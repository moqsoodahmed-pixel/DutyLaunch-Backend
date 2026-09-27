/**
 * AGENT 6 — Resume Rewriter (spec §15, §16, §29, §32).
 *
 * The only module in the pipeline that calls a model, and it is given the
 * narrowest possible job: improve the *wording* of content that already
 * exists. Facts are supplied to it, never requested from it.
 *
 * Spec §32 is enforced structurally — `buildPrompt` refuses to assemble a
 * request that lacks candidate facts, target job, keywords, seniority,
 * country and output rules. There is no code path that hands a model a JD
 * and asks it to "write a resume".
 *
 * Every proposal is returned for review with ACCEPT / EDIT / REJECT and a
 * "why did DutyLaunch make this change?" explanation (spec §28, §29).
 */

import { callModel } from './aiClient.js';
import { logger } from '../../utils/logger.js';
import { MATCH, stuffingBudget } from './keywordIntelligence.js';
import { classifyClaim } from './integrity.js';
import { EVIDENCE } from './resumeSchema.js';
import { countryGuidance } from './scoringConfig.js';

/* ------------------------------------------------------------------ *
 * Output rules — one source of truth, sent with every request
 * ------------------------------------------------------------------ */

const OUTPUT_RULES = `HARD RULES — a response that breaks any of these is rejected:
1. Never introduce a fact that is not in CANDIDATE FACTS. No employers, titles, dates, degrees, certifications, tools, clients, team sizes, revenue figures, percentages or any other number.
2. If the original bullet contains no number, the rewrite contains no number. Do not estimate, round, or imply scale that was not stated.
3. Never change an employer name, job title, or date. You may improve how a responsibility is described underneath them.
4. Only use a keyword from TARGET KEYWORDS when the original text already shows evidence of that work. Aligning vocabulary is allowed; asserting new experience is not.
5. Preserve the meaning of the original. You are re-expressing it, not replacing it.
6. One bullet in, one bullet out. Do not merge, split or add bullets.
7. Write in the past tense for past roles and present tense for the current role, with no first-person pronouns.
8. Keep each bullet under 32 words.
9. Return ONLY valid JSON matching the requested shape. No markdown fences, no commentary.`;

const SYSTEM_PROMPT = `You are the DutyLaunch Resume Rewriter. You improve the clarity, structure and professional register of resume content that a candidate has already written.

You are not a resume writer inventing content. You are an editor working under strict factual constraints. The candidate will be interviewed on every line you produce, so a plausible-sounding embellishment is a serious failure, worse than leaving a weak bullet alone.

When the original is too thin to improve without adding facts, return it unchanged and say why.`;

/* ------------------------------------------------------------------ *
 * Prompt assembly (spec §32)
 * ------------------------------------------------------------------ */

function requireContext(context) {
  const missing = [];
  if (!context.facts) missing.push('CANDIDATE FACTS');
  if (!context.targetJob) missing.push('TARGET JOB');
  if (!context.keywords) missing.push('RELEVANT KEYWORDS');
  if (!context.seniority) missing.push('TARGET SENIORITY');
  if (!context.country) missing.push('COUNTRY');
  if (missing.length) {
    throw new Error(`Rewrite context incomplete — missing ${missing.join(', ')}. See spec §32.`);
  }
}

/**
 * Assembles the full prompt. Exported so it can be asserted on in tests:
 * the guarantee that facts always accompany a generation request should be
 * testable, not just documented.
 */
export function buildPrompt(context, task) {
  requireContext(context);
  const country = countryGuidance(context.country);

  return [
    { role: 'system', content: SYSTEM_PROMPT },
    {
      role: 'user',
      content: [
        '=== CANDIDATE FACTS (the only permitted source of truth) ===',
        context.facts,
        '',
        '=== TARGET JOB ===',
        context.targetJob,
        '',
        '=== RELEVANT KEYWORDS (use only where the original already evidences them) ===',
        context.keywords,
        '',
        '=== TARGET SENIORITY ===',
        `${context.seniority} — ${context.strategyGuidance || ''}`,
        '',
        '=== COUNTRY CONVENTIONS ===',
        `${country.label}. Spelling: ${country.spelling}. ${country.lengthNote}`,
        '',
        '=== OUTPUT RULES ===',
        OUTPUT_RULES,
        '',
        '=== TASK ===',
        task,
      ].join('\n'),
    },
  ];
}

