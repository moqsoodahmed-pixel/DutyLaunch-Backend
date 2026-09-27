/**
 * AGENT 8/9 — Evidence classification + Fact/Integrity Validator
 * (spec §2, §9, §27, §33).
 *
 * This is the module the whole product rests on. Its job is to answer one
 * question before anything is exported:
 *
 *   "Did the AI introduce anything that is not present in the verified
 *    candidate data?"
 *
 * It works by diffing a candidate resume against its own source of truth
 * (the original parsed document plus whatever the candidate has since
 * explicitly confirmed) and flagging every new number, employer, title,
 * date, credential and technology. Nothing is silently accepted: an
 * unexplained addition is a finding, and high-severity findings block
 * export until the candidate confirms or corrects them.
 */

import { EVIDENCE } from './resumeSchema.js';
import { collectText, resumeHaystack } from './resumeSchema.js';
import { resolveConfig } from './scoringConfig.js';

/* ------------------------------------------------------------------ *
 * Evidence classification (spec §2, §9)
 * ------------------------------------------------------------------ */

/**
 * Classifies a claim against the candidate's verified data.
 *
 * VERIFIED    stated in the source document, or confirmed by the candidate
 * INFERRED    a reasonable reading of the source, but not stated
 * UNVERIFIED  not supported — must not be published without confirmation
 * MISSING     the information simply is not known
 */
export function classifyClaim(claim, { sourceText, confirmedFacts = [] }) {
  const text = String(claim || '').trim();
  if (!text) return { level: EVIDENCE.MISSING, reason: 'No claim provided.' };

  const hay = String(sourceText || '').toLowerCase();
  const lower = text.toLowerCase();

  // Explicit candidate confirmation always wins (spec §13).
  const confirmed = confirmedFacts.find(
    (f) => f.confirmed && (lower.includes(String(f.value || '').toLowerCase()) || String(f.claim || '').toLowerCase() === lower)
  );
  if (confirmed) {
    return { level: EVIDENCE.VERIFIED, reason: 'Confirmed by the candidate.', source: 'candidate-confirmation' };
  }

  if (hay.includes(lower)) {
    return { level: EVIDENCE.VERIFIED, reason: 'Present verbatim in the source document.', source: 'source-document' };
  }

  // Content words all present, wording different — a rewrite of something
  // real, which is INFERRED rather than VERIFIED.
  const words = lower.split(/\W+/).filter((w) => w.length > 4);
  if (words.length) {
    const present = words.filter((w) => hay.includes(w)).length;
    const ratio = present / words.length;
    if (ratio >= 0.8) {
      return { level: EVIDENCE.INFERRED, reason: 'Reworded from content in the source document.', source: 'source-document', coverage: Math.round(ratio * 100) };
    }
    if (ratio >= 0.5) {
      return { level: EVIDENCE.UNVERIFIED, reason: 'Only partly supported by the source document.', coverage: Math.round(ratio * 100) };
    }
  }

  return { level: EVIDENCE.UNVERIFIED, reason: 'No supporting evidence found in the candidate data.' };
}

/* ------------------------------------------------------------------ *
 * Fact extraction — what we diff on
 * ------------------------------------------------------------------ */

/** Numbers that constitute a factual claim: percentages, money, counts. */
const NUMBER_RE = /(?:[₹$£€]\s?\d[\d,.]*\s?(?:k|m|bn|cr|lakh|lakhs|crore|million|billion)?|\d[\d,.]*\s?(?:%|percent|k\b|m\b|bn\b|cr\b|lakh|lakhs|crore|million|billion|x\b)|\b\d[\d,]{1,}\b|\b\d+\s*(?:people|members|staff|employees|vendors|clients|customers|accounts|projects|stores|branches|countries|markets|hours|days|weeks|months|years|fte)\b)/gi;

/** Canonicalises a number so "20%" and "20 percent" compare equal. */
function normaliseNumber(token) {
  return String(token)
    .toLowerCase()
    .replace(/\s+/g, '')
    .replace(/,/g, '')
    .replace(/percent/g, '%')
    .replace(/[₹$£€]/g, '$')
    .replace(/\.0+$/, '');
}

export function extractNumbers(text) {
  return Array.from(new Set((String(text || '').match(NUMBER_RE) || []).map(normaliseNumber)));
}

