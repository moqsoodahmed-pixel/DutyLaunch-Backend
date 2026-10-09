/**
 * Upload -> optimise workflow glue.
 *
 * `proposeRewrites()` (rewriter.js) produces validated proposals. This module
 * turns them into a complete optimised resume WITHOUT a second rewriting or
 * scoring engine:
 *
 *   - proposals that passed the integrity checks (numbers, named entities,
 *     evidence) are applied to a COPY of the resume; the original is never
 *     touched and is returned alongside so the UI can offer "revert";
 *   - safe, deterministic improvements that need no model are added (a
 *     missing headline is taken from the most recent job title; skills are
 *     reordered so job-relevant ones come first — nothing is added or
 *     removed);
 *   - before/after numbers come from the existing scoring engine
 *     (`analyzeCandidate`), never from a model.
 */

import { applyDecisions, buildComparison } from './rewriter.js';
import { EVIDENCE } from './resumeSchema.js';
import { MATCH } from './keywordIntelligence.js';

const clone = (v) => JSON.parse(JSON.stringify(v));

/** Proposals the pipeline may apply without a manual click. */
export function isAutoApplicable(proposal) {
  return proposal.evidence === EVIDENCE.VERIFIED || proposal.evidence === EVIDENCE.INFERRED;
}

/** Skill text matches a job keyword when one contains the other, as whole words. */
function skillMatchesKeyword(skill, keyword) {
  const a = String(skill || '').toLowerCase();
  const b = String(keyword || '').toLowerCase();
  if (!a || !b) return false;
  const word = (hay, needle) =>
    new RegExp(`(?:^|[^a-z0-9])${needle.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')}(?:[^a-z0-9]|$)`).test(hay);
  return word(a, b) || word(b, a);
}

/**
 * Builds the optimised resume.
 *
 * @returns {{ resume, changelog, applied, pending, extras }}
 */
export function buildOptimizedResume(resume, proposals = [], { keywordResult = null } = {}) {
  const auto = proposals.filter(isAutoApplicable);
  const pending = proposals.filter((p) => !isAutoApplicable(p));

  const { resume: applied, changelog } = applyDecisions(
    resume,
    auto.map((p) => ({ id: p.id, action: 'accept' })),
    auto
  );
  const log = changelog.map((c) => ({ ...c, autoApplied: true }));
  const extras = [];

  /* Headline: only when the candidate has none, and only from a documented
     fact — the title of their most recent role. */
  if (!applied.personal?.headline?.trim() && applied.experience?.[0]?.title) {
    applied.personal = { ...applied.personal, headline: applied.experience[0].title };
    extras.push({
      id: 'headline',
      action: 'accept',
      autoApplied: true,
      original: '',
      final: applied.experience[0].title,
      reason: 'Your resume had no headline, so your most recent job title was used. Edit it to describe the role you are targeting.',
      keywordsAligned: [],
    });
  }

  /* Skills: surface the ones the job asks for. Nothing is added or removed. */
  const evidenced = (keywordResult?.keywords || []).filter(
    (k) => k.status === MATCH.EXACT || k.status === MATCH.RELATED
  );
  if (evidenced.length && applied.skills && typeof applied.skills === 'object') {
    let moved = 0;
    Object.keys(applied.skills).forEach((bucket) => {
      const list = applied.skills[bucket];
      if (!Array.isArray(list) || list.length < 2) return;
      const hit = list.filter((s) => evidenced.some((k) => skillMatchesKeyword(s, k.term)));
      if (!hit.length || hit.length === list.length) return;
      const reordered = [...hit, ...list.filter((s) => !hit.includes(s))];
      if (reordered.some((s, i) => s !== list[i])) {
        moved += hit.length;
        applied.skills[bucket] = reordered;
      }
    });
    if (moved) {
      extras.push({
        id: 'skills-order',
        action: 'accept',
        autoApplied: true,
        original: '',
        final: '',
        reason: `${moved} skill${moved === 1 ? '' : 's'} the job description asks for were moved to the front of their lists. No skills were added or removed.`,
        keywordsAligned: [],
      });
    }
  }

  return { resume: applied, changelog: log, extras, applied: auto, pending };
}

/** Compact, honest score block from an `analyzeCandidate` result. */
export function summarizeAnalysis(analysis) {
  if (!analysis) return null;
  return {
    resumeHealth: analysis.health?.score ?? null,
    jobMatch: analysis.match?.overall ?? null,
    keywordCoverage: analysis.keywords?.summary?.coverage ?? null,
    hasJobDescription: Boolean(analysis.jobIntel),
  };
}

/** Keyword report for the review screen. Returns null without a job description. */
export function keywordReport(analysis) {
  const keywords = analysis?.keywords?.keywords;
  if (!keywords) return null;
  const pick = (fn) =>
    keywords.filter(fn).map((k) => ({
      term: k.term,
      status: k.status,
      required: Boolean(k.required),
      preferred: Boolean(k.preferred),
      evidence: k.evidence || null,
    }));
  return {
    matched: pick((k) => k.status === MATCH.EXACT || k.status === MATCH.RELATED).slice(0, 40),
    needsConfirmation: pick((k) => k.status === MATCH.POSSIBLE).slice(0, 20),
    missingRequired: pick((k) => k.status === MATCH.MISSING && k.required).slice(0, 20),
    missingPreferred: pick((k) => k.status === MATCH.MISSING && k.preferred && !k.required).slice(0, 20),
    missingOther: pick((k) => k.status === MATCH.MISSING && !k.required && !k.preferred).slice(0, 15),
  };
}

export { buildComparison, clone };
