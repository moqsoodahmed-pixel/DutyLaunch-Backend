/**
 * AGENT 13 — Job Match  (spec §7, §20)
 * AGENT 6  — Skill Gap   (spec §15, §16)
 *
 * Both are deterministic and both are explainable: every sub-score carries
 * the reason it landed where it did, because the UI has to show the
 * candidate *why* they are at 78% and never present the number as a
 * prediction of being hired (spec §7, §20).
 */

import { resolveConfig } from './scoringConfig.js';
import { MATCH } from './keywordIntelligence.js';
import { LEVEL_RANK } from './candidateProfile.js';
import { LEARNING_PATHS, canonicalise, skillCategoryOf } from './taxonomy.js';
import { resumeHaystack } from './resumeSchema.js';

const clamp = (n) => Math.max(0, Math.min(100, Math.round(n)));

export const MATCH_DISCLAIMER =
  'Profile Match compares your resume against this job description. It reflects how well your documented experience aligns with the stated requirements — not a prediction of whether you will be shortlisted or hired.';

/* ------------------------------------------------------------------ *
 * Job match
 * ------------------------------------------------------------------ */

function matchSkills(resume, jobIntel) {
  const required = Array.from(new Set([
    ...(jobIntel.skills?.required || []),
    ...(jobIntel.skills?.technical || []),
    ...(jobIntel.skills?.tools || []),
    ...(jobIntel.skills?.functional || []),
  ]));

  if (!required.length) {
    return { score: 70, reason: 'The job description does not list specific skills, so this is a neutral baseline.', matched: [], missing: [] };
  }

  const hay = resumeHaystack(resume);
  const matched = [];
  const missing = [];

  required.forEach((skill) => {
    if (hay.includes(String(skill).toLowerCase())) matched.push(skill);
    else missing.push(skill);
  });

  return {
    score: clamp((matched.length / required.length) * 100),
    reason: `${matched.length} of ${required.length} skills named in the job description appear in your resume.`,
    matched,
    missing,
  };
}

function matchKeywords(keywordResult) {
  if (!keywordResult) return { score: 60, reason: 'Keyword analysis was not available.' };
  const { summary } = keywordResult;
  const tier1 = summary.tier1Coverage;
  return {
    score: clamp(tier1 == null ? summary.coverage : tier1 * 0.65 + summary.coverage * 0.35),
    reason:
      tier1 == null
        ? `${summary.coverage}% of job-description terms are covered.`
        : `${summary.tier1Covered} of ${summary.tier1Total} critical terms are covered (${summary.coverage}% overall).`,
  };
}

function matchExperience(profile, jobIntel) {
  const req = jobIntel.requirements?.experience;
  const years = profile?.yearsOfExperience ?? 0;

  if (!req) {
    return { score: 75, reason: 'The job description does not state a years-of-experience requirement.' };
  }

  if (years >= req.min) {
    // Being far over the stated range is its own (mild) mismatch signal.
    const over = req.max && years > req.max * 1.8;
    return {
      score: over ? 85 : 100,
      reason: over
        ? `You have about ${years} years against a stated range of ${req.min}–${req.max}. You may be over-qualified for how the role is written.`
        : `You have about ${years} years against a requirement of ${req.min}+.`,
    };
  }

  const ratio = req.min ? years / req.min : 1;
  return {
    score: clamp(ratio * 85),
    reason: `The role asks for ${req.min}+ years; your resume documents about ${years}.`,
  };
}

function matchSeniority(profile, jobIntel) {
  const jobLevel = jobIntel.role?.seniority;
  const candidateLevel = profile?.careerLevel;
  if (!jobLevel || !candidateLevel) {
    return { score: 70, reason: 'Seniority could not be determined from one side of the comparison.' };
  }

  const gap = (LEVEL_RANK[jobLevel] ?? 3) - (LEVEL_RANK[candidateLevel] ?? 3);
  if (gap === 0) return { score: 100, reason: `Both the role and your profile read as ${jobLevel.replace('-', ' ')} level.` };
  if (gap === 1) return { score: 82, reason: 'The role is one level above your current profile — a realistic step up.' };
  if (gap === -1) return { score: 85, reason: 'The role is one level below your current profile.' };
  if (gap > 1) return { score: clamp(70 - gap * 15), reason: `The role sits about ${gap} levels above your documented profile.` };
  return { score: clamp(75 + gap * 8), reason: `The role sits about ${Math.abs(gap)} levels below your documented profile.` };
}

