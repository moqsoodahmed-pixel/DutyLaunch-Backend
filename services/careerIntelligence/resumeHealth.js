/**
 * AGENT 5 — Resume Health + ATS Validator (spec §18, §19, §38).
 *
 * Every category returns not just a number but the findings that produced
 * it, so the UI can answer "why 73?" without guessing. Nothing here claims
 * a resume will pass any particular ATS — the language is fixed in
 * `METHODOLOGY` and reused verbatim wherever a score is shown.
 */

import { resolveConfig, bandFor, lengthGuidance } from './scoringConfig.js';
import { collectText } from './resumeSchema.js';
import { MATCH } from './keywordIntelligence.js';

export const METHODOLOGY =
  'This score evaluates resume structure, content alignment and keyword coverage based on DutyLaunch’s methodology. It is not a guarantee of ATS acceptance or interview success.';

const clamp = (n) => Math.max(0, Math.min(100, Math.round(n)));

/* ------------------------------------------------------------------ *
 * ATS structural checklist (spec §19)
 * ------------------------------------------------------------------ */

const EMAIL_RE = /[\w.+-]+@[\w-]+\.[a-zA-Z]{2,}/;

/**
 * Runs the 22-point checklist. Each item is { id, label, pass, severity,
 * detail }. Severity drives both the score and what the UI shows first.
 */
