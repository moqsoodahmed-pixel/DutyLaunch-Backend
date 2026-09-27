/**
 * AGENT 7 — Achievement Builder (spec §13, §14).
 *
 * Turns what the resume is *missing* into questions, and candidate answers
 * into bullets. The rule that makes this safe: a question is only ever
 * generated from something already in the candidate's data, and a bullet is
 * only ever generated from an answer the candidate has explicitly given.
 *
 * Nothing here invents a metric. If the candidate answers "no" or skips,
 * the bullet stays as it was (spec §14: do not force metrics where none
 * exist).
 */

import { MATCH } from './keywordIntelligence.js';

/* ------------------------------------------------------------------ *
 * Question bank (spec §14)
 * ------------------------------------------------------------------ */

const IMPACT_QUESTIONS = [
  { id: 'improved', prompt: 'What did you improve in this role?', type: 'text', placeholder: 'e.g. onboarding turnaround, error rate, customer satisfaction' },
  { id: 'problem', prompt: 'What problem did you solve that someone else had not?', type: 'text' },
  { id: 'scale_people', prompt: 'How many people, customers or vendors did you deal with?', type: 'number', unit: 'count' },
  { id: 'revenue', prompt: 'Did you influence revenue? If so, roughly how much?', type: 'text', optional: true },
  { id: 'cost', prompt: 'Did you reduce cost? By how much, or by what proportion?', type: 'text', optional: true },
  { id: 'productivity', prompt: 'Did you improve productivity or throughput?', type: 'text', optional: true },
  { id: 'turnaround', prompt: 'Did you reduce turnaround or response time?', type: 'text', optional: true },
  { id: 'conversion', prompt: 'Did you improve conversion, retention or renewal rates?', type: 'text', optional: true },
  { id: 'errors', prompt: 'Did you reduce errors, defects or escalations?', type: 'text', optional: true },
  { id: 'satisfaction', prompt: 'Did customer or stakeholder satisfaction improve?', type: 'text', optional: true },
  { id: 'automation', prompt: 'Did you automate anything?', type: 'text', optional: true },
  { id: 'launch', prompt: 'Did you launch anything — a product, process, market or team?', type: 'text', optional: true },
  { id: 'team', prompt: 'Did you manage a team? How many people reported to you?', type: 'number', unit: 'people', optional: true },
];

/** Follow-ups for a confirmed capability (spec §13). */
const FOLLOW_UPS = {
  default: [
    { id: 'scale', prompt: 'At what scale — how many, how often, or how large?', type: 'text' },
    { id: 'method', prompt: 'How did you do it? What was the approach?', type: 'text' },
    { id: 'outcome', prompt: 'What changed as a result? A number if you have one, a plain description if not.', type: 'text' },
    { id: 'tools', prompt: 'Which tools or systems did you use?', type: 'text', optional: true },
  ],
  'vendor management': [
    { id: 'scale', prompt: 'How many vendors did you manage?', type: 'number', unit: 'vendors' },
    { id: 'type', prompt: 'What type of vendors were they?', type: 'text' },
    { id: 'method', prompt: 'What was your process — onboarding, contracts, performance reviews?', type: 'text' },
    { id: 'outcome', prompt: 'What was the outcome? (cost, turnaround, quality, compliance)', type: 'text' },
    { id: 'tools', prompt: 'Which tools or systems did you use?', type: 'text', optional: true },
  ],
  'people management': [
    { id: 'scale', prompt: 'How many people reported to you?', type: 'number', unit: 'people' },
    { id: 'type', prompt: 'What did the team do?', type: 'text' },
    { id: 'method', prompt: 'What did you own — hiring, performance, rostering, development?', type: 'text' },
    { id: 'outcome', prompt: 'What changed under your leadership?', type: 'text' },
  ],
  'process improvement': [
    { id: 'type', prompt: 'Which process did you improve?', type: 'text' },
    { id: 'method', prompt: 'What did you change?', type: 'text' },
    { id: 'outcome', prompt: 'What was the measured improvement, if you measured one?', type: 'text' },
  ],
  'stakeholder management': [
    { id: 'type', prompt: 'Which stakeholders — internal teams, clients, regulators, leadership?', type: 'text' },
    { id: 'scale', prompt: 'How senior were they, and how many?', type: 'text' },
    { id: 'method', prompt: 'What did the engagement involve — reporting, negotiation, escalation?', type: 'text' },
    { id: 'outcome', prompt: 'What did it achieve?', type: 'text' },
  ],
  'project management': [
    { id: 'scale', prompt: 'How many projects, and how large?', type: 'text' },
    { id: 'method', prompt: 'What methodology or process did you follow?', type: 'text' },
    { id: 'outcome', prompt: 'Were they delivered on time and to budget?', type: 'text' },
  ],
};

