/**
 * LinkedIn profile PDF import.
 *
 * Reads the PDF a member downloads themselves from LinkedIn ("More" →
 * "Save to PDF") and turns it into the standard DutyLaunch resume JSON, so
 * the same review screen, scoring engine and generators work on it.
 *
 * What this does NOT do: it never contacts LinkedIn, never scrapes a
 * profile, and never treats a profile URL as imported data. A URL the
 * candidate pastes is stored as a reference only.
 *
 * LinkedIn's export layout (as text) is:
 *   sidebar  — Contact, Top Skills, Languages, Certifications, Honors-Awards…
 *   header   — Name, Headline, Location
 *   main     — Summary, Experience, Education, …
 *   footer   — "Page N of M" on every page
 * Roles appear as  Company / Title / "Month Year - Month Year (duration)" /
 * Location / description, with several titles grouped under one company
 * when the member held more than one role there.
 *
 * Every field records a confidence so the review step can ask the candidate
 * about anything we guessed. Nothing is invented: a field we cannot read is
 * left empty and flagged.
 */

import { emptyResume, emptyExperience, emptyEducation } from './resumeSchema.js';
import { normaliseDate } from './resumeParser.js';

const SIDEBAR_HEADINGS = ['Contact', 'Top Skills', 'Languages', 'Certifications', 'Honors-Awards', 'Publications', 'Patents'];
const MAIN_HEADINGS = ['Summary', 'Experience', 'Education', 'Volunteer Experience', 'Projects', 'Courses', 'Organizations', 'Recommendations', 'Licenses & Certifications'];
const ALL_HEADINGS = new Set([...SIDEBAR_HEADINGS, ...MAIN_HEADINGS]);

const MONTH = '(?:Jan(?:uary)?|Feb(?:ruary)?|Mar(?:ch)?|Apr(?:il)?|May|June?|July?|Aug(?:ust)?|Sep(?:tember)?|Oct(?:ober)?|Nov(?:ember)?|Dec(?:ember)?)';
const DATE_TOKEN = `(?:${MONTH}\\s+\\d{4}|\\d{4})`;
const DATE_RANGE_RE = new RegExp(`^(${DATE_TOKEN})\\s*[-–—]\\s*(Present|${DATE_TOKEN})\\s*(?:\\(([^)]*)\\))?\\s*$`, 'i');
const DURATION_ONLY_RE = /^(?:\d+\s+(?:years?|yrs?|months?|mos?)\s*)+$/i;
const PAGE_RE = /^\s*Page\s+\d+\s+of\s+\d+\s*$/i;
const EMAIL_RE = /[\w.+-]+@[\w-]+\.[\w.]+/;
const PHONE_RE = /(?:\+?\d[\d\s().-]{7,}\d)/;
const LINKEDIN_RE = /(?:www\.)?linkedin\.com\/in\/[\w\-%]+\/?/i;

/** True when the extracted text looks like a LinkedIn "Save to PDF" export. */
export function looksLikeLinkedInExport(text = '') {
  const t = String(text);
  const signals = [
    /linkedin\.com\/in\//i.test(t),
    /^\s*Top Skills\s*$/im.test(t),
    /^\s*Page \d+ of \d+\s*$/im.test(t),
    /^\s*Experience\s*$/im.test(t),
    /^\s*Contact\s*$/im.test(t),
  ];
  return signals.filter(Boolean).length >= 3;
}