export function runAtsChecklist(resume, { rawText = '' } = {}) {
  const items = [];
  const add = (id, label, pass, severity, detail = '') => items.push({ id, label, pass, severity, detail });

  const p = resume.personal || {};
  const experience = resume.experience || [];
  const education = resume.education || [];
  const skills = resume.skills || {};
  const text = rawText || collectText(resume).join('\n');

  /* --- contact ------------------------------------------------- */
  add('contact.email', 'Email address present', Boolean(p.email && EMAIL_RE.test(p.email)), 'high',
    'Parsers key on the email to create the candidate record.');
  add('contact.phone', 'Phone number present', Boolean(p.phone), 'high', '');
  add('contact.name', 'Name detected at the top', Boolean(p.name), 'high', '');
  add('contact.location', 'Location present', Boolean(p.location), 'low',
    'City and country help location-based filtering.');
  add('contact.linkedin', 'LinkedIn URL present', Boolean(p.linkedin), 'low', '');

  /* --- sections ------------------------------------------------- */
  add('section.experience', 'Work experience section found', experience.length > 0, 'high', '');
  add('section.education', 'Education section found', education.length > 0, 'medium', '');
  add('section.skills', 'Skills section found',
    Object.values(skills).some((list) => (list || []).length > 0), 'medium', '');
  add('section.summary', 'Professional summary present', Boolean(resume.summary?.trim()), 'medium',
    'A summary gives the reader the headline before they scan the detail.');

  /* --- work history integrity ----------------------------------- */
  const rolesWithTitle = experience.filter((r) => r.title?.trim()).length;
  const rolesWithCompany = experience.filter((r) => r.company?.trim()).length;
  const rolesWithDates = experience.filter((r) => r.startDate && (r.endDate || r.current)).length;

  add('history.titles', 'Every role has a job title', experience.length > 0 && rolesWithTitle === experience.length, 'high',
    experience.length ? `${rolesWithTitle} of ${experience.length} roles have a title.` : '');
  add('history.companies', 'Every role has an employer name', experience.length > 0 && rolesWithCompany === experience.length, 'high',
    experience.length ? `${rolesWithCompany} of ${experience.length} roles name an employer.` : '');
  add('history.dates', 'Every role has start and end dates', experience.length > 0 && rolesWithDates === experience.length, 'high',
    experience.length ? `${rolesWithDates} of ${experience.length} roles carry a complete date range.` : '');

  /* --- date consistency ----------------------------------------- */
  const dateIssues = findDateIssues(experience);
  add('history.dateConsistency', 'Dates are internally consistent', dateIssues.length === 0, 'high',
    dateIssues.join(' '));

  const formats = new Set(
    experience.flatMap((r) => [r.startDate, r.endDate]).filter(Boolean)
      .map((d) => (/^\d{4}-\d{2}$/.test(d) ? 'month-year' : /^\d{4}$/.test(d) ? 'year' : 'other'))
  );
  add('history.dateFormat', 'Date format is consistent', formats.size <= 1, 'medium',
    formats.size > 1 ? 'Some roles use month and year, others only a year.' : '');

  /* --- formatting hazards (spec §21) ----------------------------- */
  const hazards = detectFormattingHazards(text);
  add('format.columns', 'No multi-column layout detected', !hazards.multiColumn, 'high',
    hazards.multiColumn ? 'Text appears to come from side-by-side columns, which parsers frequently interleave.' : '');
  add('format.tables', 'No table-based layout detected', !hazards.tables, 'medium',
    hazards.tables ? 'Tabular layout was detected. Parsers often read tables row-first and scramble the order.' : '');
  add('format.glyphs', 'No unusual characters or icon fonts', !hazards.oddGlyphs, 'medium',
    hazards.oddGlyphs ? 'Icon glyphs or non-standard characters were found; they come through as noise.' : '');
  add('format.headerFooter', 'No critical detail in a header or footer', !hazards.headerFooter, 'medium',
    hazards.headerFooter ? 'Contact details appear to sit in a page header or footer, which many parsers skip.' : '');
  add('format.textLayer', 'Resume contains selectable text', text.replace(/\s/g, '').length > 200, 'high', '');

  /* --- length ---------------------------------------------------- */
  const wordCount = text.split(/\s+/).filter(Boolean).length;
  add('content.length', 'Length is in a sensible range', wordCount >= 180 && wordCount <= 1500, 'medium',
    `${wordCount} words.`);

  /* --- content quality ------------------------------------------ */
  const bullets = experience.flatMap((r) => [...(r.responsibilities || []), ...(r.achievements || [])]);
  const quantified = bullets.filter((b) => /\d/.test(b)).length;
  add('content.quantified', 'Achievements include measurable outcomes', bullets.length > 0 && quantified >= Math.min(3, bullets.length), 'medium',
    bullets.length ? `${quantified} of ${bullets.length} bullets contain a number.` : '');

  const firstPerson = bullets.filter((b) => /^\s*(i|my|we)\b/i.test(b)).length;
  add('content.voice', 'Bullets avoid first person', firstPerson === 0, 'low',
    firstPerson ? `${firstPerson} bullets start with "I", "my" or "we".` : '');

  const longBullets = bullets.filter((b) => b.split(/\s+/).length > 45).length;
  add('content.bulletLength', 'Bullets are a readable length', longBullets === 0, 'low',
    longBullets ? `${longBullets} bullets run past 45 words.` : '');

  return items;
}

function findDateIssues(experience) {
  const issues = [];
  const currentYear = new Date().getFullYear();

  experience.forEach((role, i) => {
    const label = role.title || role.company || `Role ${i + 1}`;
    const start = parseYm(role.startDate);
    const end = role.current ? currentYm() : parseYm(role.endDate);

    if (start && end && end < start) issues.push(`${label}: the end date is before the start date.`);
    if (start && start > currentYm()) issues.push(`${label}: the start date is in the future.`);
    if (start && Math.floor(start / 12) < 1960) issues.push(`${label}: the start year looks wrong.`);
    if (end && Math.floor(end / 12) > currentYear + 1) issues.push(`${label}: the end date is in the future.`);
  });

  const currentRoles = experience.filter((r) => r.current).length;
  if (currentRoles > 2) issues.push(`${currentRoles} roles are marked as current.`);

  return issues.slice(0, 5);
}

function parseYm(v) {
  const m = String(v || '').match(/^(\d{4})(?:-(\d{1,2}))?$/);
  if (!m) return null;
  return Number(m[1]) * 12 + (m[2] ? Number(m[2]) : 1);
}