/* ------------------------------------------------------------------ *
 * Question generation
 * ------------------------------------------------------------------ */

/**
 * Generates the evidence questions worth asking, highest-value first.
 *
 * Three sources, in priority order:
 *  1. Tier 1 keywords the JD requires with POSSIBLE evidence — confirming
 *     these turns an implied claim into a stated one (spec §11).
 *  2. Tier 1 keywords that are MISSING but plausible for this candidate's
 *     function — worth one yes/no before writing them off (spec §13).
 *  3. Roles with no quantified achievement at all (spec §14).
 */
export function generateEvidenceQuestions(resume, { keywordResult, profile, limit = 10 } = {}) {
  const questions = [];

  /* --- 1. Confirm partial evidence ------------------------------- */
  (keywordResult?.needsConfirmation || []).forEach((keyword) => {
    questions.push({
      id: `confirm:${keyword.term}`,
      kind: 'confirm-capability',
      priority: 1 - keyword.importance,
      keyword: keyword.term,
      tier: keyword.tier,
      prompt: `The job description asks for "${keyword.term}". Your resume says: “${truncate(keyword.evidence)}”. Is that the same work?`,
      why: `We found related evidence but not a direct statement. We will not claim "${keyword.term}" on your behalf until you confirm it.`,
      type: 'yes-no',
      followUps: followUpsFor(keyword.term),
    });
  });

  /* --- 2. Ask about missing critical keywords --------------------- */
  (keywordResult?.missingTier1 || []).slice(0, 5).forEach((keyword) => {
    questions.push({
      id: `ask:${keyword.term}`,
      kind: 'ask-capability',
      priority: 1 - keyword.importance + 0.1,
      keyword: keyword.term,
      tier: keyword.tier,
      prompt: `Have you done work involving ${keyword.term}?`,
      why: `This is one of the job description's critical requirements and we found no evidence of it in your resume. If you have done it, it belongs on the page.`,
      type: 'yes-no',
      followUps: followUpsFor(keyword.term),
    });
  });

  /* --- 3. Quantify roles that have no numbers --------------------- */
  (resume.experience || []).forEach((role, index) => {
    const bullets = [...(role.responsibilities || []), ...(role.achievements || [])];
    if (!bullets.length) return;
    const quantified = bullets.filter((b) => /\d/.test(b)).length;
    if (quantified >= 2) return;

    questions.push({
      id: `quantify:${index}`,
      kind: 'quantify-role',
      priority: 0.5 + index * 0.05,
      roleIndex: index,
      roleLabel: [role.title, role.company].filter(Boolean).join(' at ') || `Role ${index + 1}`,
      prompt: `Your time as ${role.title || 'this role'}${role.company ? ` at ${role.company}` : ''} has no measurable outcome on it yet. What changed because you were there?`,
      why: 'Scope and outcome are what separate a duty from an achievement. Volume, frequency and time count as much as percentages.',
      type: 'impact-set',
      questions: IMPACT_QUESTIONS.filter((q) => !q.optional || index === 0).slice(0, 6),
    });
  });

  /* --- 4. Fresher-specific prompts (spec §7) ---------------------- */
  if (profile?.strategy === 'fresher') {
    const ev = profile.fresherEvidence || {};
    if (!ev.projects) {
      questions.push({
        id: 'fresher:projects',
        kind: 'add-section',
        priority: 0.2,
        prompt: 'Have you built anything — an academic project, a personal build, a competition entry?',
        why: 'With limited employment history, projects are the strongest evidence you can show. This is not a gap in your CV; it is the section that should lead it.',
        type: 'yes-no',
        followUps: [
          { id: 'name', prompt: 'What was it called?', type: 'text' },
          { id: 'what', prompt: 'What did it do, and what was your part in it?', type: 'text' },
          { id: 'tools', prompt: 'What did you build it with?', type: 'text' },
          { id: 'outcome', prompt: 'What was the result — a grade, a placement, users, a working demo?', type: 'text', optional: true },
        ],
      });
    }
    if (!ev.internships && !ev.volunteering) {
      questions.push({
        id: 'fresher:experience',
        kind: 'add-section',
        priority: 0.25,
        prompt: 'Have you done an internship, freelance work, volunteering or a leadership role in a society or club?',
        why: 'All of these count as experience and belong on the page.',
        type: 'yes-no',
        followUps: followUpsFor('default'),
      });
    }
  }

  /* --- 5. Executive-specific prompts (spec §8) -------------------- */
  if (profile?.strategy === 'executive' && !profile.leadership?.hasPnl) {
    questions.push({
      id: 'exec:scope',
      kind: 'confirm-capability',
      priority: 0.15,
      prompt: 'Did you hold budget or P&L responsibility? If so, at what scale?',
      why: 'At director level and above, scope of ownership is the first thing a reader looks for. We will only state a figure you give us.',
      type: 'yes-no',
      followUps: [
        { id: 'scale', prompt: 'What was the budget or revenue scale?', type: 'text' },
        { id: 'scope', prompt: 'How many people, sites or markets did it cover?', type: 'text' },
        { id: 'outcome', prompt: 'What did you change about its performance?', type: 'text' },
      ],
    });
  }

  return questions.sort((a, b) => a.priority - b.priority).slice(0, limit);
}

