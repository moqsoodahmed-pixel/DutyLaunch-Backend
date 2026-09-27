/**
 * AGENT 4 — Keyword Intelligence (spec §11, §12, §13).
 *
 * The differentiator. Does NOT count exact matches. Every JD keyword is
 * classified against the candidate's *evidence*:
 *
 *   EXACT    the candidate's own wording contains the term
 *   RELATED  a synonym is present — same concept, different words
 *   POSSIBLE weaker evidence exists ("worked with internal business teams"
 *            for "stakeholder management"); needs candidate confirmation
 *            before it can become a factual claim
 *   MISSING  no evidence at all
 *
 * A POSSIBLE match is never silently promoted into the resume. It becomes
 * an evidence question instead (spec §13), and only a confirmed answer
 * turns it into content.
 */

import { surfaceForms, relatedForms, canonicalise } from './taxonomy.js';
import { resumeHaystack, collectText } from './resumeSchema.js';

export const MATCH = Object.freeze({
  EXACT: 'EXACT',
  RELATED: 'RELATED',
  POSSIBLE: 'POSSIBLE',
  MISSING: 'MISSING',
});

export const TIER = Object.freeze({ ONE: 1, TWO: 2, THREE: 3 });

/* ------------------------------------------------------------------ *
 * Matching
 * ------------------------------------------------------------------ */

function phraseRegex(phrase) {
  const escaped = String(phrase).replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
  return new RegExp(`(?:^|[^a-z0-9+#.])${escaped}(?:[^a-z0-9+#]|$)`, 'i');
}

/** Returns the snippet of candidate text that evidences a phrase. */
function findEvidence(sentences, phrase) {
  const re = phraseRegex(phrase);
  const hit = sentences.find((s) => re.test(s));
  if (!hit) return null;
  return hit.length > 220 ? `${hit.slice(0, 217)}…` : hit;
}

/**
 * Classifies one JD keyword against the resume.
 * @returns {{ status, evidence, matchedOn }}
 */
export function classifyKeyword(keyword, { haystack, sentences }) {
  const term = typeof keyword === 'string' ? keyword : keyword.term;
  const canonical = canonicalise(term) || term;

  // 1. EXACT — the JD's own words appear in the CV.
  if (phraseRegex(term).test(haystack)) {
    return { status: MATCH.EXACT, evidence: findEvidence(sentences, term), matchedOn: term };
  }

  // 2. RELATED — a recognised synonym appears.
  for (const form of surfaceForms(canonical)) {
    if (form === term) continue;
    if (phraseRegex(form).test(haystack)) {
      return { status: MATCH.RELATED, evidence: findEvidence(sentences, form), matchedOn: form };
    }
  }

  // 3. POSSIBLE — adjacent evidence that is not the same claim.
  for (const form of relatedForms(canonical)) {
    if (phraseRegex(form).test(haystack)) {
      return { status: MATCH.POSSIBLE, evidence: findEvidence(sentences, form), matchedOn: form };
    }
  }

  // 4. Partial head-word match for multi-word terms, e.g. JD says
  //    "inventory reconciliation process" and the CV says "inventory
  //    reconciliation". Treated as POSSIBLE, never EXACT.
  const words = term.split(' ').filter((w) => w.length > 3);
  if (words.length >= 2) {
    const present = words.filter((w) => phraseRegex(w).test(haystack));
    if (present.length >= Math.ceil(words.length * 0.7)) {
      return { status: MATCH.POSSIBLE, evidence: findEvidence(sentences, present[0]), matchedOn: present.join(' + ') };
    }
  }

  return { status: MATCH.MISSING, evidence: null, matchedOn: null };
}

/* ------------------------------------------------------------------ *
 * Prioritisation (spec §12)
 * ------------------------------------------------------------------ */

/**
 * Importance score in [0,1], combining the seven ranking signals the spec
 * asks for. Weights are deliberately explicit so the "why is this Tier 1?"
 * answer in the UI can be generated from the same numbers.
 */
export function importanceOf(keyword, { jobSeniority, candidateSeniority } = {}) {
  const signals = {
    // 1. Required beats preferred beats mentioned.
    requirement: keyword.required ? 1 : keyword.preferred ? 0.55 : 0.3,
    // 2. Frequency, saturating at 5 mentions.
    frequency: Math.min(keyword.frequency || 1, 5) / 5,
    // 3. Position in the JD.
    position: keyword.positionWeight ?? 0.3,
    // 4. Named in the responsibilities block — it is the actual job.
    responsibilities: keyword.inResponsibilities ? 1 : 0.35,
    // 5. A known taxonomy skill is a more reliable keyword than an
    //    arbitrary repeated phrase.
    recognised: keyword.known ? 1 : 0.6,
    // 6. Seniority relevance — soft skills matter more at senior levels,
    //    tools matter more below them.
    seniorityFit: seniorityFit(keyword, jobSeniority, candidateSeniority),
  };

  const weights = {
    requirement: 0.3,
    frequency: 0.18,
    position: 0.12,
    responsibilities: 0.16,
    recognised: 0.1,
    seniorityFit: 0.14,
  };

  const score = Object.entries(weights).reduce((sum, [key, w]) => sum + signals[key] * w, 0);
  return { score: Math.round(score * 1000) / 1000, signals };
}