function currentYm() {
  const d = new Date();
  return d.getFullYear() * 12 + d.getMonth() + 1;
}

function detectFormattingHazards(text) {
  const lines = text.split('\n');
  const nonEmpty = lines.filter((l) => l.trim());

  // Runs of 4+ spaces mid-line, on many lines, are what a two-column PDF
  // looks like once flattened.
  const gappy = nonEmpty.filter((l) => /\S {4,}\S/.test(l)).length;
  const multiColumn = nonEmpty.length > 12 && gappy / nonEmpty.length > 0.28;

  // Pipe-delimited or heavily tabbed lines suggest a table.
  const piped = nonEmpty.filter((l) => (l.match(/\|/g) || []).length >= 2).length;
  const tables = piped >= 3;

  // Private-use-area glyphs are icon fonts; box-drawing is a table border.
  const oddGlyphs = /[\uE000-\uF8FF\u2500-\u257F]/.test(text)
    || (text.match(/[^\x00-\x7F]/g) || []).length / Math.max(text.length, 1) > 0.04;

  // The same email or phone repeating on every page = a running header.
  const email = (text.match(EMAIL_RE) || [])[0];
  const headerFooter = Boolean(email) && (text.match(new RegExp(email.replace(/[.*+?^${}()|[\]\\]/g, '\\$&'), 'g')) || []).length >= 3;

  return { multiColumn, tables, oddGlyphs, headerFooter };
}

/* ------------------------------------------------------------------ *
 * Category scores
 * ------------------------------------------------------------------ */

const SEVERITY_PENALTY = { high: 18, medium: 9, low: 4 };

function scoreAtsStructure(checklist) {
  const structural = checklist.filter((c) => c.id.startsWith('contact.') || c.id.startsWith('section.') || c.id.startsWith('history.') || c.id.startsWith('format.'));
  const penalty = structural.filter((c) => !c.pass).reduce((sum, c) => sum + (SEVERITY_PENALTY[c.severity] || 5), 0);
  const failures = structural.filter((c) => !c.pass);
  return {
    score: clamp(100 - penalty),
    findings: failures.map((f) => ({ label: f.label, severity: f.severity, detail: f.detail })),
  };
}

function scoreReadability(resume, text) {
  const bullets = (resume.experience || []).flatMap((r) => [...(r.responsibilities || []), ...(r.achievements || [])]);
  let score = 100;
  const findings = [];

  if (bullets.length) {
    const avgWords = bullets.reduce((s, b) => s + b.split(/\s+/).length, 0) / bullets.length;
    if (avgWords > 32) {
      score -= 18;
      findings.push({ label: 'Bullets average over 32 words', severity: 'medium', detail: 'Shorter bullets are read; longer ones are skimmed past.' });
    } else if (avgWords < 7) {
      score -= 10;
      findings.push({ label: 'Bullets are very short', severity: 'low', detail: 'Fragments leave the reader to infer the outcome.' });
    }

    const passive = bullets.filter((b) => /\b(?:was|were|been|being)\s+\w+ed\b/i.test(b)).length;
    if (passive / bullets.length > 0.25) {
      score -= 12;
      findings.push({ label: 'Frequent passive voice', severity: 'low', detail: `${passive} of ${bullets.length} bullets are passive.` });
    }

    const weakOpeners = bullets.filter((b) => /^\s*(responsible for|worked on|helped with|involved in|tasked with|duties includ)/i.test(b)).length;
    if (weakOpeners) {
      score -= Math.min(20, weakOpeners * 5);
      findings.push({ label: 'Bullets open with weak phrasing', severity: 'medium', detail: `${weakOpeners} bullets start with phrases like "responsible for".` });
    }
  }

  const wordCount = text.split(/\s+/).filter(Boolean).length;
  const paragraphs = text.split(/\n\s*\n/).filter((p) => p.split(/\s+/).length > 80).length;
  if (paragraphs > 1) {
    score -= 10;
    findings.push({ label: 'Long unbroken paragraphs', severity: 'low', detail: 'Dense blocks of text are rarely read in full.' });
  }

  if (wordCount < 150) {
    score -= 15;
    findings.push({ label: 'Very little content to assess', severity: 'medium', detail: '' });
  }

  return { score: clamp(score), findings };
}

