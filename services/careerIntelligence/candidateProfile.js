/**
 * AGENT 2 — Candidate Profile Analyst (spec §6, §7, §8, §9, §14).
 *
 * Deterministic. Derives an internal profile from the Resume JSON: career
 * level, years of experience, progression, employment gaps, career changes
 * and transferable skills — and picks the optimisation strategy
 * (fresher / standard / executive / career-changer).
 *
 * What this agent deliberately does NOT do: infer anything sensitive.
 * No age, gender, nationality, marital status, health or religion is
 * derived, even where a CV states it (spec §6, §21).
 */

import {
  SENIORITY_TITLE_MARKERS,
  SENIORITY_BY_YEARS,
  ROLE_FAMILIES,
  skillCategoryOf,
} from './taxonomy.js';

/* ------------------------------------------------------------------ *
 * Date maths
 * ------------------------------------------------------------------ */

/** 'YYYY-MM' | 'YYYY' | 'present' -> month index since year 0. */
function toMonths(value) {
  if (!value) return null;
  if (value === 'present') {
    const now = new Date();
    return now.getFullYear() * 12 + now.getMonth() + 1;
  }
  const m = String(value).match(/^(\d{4})(?:-(\d{1,2}))?$/);
  if (!m) return null;
  const year = Number(m[1]);
  if (year < 1950 || year > new Date().getFullYear() + 1) return null;
  return year * 12 + (m[2] ? Number(m[2]) : 1);
}

function monthsToYears(months) {
  return Math.round((months / 12) * 10) / 10;
}

function formatMonth(months) {
  if (months == null) return '';
  const year = Math.floor((months - 1) / 12);
  const month = ((months - 1) % 12) + 1;
  return `${year}-${String(month).padStart(2, '0')}`;
}

/**
 * Merges overlapping role intervals so concurrent jobs are not
 * double-counted as tenure — a real problem for consultants and anyone
 * who freelanced alongside a salaried role.
 */
function mergeIntervals(intervals) {
  const sorted = intervals.filter((i) => i.start != null && i.end != null && i.end >= i.start).sort((a, b) => a.start - b.start);
  const merged = [];
  sorted.forEach((interval) => {
    const last = merged[merged.length - 1];
    if (last && interval.start <= last.end + 1) {
      last.end = Math.max(last.end, interval.end);
    } else {
      merged.push({ ...interval });
    }
  });
  return merged;
}

/* ------------------------------------------------------------------ *
 * Seniority
 * ------------------------------------------------------------------ */

const LEVEL_RANK = {
  fresher: 0, entry: 1, associate: 2, mid: 3, senior: 4, lead: 5,
  manager: 6, 'senior-manager': 7, director: 8, vp: 9, 'c-suite': 10,
};

/** Seniority implied by a job title alone. */
export function seniorityFromTitle(title) {
  const t = String(title || '').toLowerCase();
  if (!t) return null;
  // Ordered most-senior first so "Senior Manager" isn't read as "Senior".
  for (const level of ['c-suite', 'vp', 'director', 'senior-manager', 'manager', 'lead', 'senior', 'mid', 'entry', 'fresher']) {
    if ((SENIORITY_TITLE_MARKERS[level] || []).some((marker) => t.includes(marker))) return level;
  }
  return null;
}

function seniorityFromYears(years) {
  return (SENIORITY_BY_YEARS.find((b) => years <= b.max) || { level: 'mid' }).level;
}

/* ------------------------------------------------------------------ *
 * Role family
 * ------------------------------------------------------------------ */

function roleFamilyOf(title) {
  const t = String(title || '').toLowerCase();
  if (!t) return null;
  let best = null;
  for (const [family, roles] of Object.entries(ROLE_FAMILIES)) {
    for (const role of roles) {
      if (t.includes(role)) return family;
      // Partial: a distinctive word from the role name.
      const head = role.split(' ')[0];
      if (head.length > 4 && t.includes(head) && !best) best = family;
    }
  }
  return best;
}

/* ------------------------------------------------------------------ *
 * Transferable skills (spec §9, §14)
 * ------------------------------------------------------------------ */