/** Validates a LinkedIn profile URL the candidate pastes (reference only). */
export function normaliseLinkedInUrl(raw = '') {
  const m = String(raw).trim().match(/^(?:https?:\/\/)?(?:[a-z]{2,3}\.)?linkedin\.com\/in\/([\w\-%]{3,100})\/?(?:[?#].*)?$/i);
  return m ? `https://www.linkedin.com/in/${m[1]}` : null;
}

function splitSections(lines) {
  const sections = { _preamble: [] };
  let current = '_preamble';
  for (const line of lines) {
    if (ALL_HEADINGS.has(line)) {
      current = line;
      sections[current] = sections[current] || [];
      continue;
    }
    sections[current].push(line);
  }
  return sections;
}

function parseDateRange(line) {
  const m = line.match(DATE_RANGE_RE);
  if (!m) return null;
  const current = /present/i.test(m[2]);
  return {
    startDate: normaliseDate(m[1]) || '',
    endDate: current ? '' : normaliseDate(m[2]) || '',
    current,
  };
}

const looksLikeLocation = (s) => s.length <= 80 && /,/.test(s) && !/[.!?]$/.test(s) && !DATE_RANGE_RE.test(s);

/**
 * The header (name / headline / location) is the run of non-heading lines
 * that sits just before "Summary" or "Experience" — in LinkedIn's export it
 * trails the sidebar content.
 */
function extractHeader(sections, orderedLines) {
  const firstMain = orderedLines.findIndex((l) => MAIN_HEADINGS.includes(l));
  // Without a Summary/Experience heading this is not a LinkedIn export, and
  // guessing a name from arbitrary lines would be inventing data.
  if (firstMain < 0) return { name: '', headline: '', location: '', headerLines: [] };
  const before = orderedLines.slice(0, firstMain);

  // Walk back from the first main heading until we hit a sidebar heading.
  const header = [];
  for (let i = before.length - 1; i >= 0; i -= 1) {
    if (ALL_HEADINGS.has(before[i])) break;
    header.unshift(before[i]);
  }
  // The sidebar section that precedes the header also swallowed it; the
  // header is always the last 1–3 lines of that run.
  const tail = header.slice(-3);
  let name = '';
  let headline = '';
  let location = '';
  if (tail.length === 3) [name, headline, location] = tail;
  else if (tail.length === 2) {
    [name, headline] = tail;
    if (looksLikeLocation(headline)) [location, headline] = [headline, ''];
  } else if (tail.length === 1) [name] = tail;

  if (location && !looksLikeLocation(location)) {
    headline = [headline, location].filter(Boolean).join(' ');
    location = '';
  }
  return { name, headline, location, headerLines: tail };
}

/* A description line reads like a sentence; a company name does not. */
const isSentence = (l = '') => /[.!?;:]$/.test(l) || l.length > 70 || /^[•●▪\-*]/.test(l);

function parseExperience(lines) {
  const dateIdx = lines.map((l, i) => (DATE_RANGE_RE.test(l) ? i : -1)).filter((i) => i >= 0);

  /* Pass 1 — where each role's header starts and which company it belongs to.
       Company / duration / Title / dates   → first role of a company group
       Company / Title / dates              → single role at a company
       <previous description> / Title / dates → next role in the same group */
  let groupCompany = '';
  const heads = dateIdx.map((di, n) => {
    const titleIdx = di - 1;
    const prevEnd = n > 0 ? dateIdx[n - 1] : -1;
    const lineA = lines[di - 2];
    let company = '';
    let start = titleIdx;
    let companyConfidence = 0.8;
    if (lineA !== undefined && di - 2 > prevEnd && DURATION_ONLY_RE.test(lineA) && di - 3 > prevEnd) {
      company = lines[di - 3];
      groupCompany = company;
      start = di - 3;
    } else if (lineA !== undefined && di - 2 > prevEnd && !isSentence(lineA) && !(n > 0 && lineA === lines[prevEnd + 1])) {
      company = lineA;
      groupCompany = company;
      start = di - 2;
    } else if (groupCompany) {
      company = groupCompany;
      companyConfidence = 0.65;
    } else {
      companyConfidence = 0;
    }
    return { di, titleIdx, start, company, companyConfidence };
  });

  /* Pass 2 — build each role; its body runs up to the next role's header. */
  return heads.map((h, n) => {
    const role = emptyExperience();
    Object.assign(role, parseDateRange(lines[h.di]));
    role.title = lines[h.titleIdx] || '';
    role.company = h.company;

    let start = h.di + 1;
    if (lines[start] && looksLikeLocation(lines[start])) {
      role.location = lines[start];
      start += 1;
    }
    const end = n + 1 < heads.length ? heads[n + 1].start : lines.length;
    const body = lines.slice(start, Math.max(start, end));
    role.responsibilities = body.map((l) => l.replace(/^[•●▪\-*]\s*/, '').trim()).filter((l) => l.length > 2);
    role._originalText = [role.title, role.company, lines[h.di], ...body].join('\n');
    role._confidence = { title: role.title ? 0.8 : 0, company: h.companyConfidence, dates: 0.95 };
    return role;
  });
}

function parseEducation(lines) {
  const out = [];
  for (let i = 0; i < lines.length; i += 1) {
    const line = lines[i];
    const next = lines[i + 1] || '';
    // Institution line followed by "Degree, Field · (2012 - 2016)".
    const detail = next.match(/^(.*?)(?:\s*·\s*\(([^)]*)\))?\s*$/);
    if (!line || ALL_HEADINGS.has(line)) continue;
    const ed = emptyEducation();
    ed.institution = line;
    if (next && (/·/.test(next) || /\b(Bachelor|Master|B\.?Tech|M\.?Tech|B\.?E|MBA|B\.?Sc|M\.?Sc|Ph\.?D|Diploma|Degree|BCA|MCA|B\.?Com)\b/i.test(next))) {
      const [degree, ...field] = (detail?.[1] || next).split(',').map((s) => s.trim());
      ed.degree = degree || '';
      ed.field = field.join(', ');
      const years = (detail?.[2] || '').match(/\d{4}/g) || [];
      ed.startDate = years[0] ? normaliseDate(years[0]) : '';
      ed.endDate = years[1] ? normaliseDate(years[1]) : '';
      i += 1;
    }
    ed._originalText = [line, next].join('\n');
    out.push(ed);
  }
  return out;
}

/**
 * Parses LinkedIn export text into resume JSON plus an import report.
 * Returns { resume, report } where report.status is one of
 *   'imported'       — header, experience and education all read
 *   'partial'        — some sections read, others need manual input
 *   'manual-needed'  — almost nothing could be read
 */
export function parseLinkedInText(text, meta = {}) {
  const orderedLines = String(text)
    .split(/\r?\n/)
    .map((l) => l.replace(/\s+/g, ' ').trim())
    .filter((l) => l && !PAGE_RE.test(l));

  const sections = splitSections(orderedLines);
  const resume = emptyResume();
  const needsReview = [];
  const confidence = {};

  /* Header */
  const header = extractHeader(sections, orderedLines);
  resume.personal.name = header.name;
  resume.personal.headline = header.headline;
  resume.personal.location = header.location;
  confidence['personal.name'] = header.name ? 0.8 : 0;
  if (!header.name) needsReview.push('personal.name');
  if (!header.headline) needsReview.push('personal.headline');

  /* Contact (sidebar). The header lines were swallowed into the last
     sidebar section, so strip them before reading lists. */
  const strip = (arr = []) => arr.filter((l) => !header.headerLines.includes(l));
  const contact = strip(sections.Contact).join(' ');
  resume.personal.email = contact.match(EMAIL_RE)?.[0] || '';
  resume.personal.phone = (contact.replace(LINKEDIN_RE, '').match(PHONE_RE)?.[0] || '').trim();
  const li = contact.match(LINKEDIN_RE)?.[0] || meta.linkedinUrl || '';
  resume.personal.linkedin = li ? normaliseLinkedInUrl(li) || '' : '';
  const site = strip(sections.Contact).find((l) => /\((?:Personal|Company|Portfolio|Blog|Other)\)/i.test(l));
  if (site) resume.personal.website = site.replace(/\s*\(.*\)\s*$/, '');

  /* Sidebar lists */
  resume.skills.technical = strip(sections['Top Skills']);
  resume.languages = strip(sections.Languages).map((l) => {
    const m = l.match(/^(.*?)\s*\((.*)\)\s*$/);
    return m ? { name: m[1], proficiency: m[2] } : { name: l, proficiency: '' };
  });
  resume.certifications = strip([...(sections.Certifications || []), ...(sections['Licenses & Certifications'] || [])]).map((name) => ({
    name, issuer: '', issueDate: '', expiryDate: '', credentialId: '', link: '',
  }));
  resume.awards = strip(sections['Honors-Awards']);
  resume.publications = strip(sections.Publications);

  /* Main */
  resume.summary = (sections.Summary || []).join(' ').trim();
  resume.experience = parseExperience(sections.Experience || []);
  resume.education = parseEducation(sections.Education || []);
  resume.volunteering = (sections['Volunteer Experience'] || []).filter(Boolean);

  resume.experience.forEach((r, i) => {
    Object.entries(r._confidence || {}).forEach(([k, v]) => {
      confidence[`experience.${i}.${k}`] = v;
      if (v < 0.7) needsReview.push(`experience.${i}.${k}`);
    });
    delete r._confidence;
  });
  resume.education.forEach((e, i) => {
    if (!e.degree) needsReview.push(`education.${i}.degree`);
  });

  resume._source = {
    rawText: String(text),
    fileName: meta.fileName || 'linkedin-profile.pdf',
    fileType: meta.fileType || 'application/pdf',
    parsedAt: new Date().toISOString(),
    wasScanned: false,
    ocrUsed: false,
  };
  resume._confidence = confidence;
  resume._needsReview = Array.from(new Set(needsReview));

  /* Import report */
  const found = {
    header: Boolean(header.name),
    about: Boolean(resume.summary),
    experience: resume.experience.length,
    education: resume.education.length,
    skills: resume.skills.technical.length,
    certifications: resume.certifications.length,
  };
  const missing = [];
  if (!found.header) missing.push('name and headline');
  if (!found.about) missing.push('About section');
  if (!found.experience) missing.push('experience');
  if (!found.education) missing.push('education');
  if (!found.skills) missing.push('skills');

  const status =
    found.header && found.experience && found.education ? 'imported' : found.header || found.experience ? 'partial' : 'manual-needed';

  return {
    resume,
    report: {
      source: 'linkedin-pdf',
      status,
      found,
      missing,
      note:
        status === 'imported'
          ? 'Your LinkedIn PDF was read. Review every section before continuing — LinkedIn only exports your top 3 skills, so add any others you use.'
          : status === 'partial'
            ? `Some sections were read, but we could not find: ${missing.join(', ')}. Add them on the review screen.`
            : 'We could not read this file as a LinkedIn profile export. Enter your details manually or upload your CV instead.',
    },
  };
}

/* ------------------------------------------------------------------ *
 * Merge: combine a LinkedIn import with an uploaded CV (Studio option C)
 * ------------------------------------------------------------------ */

const key = (...parts) => parts.map((p) => String(p || '').toLowerCase().replace(/[^a-z0-9]/g, '')).join('|');

/**
 * Adds to `primary` anything in `secondary` it does not already have.
 * Existing primary entries are never overwritten, so a candidate's reviewed
 * master is never silently changed. Added entries are listed so the review
 * screen can show them.
 */
export function mergeResumes(primary, secondary) {
  const out = JSON.parse(JSON.stringify(primary));
  const added = [];

  ['name', 'headline', 'email', 'phone', 'location', 'linkedin', 'website'].forEach((f) => {
    if (!out.personal[f] && secondary.personal?.[f]) {
      out.personal[f] = secondary.personal[f];
      added.push(`personal.${f}`);
    }
  });
  if (!out.summary && secondary.summary) {
    out.summary = secondary.summary;
    added.push('summary');
  }

  const expKeys = new Set(out.experience.map((r) => key(r.company, r.title)));
  (secondary.experience || []).forEach((r) => {
    if (!expKeys.has(key(r.company, r.title))) {
      out.experience.push(r);
      added.push(`experience: ${r.title} at ${r.company}`);
    }
  });
  const eduKeys = new Set(out.education.map((e) => key(e.institution, e.degree)));
  (secondary.education || []).forEach((e) => {
    if (!eduKeys.has(key(e.institution, e.degree))) {
      out.education.push(e);
      added.push(`education: ${e.degree || e.institution}`);
    }
  });

  Object.keys(out.skills).forEach((group) => {
    const have = new Set(out.skills[group].map((s) => s.toLowerCase()));
    (secondary.skills?.[group] || []).forEach((s) => {
      if (!have.has(s.toLowerCase())) {
        out.skills[group].push(s);
        have.add(s.toLowerCase());
        added.push(`skill: ${s}`);
      }
    });
  });

  const certKeys = new Set(out.certifications.map((c) => key(c.name)));
  (secondary.certifications || []).forEach((c) => {
    if (!certKeys.has(key(c.name))) {
      out.certifications.push(c);
      added.push(`certification: ${c.name}`);
    }
  });
  const projKeys = new Set(out.projects.map((p) => key(p.name)));
  (secondary.projects || []).forEach((p) => {
    if (!projKeys.has(key(p.name))) {
      out.projects.push(p);
      added.push(`project: ${p.name}`);
    }
  });

  out._needsReview = Array.from(new Set([...(out._needsReview || []), ...(secondary._needsReview || [])]));
  return { resume: out, added };
}