function scoreAchievementStrength(resume, profile) {
  const isFresher = profile?.strategy === 'fresher';
  const roles = resume.experience || [];
  const bullets = roles.flatMap((r) => [...(r.responsibilities || []), ...(r.achievements || [])]);
  const findings = [];

  if (!bullets.length) {
    const projectBullets = (resume.projects || []).flatMap((p) => p.highlights || p.bullets || []);
    const fallback = projectBullets.length + (resume.achievements || []).length;

    if (isFresher) {
      /* Score the evidence a fresher actually has rather than the
         employment history they do not. Projects, coursework and
         achievements are the right material at this stage. */
      const quantifiedFallback = [...projectBullets, ...(resume.achievements || [])].filter((b) => /\b\d/.test(b)).length;
      return {
        score: clamp(fallback ? 45 + Math.min(fallback, 6) * 5 + quantifiedFallback * 4 : 25),
        findings: fallback
          ? quantifiedFallback
            ? []
            : [{
                label: 'Your projects could show scale or outcome',
                severity: 'medium',
                detail: 'Users reached, accuracy achieved, time saved — a number makes a student project concrete.',
              }]
          : [{
              label: 'Add projects, coursework or internships',
              severity: 'high',
              detail: 'Without work history these are what a recruiter reads. One or two described properly is enough.',
            }],
      };
    }

    return {
      score: fallback ? 45 : 15,
      findings: [{ label: 'No experience bullets found', severity: 'high', detail: fallback ? 'Projects and achievements were used instead.' : '' }],
    };
  }

  const quantified = bullets.filter((b) => /\b\d/.test(b)).length;
  const withResult = bullets.filter((b) =>
    /(increas|decreas|reduc|improv|grew|growth|saved|achiev|deliver|exceed|launch|generat|boost|resulting in|led to)/i.test(b)
  ).length;
  const strongVerb = bullets.filter((b) =>
    /^\s*(led|built|created|delivered|designed|developed|drove|managed|launched|implemented|reduced|increased|improved|negotiated|automated|streamlined|scaled|owned|established|coordinated|analysed|analyzed)/i.test(b)
  ).length;

  const quantRatio = quantified / bullets.length;
  const resultRatio = withResult / bullets.length;
  const verbRatio = strongVerb / bullets.length;

  const score = clamp(quantRatio * 45 + resultRatio * 30 + verbRatio * 25);

  if (quantRatio < 0.3) {
    findings.push({
      label: 'Few bullets carry a number',
      severity: 'medium',
      detail: `${quantified} of ${bullets.length} bullets are quantified. Scale, volume, frequency and time all count — not just percentages.`,
    });
  }
  if (resultRatio < 0.3) {
    findings.push({ label: 'Bullets describe duties more than outcomes', severity: 'medium', detail: 'What changed because you did the work?' });
  }
  if (verbRatio < 0.4) {
    findings.push({ label: 'Bullets rarely open with a strong action verb', severity: 'low', detail: '' });
  }

  return { score, findings, stats: { bullets: bullets.length, quantified, withResult } };
}