const TRANSFER_MAP = {
  'customer support': ['Customer Success', 'Account Management', 'Service Delivery'],
  'customer success': ['Account Management', 'Business Development'],
  operations: ['Project Management', 'Process Excellence', 'Supply Chain'],
  sales: ['Business Development', 'Key Account Management', 'Partnerships'],
  'business development': ['Sales Management', 'Partnerships', 'Strategy'],
  'legal operations': ['Compliance Operations', 'Contract Management', 'Risk'],
  finance: ['Business Analytics', 'FP&A', 'Commercial Finance'],
  accounting: ['Financial Analysis', 'Audit', 'Compliance'],
  hr: ['Talent Acquisition', 'HR Business Partnering', 'L&D'],
  recruitment: ['Talent Acquisition', 'HR Business Partnering', 'Account Management'],
  teaching: ['Learning & Development', 'Training', 'Instructional Design'],
  engineering: ['Technical Project Management', 'Solution Consulting'],
  'quality assurance': ['Process Excellence', 'Compliance', 'Product Operations'],
  logistics: ['Supply Chain', 'Operations Management', 'Procurement'],
  marketing: ['Growth', 'Product Marketing', 'Brand Management'],
  'project management': ['Programme Management', 'Business Operations', 'Delivery Management'],
};

function transferableSkills(profileTitles, skills) {
  const out = new Set();
  const titleBlob = profileTitles.join(' ').toLowerCase();

  Object.entries(TRANSFER_MAP).forEach(([from, targets]) => {
    if (titleBlob.includes(from)) targets.forEach((t) => out.add(t));
  });

  // Functional skills are transferable by definition; technical ones
  // usually are not, so only the former are surfaced here.
  (skills.functional || []).slice(0, 12).forEach((s) => out.add(s));

  return Array.from(out).slice(0, 15);
}

/* ------------------------------------------------------------------ *
 * Main
 * ------------------------------------------------------------------ */

const GAP_THRESHOLD_MONTHS = 4;

/**
 * Builds the internal candidate profile.
 * @param {object} resume - Resume JSON
 * @returns {object} candidate profile (never persisted as resume content —
 *          it is analysis, not a claim about the candidate)
 */