/** Builds the CANDIDATE FACTS block from verified data only. */
export function buildFactsBlock(resume, profile, confirmedFacts = []) {
  const lines = [];

  lines.push(`Career level: ${profile?.careerLevel || 'unknown'}`);
  lines.push(`Years of documented experience: ${profile?.yearsOfExperience ?? 'unknown'}`);
  if (profile?.leadership?.teamSize) lines.push(`Documented team size: ${profile.leadership.teamSize}`);

  (resume.experience || []).forEach((role, i) => {
    lines.push('');
    lines.push(`ROLE ${i + 1}: ${role.title || '(title unknown)'} at ${role.company || '(employer unknown)'}`);
    lines.push(`Dates: ${role.startDate || '?'} to ${role.current ? 'present' : role.endDate || '?'}`);
    [...(role.responsibilities || []), ...(role.achievements || [])].forEach((b) => lines.push(`- ${b}`));
  });

  const skills = Object.values(resume.skills || {}).flat();
  if (skills.length) {
    lines.push('');
    lines.push(`SKILLS STATED BY CANDIDATE: ${skills.join(', ')}`);
  }

  (resume.education || []).forEach((e) => {
    lines.push(`EDUCATION: ${[e.degree, e.field, e.institution, e.endDate].filter(Boolean).join(', ')}`);
  });

  (resume.certifications || []).forEach((c) => {
    if (c.name) lines.push(`CERTIFICATION: ${c.name}${c.issuer ? ` (${c.issuer})` : ''}`);
  });

  const confirmed = confirmedFacts.filter((f) => f.confirmed);
  if (confirmed.length) {
    lines.push('');
    lines.push('CONFIRMED BY THE CANDIDATE (treat as verified fact):');
    confirmed.forEach((f) => lines.push(`- ${f.claim}: ${f.value}`));
  }

  return lines.join('\n');
}

function buildTargetBlock(jobIntel, resume) {
  if (!jobIntel) {
    const t = resume.target || {};
    return `Target role: ${t.jobTitle || 'not specified'}. Industry: ${t.industry || 'not specified'}.`;
  }
  return [
    `Job title: ${jobIntel.role?.jobTitle || 'not specified'}`,
    `Seniority: ${jobIntel.role?.seniority || 'not specified'}`,
    `Industry: ${(jobIntel.role?.industry || []).join(', ') || 'not specified'}`,
    `Key responsibilities: ${(jobIntel.responsibilities || []).slice(0, 8).join(' | ') || 'not specified'}`,
  ].join('\n');
}

/**
 * The keyword block only ever lists terms the candidate already has some
 * evidence for. A MISSING keyword is never shown to the model, because
 * showing it is an invitation to write it in.
 */
function buildKeywordBlock(keywordResult, resume) {
  if (!keywordResult) return '(no target job supplied — do not introduce keywords)';

  const usable = keywordResult.keywords
    .filter((k) => k.status === MATCH.EXACT || k.status === MATCH.RELATED || k.status === MATCH.POSSIBLE)
    .filter((k) => k.tier <= 2)
    .slice(0, 18);

  const { budget } = stuffingBudget(resume, usable.map((k) => k.term));

  if (!usable.length) return '(no keywords are currently evidenced — do not introduce any)';

  return [
    `You may align vocabulary towards at most ${budget} of the following, and only where the original already describes that work:`,
    ...usable.map((k) => `- ${k.term} (evidence: ${k.status.toLowerCase()}${k.matchedOn ? ` via "${k.matchedOn}"` : ''})`),
    '',
    'Terms not on this list must not appear.',
  ].join('\n');
}

export function buildRewriteContext(resume, { jobIntel, keywordResult, profile, confirmedFacts = [] }) {
  return {
    facts: buildFactsBlock(resume, profile, confirmedFacts),
    targetJob: buildTargetBlock(jobIntel, resume),
    keywords: buildKeywordBlock(keywordResult, resume),
    seniority: jobIntel?.role?.seniority || profile?.careerLevel || 'mid',
    strategyGuidance: profile?.strategyGuidance || '',
    country: resume.target?.country || 'India',
  };
}

/* ------------------------------------------------------------------ *
 * JSON handling
 * ------------------------------------------------------------------ */

