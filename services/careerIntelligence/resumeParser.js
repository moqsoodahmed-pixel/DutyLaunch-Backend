/**
 * AGENT 1 — Resume Parser (spec §4, §5).
 *
 * Deterministic. No model call. Turns extracted text into the Resume JSON
 * contract, preserving the candidate's original wording in `_originalText`
 * and `_source.rawText` and recording a confidence for every field it had
 * to infer.
 *
 * Design note: this parser is intentionally conservative. Where it cannot
 * read a field it writes '' and pushes a path onto `_needsReview` rather
 * than guessing — a wrong guess that looks confident is worse than a blank
 * the candidate is asked to fill in (spec §2).
 */

import pdfParse from 'pdf-parse/lib/pdf-parse.js';
import mammoth from 'mammoth';
import { ApiError } from '../../utils/ApiError.js';
import { emptyResume, emptyExperience, emptyEducation } from './resumeSchema.js';
import { SKILL_CATEGORIES, skillCategoryOf, surfaceForms, ALL_CANONICAL_TERMS } from './taxonomy.js';

/* ------------------------------------------------------------------ *
 * Text extraction
 * ------------------------------------------------------------------ */

const PDF_MIME = 'application/pdf';
const DOCX_MIME = 'application/vnd.openxmlformats-officedocument.wordprocessingml.document';
const DOC_MIME = 'application/msword';
const TXT_MIME = 'text/plain';

/**
 * Pulls plain text out of an upload.
 * Returns { text, wasScanned } — `wasScanned` is true when a PDF yielded
 * almost no text, which means it is an image scan (spec §5).
 */
export async function extractText(buffer, mimetype) {
  try {
    if (mimetype === PDF_MIME) {
      // pdf-parse's default engine (pdf.js 1.10) rejects some valid PDFs —
      // including many produced by common generators — with "bad XRef
      // entry". Retry those with the newer engine pdf-parse also bundles.
      let result;
      try {
        result = await pdfParse(buffer);
      } catch {
        result = await pdfParse(buffer, { version: 'v2.0.550' });
      }
      const text = result.text || '';
      const pages = result.numpages || 1;
      // A text PDF gives roughly 150+ characters per page. Far less than
      // that and the pages are images, not text.
      const wasScanned = text.replace(/\s/g, '').length < pages * 60;
      return { text, wasScanned, pages };
    }
    if (mimetype === DOCX_MIME) {
      const result = await mammoth.extractRawText({ buffer });
      return { text: result.value || '', wasScanned: false, pages: null };
    }
    if (mimetype === TXT_MIME) {
      return { text: buffer.toString('utf8'), wasScanned: false, pages: null };
    }
    if (mimetype === DOC_MIME) {
      // Legacy binary .doc — best-effort. Strips the binary envelope and
      // keeps printable runs. Flagged low-confidence by the caller.
      const raw = buffer.toString('utf8').replace(/[^\x20-\x7E\n]/g, ' ');
      const text = raw.replace(/\s{3,}/g, '\n').trim();
      return { text, wasScanned: false, pages: null, lossy: true };
    }
  } catch {
    throw ApiError.badRequest("We couldn't read this file. Try re-saving it as a PDF or DOCX and upload again.");
  }
  throw ApiError.badRequest('Please upload a PDF, DOCX, DOC or TXT file.');
}

/* ------------------------------------------------------------------ *
 * Field patterns
 * ------------------------------------------------------------------ */