export function buildCandidateProfile(resume) {
  const experience = Array.isArray(resume?.experience) ? resume.experience : [];
  const education = Array.isArray(resume?.education) ? resume.education : [];
  const skills = resume?.skills || {};

  /* --- tenure -------------------------------------------------- */
  const intervals = experience
    .map((role) => {
      const start = toMonths(role.startDate);
      const end = role.current ? toMonths('present') : toMonths(role.endDate);
      return start != null ? { start, end: end ?? start, role } : null;
    })
    .filter(Boolean);

  const merged = mergeIntervals(intervals);
  const totalMonths = merged.reduce((sum, i) => sum + (i.end - i.start + 1), 0);
  const yearsOfExperience = intervals.length ? monthsToYears(totalMonths) : 0;

  /* --- gaps (spec §6) ------------------------------------------ */
  const gaps = [];
  for (let i = 1; i < merged.length; i += 1) {
    const gapMonths = merged[i].start - merged[i - 1].end - 1;
    if (gapMonths >= GAP_THRESHOLD_MONTHS) {
      gaps.push({
        from: formatMonth(merged[i - 1].end),
        to: formatMonth(merged[i].start),
        months: gapMonths,
      });
    }
  }

  /* --- seniority ------------------------------------------------ */
  const titles = experience.map((r) => r.title).filter(Boolean);
  const titleLevels = titles.map(seniorityFromTitle).filter(Boolean);

  // Most recent role carries the most weight; fall back to the highest
  // level ever held, then to years of experience.
  const currentRole = experience.find((r) => r.current) || experience[0] || null;
  const currentLevel = currentRole ? seniorityFromTitle(currentRole.title) : null;
  const highestLevel = titleLevels.reduce(
    (best, level) => (LEVEL_RANK[level] > LEVEL_RANK[best ?? 'fresher'] ? level : best),
    null
  );

  let careerLevel;
  if (!experience.length) {
    careerLevel = 'fresher';
  } else if (currentLevel) {
    careerLevel = currentLevel;
  } else if (highestLevel) {
    careerLevel = highestLevel;
  } else {
    careerLevel = seniorityFromYears(yearsOfExperience);
  }

  // A title can outrun the tenure behind it. Cap "director" claims from a
  // CV with two years of history — but never *downgrade* below what the
  // years alone would imply.
  const yearsLevel = seniorityFromYears(yearsOfExperience);
  if (LEVEL_RANK[careerLevel] > LEVEL_RANK[yearsLevel] + 3) careerLevel = yearsLevel;

  /* --- progression ---------------------------------------------- */
  const chronological = [...intervals].sort((a, b) => a.start - b.start);
  const levelSequence = chronological.map((i) => seniorityFromTitle(i.role.title)).filter(Boolean);
  let progression = 'unclear';
  if (levelSequence.length >= 2) {
    const first = LEVEL_RANK[levelSequence[0]] ?? 0;
    const last = LEVEL_RANK[levelSequence[levelSequence.length - 1]] ?? 0;
    if (last > first) progression = 'upward';
    else if (last === first) progression = 'lateral';
    else progression = 'stepped-back';
  } else if (levelSequence.length === 1) {
    progression = 'single-level';
  }

  /* --- industries and functions --------------------------------- */
  const families = titles.map(roleFamilyOf).filter(Boolean);
  const functionalRoles = Array.from(new Set(families));
  const industryExposure = Array.from(new Set(skills.industry || []));

  const changedFamily = functionalRoles.length > 1;

  /* --- management signals --------------------------------------- */
  const allText = experience
    .flatMap((r) => [...(r.responsibilities || []), ...(r.achievements || []), r.title || ''])
    .join(' ')
    .toLowerCase();

  const teamSizeMatch = allText.match(/team of (\d{1,4})|(\d{1,4})[\s-]*(?:member|person|people|direct reports?|fte)/);
  const teamSize = teamSizeMatch ? Number(teamSizeMatch[1] || teamSizeMatch[2]) : null;

  const hasLeadership = /\b(led|managed|supervised|headed|directed|mentored|coached|built a team)\b/.test(allText)
    || LEVEL_RANK[careerLevel] >= LEVEL_RANK.lead;
  const hasPnl = /\b(p&l|profit and loss|budget of|revenue of|cost centre|cost center)\b/.test(allText);

  /* --- strategy (spec §7, §8, §9) ------------------------------- */
  let strategy = 'standard';
  if (!experience.length || yearsOfExperience < 1) strategy = 'fresher';
  else if (LEVEL_RANK[careerLevel] >= LEVEL_RANK.director) strategy = 'executive';
  else if (changedFamily) strategy = 'career-changer';

  /* --- core competencies ---------------------------------------- */
  const competencyCounts = new Map();
  experience.forEach((role) => {
    (role.skillsUsed || []).forEach((s) => {
      const key = s.toLowerCase();
      competencyCounts.set(key, (competencyCounts.get(key) || 0) + 1);
    });
  });
  const coreCompetencies = Array.from(competencyCounts.entries())
    .sort((a, b) => b[1] - a[1])
    .slice(0, 10)
    .map(([term]) => term);

  /* --- fresher evidence (spec §7) -------------------------------- */
  const fresherEvidence = {
    education: education.length,
    projects: (resume.projects || []).length,
    internships: experience.filter((r) => /intern/i.test(`${r.title} ${r.employmentType}`)).length,
    certifications: (resume.certifications || []).length,
    volunteering: (resume.volunteering || []).length,
    portfolio: (resume.portfolio || []).length,
    achievements: (resume.achievements || []).length,
  };

  const totalSkills = Object.values(skills).reduce((n, list) => n + (list?.length || 0), 0);

  return {
    careerLevel,
    seniorityRank: LEVEL_RANK[careerLevel] ?? 3,
    yearsOfExperience,
    totalRoles: experience.length,
    currentRole: currentRole ? { title: currentRole.title, company: currentRole.company } : null,
    progression,
    functionalRoles,
    industryExposure,
    coreCompetencies,
    totalSkills,
    skillBreakdown: Object.fromEntries(
      Object.entries(skills).map(([k, v]) => [k, (v || []).length])
    ),
    leadership: { hasLeadership, teamSize, hasPnl },
    employmentGaps: gaps,
    hasEmploymentGap: gaps.length > 0,
    careerChange: changedFamily,
    transferableSkills: transferableSkills(titles, skills),
    education: education.map((e) => ({ degree: e.degree, institution: e.institution, endDate: e.endDate })),
    certifications: (resume.certifications || []).map((c) => c.name).filter(Boolean),
    fresherEvidence,
    strategy,
    /* What the strategy means for the rewriter, in one line it can use. */
    strategyGuidance: STRATEGY_GUIDANCE[strategy],
  };
}

const STRATEGY_GUIDANCE = {
  fresher:
    'Lead with education, academic projects, internships, certifications and demonstrated skills. Do not treat the absence of employment history as a weakness or apologise for it.',
  standard:
    'Lead with role relevance and measurable outcomes. Keep bullets specific to what the candidate personally did.',
  executive:
    'Lead with scope, business impact and strategic ownership. Keep bullets few and consequential — no task lists. Only cite P&L, headcount or revenue figures that appear in the verified data.',
  'career-changer':
    'Lead with transferable competencies that map to the target role. Never restate or alter a previous job title; reframe the evidence underneath it instead.',
};

export { LEVEL_RANK, toMonths, mergeIntervals };