function parseModelJson(reply) {
  const cleaned = String(reply || '')
    .replace(/^```(?:json)?/i, '')
    .replace(/```$/, '')
    .trim();
  const start = cleaned.search(/[[{]/);
  if (start < 0) throw new Error('No JSON found in model reply.');
  const candidate = cleaned.slice(start);
  try {
    return JSON.parse(candidate);
  } catch {
    // Trim anything after the final closing brace/bracket.
    const end = Math.max(candidate.lastIndexOf('}'), candidate.lastIndexOf(']'));
    if (end > 0) return JSON.parse(candidate.slice(0, end + 1));
    throw new Error('Model reply was not valid JSON.');
  }
}

/* ------------------------------------------------------------------ *
 * Deterministic fallback (spec §41: no fake functionality)
 * ------------------------------------------------------------------ */

const WEAK_OPENERS = [
  [/^responsible for\s+/i, 'Managed '],
  [/^was responsible for\s+/i, 'Managed '],
  [/^duties included\s+/i, 'Handled '],
  [/^worked on\s+/i, 'Delivered '],
  [/^helped with\s+/i, 'Supported '],
  [/^involved in\s+/i, 'Contributed to '],
  [/^tasked with\s+/i, 'Owned '],
  [/^handling\s+/i, 'Managed '],
  [/^in charge of\s+/i, 'Led '],
];

/**
 * Rule-based improvement used when no model is configured. Strictly
 * cosmetic: it fixes openers, voice and spacing, and never touches facts.
 * Honest about being the lesser path — the response says so.
 */
function deterministicRewrite(bullet) {
  let out = String(bullet || '').trim();
  const reasons = [];

  for (const [pattern, replacement] of WEAK_OPENERS) {
    if (pattern.test(out)) {
      out = out.replace(pattern, replacement);
      reasons.push('Replaced a weak opening phrase with an action verb.');
      break;
    }
  }

  if (/^\s*(i|we|my)\b/i.test(out)) {
    out = out.replace(/^\s*(i|we|my)\s+/i, '');
    out = out.charAt(0).toUpperCase() + out.slice(1);
    reasons.push('Removed the first-person pronoun, which is the resume convention.');
  }

  const tidied = out.replace(/\s{2,}/g, ' ').replace(/\s+([,.])/g, '$1').trim();
  if (tidied !== out) {
    out = tidied;
    reasons.push('Tidied spacing and punctuation.');
  }

  if (out && !/[.]$/.test(out)) out += '.';
  out = out.charAt(0).toUpperCase() + out.slice(1);

  return reasons.length ? { text: out, reasons } : null;
}

/* ------------------------------------------------------------------ *
 * Proposal validation — the safety net between model and candidate
 * ------------------------------------------------------------------ */

const NUMBER_RE = /(?:[₹$£€]\s?\d[\d,.]*|\d[\d,.]*\s?(?:%|percent|k\b|m\b|bn\b|cr\b|lakh|crore|million|billion|x\b)|\b\d[\d,]{1,}\b)/gi;

function numbersIn(text) {
  return (String(text || '').match(NUMBER_RE) || []).map((n) => n.toLowerCase().replace(/[\s,]/g, ''));
}

/**
 * Rejects a proposal outright when it breaks a hard rule. A rejected
 * proposal never reaches the candidate — it is not shown as a suggestion
 * they could accidentally accept.
 */
function validateProposal({ original, proposed, sourceText, confirmedFacts }) {
  const problems = [];

  const before = new Set(numbersIn(original));
  const after = numbersIn(proposed);
  const confirmedNumbers = new Set(
    confirmedFacts.filter((f) => f.confirmed).flatMap((f) => numbersIn(f.value))
  );

  after.forEach((n) => {
    if (!before.has(n) && !confirmedNumbers.has(n) && !String(sourceText).toLowerCase().replace(/[\s,]/g, '').includes(n)) {
      problems.push(`introduced the figure "${n}"`);
    }
  });

  if (proposed.split(/\s+/).length > 45) problems.push('exceeds the length limit');

  const verdict = classifyClaim(proposed, { sourceText, confirmedFacts });
  if (verdict.level === EVIDENCE.UNVERIFIED) {
    problems.push('is not clearly supported by the original wording');
  }

  return { ok: problems.length === 0, problems, evidence: verdict.level };
}

/* ------------------------------------------------------------------ *
 * Public API
 * ------------------------------------------------------------------ */

/**
 * Proposes rewrites for a resume's experience bullets and summary.
 *
 * Returns proposals — it does NOT mutate the resume. Applying a proposal
 * is a separate, explicit action the candidate takes (spec §28).
 */
export async function proposeRewrites(resume, { jobIntel, keywordResult, profile, confirmedFacts = [], scope = 'all' } = {}) {
  const context = buildRewriteContext(resume, { jobIntel, keywordResult, profile, confirmedFacts });
  const sourceText = [resume._source?.rawText || '', context.facts].join('\n');

  const targets = [];

  if (scope === 'all' || scope === 'summary') {
    targets.push({ id: 'summary', field: 'summary', original: resume.summary || '', kind: 'summary' });
  }

  if (scope === 'all' || scope === 'experience') {
    (resume.experience || []).forEach((role, roleIndex) => {
      (role.responsibilities || []).forEach((bullet, i) => {
        targets.push({ id: `experience.${roleIndex}.responsibilities.${i}`, field: 'responsibilities', roleIndex, index: i, original: bullet, kind: 'bullet', roleLabel: role.title });
      });
      (role.achievements || []).forEach((bullet, i) => {
        targets.push({ id: `experience.${roleIndex}.achievements.${i}`, field: 'achievements', roleIndex, index: i, original: bullet, kind: 'bullet', roleLabel: role.title });
      });
    });
  }

  const bulletTargets = targets.filter((t) => t.kind === 'bullet' && t.original.trim().length > 12);
  const summaryTarget = targets.find((t) => t.kind === 'summary');

  let proposals = [];
  let engine = 'model';

  try {
    if (bulletTargets.length) {
      proposals = await rewriteBullets(bulletTargets, context, { sourceText, confirmedFacts });
    }
    if (summaryTarget) {
      const summary = await rewriteSummary(resume, context, { sourceText, confirmedFacts, profile });
      if (summary) proposals.unshift(summary);
    }
  } catch (err) {
    logger.error(`[career-intelligence] model rewrite unavailable: ${err.message}`);
    engine = 'rules';
    proposals = bulletTargets
      .map((target) => {
        const result = deterministicRewrite(target.original);
        if (!result || result.text === target.original) return null;
        return {
          id: target.id,
          field: target.field,
          roleIndex: target.roleIndex,
          index: target.index,
          original: target.original,
          proposed: result.text,
          reason: result.reasons.join(' '),
          keywordsAligned: [],
          evidence: EVIDENCE.VERIFIED,
          status: 'pending',
        };
      })
      .filter(Boolean);
  }

  return {
    engine,
    engineNote:
      engine === 'rules'
        ? 'AI rewriting is not available right now, so only rule-based improvements (weak openers, voice, punctuation) were applied. Your wording and every fact are unchanged.'
        : null,
    proposals,
    summary: {
      total: proposals.length,
      reviewed: 0,
      bulletsConsidered: bulletTargets.length,
    },
  };
}

async function rewriteBullets(targets, context, { sourceText, confirmedFacts }) {
  const BATCH = 10;
  const proposals = [];

  for (let i = 0; i < targets.length; i += BATCH) {
    const batch = targets.slice(i, i + BATCH);

    const task = [
      'Rewrite each bullet below. Return a JSON array with one object per input bullet, in the same order:',
      '[{ "id": "<the id given>", "rewritten": "<improved bullet, or the original unchanged>", "changed": true|false, "reason": "<one sentence explaining what you changed and why, addressed to the candidate>", "keywordsAligned": ["<any target keyword whose vocabulary you aligned towards>"] }]',
      '',
      'Set "changed": false and return the original verbatim when the bullet cannot be improved without adding facts.',
      '',
      'BULLETS:',
      ...batch.map((t) => JSON.stringify({ id: t.id, role: t.roleLabel || '', bullet: t.original })),
    ].join('\n');

    // eslint-disable-next-line no-await-in-loop
    const reply = await callModel(buildPrompt(context, task));
    const parsed = parseModelJson(reply);
    const rows = Array.isArray(parsed) ? parsed : parsed.results || [];

    rows.forEach((row) => {
      const target = batch.find((t) => t.id === row.id);
      if (!target) return;
      const proposed = String(row.rewritten || '').trim();
      if (!proposed || !row.changed || proposed === target.original) return;

      const check = validateProposal({ original: target.original, proposed, sourceText, confirmedFacts });
      if (!check.ok) {
        logger.warn(`[career-intelligence] rejected rewrite for ${target.id}: ${check.problems.join('; ')}`);
        return;
      }

      proposals.push({
        id: target.id,
        field: target.field,
        roleIndex: target.roleIndex,
        index: target.index,
        original: target.original,
        proposed,
        reason: String(row.reason || '').trim() || 'Wording was tightened for clarity and relevance.',
        keywordsAligned: Array.isArray(row.keywordsAligned) ? row.keywordsAligned.slice(0, 4) : [],
        evidence: check.evidence,
        status: 'pending',
      });
    });
  }

  return proposals;
}

async function rewriteSummary(resume, context, { sourceText, confirmedFacts, profile }) {
  const existing = resume.summary?.trim();

  const task = [
    existing
      ? 'Rewrite the professional summary below.'
      : 'Write a professional summary using ONLY the facts already listed in CANDIDATE FACTS. Do not introduce anything new.',
    '',
    'Structure: ROLE + EXPERIENCE + SPECIALISATION + IMPACT. Three sentences maximum, under 70 words.',
    'Never use filler such as "hardworking professional seeking a challenging opportunity", "dynamic individual", or "proven track record" without evidence behind it.',
    profile?.strategyGuidance ? `Strategy for this candidate: ${profile.strategyGuidance}` : '',
    '',
    'Return JSON: { "rewritten": "<summary>", "changed": true|false, "reason": "<one sentence for the candidate>", "keywordsAligned": [] }',
    '',
    existing ? `CURRENT SUMMARY:\n${existing}` : '(There is no current summary.)',
  ].filter(Boolean).join('\n');

  const reply = await callModel(buildPrompt(context, task));
  const row = parseModelJson(reply);
  const proposed = String(row.rewritten || '').trim();
  if (!proposed || proposed === existing) return null;

  const check = validateProposal({ original: existing || sourceText, proposed, sourceText, confirmedFacts });
  if (!check.ok) {
    logger.warn(`[career-intelligence] rejected summary rewrite: ${check.problems.join('; ')}`);
    return null;
  }

  return {
    id: 'summary',
    field: 'summary',
    original: existing || '',
    proposed,
    reason: String(row.reason || '').trim() || 'The summary was rewritten to lead with your role, experience and specialisation.',
    keywordsAligned: Array.isArray(row.keywordsAligned) ? row.keywordsAligned.slice(0, 4) : [],
    evidence: check.evidence,
    status: 'pending',
  };
}

/* ------------------------------------------------------------------ *
 * Applying decisions (spec §28: ACCEPT / EDIT / REJECT)
 * ------------------------------------------------------------------ */

/**
 * Applies the candidate's decisions to a resume and returns the new
 * document plus a changelog for the before/after view (spec §30).
 *
 * @param {object} resume
 * @param {Array} decisions  [{ id, action: 'accept'|'edit'|'reject', text? }]
 * @param {Array} proposals
 */
export function applyDecisions(resume, decisions = [], proposals = []) {
  const next = JSON.parse(JSON.stringify(resume));
  const changelog = [];

  decisions.forEach((decision) => {
    const proposal = proposals.find((p) => p.id === decision.id);
    if (!proposal) return;
    if (decision.action === 'reject') {
      changelog.push({ id: proposal.id, action: 'reject', original: proposal.original, final: proposal.original, reason: proposal.reason });
      return;
    }

    const text = decision.action === 'edit' ? String(decision.text || '').trim() : proposal.proposed;
    if (!text) return;

    if (proposal.field === 'summary') {
      next.summary = text;
    } else {
      const role = next.experience?.[proposal.roleIndex];
      if (!role || !Array.isArray(role[proposal.field])) return;
      role[proposal.field][proposal.index] = text;
    }

    changelog.push({
      id: proposal.id,
      action: decision.action,
      original: proposal.original,
      final: text,
      reason: proposal.reason,
      keywordsAligned: proposal.keywordsAligned,
    });
  });

  // `_source` is never touched — the candidate's original document stays
  // exactly as parsed, whatever they accept here.
  next._source = resume._source;

  return { resume: next, changelog };
}

/**
 * Builds the before/after comparison payload (spec §30).
 * Classifies each change as added / removed / rewritten / keyword-aligned.
 */
export function buildComparison(before, after, changelog = []) {
  const changes = changelog.map((entry) => ({
    ...entry,
    type: !entry.original
      ? 'added'
      : !entry.final
        ? 'removed'
        : entry.keywordsAligned?.length
          ? 'keyword-aligned'
          : 'rewritten',
  }));

  const countBullets = (r) =>
    (r.experience || []).reduce((n, role) => n + (role.responsibilities?.length || 0) + (role.achievements?.length || 0), 0);

  return {
    changes,
    counts: {
      total: changes.length,
      accepted: changes.filter((c) => c.action !== 'reject').length,
      rejected: changes.filter((c) => c.action === 'reject').length,
      rewritten: changes.filter((c) => c.type === 'rewritten').length,
      keywordAligned: changes.filter((c) => c.type === 'keyword-aligned').length,
      added: changes.filter((c) => c.type === 'added').length,
      removed: changes.filter((c) => c.type === 'removed').length,
    },
    bulletCounts: { before: countBullets(before), after: countBullets(after) },
  };
}

export { OUTPUT_RULES, deterministicRewrite };