function scoreSkillsCoverage(resume, jobIntel, skillGap) {
  const skills = resume.skills || {};
  const total = Object.values(skills).reduce((n, list) => n + (list || []).length, 0);
  const findings = [];

  /* When the skill gap engine has already run, reuse its verdict rather
     than recomputing coverage with a cruder substring test. The two used
     to disagree — the report would say "2 of 8 skills" next to a gap
     panel listing three as demonstrated — which undermines the whole
     point of an explainable score. Partial evidence counts for half,
     because "worked with internal business teams" is genuinely weaker
     evidence than naming the skill. */
  if (skillGap?.assessed?.length) {
    const assessed = skillGap.assessed;
    const demonstrated = assessed.filter((s) => s.status === 'DEMONSTRATED').length;
    const partial = assessed.filter((s) => s.status === 'PARTIAL').length;
    const score = clamp(((demonstrated + partial * 0.5) / assessed.length) * 100);

    const shortfall = assessed.length - demonstrated;
    if (shortfall > 0) {
      const ratio = (demonstrated + partial * 0.5) / assessed.length;
      findings.push({
        label: 'Some required skills are not clearly evidenced',
        severity: ratio < 0.5 ? 'high' : 'medium',
        detail:
          `Your resume clearly demonstrates ${demonstrated} of ${assessed.length} skills the job description asks for` +
          (partial ? `, with partial evidence for ${partial} more.` : '.'),
      });
    }

    return { score, findings, stats: { total, assessed: assessed.length, demonstrated, partial } };
  }

  let score;
  if (!jobIntel) {
    // No target role: breadth and balance are all we can honestly judge.
    const populated = Object.values(skills).filter((list) => (list || []).length > 0).length;
    score = clamp(Math.min(total, 22) * 3 + populated * 6);
    if (total < 8) findings.push({ label: 'Few skills listed', severity: 'medium', detail: `${total} skills detected.` });
    if (populated < 3) findings.push({ label: 'Skills are not varied', severity: 'low', detail: 'Technical, functional, tools and soft skills are all worth separating.' });
  } else {
    const required = [...(jobIntel.skills?.required || []), ...(jobIntel.skills?.technical || []), ...(jobIntel.skills?.tools || [])];
    const unique = Array.from(new Set(required));
    if (!unique.length) {
      score = clamp(Math.min(total, 20) * 4);
    } else {
      const hay = Object.values(skills).flat().join(' ').toLowerCase();
      const covered = unique.filter((s) => hay.includes(String(s).toLowerCase())).length;
      score = clamp((covered / unique.length) * 100);
      if (covered < unique.length) {
        findings.push({
          label: 'Some required skills are not represented',
          severity: covered / unique.length < 0.5 ? 'high' : 'medium',
          detail: `${covered} of ${unique.length} skills named in the job description appear in your resume.`,
        });
      }
    }
  }

  return { score, findings, stats: { total } };
}

function scoreCompleteness(resume, checklist, profile) {
  const optional = [
    ['summary', Boolean(resume.summary?.trim())],
    ['experience', (resume.experience || []).length > 0],
    ['education', (resume.education || []).length > 0],
    ['skills', Object.values(resume.skills || {}).some((l) => (l || []).length)],
    ['certifications', (resume.certifications || []).length > 0],
    ['projects', (resume.projects || []).length > 0],
    ['contact', Boolean(resume.personal?.email && resume.personal?.phone)],
    ['headline', Boolean(resume.personal?.headline?.trim())],
  ];
  const present = optional.filter(([, ok]) => ok).length;

  /* Core sections carry most of the weight; the rest are bonuses.
     For a fresher, projects and education do the job an employment
     history does for everyone else — telling a student their resume is
     incomplete because it has no work history is both useless advice
     and untrue of what a good fresher CV looks like (spec §7). */
  const isFresher = profile?.strategy === 'fresher';
  const core = isFresher
    ? ['summary', 'education', 'skills', 'contact']
    : ['summary', 'experience', 'skills', 'contact'];
  const coreScore = (core.filter((k) => optional.find(([n]) => n === k)?.[1]).length / core.length) * 70;
  const bonusScore = ((present - core.length) / (optional.length - core.length)) * 30;

  const needsReview = (resume._needsReview || []).length;
  const penalty = Math.min(20, needsReview * 4);

  const findings = [];
  optional
    .filter(([, ok]) => !ok)
    // A fresher is not missing an employment history; they simply do not
    // have one yet, and we say so in the guidance rather than the faults.
    .filter(([name]) => !(isFresher && name === 'experience'))
    .forEach(([name]) => {
      findings.push({ label: `No ${name} section`, severity: core.includes(name) ? 'medium' : 'low', detail: '' });
    });
  if (needsReview) {
    findings.push({ label: `${needsReview} fields need your review`, severity: 'medium', detail: 'We could not read these confidently from your file.' });
  }

  return { score: clamp(coreScore + Math.max(0, bonusScore) - penalty), findings };
}

