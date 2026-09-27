/**
 * AGENT 3 — Job Description Analyst (spec §10, §6).
 *
 * Deterministic. Turns a pasted or uploaded JD into structured Job
 * Intelligence: role, seniority, required vs preferred skills, tools,
 * responsibilities, experience and education requirements, and a ranked
 * keyword list carrying the signals the prioritisation step needs
 * (frequency, position, whether it sat under a "required" heading).
 *
 * Unknown job titles and unknown skills are first-class here. The taxonomy
 * improves classification but is never a gate (spec §22).
 */

import {
  STOP_WORDS,
  NON_SKILL_NOISE,
  ALL_CANONICAL_TERMS,
  surfaceForms,
  canonicalise,
  skillCategoryOf,
  SENIORITY_TITLE_MARKERS,
} from './taxonomy.js';
import { seniorityFromTitle } from './candidateProfile.js';

/* ------------------------------------------------------------------ *
 * Block segmentation
 * ------------------------------------------------------------------ */

const BLOCK_PATTERNS = [
  ['required', /^(requirements?|required (?:skills?|qualifications?|experience)|must[- ]haves?|what (?:you'?ll )?(?:need|bring)|essential(?: criteria| skills?| requirements?)?|minimum qualifications?|who you are|skills? (?:and|&) (?:experience|qualifications?))\s*:?\s*$/i],
  ['preferred', /^(preferred(?: qualifications?| skills?| experience)?|nice[- ]to[- ]haves?|desirable|bonus(?: points?)?|good to have|advantageous|plus(?:es)?)\s*:?\s*$/i],
  ['responsibilities', /^(responsibilities|key responsibilities|what you'?ll do|the role|duties|role (?:overview|description)|your (?:role|impact)|day[- ]to[- ]day|job description)\s*:?\s*$/i],
  ['benefits', /^(benefits?|what we offer|perks?|compensation|why join|our offer)\s*:?\s*$/i],
  ['about', /^(about (?:us|the (?:company|team|role))|company overview|who we are)\s*:?\s*$/i],
  ['education', /^(education|academic requirements?|qualifications?)\s*:?\s*$/i],
];

function classifyBlockHeading(line) {
  const cleaned = line.replace(/^[\s\d.)\-–—_*#•]+/, '').replace(/[\s:_\-–—*#]+$/, '').trim();
  if (!cleaned || cleaned.length > 70) return null;
  for (const [key, re] of BLOCK_PATTERNS) {
    if (re.test(cleaned)) return key;
  }
  return null;
}

/** Splits a JD into labelled blocks so "required" can outrank "preferred". */
export function segmentJd(text) {
  const lines = String(text || '').split(/\r?\n/).map((l) => l.replace(/\t/g, ' ').replace(/\s{2,}/g, ' ').trim());
  const blocks = { intro: [], required: [], preferred: [], responsibilities: [], benefits: [], about: [], education: [] };
  let current = 'intro';

  lines.forEach((line) => {
    const key = classifyBlockHeading(line);
    if (key) {
      current = key;
      return;
    }
    if (line) blocks[current].push(line);
  });

  return blocks;
}

/* ------------------------------------------------------------------ *
 * Header fields
 * ------------------------------------------------------------------ */

const TITLE_HINT = /(manager|engineer|developer|analyst|executive|officer|director|lead|head of|consultant|specialist|associate|coordinator|administrator|assistant|intern|architect|designer|scientist|supervisor|president|partner|advisor|accountant|recruiter|representative|strategist)/i;

function extractJobTitle(text, blocks) {
  const explicit = text.match(/^\s*(?:job\s*title|position|role|designation)\s*[:\-]\s*(.{3,80})$/im);
  if (explicit) return explicit[1].trim().replace(/[.,;]$/, '');

  // Otherwise the first short line near the top that reads like a title.
  const candidates = [...(blocks.intro || []), ...String(text).split(/\r?\n/).slice(0, 12)];
  for (const line of candidates) {
    const t = line.trim();
    if (t.length > 3 && t.length < 70 && TITLE_HINT.test(t) && !/^\W/.test(t)) {
      return t.replace(/[.,;:]$/, '').replace(/\s*[-–—|]\s*.*(full|part)[- ]time.*/i, '').trim();
    }
  }
  return '';
}

function extractExperienceRequirement(text) {
  const patterns = [
    /(\d{1,2})\s*(?:\+|plus)?\s*(?:-|–|to)\s*(\d{1,2})\s*\+?\s*years?/i,
    /(?:minimum|min\.?|at least|over)\s*(?:of\s*)?(\d{1,2})\s*\+?\s*years?/i,
    /(\d{1,2})\s*\+\s*years?/i,
    /(\d{1,2})\s*years?\s*(?:of\s*)?(?:relevant\s*|professional\s*|proven\s*)?experience/i,
  ];
  for (const re of patterns) {
    const m = text.match(re);
    if (m) {
      const min = Number(m[1]);
      const max = m[2] ? Number(m[2]) : null;
      if (min >= 0 && min <= 40) return { min, max, raw: m[0].trim() };
    }
  }
  if (/\b(fresher|fresh graduate|no (?:prior )?experience|entry[- ]level|graduate (?:role|programme|program))\b/i.test(text)) {
    return { min: 0, max: 1, raw: 'entry level / fresher' };
  }
  return null;
}

const DEGREE_RE = /\b(ph\.?d|doctorate|m\.?b\.?a|master'?s?|m\.?tech|m\.?sc|bachelor'?s?|b\.?tech|b\.?e\b|b\.?sc|b\.?com|b\.?a\b|degree|diploma|graduate|post[- ]?graduate)\b/i;

function extractEducationRequirement(text, blocks) {
  const scope = [...(blocks.education || []), ...(blocks.required || [])].join('\n') || text;
  const line = scope.split(/\r?\n/).find((l) => DEGREE_RE.test(l));
  if (!line) return null;
  return { raw: line.trim().slice(0, 240), level: (line.match(DEGREE_RE) || [''])[0].toLowerCase() };
}

const CERT_RE = /\b(pmp|prince2|csm|safe|cfa|cpa|ca\b|acca|cisa|cissp|ceh|comptia|itil|six sigma|lean|aws certified|azure certified|gcp certified|scrum master|shrm|cipd|nebosh|iosh)\b/gi;

function extractCertifications(text) {
  return Array.from(new Set((text.match(CERT_RE) || []).map((c) => c.trim().toLowerCase())));
}

function extractIndustry(text) {
  const industries = [
    'fintech', 'banking', 'insurance', 'healthcare', 'pharmaceutical', 'biotechnology',
    'e-commerce', 'retail', 'manufacturing', 'logistics', 'telecom', 'edtech', 'saas',
    'hospitality', 'aviation', 'automotive', 'energy', 'real estate', 'construction',
    'legal', 'consulting', 'media', 'non-profit', 'public sector', 'agriculture',
  ];
  const lower = text.toLowerCase();
  return industries.filter((i) => lower.includes(i)).slice(0, 4);
}

function extractLocation(text) {
  const explicit = text.match(/^\s*(?:location|based in|work location|city)\s*[:\-]\s*(.{2,60})$/im);
  if (explicit) return explicit[1].trim().replace(/[.,;]$/, '');
  if (/\b(fully )?remote\b/i.test(text)) return 'Remote';
  if (/\bhybrid\b/i.test(text)) return 'Hybrid';
  return '';
}

/* ------------------------------------------------------------------ *
 * Keyword extraction
 * ------------------------------------------------------------------ */

const PHRASE_SPLIT = /[.;:!?()[\]{}"']|\s[-–—]\s|,\s/;

/**
 * Extracts candidate keyword phrases from a block of JD text.
 * Two passes:
 *   1. Taxonomy terms present verbatim (high precision).
 *   2. Repeated noun-ish bigrams/trigrams the taxonomy doesn't know, so an
 *      unfamiliar domain still yields usable keywords (spec §22).
 */
function extractPhrases(text) {
  const lower = String(text || '').toLowerCase();
  const found = new Map(); // phrase -> count

  const bump = (phrase, n = 1) => {
    if (!phrase) return;
    found.set(phrase, (found.get(phrase) || 0) + n);
  };

  // Pass 1 — known terms.
  ALL_CANONICAL_TERMS.forEach((term) => {
    let count = 0;
    surfaceForms(term).forEach((form) => {
      const escaped = form.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
      const matches = lower.match(new RegExp(`(?:^|[^a-z0-9+#.])${escaped}(?:[^a-z0-9+#]|$)`, 'gi'));
      if (matches) count += matches.length;
    });
    if (count) bump(term, count);
  });

  // Pass 2 — unknown n-grams.
  const segments = lower.split(PHRASE_SPLIT);
  const ngramCounts = new Map();
  segments.forEach((segment) => {
    const words = segment
      .replace(/[^a-z0-9+#.\s/&-]/g, ' ')
      .split(/\s+/)
      .filter(Boolean);

    for (let n = 3; n >= 1; n -= 1) {
      for (let i = 0; i + n <= words.length; i += 1) {
        const gram = words.slice(i, i + n);
        if (gram.some((w) => STOP_WORDS.has(w))) continue;
        if (gram.some((w) => w.length < 3 && !/^(bi|ux|ui|qa|hr|it|ai|ml)$/.test(w))) continue;
        if (gram.every((w) => /^\d+$/.test(w))) continue;
        const phrase = gram.join(' ');
        if (phrase.length < 3 || phrase.length > 45) continue;
        if (NON_SKILL_NOISE.has(phrase)) continue;
        ngramCounts.set(phrase, (ngramCounts.get(phrase) || 0) + 1);
      }
    }
  });

  // Only keep unknown phrases that repeat — a single mention of an
  // arbitrary word pair is noise, a repeated one is the JD's vocabulary.
  ngramCounts.forEach((count, phrase) => {
    if (found.has(phrase)) return;
    if (canonicalise(phrase)) return;
    const words = phrase.split(' ');
    const threshold = words.length === 1 ? 3 : 2;
    if (count >= threshold) bump(phrase, count);
  });

  return found;
}

/** Drops phrases fully contained in a longer, equally frequent phrase. */
function dedupeSubphrases(entries) {
  const sorted = [...entries].sort((a, b) => b.term.length - a.term.length);
  const kept = [];
  sorted.forEach((entry) => {
    const swallowed = kept.some(
      (k) => k.term !== entry.term && k.term.includes(entry.term) && k.frequency >= entry.frequency
    );
    if (!swallowed) kept.push(entry);
  });
  return kept;
}

/* ------------------------------------------------------------------ *
 * Main
 * ------------------------------------------------------------------ */

/**
 * @param {string} jdText  raw job description
 * @param {object} hints   { jobTitle, company, industry, country, seniority }
 * @returns {object} Job Intelligence JSON
 */
export function analyzeJobDescription(jdText, hints = {}) {
  const text = String(jdText || '').trim();
  const blocks = segmentJd(text);
  const totalLength = Math.max(text.length, 1);

  const jobTitle = hints.jobTitle?.trim() || extractJobTitle(text, blocks);
  const experienceRequirement = extractExperienceRequirement(text);

  let seniority = hints.seniority || seniorityFromTitle(jobTitle);
  if (!seniority && experienceRequirement) {
    if (experienceRequirement.min <= 1) seniority = 'entry';
    else if (experienceRequirement.min <= 4) seniority = 'mid';
    else if (experienceRequirement.min <= 8) seniority = 'senior';
    else seniority = 'manager';
  }

  /* --- keywords with their signals ------------------------------ */
  const requiredPhrases = extractPhrases([...blocks.required, ...blocks.intro].join('\n'));
  const preferredPhrases = extractPhrases(blocks.preferred.join('\n'));
  const responsibilityPhrases = extractPhrases(blocks.responsibilities.join('\n'));
  const allPhrases = extractPhrases(
    [...blocks.intro, ...blocks.required, ...blocks.preferred, ...blocks.responsibilities, ...blocks.education].join('\n')
  );

  const lower = text.toLowerCase();

  const keywords = dedupeSubphrases(
    Array.from(allPhrases.entries()).map(([term, frequency]) => {
      const firstIndex = lower.indexOf(term.split(' ')[0]);
      // 1.0 at the very top of the JD, decaying to 0 at the end.
      const positionWeight = firstIndex < 0 ? 0.3 : Math.max(0, 1 - firstIndex / totalLength);

      return {
        term,
        canonical: canonicalise(term) || term,
        frequency,
        positionWeight: Math.round(positionWeight * 100) / 100,
        required: requiredPhrases.has(term),
        preferred: preferredPhrases.has(term) && !requiredPhrases.has(term),
        inResponsibilities: responsibilityPhrases.has(term),
        category: skillCategoryOf(term),
        known: Boolean(canonicalise(term)),
      };
    })
  );

  const bucket = (predicate) =>
    keywords
      .filter(predicate)
      .sort((a, b) => b.frequency - a.frequency)
      .map((k) => k.term);

  return {
    source: { length: text.length, hasStructuredBlocks: blocks.required.length + blocks.preferred.length > 0 },
    role: {
      jobTitle,
      company: hints.company?.trim() || '',
      department: '',
      seniority: seniority || '',
      industry: hints.industry ? [hints.industry] : extractIndustry(text),
      location: hints.location || extractLocation(text),
      country: hints.country || '',
    },
    requirements: {
      experience: experienceRequirement,
      education: extractEducationRequirement(text, blocks),
      certifications: extractCertifications(text),
    },
    skills: {
      required: bucket((k) => k.required && k.category !== 'soft'),
      preferred: bucket((k) => k.preferred),
      tools: bucket((k) => k.category === 'tools'),
      technical: bucket((k) => k.category === 'technical'),
      functional: bucket((k) => k.category === 'functional'),
      behavioural: bucket((k) => k.category === 'soft'),
    },
    responsibilities: blocks.responsibilities
      .map((l) => l.replace(/^[\s•▪◦‣·*\-–—o>»]+/, '').trim())
      .filter((l) => l.length > 12)
      .slice(0, 25),
    keywords,
    blocks: {
      hasRequired: blocks.required.length > 0,
      hasPreferred: blocks.preferred.length > 0,
      hasResponsibilities: blocks.responsibilities.length > 0,
    },
    /* Honest signal for the UI: a 3-line JD cannot support a confident
       match score, and we say so rather than scoring it anyway. */
    quality:
      text.length < 300
        ? 'thin'
        : keywords.length < 8
          ? 'limited'
          : 'good',
  };
}