const EMAIL_RE = /[\w.+-]+@[\w-]+\.[a-zA-Z]{2,}/;
const PHONE_RE = /(?:\+?\d{1,3}[\s-]?)?(?:\(\d{2,4}\)[\s-]?)?\d{3,5}[\s-]?\d{3,5}(?:[\s-]?\d{2,4})?/;
const LINKEDIN_RE = /(?:https?:\/\/)?(?:[\w]{2,3}\.)?linkedin\.com\/[\w\-/%.]+/i;
const URL_RE = /(?:https?:\/\/)?(?:www\.)?[\w-]+\.(?:com|net|org|io|dev|co|in|me|ai|app)(?:\/[\w\-./%?=&#]*)?/i;

/* Month names for date parsing, incl. common abbreviations. */
const MONTHS = {
  jan: 1, january: 1, feb: 2, february: 2, mar: 3, march: 3, apr: 4, april: 4,
  may: 5, jun: 6, june: 6, jul: 7, july: 7, aug: 8, august: 8,
  sep: 9, sept: 9, september: 9, oct: 10, october: 10, nov: 11, november: 11,
  dec: 12, december: 12,
};

const MONTH_ALT = Object.keys(MONTHS).join('|');
/** "Jan 2020", "January 2020", "01/2020", "2020-01", "2020" */
const DATE_TOKEN = `(?:(?:${MONTH_ALT})[a-z]*\\.?\\s*,?\\s*\\d{4}|\\d{1,2}[/-]\\d{4}|\\d{4}[-/]\\d{1,2}|\\d{4})`;
const PRESENT = '(?:present|current|now|till\\s*date|to\\s*date|ongoing)';
const DATE_RANGE_RE = new RegExp(
  `(${DATE_TOKEN})\\s*(?:-|–|—|to|until|through)\\s*(${DATE_TOKEN}|${PRESENT})`,
  'i'
);

/* ------------------------------------------------------------------ *
 * Section segmentation
 * ------------------------------------------------------------------ */

/**
 * Heading patterns, ordered most-specific first. A line is treated as a
 * heading only when it is short, mostly not sentence-like, and matches.
 */
const SECTION_PATTERNS = [
  /* Internships and industrial training are experience. Dropping them
     because the heading says "Internships" is the difference between a
     fresher having a work history and appearing to have none — and the
     fresher persona is the one that can least afford it (spec §7). */
  [
    'experience',
    /^(work|professional|employment|career|relevant|industry|industrial)?\s*(experience|history|background)$|^employment$|^work history$|^professional background$|^(internships?|industrial training|apprenticeships?|trainings?)(\s+(experience|history))?$|^(internship|work)\s*&?\s*(experience|training)$/i,
  ],
  ['education', /^(education|academic|educational)\s*(background|qualifications?|details?|history)?$|^qualifications?$|^academics?$/i],
  ['skills', /^(technical\s+|core\s+|key\s+|professional\s+|it\s+)?(skills|competenc(?:y|ies)|expertise|proficienc(?:y|ies)|skill set)$|^areas of expertise$|^technical proficiency$/i],
  ['summary', /^(professional\s+|career\s+|executive\s+)?(summary|profile|objective|overview|about me|about)$|^career objective$|^personal statement$/i],
  ['certifications', /^(certifications?|certificates?|licences?|licenses?|credentials)$|^professional certifications?$/i],
  ['projects', /^(projects?|key projects?|academic projects?|personal projects?|project experience)$/i],
  ['achievements', /^(achievements?|accomplishments?|key achievements?|highlights?)$/i],
  ['awards', /^(awards?|honou?rs?|recognitions?|awards? (?:and|&) honou?rs?)$/i],
  ['languages', /^languages?(?:\s+known)?$/i],
  ['volunteering', /^(volunteer(?:ing)?|community|social work|extra[- ]?curricular)(?:\s+(?:work|experience|activities))?$/i],
  ['publications', /^(publications?|research|papers?|patents?)$/i],
  ['memberships', /^(memberships?|professional (?:memberships?|affiliations?)|affiliations?)$/i],
  ['portfolio', /^(portfolio|links?|profiles?|online presence)$/i],
  ['interests', /^(interests?|hobb(?:y|ies)|personal interests?)$/i],
  ['references', /^references?(?:\s+available.*)?$/i],
  ['personal', /^(personal\s+(?:details?|information|profile)|declaration)$/i],
];

/* Section headings printed by DutyLaunch's own resume templates (and
   similar wording on other resumes), so a resume downloaded from the
   Resume Builder can be uploaded again and read back correctly. */
const TEMPLATE_HEADINGS = {
  experience: ['professional experience', 'technical & engineering experience', 'executive leadership & board history', 'professional career history', 'investment banking & transaction experience', 'product design & architecture experience', 'engineering experience & internships', 'work experience & internships'],
  skills: ['core competencies & functional expertise', 'core competencies & leadership capabilities', 'core systems architecture & open source', 'design tooling & systems methodologies', 'executive capabilities & governance', 'quantitative & financial core competencies', 'technical proficiencies', 'skills & competencies', 'key skills & tools'],
  education: ['education & academic honors', 'education & academic honours', 'academic credentials', 'executive education', 'education & academic track', 'education & training'],
  certifications: ['certifications & credentials', 'certifications & licensures', 'licenses & certifications', 'licences & certifications', 'verified certifications', 'board credentials & fellowships', 'credentials & honors', 'certifications & training'],
  summary: ['professional summary', 'design philosophy & professional summary', 'executive financial profile', 'profile summary'],
  projects: ['strategic programs & transformations', 'board directorships & key transformations', 'featured design systems & case studies', 'selected m&a & financing mandates', 'strategic m&a & capital deployment', 'key projects & case studies'],
  awards: ['executive honors & awards', 'deal honors & recognitions', 'design awards & speaking', 'honors & hackathons', 'industry recognitions', 'patents & honors', 'executive recognition & publications', 'honors & awards', 'awards & recognitions'],
  _head: ['contact info', 'contact', 'contact details', 'contact information'],
};
const TEMPLATE_HEADING_KEY = new Map(
  Object.entries(TEMPLATE_HEADINGS).flatMap(([key, list]) => list.map((h) => [h, key]))
);
const normHeading = (t) => t.toLowerCase().replace(/\s+and\s+/g, ' & ').replace(/\s+/g, ' ').trim();

/**
 * PDF text extraction glues right-aligned text onto the line it sits on:
 * "Web developer2023 – 2025", "Skyup digital solutions llpBengaluru".
 * Put the missing space back (never inside emails or web addresses).
 */
function unglue(line) {
  if (!line || /@|https?:|www\.|\.com\b|linkedin/i.test(line)) return line;
  return line
    .replace(new RegExp(`([A-Za-z.)'’])((?:19|20)\\d{2}\\b|(?:${MONTH_ALT})[a-z]*\\.?\\s*\\d{4})`, 'g'), '$1 $2')
    .replace(/(^|\s)([a-z.]{3,})([A-Z][a-z]{2,}(?:\s[A-Z][a-z]+)?)$/, '$1$2 · $3');
}

function looksLikeHeading(line) {
  const t = line.trim();
  if (!t || t.length > 60) return false;
  if (/[.!?;]$/.test(t)) return false; // sentences aren't headings
  const words = t.split(/\s+/);
  if (words.length > 6) return false;
  return true;
}

function headingKey(line) {
  // Strip decoration: "— EXPERIENCE —", "1. Experience", "EXPERIENCE:"
  const cleaned = line
    .replace(/^[\s\d.)\-–—_*#•|]+/, '')
    .replace(/[\s:_\-–—*#|]+$/, '')
    .trim();
  if (!cleaned) return null;
  const known = TEMPLATE_HEADING_KEY.get(normHeading(cleaned));
  if (known) return known;
  for (const [key, re] of SECTION_PATTERNS) {
    if (re.test(cleaned)) return key;
  }
  return null;
}

/**
 * Splits the document into { sectionKey: linesArray }, plus `_head` for
 * everything above the first recognised heading (where the name and
 * contact block usually live).
 */
export function segmentSections(text) {
  const lines = text.split(/\r?\n/).map((l) => unglue(l.replace(/\t/g, ' ').replace(/\s{2,}/g, ' ').trimEnd()));
  const sections = { _head: [] };
  let current = '_head';

  for (const line of lines) {
    if (looksLikeHeading(line)) {
      const key = headingKey(line);
      if (key) {
        current = key;
        if (!sections[current]) sections[current] = [];
        continue;
      }
    }
    if (!sections[current]) sections[current] = [];
    sections[current].push(line);
  }

  Object.keys(sections).forEach((k) => {
    sections[k] = sections[k].filter((l, i, arr) => !(l.trim() === '' && arr[i - 1]?.trim() === ''));
  });

  return sections;
}

/* ------------------------------------------------------------------ *
 * Contact block
 * ------------------------------------------------------------------ */

const NAME_STOP = /(curriculum vitae|resume|cv|profile|contact|phone|email|address|mobile)/i;

function looksLikeName(line, { first = false } = {}) {
  const t = line.trim();
  if (!t || t.length < 3 || t.length > 48) return false;
  if (NAME_STOP.test(t)) return false;
  if (EMAIL_RE.test(t) || /\d/.test(t)) return false;
  const words = t.split(/\s+/);
  if (words.length < 1 || words.length > 5) return false;
  // Title Case or ALL CAPS, letters only (allow . ' -)
  if (words.every((w) => /^[A-Z][a-zA-Z.'-]*$/.test(w) || /^[A-Z.'-]+$/.test(w))) return true;
  // The very first line of a resume is almost always the name, even when
  // typed in lower case ("Srinivas sutar"): accept 2–4 plain words there.
  return first && words.length >= 2 && words.length <= 4 && words.every((w) => /^[A-Za-z][a-zA-Z.'-]*$/.test(w)) && /^[A-Z]/.test(t);
}

/** A contact line is often "email | phone | city | site": look at each piece. */
const contactPieces = (lines) => lines.flatMap((l) => l.split(/\s*[|•·]\s*|\s{3,}/)).map((p) => p.trim()).filter(Boolean);

const INDIAN_MOBILE = /(?:\+?91[\s-]?)?[6-9]\d{4}[\s-]?\d{5}\b/;

function extractContact(headLines, fullText) {
  const head = headLines.join('\n');
  const scope = head.length > 40 ? head : fullText.slice(0, 1200);

  const email = (scope.match(EMAIL_RE) || fullText.match(EMAIL_RE) || [''])[0];
  const linkedin = (scope.match(LINKEDIN_RE) || fullText.match(LINKEDIN_RE) || [''])[0];
  const pieces = contactPieces(scope.split('\n'));

  // Phone: check each piece of the contact line on its own (a whole line
  // like "email | 9538281101 | city 560001" has too many digits to judge),
  // never a date range, never part of an email or a PIN code.
  let phone = '';
  for (const piece of pieces) {
    if (EMAIL_RE.test(piece) || DATE_RANGE_RE.test(piece) || URL_RE.test(piece)) continue;
    const digits = piece.replace(/[^\d]/g, '');
    if (digits.length < 8 || digits.length > 15) continue;
    const m = piece.match(INDIAN_MOBILE) || piece.match(PHONE_RE);
    if (m && m[0].replace(/[^\d]/g, '').length >= 8) {
      phone = m[0].trim();
      break;
    }
  }

  // Website: a URL that isn't the LinkedIn one and isn't an email domain.
  let website = '';
  for (const m of scope.matchAll(new RegExp(URL_RE, 'gi'))) {
    const candidate = m[0];
    if (/linkedin\.com/i.test(candidate)) continue;
    if (email && email.includes(candidate.replace(/^https?:\/\//, ''))) continue;
    website = candidate;
    break;
  }

  // Name: first line in the head that reads like a person's name.
  let name = '';
  let nameIndex = -1;
  const firstFilled = headLines.findIndex((l) => l.trim());
  for (let i = 0; i < Math.min(headLines.length, 8); i += 1) {
    if (looksLikeName(headLines[i], { first: i === firstFilled })) {
      name = headLines[i].trim();
      nameIndex = i;
      break;
    }
  }

  // Location: a piece with a comma, letters, and optionally a PIN code
  // ("bengaluru, India 560001"), near the top.
  let location = '';
  for (const piece of pieces) {
    const t = piece.replace(/^[|•\-\s]+/, '').trim();
    if (!t || t === name) continue;
    if (EMAIL_RE.test(t) || LINKEDIN_RE.test(t) || URL_RE.test(t)) continue;
    if (/,/.test(t) && t.length < 70 && /^[A-Za-z\s,.\-()]+(?:\s*\d{6})?$/.test(t)) {
      location = t;
      break;
    }
  }

  // Headline: the short line right under the name ("Web Developer"),
  // if it is not contact details or a section heading.
  let headline = '';
  if (nameIndex >= 0) {
    const next = (headLines.slice(nameIndex + 1).find((l) => l.trim()) || '').trim();
    if (next && next.length <= 70 && !EMAIL_RE.test(next) && !URL_RE.test(next) && !/\d{5,}/.test(next) && !/[|•]/.test(next) && next !== location && !headingKey(next)) {
      headline = next;
    }
  }

  return { name, email, phone, location, linkedin, website, headline };
}

/* ------------------------------------------------------------------ *
 * Dates
 * ------------------------------------------------------------------ */

/** Normalises any recognised date token to `YYYY-MM` (or `YYYY`). */
export function normaliseDate(token) {
  if (!token) return '';
  const t = String(token).trim().toLowerCase();
  if (new RegExp(`^${PRESENT}$`, 'i').test(t)) return 'present';

  const monthYear = t.match(new RegExp(`^(${MONTH_ALT})[a-z]*\\.?\\s*,?\\s*(\\d{4})$`, 'i'));
  if (monthYear) {
    const m = MONTHS[monthYear[1].slice(0, 4)] ?? MONTHS[monthYear[1].slice(0, 3)];
    return m ? `${monthYear[2]}-${String(m).padStart(2, '0')}` : monthYear[2];
  }
  const numeric = t.match(/^(\d{1,2})[/-](\d{4})$/);
  if (numeric) return `${numeric[2]}-${String(Number(numeric[1])).padStart(2, '0')}`;
  const iso = t.match(/^(\d{4})[-/](\d{1,2})$/);
  if (iso) return `${iso[1]}-${String(Number(iso[2])).padStart(2, '0')}`;
  const yearOnly = t.match(/^(\d{4})$/);
  if (yearOnly) return yearOnly[1];
  return '';
}

/** Finds a start/end pair anywhere in a block of text. */
export function findDateRange(text) {
  const m = String(text || '').match(DATE_RANGE_RE);
  if (!m) {
    // A lone date is still useful (e.g. graduation year).
    const single = String(text || '').match(new RegExp(DATE_TOKEN, 'i'));
    if (single) return { startDate: normaliseDate(single[0]), endDate: '', current: false, confidence: 0.4 };
    return { startDate: '', endDate: '', current: false, confidence: 0 };
  }
  const endRaw = m[2];
  const current = new RegExp(PRESENT, 'i').test(endRaw);
  return {
    startDate: normaliseDate(m[1]),
    endDate: current ? '' : normaliseDate(endRaw),
    current,
    confidence: 0.9,
  };
}

/* ------------------------------------------------------------------ *
 * Experience
 * ------------------------------------------------------------------ */

const BULLET_RE = /^[\s]*[•▪◦‣·*\-–—o>»]\s+/;
const EMPLOYMENT_TYPES = /(full[- ]?time|part[- ]?time|contract|freelance|internship|intern|consultant|temporary|permanent|volunteer)/i;

function stripBullet(line) {
  return line.replace(BULLET_RE, '').trim();
}

function isBullet(line) {
  return BULLET_RE.test(line);
}

/**
 * Splits an experience section into role blocks.
 *
 * A dated, non-bullet line is the most reliable role boundary across CV
 * layouts — but it is not always the *first* line of the role. Two very
 * common layouts have to work:
 *
 *   Operations Manager, PayNext          <- header
 *   Bengaluru | Jan 2021 - Present       <- dates on the next line
 *
 *   Operations Manager, PayNext | Jan 2021 - Present   <- all on one line
 *
 * So when a dated line arrives we do one of two things. If the open block
 * has no dates yet and no bullets, the dated line simply belongs to it
 * (layout one, first role). Otherwise we close the block and carry any
 * trailing header lines — the lines sitting after that block's last
 * bullet — forward into the new one, because those describe the role that
 * is starting, not the one that just ended. Without this the title and
 * company end up one role out of step with the dates and bullets.
 */
function looksLikeRoleHeader(line) {
  const t = line.trim();
  if (!t || isBullet(t) || t.length > 120) return false;
  // A header is short and has no sentence-ending punctuation mid-line.
  return !/[.;]\s/.test(t);
}

function splitRoleBlocks(lines) {
  const blocks = [];
  let currentBlock = null;

  const closeAndCarry = () => {
    // Everything after the last bullet is a header for the *next* role.
    const carried = [];
    let lastBulletIndex = -1;
    currentBlock.lines.forEach((l, i) => {
      if (isBullet(l)) lastBulletIndex = i;
    });

    while (currentBlock.lines.length > lastBulletIndex + 1) {
      const last = currentBlock.lines[currentBlock.lines.length - 1];
      if (!last.trim()) {
        currentBlock.lines.pop();
        continue;
      }
      if (!looksLikeRoleHeader(last) || carried.length >= 2) break;
      carried.unshift(currentBlock.lines.pop());
    }

    if (currentBlock.lines.some((l) => l.trim())) blocks.push(currentBlock);
    return carried;
  };

  lines.forEach((line) => {
    const t = line.trim();
    if (!t) {
      if (currentBlock) currentBlock.lines.push('');
      return;
    }
    const hasDate = DATE_RANGE_RE.test(t);
    const bullet = isBullet(t);

    if (hasDate && !bullet) {
      const openBlockIsJustAHeader =
        currentBlock &&
        !currentBlock.lines.some((l) => isBullet(l)) &&
        !currentBlock.lines.some((l) => DATE_RANGE_RE.test(l));

      if (openBlockIsJustAHeader) {
        // The dates belong to the header we are already holding.
        currentBlock.lines.push(t);
        return;
      }

      const carried = currentBlock ? closeAndCarry() : [];
      currentBlock = { lines: [...carried, t] };
      return;
    }

    if (!currentBlock) currentBlock = { lines: [t] };
    else currentBlock.lines.push(t);
  });

  if (currentBlock && currentBlock.lines.some((l) => l.trim())) blocks.push(currentBlock);
  return blocks;
}

/**
 * Reads company and title from a role block's header lines. CVs use both
 * orders ("Acme Corp — Operations Manager" and "Operations Manager, Acme"),
 * so we score each candidate rather than assuming a layout.
 */
function readCompanyAndTitle(headerLines) {
  const joined = headerLines.join(' | ');
  const cleaned = joined.replace(DATE_RANGE_RE, '').replace(/\|\s*\|/g, '|');

  const parts = cleaned
    .split(/[|,•·]|\s[-–—]\s|\sat\s/i)
    .map((p) => p.trim())
    .filter((p) => p.length > 1 && p.length < 90 && !/^\d+$/.test(p));

  const COMPANY_HINT = /(ltd|limited|inc|llc|llp|pvt|private|plc|gmbh|corp|corporation|technologies|solutions|services|systems|group|bank|university|college|hospital|consulting|industries|enterprises|labs|studio|agency|foundation|&)/i;
  const TITLE_HINT = /(manager|engineer|developer|analyst|executive|officer|director|lead|head|consultant|specialist|associate|coordinator|administrator|assistant|intern|architect|designer|scientist|supervisor|president|partner|advisor|accountant|recruiter|nurse|teacher|trainer|operator|technician)/i;

  let title = '';
  let company = '';
  let employmentType = '';

  const typeMatch = cleaned.match(EMPLOYMENT_TYPES);
  if (typeMatch) employmentType = typeMatch[0];

  for (const part of parts) {
    if (!title && TITLE_HINT.test(part)) {
      title = part;
      continue;
    }
    if (!company && COMPANY_HINT.test(part)) {
      company = part;
    }
  }

  const remaining = parts.filter((p) => p !== title && p !== company);
  if (!title && remaining.length) title = remaining.shift();
  if (!company && remaining.length) company = remaining.shift();

  /* Only strip an employment type when it is parenthetical decoration
     ("Operations Manager (Contract)"). "Software Engineering Intern" is
     the candidate's actual job title and must survive intact. */
  const strip = (s) =>
    String(s || '')
      .replace(/\(\s*(?:full[- ]?time|part[- ]?time|contract|freelance|internship|intern|consultant|temporary|permanent|volunteer)\s*\)/gi, '')
      .replace(/[()]/g, '')
      .replace(/\s{2,}/g, ' ')
      .trim();

  return {
    title: strip(title),
    company: strip(company),
    employmentType,
    // Whatever is left over in the header — the location usually lives here.
    leftovers: remaining.filter((p) => p !== title && p !== company),
  };
}

/**
 * Picks a location out of the header fragments the title and company did
 * not claim. Matching against the whole header line instead would happily
 * read "Operations Manager, PayNext" as a city and country.
 */
const LOCATION_NOISE = /(ltd|limited|inc|llc|pvt|manager|engineer|analyst|executive|officer|director|present|current|remote work)/i;

function readLocation(leftovers) {
  for (const part of leftovers) {
    const t = part.trim();
    if (!t || t.length > 60 || LOCATION_NOISE.test(t)) continue;
    if (DATE_RANGE_RE.test(t) || /\d{4}/.test(t)) continue;
    // One to three capitalised words, optionally "City, Country".
    if (/^[A-Z][a-zA-Z.'-]+(?:\s[A-Z][a-zA-Z.'-]+){0,2}$/.test(t)) return t;
  }
  return '';
}

/** Achievements carry a number or a result verb; everything else is a duty. */
const RESULT_SIGNAL = /(\d+\s*%|\d+\s*(?:k|m|bn|cr|lakh|lakhs|crore|million|billion)|₹|\$|£|€|increas|decreas|reduc|improv|grew|growth|saved|savings|achiev|deliver|exceed|won|award|launch|generat|boost|optimis|optimiz|accelerat|cut\b)/i;

function classifyBullets(bullets) {
  const responsibilities = [];
  const achievements = [];
  bullets.forEach((b) => {
    if (RESULT_SIGNAL.test(b)) achievements.push(b);
    else responsibilities.push(b);
  });
  return { responsibilities, achievements };
}

function parseExperience(lines) {
  if (!lines?.length) return [];

  return splitRoleBlocks(lines)
    .map((block, index) => {
      const raw = block.lines.join('\n').trim();
      if (!raw) return null;

      const role = emptyExperience();
      role.id = `exp_${index + 1}`;
      role._originalText = raw;

      const dates = findDateRange(raw);
      role.startDate = dates.startDate;
      role.endDate = dates.endDate;
      role.current = dates.current;

      const bulletLines = block.lines.filter((l) => isBullet(l)).map(stripBullet);
      // Header = up to 3 short lines (title, company, dates). Stop at the
      // first full sentence: in PDFs without bullet symbols, the first
      // duty line would otherwise be swallowed into the header and lost.
      const headerLines = [];
      for (const l of block.lines.filter((x) => x.trim() && !isBullet(x))) {
        if (headerLines.length >= 3) break;
        const t = l.trim();
        const sentence = /[.!?]$/.test(t) || t.split(/\s+/).length > 12;
        if (sentence && headerLines.length) break;
        headerLines.push(l);
      }

      const { title, company, employmentType, leftovers } = readCompanyAndTitle(headerLines);
      role.title = title;
      role.company = company;
      role.employmentType = employmentType;
      role.location = readLocation(leftovers);

      // If the block has no bullet characters at all, treat non-header
      // sentence lines as duties so prose CVs are not dropped.
      const fallbackLines =
        bulletLines.length === 0
          ? block.lines
              .filter((l) => l.trim() && !headerLines.includes(l))
              .flatMap((l) => l.split(/(?<=\.)\s+(?=[A-Z])/))
              .map((l) => l.trim())
              .filter((l) => l.length > 25)
          : [];

      const bullets = (bulletLines.length ? bulletLines : fallbackLines).filter((b) => b.length > 3);
      const { responsibilities, achievements } = classifyBullets(bullets);
      role.responsibilities = responsibilities;
      role.achievements = achievements;
      role.skillsUsed = detectSkillTerms(raw).slice(0, 12);

      const hasAnything = role.company || role.title || bullets.length;
      return hasAnything ? role : null;
    })
    .filter(Boolean);
}

/* ------------------------------------------------------------------ *
 * Education
 * ------------------------------------------------------------------ */

const DEGREE_RE = /\b(ph\.?d|doctorate|m\.?b\.?a|m\.?tech|m\.?sc|m\.?a\b|m\.?com|m\.?s\b|masters?|b\.?tech|b\.?e\b|b\.?sc|b\.?a\b|b\.?com|b\.?b\.?a|b\.?c\.?a|m\.?c\.?a|bachelors?|diploma|associate degree|hsc|sslc|12th|10th|intermediate|secondary|higher secondary|pgdm|pgd|llb|llm|md\b|mbbs|ca\b|cfa|cpa)\b/i;
const INSTITUTION_HINT = /(university|college|institute|school|academy|polytechnic|iit|nit|iim|bits|vtu|anna university|board)/i;

/** DEGREE_RE without false hits on everyday "be" ("deemed to be university"). */
const isDegree = (t) => DEGREE_RE.test(String(t || '').replace(/\b(?:to|will|can|may|must|would|should|could|shall|might)\s+be\b/gi, ' '));

function parseEducation(lines) {
  if (!lines?.length) return [];

  const blocks = [];
  let block = [];
  lines.forEach((line) => {
    const t = line.trim();
    if (!t) {
      if (block.length) blocks.push(block);
      block = [];
      return;
    }
    // A degree mention or a date starts a new entry when one is open.
    // A new entry starts when this line repeats what the open entry already
    // has (a second degree, or a second institution). "Degree" on one line
    // and "University" on the next is ONE entry, not two.
    const joined = block.join(' ');
    const repeatsDegree = isDegree(t) && isDegree(joined);
    const repeatsInstitution = INSTITUTION_HINT.test(t) && INSTITUTION_HINT.test(joined);
    if (block.length && (repeatsDegree || repeatsInstitution)) {
      blocks.push(block);
      block = [t];
      return;
    }
    block.push(t);
  });
  if (block.length) blocks.push(block);

  return blocks
    .map((b, index) => {
      const raw = b.join('\n').trim();
      if (!raw) return null;
      const entry = emptyEducation();
      entry.id = `edu_${index + 1}`;
      entry._originalText = raw;

      const dates = findDateRange(raw);
      entry.startDate = dates.startDate;
      entry.endDate = dates.endDate || (dates.startDate && !dates.endDate ? dates.startDate : '');

      /* Education is written on one line at least as often as on two
         ("MBA, Operations, Christ University, 2018"), so each line is
         broken into fragments and each fragment is assigned on its own
         merits. Assigning the whole line to both degree and institution
         — as a naive line-level match does — makes every downstream
         education check meaningless. */
      const clean = (s) =>
        String(s || '')
          .replace(DATE_RANGE_RE, '')
          .replace(/[|•]/g, ' ')
          .replace(/,\s*$/, '')
          .replace(/\s+(?:19|20)\d{2}$/, '')
          .replace(/\s{2,}/g, ' ')
          .trim();

      const fragments = b
        .flatMap((line) => line.split(/[,|•·]|\s[-–—]\s/))
        .map(clean)
        .filter((f) => f.length > 1 && !/^\d{4}$/.test(f));

      let afterInstitution = false;
      for (const frag of fragments) {
        if (!entry.degree && isDegree(frag)) {
          entry.degree = frag.slice(0, 120);
          afterInstitution = false;
          continue;
        }
        if (!entry.institution && INSTITUTION_HINT.test(frag)) {
          entry.institution = frag.slice(0, 140);
          afterInstitution = true;
          continue;
        }
        // "University, Bengaluru" / "University · Bengaluru": a short place
        // name right after the institution is its location, not the field.
        if (afterInstitution && !entry.location && /^[A-Za-z][A-Za-z .'-]{1,40}$/.test(frag) && frag.split(/\s+/).length <= 3) {
          entry.location = frag;
        }
        afterInstitution = false;
      }

      // "Master's degree in Computer Science" → degree + field.
      if (entry.degree && !entry.field) {
        const m = entry.degree.match(/^(.+?)\s+in\s+([A-Za-z&/ .'-]{3,60})$/i);
        if (m) {
          entry.degree = m[1].trim();
          entry.field = m[2].trim();
        }
      }

      // Whatever is left between a degree and an institution is the field.
      if (!entry.field) {
        const leftover = fragments.find(
          (f) => f !== entry.degree && f !== entry.institution && f !== entry.location && !/^\d/.test(f) && f.length > 2 && f.length < 60
        );
        if (leftover && (entry.degree || entry.institution)) entry.field = leftover;
      }

      // Fall back to whole lines when the fragments told us nothing.
      if (!entry.degree) {
        const line = b.find((l) => isDegree(l));
        if (line) entry.degree = clean(line).slice(0, 120);
      }
      if (!entry.institution) {
        const line = b.find((l) => INSTITUTION_HINT.test(l) && clean(l) !== entry.degree);
        if (line) entry.institution = clean(line).slice(0, 140);
      }

      const gradeMatch = raw.match(/\b(?:cgpa|gpa|percentage|score|marks)\s*[:\-]?\s*([\d.]+\s*%?(?:\s*\/\s*[\d.]+)?)/i);
      if (gradeMatch) entry.grade = gradeMatch[1].trim();

      if (!entry.field) {
        const fieldMatch = raw.match(/\b(?:in|of)\s+([A-Z][A-Za-z&\s]{3,40})(?:$|[,\n(])/);
        if (fieldMatch) entry.field = fieldMatch[1].trim();
      }

      if (!entry.degree && !entry.institution) {
        entry.institution = b[0].slice(0, 140);
      }
      return entry;
    })
    .filter(Boolean);
}

/* ------------------------------------------------------------------ *
 * Skills
 * ------------------------------------------------------------------ */

/** Every taxonomy term whose surface form appears in the text. */
export function detectSkillTerms(text) {
  const source = String(text || '');
  const found = new Map(); // canonical -> the wording the candidate used

  ALL_CANONICAL_TERMS.forEach((term) => {
    for (const form of surfaceForms(term)) {
      // Word-boundary match so "java" never matches inside "javascript".
      const escaped = form.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
      const match = source.match(new RegExp(`(?:^|[^a-zA-Z0-9+#.])(${escaped})(?:[^a-zA-Z0-9+#]|$)`, 'i'));
      if (match) {
        /* Record what the candidate actually wrote, not the canonical
           label. A CV that says "Excel" must not come back claiming
           "Advanced Excel" — the canonical form exists for matching, and
           promoting it into the resume would be inventing a skill level
           the candidate never stated (spec §2). */
        found.set(term, match[1].trim());
        break;
      }
    }
  });

  return Array.from(found.values());
}

function parseSkills(skillLines, fullText) {
  const buckets = { technical: [], functional: [], soft: [], tools: [], industry: [] };
  const seen = new Set();

  const add = (raw) => {
    const term = String(raw || '').trim().replace(/[.;]+$/, '');
    if (!term || term.length > 60) return;
    const key = term.toLowerCase();
    if (seen.has(key)) return;
    seen.add(key);
    buckets[skillCategoryOf(term)].push(term);
  };

  // 1. The candidate's own Skills section, preserving their wording.
  (skillLines || []).forEach((line) => {
    const cleaned = stripBullet(line).replace(/^(technical|soft|core|key|other)\s+skills?\s*[:\-]/i, '');
    if (!cleaned.trim()) return;
    cleaned
      .split(/[,;|•·/]|\s{3,}/)
      .map((s) => s.trim())
      .filter((s) => s.length > 1 && s.length < 60 && !/^\d+$/.test(s))
      .forEach(add);
  });

  // 2. Taxonomy terms found anywhere else in the CV, so a skill proved in
  //    an experience bullet still counts (spec §6).
  //    Section headings are left out: "Core Competencies & Leadership
  //    Capabilities" is a heading, not proof of a leadership skill.
  const withoutHeadings = String(fullText || '')
    .split(/\r?\n/)
    .filter((l) => !(looksLikeHeading(l) && headingKey(l)))
    .join('\n');
  detectSkillTerms(withoutHeadings).forEach(add);

  return buckets;
}

/* ------------------------------------------------------------------ *
 * Simple list sections
 * ------------------------------------------------------------------ */

function parseList(lines, { max = 30, minLength = 3 } = {}) {
  return (lines || [])
    .map(stripBullet)
    .map((l) => l.trim())
    .filter((l) => l.length >= minLength && l.length < 400)
    .slice(0, max);
}

function parseCertifications(lines) {
  return parseList(lines, { max: 30 }).map((line) => {
    const dateMatch = line.match(new RegExp(DATE_TOKEN, 'i'));
    const issuerMatch = line.match(/(?:by|from|—|–|-|\|)\s*([A-Z][\w&.\s]{2,50})$/);
    return {
      name: line.replace(DATE_RANGE_RE, '').replace(/\s{2,}/g, ' ').trim().slice(0, 160),
      issuer: issuerMatch ? issuerMatch[1].trim() : '',
      issueDate: dateMatch ? normaliseDate(dateMatch[0]) : '',
      expiryDate: '',
      credentialId: '',
      link: (line.match(URL_RE) || [''])[0],
    };
  });
}

function parseProjects(lines) {
  const blocks = [];
  let block = [];
  (lines || []).forEach((line) => {
    if (!line.trim()) {
      if (block.length) blocks.push(block);
      block = [];
      return;
    }
    if (!isBullet(line) && block.length && block.some(isBullet)) {
      blocks.push(block);
      block = [line];
      return;
    }
    block.push(line);
  });
  if (block.length) blocks.push(block);

  return blocks
    .map((b, i) => {
      const header = b.find((l) => !isBullet(l))?.trim() || b[0]?.trim() || '';
      if (!header) return null;
      const bullets = b.filter(isBullet).map(stripBullet);
      return {
        id: `prj_${i + 1}`,
        name: header.replace(DATE_RANGE_RE, '').replace(/[|•]/g, ' ').replace(/\s{2,}/g, ' ').trim().slice(0, 140),
        role: '',
        description: bullets[0] || '',
        technologies: detectSkillTerms(b.join(' ')).slice(0, 10),
        link: (b.join(' ').match(URL_RE) || [''])[0],
        startDate: findDateRange(b.join(' ')).startDate,
        endDate: findDateRange(b.join(' ')).endDate,
        highlights: bullets.slice(1),
      };
    })
    .filter(Boolean)
    .slice(0, 20);
}

function parseLanguages(lines) {
  const out = [];
  parseList(lines, { max: 20, minLength: 2 }).forEach((line) => {
    line
      .split(/[,;|•·]/)
      .map((s) => s.trim())
      .filter(Boolean)
      .forEach((chunk) => {
        const m = chunk.match(/^([A-Za-z\s]{2,30}?)\s*[\-–—(:]\s*([A-Za-z\s]{3,25})\)?$/);
        if (m) out.push({ name: m[1].trim(), proficiency: m[2].trim() });
        else if (chunk.length < 30) out.push({ name: chunk, proficiency: '' });
      });
  });
  return out.slice(0, 15);
}

/* ------------------------------------------------------------------ *
 * Main entry point
 * ------------------------------------------------------------------ */

/**
 * Parses extracted text into the Resume JSON contract.
 * Pure and synchronous — safe to unit test without a file or a network.
 */
export function parseResumeText(text, meta = {}) {
  if (!text || text.trim().length < 40) {
    throw ApiError.badRequest(
      "We couldn't read enough text from this file. If it's a scan, upload a text-based PDF or DOCX instead."
    );
  }

  const resume = emptyResume();
  const sections = segmentSections(text);
  const confidence = {};
  const needsReview = [];

  /* --- contact ------------------------------------------------- */
  const contact = extractContact(sections._head || [], text);
  resume.personal = { ...resume.personal, ...contact };

  confidence['personal.name'] = contact.name ? 0.8 : 0;
  confidence['personal.email'] = contact.email ? 0.95 : 0;
  confidence['personal.phone'] = contact.phone ? 0.85 : 0;
  confidence['personal.location'] = contact.location ? 0.5 : 0;

  if (!contact.name) needsReview.push('personal.name');
  if (!contact.email) needsReview.push('personal.email');
  if (!contact.phone) needsReview.push('personal.phone');

  /* --- summary ------------------------------------------------- */
  const summaryLines = sections.summary || [];
  if (summaryLines.length) {
    resume.summary = summaryLines.map(stripBullet).join(' ').replace(/\s{2,}/g, ' ').trim().slice(0, 2000);
    confidence.summary = 0.9;
  } else {
    // A paragraph in the head block, below the contact details, is very
    // often an unlabelled summary.
    const candidate = (sections._head || [])
      .filter((l) => l.trim().length > 90 && !EMAIL_RE.test(l))
      .join(' ')
      .trim();
    if (candidate) {
      resume.summary = candidate.slice(0, 2000);
      confidence.summary = 0.4;
      needsReview.push('summary');
    }
  }

  /* --- experience ---------------------------------------------- */
  resume.experience = parseExperience(sections.experience || []);

  /* Plenty of real CVs — especially ones typed straight into a Word
     document — have no headings at all. When nothing was recognised, fall
     back to reading dated prose out of the unlabelled block rather than
     reporting an empty work history, which would be both wrong and the
     single most damaging thing to get wrong. Anything recovered this way
     is marked low-confidence so the review step surfaces it. */
  if (!resume.experience.length) {
    const unlabelled = (sections._head || []).filter((l) => !EMAIL_RE.test(l));
    const hasDatedProse = unlabelled.some((l) => DATE_RANGE_RE.test(l));
    if (hasDatedProse) {
      resume.experience = parseExperience(unlabelled);
      resume.experience.forEach((role) => {
        role._recoveredWithoutHeading = true;
      });
    }
  }

  resume.experience.forEach((role, i) => {
    const penalty = role._recoveredWithoutHeading ? 0.5 : 1;
    confidence[`experience.${i}.company`] = role.company ? 0.7 * penalty : 0;
    confidence[`experience.${i}.title`] = role.title ? 0.7 * penalty : 0;
    confidence[`experience.${i}.startDate`] = role.startDate ? 0.85 * penalty : 0;
    confidence[`experience.${i}.endDate`] = role.current || role.endDate ? 0.85 * penalty : 0;
    if (!role.company) needsReview.push(`experience.${i}.company`);
    if (!role.title) needsReview.push(`experience.${i}.title`);
    if (!role.startDate) needsReview.push(`experience.${i}.startDate`);
    if (role._recoveredWithoutHeading && !needsReview.includes(`experience.${i}.company`)) {
      needsReview.push(`experience.${i}.company`);
    }
  });

  /* --- education ----------------------------------------------- */
  resume.education = parseEducation(sections.education || []);
  resume.education.forEach((e, i) => {
    confidence[`education.${i}.institution`] = e.institution ? 0.7 : 0;
    confidence[`education.${i}.degree`] = e.degree ? 0.75 : 0;
    if (!e.degree) needsReview.push(`education.${i}.degree`);
  });

  /* --- skills and the optional sections ------------------------- */
  resume.skills = parseSkills(sections.skills, text);
  resume.certifications = parseCertifications(sections.certifications);
  resume.projects = parseProjects(sections.projects);
  resume.achievements = parseList(sections.achievements);
  resume.awards = parseList(sections.awards);
  resume.languages = parseLanguages(sections.languages);
  resume.volunteering = parseList(sections.volunteering);
  resume.publications = parseList(sections.publications);
  resume.professionalMemberships = parseList(sections.memberships);
  resume.portfolio = parseList(sections.portfolio, { minLength: 4 });

  // Anything under a heading we recognised as a heading but have no first-
  // class home for is kept, not discarded (spec §3: optional sections).
  ['interests', 'personal'].forEach((key) => {
    const items = parseList(sections[key]);
    if (items.length) {
      resume.customSections.push({
        title: key === 'interests' ? 'Interests' : 'Additional information',
        items,
        body: '',
      });
    }
  });

  /* --- provenance ---------------------------------------------- */
  resume._source = {
    rawText: text,
    fileName: meta.fileName || '',
    fileType: meta.fileType || '',
    parsedAt: new Date().toISOString(),
    wasScanned: Boolean(meta.wasScanned),
    ocrUsed: Boolean(meta.ocrUsed),
  };
  resume._confidence = confidence;
  resume._needsReview = Array.from(new Set(needsReview));

  if (meta.lossy) {
    resume._needsReview.push('_source.fileType');
  }

  return resume;
}

/** Convenience wrapper: upload buffer -> Resume JSON. */
export async function parseResumeFile({ buffer, mimetype, fileName }) {
  const { text, wasScanned, lossy } = await extractText(buffer, mimetype);

  if (wasScanned) {
    // Spec §5 — detect it, say so plainly, and let the candidate correct
    // course rather than returning a confidently empty parse.
    throw ApiError.badRequest(
      'This looks like a scanned or image-only PDF, so there is no text to read. Upload a text-based PDF or DOCX, or paste your CV text instead.'
    );
  }

  return parseResumeText(text, { fileName, fileType: mimetype, wasScanned, lossy });
}