function scoreKeywordAlignment(keywordResult) {
  if (!keywordResult) return null;
  const { summary } = keywordResult;
  const tier1 = summary.tier1Coverage;
  const overall = summary.coverage;

  // Tier 1 dominates: covering ten Tier 3 terms while missing the two
  // Tier 1 ones is not alignment.
  const score = clamp(tier1 == null ? overall : tier1 * 0.7 + overall * 0.3);

  const findings = [];
  if (summary.missing > 0) {
    findings.push({
      label: `${summary.missing} job-description terms have no match`,
      severity: tier1 != null && tier1 < 50 ? 'high' : 'medium',
      detail: `${summary.exact} exact, ${summary.related} related, ${summary.possible} possible.`,
    });
  }
  if (summary.possible > 0) {
    findings.push({
      label: `${summary.possible} terms have partial evidence`,
      severity: 'low',
      detail: 'Confirm these and they can be stated properly rather than implied.',
    });
  }
  return { score, findings };
}

function scoreExperienceRelevance(resume, jobIntel, profile) {
  if (!jobIntel) return null;
  const findings = [];

  const responsibilities = (jobIntel.responsibilities || []).join(' ').toLowerCase();
  const bullets = (resume.experience || []).flatMap((r) => [...(r.responsibilities || []), ...(r.achievements || [])]);

  // Overlap between JD responsibility vocabulary and the CV's bullets.
  const jdWords = new Set(responsibilities.split(/\W+/).filter((w) => w.length > 4));
  let overlap = 0;
  bullets.forEach((b) => {
    const words = new Set(b.toLowerCase().split(/\W+/).filter((w) => w.length > 4));
    const shared = [...words].filter((w) => jdWords.has(w)).length;
    if (shared >= 2) overlap += 1;
  });
  const overlapRatio = bullets.length ? overlap / bullets.length : 0;

  // Title proximity between the target role and the candidate's history.
  const target = String(jobIntel.role?.jobTitle || '').toLowerCase();
  const titles = (resume.experience || []).map((r) => String(r.title || '').toLowerCase());
  const titleWords = target.split(/\W+/).filter((w) => w.length > 3);
  const titleHit = titleWords.length
    ? Math.max(0, ...titles.map((t) => titleWords.filter((w) => t.includes(w)).length / titleWords.length))
    : 0;

  // Years against the JD's stated requirement.
  const req = jobIntel.requirements?.experience;
  let yearsFit = 0.7;
  if (req && profile) {
    const years = profile.yearsOfExperience || 0;
    if (years >= req.min) yearsFit = 1;
    else if (years >= req.min * 0.6) yearsFit = 0.65;
    else yearsFit = 0.35;
  }

  const score = clamp((overlapRatio * 40 + titleHit * 30 + yearsFit * 30));

  if (overlapRatio < 0.25) {
    findings.push({ label: 'Your bullets and the job responsibilities share little vocabulary', severity: 'medium', detail: 'The work may well be the same — the wording is not.' });
  }
  if (req && profile && profile.yearsOfExperience < req.min) {
    findings.push({
      label: `The role asks for ${req.min}+ years; your resume shows about ${profile.yearsOfExperience}`,
      severity: 'medium',
      detail: 'Worth applying anyway when the rest is a strong fit — but lead with the evidence that offsets it.',
    });
  }

  return { score, findings };
}

/* ------------------------------------------------------------------ *
 * Main
 * ------------------------------------------------------------------ */

