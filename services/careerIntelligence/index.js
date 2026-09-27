/**
 * THE CAREER INTELLIGENCE ENGINE (spec §29, §31).
 *
 * The orchestration layer. It owns the *order* the agents run in and the
 * data that flows between them, and nothing else — no scoring, no parsing,
 * no generation lives here. That separation is what makes each agent
 * independently testable and lets Phase 2+ features slot in without
 * rewriting the pipeline.
 *
 * Pipeline:
 *   parse -> profile -> [JD analysis -> keywords -> match -> skill gap]
 *         -> health -> questions -> recommendations
 *
 * Everything in brackets is skipped when no target job is supplied, and
 * the Resume Health score honestly reports that it was scored without one.
 */

import { parseResumeFile, parseResumeText } from './resumeParser.js';
import { buildCandidateProfile } from './candidateProfile.js';
import { analyzeJobDescription } from './jobIntelligence.js';
import { runKeywordIntelligence } from './keywordIntelligence.js';
import { computeResumeHealth } from './resumeHealth.js';
import { computeJobMatch, computeSkillGap } from './matching.js';
import { generateEvidenceQuestions } from './achievementBuilder.js';
import { runQualityControl, validateIntegrity } from './integrity.js';
import { suggestTemplate, listTemplates, renderResume } from './templateEngine.js';
import { parseResumeJson } from './resumeSchema.js';

export * from './resumeSchema.js';
export { listTemplates, renderResume, suggestTemplate };
export { parseResumeFile, parseResumeText };
export { analyzeJobDescription };
export { runQualityControl, validateIntegrity };
export { generateEvidenceQuestions, buildAchievementBullet, toConfirmedFacts } from './achievementBuilder.js';
export { proposeRewrites, applyDecisions, buildComparison } from './rewriter.js';
export { DEFAULT_CONFIG, resolveConfig, countryGuidance } from './scoringConfig.js';
export { METHODOLOGY } from './resumeHealth.js';
export { MATCH_DISCLAIMER, GAP_STATUS, computeJobMatch, computeSkillGap } from './matching.js';
export { MATCH, classifyKeyword, runKeywordIntelligence } from './keywordIntelligence.js';
export { deterministicRewrite, OUTPUT_RULES } from './rewriter.js';
export { computeResumeHealth, runAtsChecklist, CATEGORY_LABELS } from './resumeHealth.js';
export { buildCandidateProfile } from './candidateProfile.js';
export { TEMPLATES } from './templateEngine.js';
export { generateLinkedIn, generateCoverLetter, generateInterviewPrep } from './careerTools.js';

/**
 * Runs the full analysis for a resume, optionally against a target job.
 *
 * @param {object} resumeJson
 * @param {object} opts
 * @param {string} [opts.jobDescription]
 * @param {object} [opts.jobHints]        { jobTitle, company, industry, country, location }
 * @param {Array}  [opts.confirmedFacts]
 * @param {object} [opts.configOverride]
 */
export function analyzeCandidate(resumeJson, opts = {}) {
  const resume = parseResumeJson(resumeJson);
  const { jobDescription, jobHints = {}, confirmedFacts = [], configOverride = null } = opts;

  /* 1. Candidate profile */
  const profile = buildCandidateProfile(resume);

  /* 2. Target job, when one was supplied */
  const hasJd = Boolean(jobDescription?.trim()) || Boolean(jobHints.jobTitle);
  let jobIntel = null;
  let keywordResult = null;
  let jobMatch = null;
  let skillGap = null;

  if (hasJd) {
    jobIntel = analyzeJobDescription(jobDescription || '', {
      ...jobHints,
      country: jobHints.country || resume.target?.country,
    });
    keywordResult = runKeywordIntelligence(resume, jobIntel, { candidateSeniority: profile.careerLevel });
    jobMatch = computeJobMatch(resume, jobIntel, { profile, keywordResult, configOverride });
    skillGap = computeSkillGap(resume, jobIntel, { keywordResult });
  }

  /* 3. Resume health */
  const health = computeResumeHealth(resume, { jobIntel, keywordResult, profile, skillGap, configOverride });

  /* 4. Evidence questions */
  const questions = generateEvidenceQuestions(resume, { keywordResult, profile });

  /* 5. Next actions */
  const recommendations = buildRecommendations({ health, jobMatch, skillGap, profile, questions, keywordResult });

  return {
    resume,
    profile,
    jobIntel,
    keywords: keywordResult,
    match: jobMatch,
    skillGap,
    health,
    questions,
    recommendations,
    suggestedTemplate: suggestTemplate(profile, jobIntel),
    confirmedFacts,
    analyzedAt: new Date().toISOString(),
  };
}

/* ------------------------------------------------------------------ *
 * Next-action recommendations (spec §29)
 * ------------------------------------------------------------------ */