const SENIOR_LEVELS = new Set(['manager', 'senior-manager', 'director', 'vp', 'c-suite']);

function seniorityFit(keyword, jobSeniority, candidateSeniority) {
  const senior = SENIOR_LEVELS.has(jobSeniority) || SENIOR_LEVELS.has(candidateSeniority);
  if (keyword.category === 'soft') return senior ? 0.9 : 0.5;
  if (keyword.category === 'tools') return senior ? 0.6 : 0.95;
  if (keyword.category === 'technical') return senior ? 0.7 : 0.95;
  return 0.8;
}

function tierOf(importance, index, total) {
  // Absolute threshold first, with a relative fallback so a JD whose
  // keywords all score modestly still produces a usable Tier 1.
  if (importance >= 0.7) return TIER.ONE;
  if (importance >= 0.5) return TIER.TWO;
  if (index < Math.max(3, Math.ceil(total * 0.15))) return TIER.ONE;
  if (index < Math.ceil(total * 0.45)) return TIER.TWO;
  return TIER.THREE;
}

/* ------------------------------------------------------------------ *
 * Main
 * ------------------------------------------------------------------ */

/**
 * Runs keyword intelligence over a resume and a Job Intelligence object.
 *
 * @returns {{
 *   keywords: Array,            all keywords, ranked
 *   tiers: { 1: [], 2: [], 3: [] },
 *   summary: { exact, related, possible, missing, coverage, tier1Coverage },
 *   missingTier1: Array,        what to fix first
 *   needsConfirmation: Array    POSSIBLE matches -> evidence questions
 * }}
 */
export function runKeywordIntelligence(resume, jobIntel, { candidateSeniority } = {}) {
  const haystack = resumeHaystack(resume);
  const sentences = collectText(resume).flatMap((t) => t.split(/(?<=[.!?])\s+/));

  const jobSeniority = jobIntel?.role?.seniority || '';
  const source = Array.isArray(jobIntel?.keywords) ? jobIntel.keywords : [];

  const scored = source.map((keyword) => {
    const { score, signals } = importanceOf(keyword, { jobSeniority, candidateSeniority });
    const match = classifyKeyword(keyword, { haystack, sentences });
    return { ...keyword, importance: score, signals, ...match };
  });

  scored.sort((a, b) => b.importance - a.importance);

  const keywords = scored.map((k, i) => ({ ...k, tier: tierOf(k.importance, i, scored.length) }));

  const tiers = { 1: [], 2: [], 3: [] };
  keywords.forEach((k) => tiers[k.tier].push(k));

  const count = (status) => keywords.filter((k) => k.status === status).length;
  const total = keywords.length || 1;

  const tier1 = tiers[1];
  const tier1Covered = tier1.filter((k) => k.status === MATCH.EXACT || k.status === MATCH.RELATED).length;

  return {
    keywords,
    tiers,
    summary: {
      total: keywords.length,
      exact: count(MATCH.EXACT),
      related: count(MATCH.RELATED),
      possible: count(MATCH.POSSIBLE),
      missing: count(MATCH.MISSING),
      /* Coverage counts EXACT and RELATED only. A POSSIBLE match is not
         coverage — it is an unanswered question. */
      coverage: Math.round(((count(MATCH.EXACT) + count(MATCH.RELATED)) / total) * 100),
      tier1Total: tier1.length,
      tier1Covered,
      tier1Coverage: tier1.length ? Math.round((tier1Covered / tier1.length) * 100) : null,
    },
    missingTier1: tier1.filter((k) => k.status === MATCH.MISSING),
    needsConfirmation: keywords
      .filter((k) => k.status === MATCH.POSSIBLE && k.tier <= TIER.TWO)
      .slice(0, 12),
  };
}

/**
 * Anti-stuffing guard (spec §12). Given the keywords a rewrite wants to
 * introduce, returns how many may safely be woven in given the document's
 * length, and flags terms already over-used.
 */
export function stuffingBudget(resume, proposedTerms = []) {
  const haystack = resumeHaystack(resume);
  const wordCount = haystack.split(/\s+/).filter(Boolean).length || 1;

  // Roughly one new keyword per 60 words of existing content, capped.
  const budget = Math.max(3, Math.min(14, Math.floor(wordCount / 60)));

  const overUsed = proposedTerms.filter((term) => {
    const matches = haystack.match(new RegExp(String(term).replace(/[.*+?^${}()|[\]\\]/g, '\\$&'), 'gi')) || [];
    // More than 3 mentions, or over 1.5% density, reads as stuffing.
    return matches.length > 3 || (matches.length * String(term).split(' ').length) / wordCount > 0.015;
  });

  return { budget, overUsed, wordCount };
}