/**
 * @param {object} resume      Resume JSON
 * @param {object} opts
 * @param {object} [opts.jobIntel]       Job Intelligence (enables 2 extra categories)
 * @param {object} [opts.keywordResult]  Keyword Intelligence output
 * @param {object} [opts.profile]        Candidate profile
 * @param {object} [opts.configOverride] Admin scoring override
 */
export function computeResumeHealth(
  resume,
  { jobIntel = null, keywordResult = null, profile = null, skillGap = null, configOverride = null } = {}
) {
  const config = resolveConfig(configOverride);
  const rawText = resume?._source?.rawText || collectText(resume).join('\n');

  const checklist = runAtsChecklist(resume, { rawText });

  const categories = {
    atsStructure: scoreAtsStructure(checklist),
    achievementStrength: scoreAchievementStrength(resume, profile),
    skillsCoverage: scoreSkillsCoverage(resume, jobIntel, skillGap),
    readability: scoreReadability(resume, rawText),
    completeness: scoreCompleteness(resume, checklist, profile),
  };

  const hasJd = Boolean(jobIntel);
  if (hasJd) {
    const keywordAlignment = scoreKeywordAlignment(keywordResult);
    const experienceRelevance = scoreExperienceRelevance(resume, jobIntel, profile);
    if (keywordAlignment) categories.keywordAlignment = keywordAlignment;
    if (experienceRelevance) categories.experienceRelevance = experienceRelevance;
  }

  const weights = hasJd && categories.keywordAlignment && categories.experienceRelevance
    ? config.health.weightsWithJd
    : config.health.weightsWithoutJd;

  // Renormalise so the weights always sum to 1 even if a category is absent.
  const active = Object.keys(weights).filter((k) => categories[k]);
  const weightSum = active.reduce((s, k) => s + weights[k], 0) || 1;

  const overall = clamp(
    active.reduce((sum, key) => sum + categories[key].score * (weights[key] / weightSum), 0)
  );

  /* --- narrative summary (spec §5) ------------------------------ */
  const labelled = active.map((key) => ({ key, label: CATEGORY_LABELS[key], score: categories[key].score }));
  const strong = labelled.filter((c) => c.score >= 80).sort((a, b) => b.score - a.score);
  const weak = labelled.filter((c) => c.score < 65).sort((a, b) => a.score - b.score);

  const allFindings = active.flatMap((key) =>
    (categories[key].findings || []).map((f) => ({ ...f, category: CATEGORY_LABELS[key] }))
  );
  const severityRank = { high: 0, medium: 1, low: 2 };
  allFindings.sort((a, b) => severityRank[a.severity] - severityRank[b.severity]);

  return {
    score: overall,
    band: bandFor(overall, config),
    methodology: METHODOLOGY,
    scoredAgainstJd: hasJd,
    categories: Object.fromEntries(
      active.map((key) => [
        key,
        {
          label: CATEGORY_LABELS[key],
          score: categories[key].score,
          weight: Math.round((weights[key] / weightSum) * 100),
          findings: categories[key].findings || [],
          stats: categories[key].stats,
        },
      ])
    ),
    checklist,
    checklistSummary: {
      passed: checklist.filter((c) => c.pass).length,
      total: checklist.length,
      highFailures: checklist.filter((c) => !c.pass && c.severity === 'high').length,
    },
    whatIsStrong: strong.map((c) => c.label),
    whatNeedsImprovement: weak.map((c) => c.label),
    whatIsMissing: checklist.filter((c) => !c.pass && c.severity !== 'low').map((c) => c.label),
    priorityFindings: allFindings.slice(0, 8),
    lengthGuidance: lengthGuidance(profile?.careerLevel || 'mid', config),
  };
}

export const CATEGORY_LABELS = {
  atsStructure: 'ATS structure',
  keywordAlignment: 'Keyword alignment',
  experienceRelevance: 'Experience relevance',
  achievementStrength: 'Achievement strength',
  skillsCoverage: 'Skills coverage',
  readability: 'Readability',
  completeness: 'Completeness',
};