function matchEducation(resume, jobIntel) {
  const req = jobIntel.requirements?.education;
  if (!req) return { score: 80, reason: 'No specific education requirement was stated.' };

  const education = resume.education || [];
  if (!education.length) {
    return { score: 30, reason: 'The job description states an education requirement and no education section was found.' };
  }

  const have = education.map((e) => `${e.degree} ${e.field}`.toLowerCase()).join(' ');
  const LEVELS = [
    [/ph\.?d|doctorate/, 4],
    [/master|m\.?tech|m\.?sc|m\.?b\.?a|m\.?com|m\.?a\b|pgdm/, 3],
    [/bachelor|b\.?tech|b\.?e\b|b\.?sc|b\.?com|b\.?a\b|degree|graduate/, 2],
    [/diploma/, 1],
  ];
  const levelOf = (text) => (LEVELS.find(([re]) => re.test(text)) || [null, 0])[1];

  const required = levelOf(req.level || req.raw || '');
  const held = Math.max(...education.map((e) => levelOf(`${e.degree} ${e.field}`.toLowerCase())), 0);

  if (!required) return { score: 80, reason: 'The education requirement could not be read precisely.' };
  if (held >= required) return { score: 100, reason: 'Your qualifications meet the stated education requirement.' };
  return { score: clamp(45 + held * 15), reason: 'Your qualifications sit below the stated education requirement.' };
}

function matchLocation(resume, jobIntel) {
  const jobLocation = String(jobIntel.role?.location || '').toLowerCase();
  const candidateLocation = String(resume.personal?.location || '').toLowerCase();

  if (!jobLocation) return { score: 75, reason: 'No location was stated in the job description.' };
  if (/remote/.test(jobLocation)) return { score: 100, reason: 'The role is remote.' };
  if (!candidateLocation) return { score: 60, reason: 'No location on your resume to compare against.' };

  const tokens = jobLocation.split(/[\s,]+/).filter((t) => t.length > 3);
  const hit = tokens.some((t) => candidateLocation.includes(t));
  return hit
    ? { score: 100, reason: 'Your stated location matches the job location.' }
    : { score: 45, reason: 'Your stated location differs from the job location. Relocation or remote working may need to be addressed.' };
}

/**
 * Compares a candidate against a target job.
 * @returns overall + per-dimension scores, each with its reason.
 */
export function computeJobMatch(resume, jobIntel, { profile, keywordResult, configOverride } = {}) {
  const config = resolveConfig(configOverride);
  const weights = config.match.weights;

  const dimensions = {
    skills: matchSkills(resume, jobIntel),
    keywords: matchKeywords(keywordResult),
    experience: matchExperience(profile, jobIntel),
    seniority: matchSeniority(profile, jobIntel),
    education: matchEducation(resume, jobIntel),
    location: matchLocation(resume, jobIntel),
  };

  const overall = clamp(
    Object.entries(weights).reduce((sum, [key, w]) => sum + (dimensions[key]?.score ?? 0) * w, 0)
  );

  const ranked = Object.entries(dimensions)
    .map(([key, value]) => ({ key, label: DIMENSION_LABELS[key], ...value }))
    .sort((a, b) => b.score - a.score);

  const strong = (keywordResult?.keywords || [])
    .filter((k) => k.status === MATCH.EXACT && k.tier <= 2)
    .slice(0, 6)
    .map((k) => k.term);

  const needsImprovement = (keywordResult?.missingTier1 || []).slice(0, 6).map((k) => k.term);

  return {
    overall,
    disclaimer: MATCH_DISCLAIMER,
    dimensions: Object.fromEntries(
      Object.entries(dimensions).map(([key, value]) => [
        key,
        { label: DIMENSION_LABELS[key], weight: Math.round(weights[key] * 100), ...value },
      ])
    ),
    strongestAreas: ranked.slice(0, 3).map((d) => d.label),
    weakestAreas: ranked.slice(-2).map((d) => d.label),
    strongMatch: strong,
    needsImprovement,
    /* Thin JDs cannot support a confident number — say so (spec §7). */
    confidence: jobIntel.quality === 'thin' ? 'low' : jobIntel.quality === 'limited' ? 'medium' : 'high',
    confidenceNote:
      jobIntel.quality === 'thin'
        ? 'This job description is very short, so the comparison is based on limited information.'
        : jobIntel.quality === 'limited'
          ? 'This job description gave us relatively few specifics, so treat the detail as indicative.'
          : null,
  };
}