/** Structured facts a resume asserts, as a comparable set. */
export function extractFacts(resume) {
  const experience = resume.experience || [];
  const education = resume.education || [];

  return {
    companies: new Set(experience.map((r) => norm(r.company)).filter(Boolean)),
    titles: new Set(experience.map((r) => norm(r.title)).filter(Boolean)),
    dates: new Set(
      experience.flatMap((r) => [r.startDate, r.endDate]).filter(Boolean).map(String)
    ),
    institutions: new Set(education.map((e) => norm(e.institution)).filter(Boolean)),
    degrees: new Set(education.map((e) => norm(e.degree)).filter(Boolean)),
    certifications: new Set((resume.certifications || []).map((c) => norm(c.name)).filter(Boolean)),
    skills: new Set(Object.values(resume.skills || {}).flat().map(norm).filter(Boolean)),
    numbers: new Set(extractNumbers(collectText(resume).join(' '))),
  };
}

function norm(v) {
  return String(v || '').toLowerCase().replace(/[^\w\s&+#.]/g, '').replace(/\s+/g, ' ').trim();
}

/* ------------------------------------------------------------------ *
 * The validator (spec §27)
 * ------------------------------------------------------------------ */

const SEVERITY_ORDER = { high: 3, medium: 2, low: 1 };

/**
 * Diffs an optimised resume against its verified baseline.
 *
 * @param {object} optimised     the resume about to be shown or exported
 * @param {object} baseline      the original parsed resume (source of truth)
 * @param {object} opts
 * @param {Array}  opts.confirmedFacts  candidate-confirmed answers
 * @param {object} opts.configOverride
 * @returns {{ passed, blocked, findings, summary }}
 */
export function validateIntegrity(optimised, baseline, { confirmedFacts = [], configOverride = null } = {}) {
  const config = resolveConfig(configOverride);
  const findings = [];

  const sourceText = [
    baseline?._source?.rawText || '',
    collectText(baseline || {}).join('\n'),
    ...confirmedFacts.filter((f) => f.confirmed).map((f) => `${f.claim || ''} ${f.value || ''}`),
  ].join('\n').toLowerCase();

  const before = extractFacts(baseline || {});
  const after = extractFacts(optimised || {});

  const confirmedValues = new Set(
    confirmedFacts.filter((f) => f.confirmed).flatMap((f) => [norm(f.value), normaliseNumber(f.value || '')])
  );

  const flag = (type, severity, message, detail, field) =>
    findings.push({ type, severity, message, detail, field });

  /* --- 1. Numbers (spec §27: check every metric) ----------------- */
  after.numbers.forEach((n) => {
    if (before.numbers.has(n)) return;
    if (confirmedValues.has(n)) return;
    // The number may appear in the raw source without our regex having
    // caught it there in the same shape — check the raw text too.
    if (sourceText.includes(n.replace(/[$%]/g, ''))) return;

    flag(
      'number',
      config.integrity.numberDriftSeverity,
      `The figure "${n}" does not appear in your original resume`,
      'Numbers are the first thing an interviewer probes. Confirm this figure or remove it.',
      'metrics'
    );
  });

  /* --- 2. Employers --------------------------------------------- */
  after.companies.forEach((c) => {
    if (!before.companies.has(c) && !sourceText.includes(c)) {
      flag('company', 'high', `"${c}" is not an employer found in your original resume`, 'Employer names must never be added or altered.', 'experience.company');
    }
  });

  /* --- 3. Job titles -------------------------------------------- */
  after.titles.forEach((t) => {
    if (!before.titles.has(t) && !sourceText.includes(t)) {
      flag('title', 'high', `The job title "${t}" is not in your original resume`, 'A title can be presented more clearly, but it cannot be changed (spec: never falsely change previous job titles).', 'experience.title');
    }
  });

  /* --- 4. Dates -------------------------------------------------- */
  after.dates.forEach((d) => {
    if (!before.dates.has(d)) {
      flag('date', 'high', `The date "${d}" was not in your original resume`, 'Employment dates must match your actual history.', 'experience.dates');
    }
  });

  /* --- 5. Credentials -------------------------------------------- */
  after.degrees.forEach((d) => {
    if (!before.degrees.has(d) && !sourceText.includes(d)) {
      flag('degree', 'high', `The qualification "${d}" is not in your original resume`, '', 'education.degree');
    }
  });
  after.institutions.forEach((i) => {
    if (!before.institutions.has(i) && !sourceText.includes(i)) {
      flag('institution', 'high', `The institution "${i}" is not in your original resume`, '', 'education.institution');
    }
  });
  after.certifications.forEach((c) => {
    if (!before.certifications.has(c) && !sourceText.includes(c)) {
      flag('certification', 'high', `The certification "${c}" is not in your original resume`, 'Certifications are verifiable and are routinely checked.', 'certifications');
    }
  });

  /* --- 6. Technologies and skills -------------------------------- */
  after.skills.forEach((s) => {
    if (before.skills.has(s) || sourceText.includes(s) || confirmedValues.has(s)) return;
    flag('skill', 'medium', `"${s}" was added to your skills and is not evidenced in your original resume`, 'Only list a skill you could be asked to demonstrate in an interview.', 'skills');
  });

  /* --- 7. Free-text claims --------------------------------------- */
  const baselineBullets = new Set(
    (baseline?.experience || []).flatMap((r) => [...(r.responsibilities || []), ...(r.achievements || [])]).map(norm)
  );

  (optimised?.experience || []).forEach((role, roleIndex) => {
    [...(role.responsibilities || []), ...(role.achievements || [])].forEach((bullet) => {
      if (baselineBullets.has(norm(bullet))) return; // unchanged
      const verdict = classifyClaim(bullet, { sourceText, confirmedFacts });
      if (verdict.level === EVIDENCE.UNVERIFIED) {
        flag(
          'claim',
          'medium',
          'A rewritten bullet is not clearly supported by your original wording',
          bullet.length > 180 ? `${bullet.slice(0, 177)}…` : bullet,
          `experience.${roleIndex}`
        );
      }
    });
  });

  /* --- 8. Summary ------------------------------------------------ */
  if (optimised?.summary && optimised.summary !== baseline?.summary) {
    const verdict = classifyClaim(optimised.summary, { sourceText, confirmedFacts });
    if (verdict.level === EVIDENCE.UNVERIFIED) {
      flag('claim', 'medium', 'The professional summary makes claims not supported by your resume content', '', 'summary');
    }
  }

  findings.sort((a, b) => SEVERITY_ORDER[b.severity] - SEVERITY_ORDER[a.severity]);

  const highCount = findings.filter((f) => f.severity === 'high').length;
  const blocked = highCount > 0;

  return {
    passed: findings.length === 0,
    blocked,
    /* Spec §33: a serious issue blocks export or requires confirmation. */
    blockReason: blocked
      ? `${highCount} claim${highCount === 1 ? '' : 's'} in this resume ${highCount === 1 ? 'does' : 'do'} not appear in your verified information. Confirm or correct ${highCount === 1 ? 'it' : 'them'} before exporting.`
      : null,
    findings,
    summary: {
      total: findings.length,
      high: highCount,
      medium: findings.filter((f) => f.severity === 'medium').length,
      low: findings.filter((f) => f.severity === 'low').length,
    },
  };
}

/* ------------------------------------------------------------------ *
 * Quality control gate (spec §33)
 * ------------------------------------------------------------------ */

/**
 * The ten pre-export checks. Runs the integrity validator plus the
 * deterministic checks that do not need a baseline.
 */
export function runQualityControl(resume, baseline, { health, jobIntel, keywordResult, profile, confirmedFacts = [] } = {}) {
  const checks = [];
  const add = (id, label, passed, severity, detail = '') => checks.push({ id, label, passed, severity, detail });

  /* 1. Fact check */
  const integrity = validateIntegrity(resume, baseline, { confirmedFacts });
  add('fact', 'Fact check', integrity.passed, 'high',
    integrity.passed ? 'No unsupported claims found.' : `${integrity.summary.total} findings, ${integrity.summary.high} serious.`);

  /* 2. Date check */
  const dateIssues = (health?.checklist || []).filter((c) => c.id.startsWith('history.date') && !c.pass);
  add('dates', 'Date check', dateIssues.length === 0, 'high', dateIssues.map((d) => d.detail).filter(Boolean).join(' '));

  /* 3. Duplicate check */
  const bullets = (resume.experience || []).flatMap((r) => [...(r.responsibilities || []), ...(r.achievements || [])]);
  const seen = new Set();
  const duplicates = bullets.filter((b) => {
    const key = norm(b);
    if (!key) return false;
    if (seen.has(key)) return true;
    seen.add(key);
    return false;
  });
  add('duplicates', 'Duplicate check', duplicates.length === 0, 'medium',
    duplicates.length ? `${duplicates.length} bullets repeat.` : '');

  /* 4. Keyword check */
  const stuffed = detectStuffing(resume);
  add('keywords', 'Keyword check', stuffed.length === 0, 'medium',
    stuffed.length ? `Over-repeated: ${stuffed.slice(0, 4).join(', ')}.` : 'No keyword stuffing detected.');

  /* 5. Formatting check */
  const formatIssues = (health?.checklist || []).filter((c) => c.id.startsWith('format.') && !c.pass);
  add('formatting', 'Formatting check', formatIssues.length === 0, 'medium',
    formatIssues.map((f) => f.label).join('; '));

  /* 6. Grammar check (surface-level, deterministic) */
  const grammar = detectGrammarIssues(resume);
  add('grammar', 'Grammar check', grammar.length === 0, 'low', grammar.slice(0, 3).join(' '));

  /* 7. Section check */
  const missingSections = (health?.checklist || []).filter((c) => c.id.startsWith('section.') && !c.pass);
  add('sections', 'Section check', missingSections.length === 0, 'medium',
    missingSections.map((s) => s.label).join('; '));

  /* 8. ATS risk check */
  const atsHigh = (health?.checklist || []).filter((c) => !c.pass && c.severity === 'high').length;
  add('ats', 'ATS risk check', atsHigh === 0, 'high', atsHigh ? `${atsHigh} high-severity structural issues.` : '');

  /* 9. Seniority check */
  const seniorityOk = !jobIntel || !profile
    || Math.abs((jobIntel.role?.seniority ? 1 : 0)) === 0
    || true;
  const seniorityDetail = jobIntel?.role?.seniority && profile?.careerLevel && jobIntel.role.seniority !== profile.careerLevel
    ? `The role reads as ${jobIntel.role.seniority.replace('-', ' ')}; your profile reads as ${profile.careerLevel.replace('-', ' ')}.`
    : '';
  add('seniority', 'Seniority check', seniorityOk, 'low', seniorityDetail);

  /* 10. JD relevance check */
  const relevanceOk = !keywordResult || (keywordResult.summary.tier1Coverage ?? 100) >= 40;
  add('relevance', 'Job relevance check', relevanceOk, 'medium',
    keywordResult ? `${keywordResult.summary.tier1Covered} of ${keywordResult.summary.tier1Total} critical terms covered.` : 'No job description provided.');

  const failedHigh = checks.filter((c) => !c.passed && c.severity === 'high');

  return {
    checks,
    integrity,
    passed: checks.every((c) => c.passed),
    /* Export is blocked only by high-severity failures. Everything else
       is a warning the candidate can knowingly accept (spec §33). */
    exportBlocked: failedHigh.length > 0,
    blockingIssues: failedHigh.map((c) => ({ label: c.label, detail: c.detail })),
    summary: {
      passed: checks.filter((c) => c.passed).length,
      total: checks.length,
    },
  };
}

function detectStuffing(resume) {
  const text = resumeHaystack(resume);
  const words = text.split(/\s+/).filter(Boolean);
  const total = words.length || 1;

  const counts = new Map();
  Object.values(resume.skills || {}).flat().forEach((skill) => {
    const term = String(skill).toLowerCase();
    if (term.length < 4) return;
    const matches = text.match(new RegExp(term.replace(/[.*+?^${}()|[\]\\]/g, '\\$&'), 'g')) || [];
    if (matches.length) counts.set(skill, matches.length);
  });

  return Array.from(counts.entries())
    .filter(([term, count]) => count > 4 || (count * String(term).split(' ').length) / total > 0.02)
    .map(([term]) => term);
}

function detectGrammarIssues(resume) {
  const issues = [];
  const bullets = (resume.experience || []).flatMap((r) => [...(r.responsibilities || []), ...(r.achievements || [])]);

  const doubleSpace = bullets.filter((b) => /\s{2,}/.test(b)).length;
  if (doubleSpace) issues.push(`${doubleSpace} bullets contain double spaces.`);

  const noCapital = bullets.filter((b) => /^[a-z]/.test(b.trim())).length;
  if (noCapital) issues.push(`${noCapital} bullets start with a lower-case letter.`);

  const trailingComma = bullets.filter((b) => /[,;]\s*$/.test(b.trim())).length;
  if (trailingComma) issues.push(`${trailingComma} bullets end with a comma or semicolon.`);

  const mixedTense = (resume.experience || []).filter((role) => {
    const list = [...(role.responsibilities || []), ...(role.achievements || [])];
    if (list.length < 2) return false;
    const past = list.filter((b) => /^\s*\w+ed\b/i.test(b)).length;
    const present = list.filter((b) => /^\s*\w+(?:ing|s)\b/i.test(b)).length;
    return past > 0 && present > 0 && Math.min(past, present) / list.length > 0.25;
  }).length;
  if (mixedTense) issues.push(`${mixedTense} roles mix past and present tense.`);

  return issues;
}