function buildRecommendations({ health, jobMatch, skillGap, profile, questions, keywordResult }) {
  const actions = [];
  const add = (priority, action) => actions.push({ priority, ...action });

  /* Fix what is structurally broken before anything else — a resume the
     parser cannot read makes every other improvement pointless. */
  const highFailures = (health.checklist || []).filter((c) => !c.pass && c.severity === 'high');
  if (highFailures.length) {
    add(1, {
      id: 'fix-structure',
      title: `Fix ${highFailures.length} structural issue${highFailures.length === 1 ? '' : 's'}`,
      body: highFailures.slice(0, 3).map((f) => f.label).join('; ') + '.',
      cta: { label: 'Review extracted information', to: '/ai-resume-builder#review' },
    });
  }

  if (questions.length) {
    add(2, {
      id: 'answer-questions',
      title: `Answer ${questions.length} question${questions.length === 1 ? '' : 's'} about your experience`,
      body: 'These turn work you have already done into claims your resume can actually make. We will not state anything you have not confirmed.',
      cta: { label: 'Open the achievement builder', to: '/ai-resume-builder#evidence' },
    });
  }

  if (health.score < 75) {
    add(3, {
      id: 'optimise',
      title: 'Optimise your resume content',
      body: `Your Resume Health is ${health.score}. The weakest areas are ${health.whatNeedsImprovement.slice(0, 2).join(' and ') || 'content strength and keyword coverage'}.`,
      cta: { label: 'Optimise my resume', to: '/ai-resume-builder' },
    });
  }

  if (skillGap?.recommendations?.length) {
    const top = skillGap.recommendations[0];
    add(4, {
      id: 'upskill',
      title: `Close your skill gap: ${top.skill}`,
      body: `${skillGap.summary.requiredMissing} required skill${skillGap.summary.requiredMissing === 1 ? '' : 's'} from this job description ${skillGap.summary.requiredMissing === 1 ? 'is' : 'are'} not evidenced in your resume.`,
      cta: { label: 'Explore learning options', to: top.link },
    });
  }

  if (jobMatch && jobMatch.overall >= 60) {
    add(5, {
      id: 'apply',
      title: 'Search for matching roles',
      body: `Your profile match against this job description is ${jobMatch.overall}%. Roles with similar requirements are worth a targeted application.`,
      cta: { label: 'Browse jobs', to: '/jobs' },
    });
  }

  add(6, {
    id: 'linkedin',
    title: 'Align your LinkedIn profile',
    body: 'Your LinkedIn should tell the same career story as your resume. Recruiters check both.',
    cta: { label: 'Optimise LinkedIn', to: '/linkedin-optimization' },
  });

  if (jobMatch) {
    add(7, {
      id: 'interview',
      title: 'Prepare for the interview',
      body: 'Practise the questions this job description and your own resume claims are most likely to produce.',
      cta: { label: 'Start interview prep', to: '/interview-preparation' },
    });
  }

  return actions.sort((a, b) => a.priority - b.priority).slice(0, 5);
}

/* ------------------------------------------------------------------ *
 * Targeted resume derivation (spec §17, §43, §44)
 * ------------------------------------------------------------------ */

/**
 * Derives a job-targeted resume from the master profile.
 *
 * The master is never modified and nothing is deleted from it. Less
 * relevant roles are *shortened* — their bullets trimmed to the most
 * relevant ones — and the ordering of sections follows the target. The
 * full history remains in the master for the next target (spec §43, §44).
 */
export function deriveTargetedResume(master, { jobIntel, keywordResult, maxBulletsPerRole = 5 }) {
  const resume = parseResumeJson(master);
  const relevantTerms = new Set(
    (keywordResult?.keywords || [])
      .filter((k) => k.tier <= 2)
      .map((k) => k.term.toLowerCase())
  );

  const scoreBullet = (bullet) => {
    const lower = bullet.toLowerCase();
    let score = 0;
    relevantTerms.forEach((term) => {
      if (lower.includes(term)) score += 2;
    });
    if (/\d/.test(bullet)) score += 1.5; // quantified bullets earn their space
    if (/^(led|delivered|built|managed|increased|reduced|launched|owned)/i.test(bullet)) score += 0.5;
    return score;
  };

  const now = new Date();
  const recencyYears = (role) => {
    const end = role.current ? now.getFullYear() : Number(String(role.endDate || '').slice(0, 4));
    return Number.isFinite(end) ? now.getFullYear() - end : 99;
  };

  resume.experience = (resume.experience || []).map((role) => {
    const bullets = [...(role.responsibilities || []), ...(role.achievements || [])];
    const ranked = bullets
      .map((b) => ({ text: b, score: scoreBullet(b), isAchievement: (role.achievements || []).includes(b) }))
      .sort((a, b) => b.score - a.score);

    // Recent and relevant roles keep their depth; older or less relevant
    // ones are condensed, not removed.
    const roleRelevance = ranked.reduce((s, r) => s + r.score, 0);
    const recent = recencyYears(role) <= 6;
    const keep = recent || roleRelevance > 4 ? maxBulletsPerRole : 2;

    const kept = ranked.slice(0, keep);

    return {
      ...role,
      responsibilities: kept.filter((r) => !r.isAchievement).map((r) => r.text),
      achievements: kept.filter((r) => r.isAchievement).map((r) => r.text),
      _shortened: kept.length < bullets.length,
      _originalBulletCount: bullets.length,
    };
  });

  resume.target = {
    ...resume.target,
    jobTitle: jobIntel?.role?.jobTitle || resume.target?.jobTitle || '',
    industry: (jobIntel?.role?.industry || [])[0] || resume.target?.industry || '',
    seniority: jobIntel?.role?.seniority || resume.target?.seniority || '',
    country: jobIntel?.role?.country || resume.target?.country || '',
  };

  // Provenance survives derivation — a targeted version can still be
  // integrity-checked against the original document.
  resume._source = parseResumeJson(master)._source;

  return resume;
}