function followUpsFor(term) {
  const key = String(term || '').toLowerCase();
  return FOLLOW_UPS[key] || FOLLOW_UPS.default;
}

function truncate(text, n = 120) {
  const t = String(text || '').trim();
  return t.length > n ? `${t.slice(0, n - 1)}…` : t;
}

/* ------------------------------------------------------------------ *
 * Answer -> bullet (spec §13, §14)
 * ------------------------------------------------------------------ */

const ACTION_BY_KEYWORD = {
  'vendor management': 'Managed relationships with',
  'people management': 'Led a team of',
  'stakeholder management': 'Partnered with',
  'process improvement': 'Redesigned',
  'project management': 'Delivered',
  default: 'Managed',
};

/**
 * Builds an ACTION + SCOPE + METHOD + RESULT bullet from confirmed answers.
 *
 * Every component comes from an answer the candidate typed. If the outcome
 * answer is empty, the bullet simply ends after the method — it does not
 * acquire an invented result (spec §14).
 *
 * @returns {{ bullet, components, evidence }} or null when there is
 *          nothing confirmed to build from.
 */
export function buildAchievementBullet({ keyword, answers = {} }) {
  const { scale, type, method, outcome, tools } = answers;
  const parts = [];
  const used = [];

  const action = ACTION_BY_KEYWORD[String(keyword || '').toLowerCase()] || ACTION_BY_KEYWORD.default;

  /* ACTION + SCOPE */
  if (scale && type) {
    parts.push(`${action} ${String(scale).trim()} ${String(type).trim()}`);
    used.push('scale', 'type');
  } else if (scale) {
    parts.push(`${action} ${String(scale).trim()}${keyword ? ` across ${keyword}` : ''}`);
    used.push('scale');
  } else if (type) {
    parts.push(`${action} ${String(type).trim()}`);
    used.push('type');
  } else if (keyword) {
    parts.push(`${action} ${keyword}`);
  } else {
    return null;
  }

  /* METHOD */
  if (method) {
    const m = String(method).trim().replace(/^(by|through|via)\s+/i, '');
    parts.push(`through ${m}`);
    used.push('method');
  }

  /* RESULT */
  if (outcome) {
    const o = String(outcome).trim().replace(/^(resulting in|which|and)\s+/i, '');
    parts.push(`, ${/^\w+ing\b/i.test(o) ? o : `resulting in ${o}`}`);
    used.push('outcome');
  }

  /* TOOLS */
  if (tools) {
    parts.push(`using ${String(tools).trim()}`);
    used.push('tools');
  }

  let bullet = parts.join(' ').replace(/\s+,/g, ',').replace(/\s{2,}/g, ' ').trim();
  bullet = bullet.charAt(0).toUpperCase() + bullet.slice(1);
  if (!/[.]$/.test(bullet)) bullet += '.';

  return {
    bullet,
    components: {
      action,
      scope: [scale, type].filter(Boolean).join(' ') || null,
      method: method || null,
      result: outcome || null,
    },
    /* Everything in this bullet traces back to a candidate answer. */
    evidence: used.map((field) => ({ field, value: answers[field], confirmed: true })),
  };
}

/**
 * Converts a completed question into the confirmed-facts records the
 * integrity validator checks against. This is what makes a generated
 * number legitimate rather than a fabrication.
 */
export function toConfirmedFacts(question, answers = {}) {
  return Object.entries(answers)
    .filter(([, value]) => value !== null && value !== undefined && String(value).trim() !== '')
    .map(([field, value]) => ({
      questionId: question.id,
      claim: question.keyword || question.prompt,
      field,
      value: String(value).trim(),
      confirmed: true,
      confirmedAt: new Date().toISOString(),
    }));
}

export { IMPACT_QUESTIONS, FOLLOW_UPS };