const DIMENSION_LABELS = {
  skills: 'Skills match',
  keywords: 'Keyword alignment',
  experience: 'Experience match',
  seniority: 'Seniority match',
  education: 'Education match',
  location: 'Location match',
};

/* ------------------------------------------------------------------ *
 * Skill gap (spec §15)
 * ------------------------------------------------------------------ */

export const GAP_STATUS = Object.freeze({
  DEMONSTRATED: 'DEMONSTRATED',
  PARTIAL: 'PARTIAL',
  NOT_DEMONSTRATED: 'NOT_DEMONSTRATED',
});

/**
 * Classifies every skill the job asks for against the candidate's
 * evidence, then turns the genuine gaps into learning recommendations the
 * Upskills marketplace can resolve against real partner catalogue entries.
 */
export function computeSkillGap(resume, jobIntel, { keywordResult } = {}) {
  const required = Array.from(new Set(jobIntel.skills?.required || []));
  const preferred = Array.from(new Set(jobIntel.skills?.preferred || []));

  const byTerm = new Map((keywordResult?.keywords || []).map((k) => [k.term, k]));
  const hay = resumeHaystack(resume);

  const classify = (skill, necessity) => {
    const keyword = byTerm.get(skill);
    let status;

    if (keyword) {
      if (keyword.status === MATCH.EXACT || keyword.status === MATCH.RELATED) status = GAP_STATUS.DEMONSTRATED;
      else if (keyword.status === MATCH.POSSIBLE) status = GAP_STATUS.PARTIAL;
      else status = GAP_STATUS.NOT_DEMONSTRATED;
    } else {
      status = hay.includes(String(skill).toLowerCase()) ? GAP_STATUS.DEMONSTRATED : GAP_STATUS.NOT_DEMONSTRATED;
    }

    return {
      skill,
      canonical: canonicalise(skill) || skill,
      category: skillCategoryOf(skill),
      necessity,
      status,
      evidence: keyword?.evidence || null,
      importance: keyword?.importance ?? (necessity === 'required' ? 0.7 : 0.45),
    };
  };

  const assessed = [
    ...required.map((s) => classify(s, 'required')),
    ...preferred.filter((s) => !required.includes(s)).map((s) => classify(s, 'preferred')),
  ].sort((a, b) => b.importance - a.importance);

  const gaps = assessed.filter((a) => a.status === GAP_STATUS.NOT_DEMONSTRATED);
  const partial = assessed.filter((a) => a.status === GAP_STATUS.PARTIAL);

  /* --- learning recommendations (spec §16) ----------------------- */
  const recommendations = [];
  const seen = new Set();

  gaps.forEach((gap) => {
    const key = gap.canonical;
    if (seen.has(key)) return;
    const path = LEARNING_PATHS[key];
    if (!path) return;
    seen.add(key);
    recommendations.push({
      skill: gap.skill,
      necessity: gap.necessity,
      label: path.label,
      track: path.track,
      /* A search term, not a hard-coded course. The Upskills marketplace
         resolves it against whatever partner catalogue actually exists,
         so we never promise a course that isn't listed. */
      catalogueQuery: path.query,
      link: `/professional-courses?q=${encodeURIComponent(path.query)}`,
    });
  });

  // Gaps with no mapped learning path still deserve an honest suggestion.
  gaps
    .filter((g) => !LEARNING_PATHS[g.canonical] && g.necessity === 'required')
    .slice(0, 4)
    .forEach((gap) => {
      recommendations.push({
        skill: gap.skill,
        necessity: gap.necessity,
        label: `Practical experience in ${gap.skill}`,
        track: 'experience',
        catalogueQuery: gap.skill,
        link: `/professional-courses?q=${encodeURIComponent(gap.skill)}`,
      });
    });

  return {
    assessed,
    demonstrated: assessed.filter((a) => a.status === GAP_STATUS.DEMONSTRATED),
    partial,
    gaps,
    summary: {
      total: assessed.length,
      demonstrated: assessed.filter((a) => a.status === GAP_STATUS.DEMONSTRATED).length,
      partial: partial.length,
      missing: gaps.length,
      requiredMissing: gaps.filter((g) => g.necessity === 'required').length,
    },
    recommendations: recommendations.slice(0, 8),
  };
}
