/**
 * AGENT 10 — LinkedIn Optimizer   (spec §24 / §22)
 * AGENT 11 — Cover Letter Engine  (spec §25 / §23)
 * AGENT 12 — Interview Prep       (spec §26 / §24)
 *
 * All three read the same Master Career Profile, which is what keeps the
 * CV, the LinkedIn profile and the interview answers telling one story.
 *
 * The same factual constraint applies throughout: no invented experience,
 * and — for cover letters specifically — no invented company facts. The
 * letter may say why the candidate's evidence fits the stated requirements;
 * it may not praise the employer for things we have not been told.
 */

import { callModel } from './aiClient.js';
import { ApiError } from '../../utils/ApiError.js';
import { logger } from '../../utils/logger.js';
import { buildPrompt, buildRewriteContext } from './rewriter.js';
import { MATCH } from './keywordIntelligence.js';

function parseJson(reply) {
  const cleaned = String(reply || '').replace(/^```(?:json)?/i, '').replace(/```$/, '').trim();
  const start = cleaned.search(/[[{]/);
  if (start < 0) throw new Error('Model reply contained no JSON.');
  const candidate = cleaned.slice(start);
  try {
    return JSON.parse(candidate);
  } catch {
    const end = Math.max(candidate.lastIndexOf('}'), candidate.lastIndexOf(']'));
    if (end > 0) return JSON.parse(candidate.slice(0, end + 1));
    throw new Error('Model reply was not valid JSON.');
  }
}

/* ------------------------------------------------------------------ *
 * LinkedIn (spec §24)
 * ------------------------------------------------------------------ */

/**
 * Generates LinkedIn recommendations from the same verified profile the
 * resume uses, so the two stay consistent.
 */
export async function generateLinkedIn(resume, { profile, jobIntel, keywordResult, confirmedFacts = [] }) {
  const context = buildRewriteContext(resume, { jobIntel, keywordResult, profile, confirmedFacts });

  const task = [
    'Produce LinkedIn profile recommendations from the candidate facts above.',
    '',
    'Return JSON with this exact shape:',
    '{',
    '  "headline": "<220 characters max, role + specialisation + value. No \"seeking opportunities\" filler.>",',
    '  "headlineAlternatives": ["<a second option>", "<a third option>"],',
    '  "about": "<3 to 4 short paragraphs in first person, under 250 words. LinkedIn About sections are written in first person even though resumes are not.>",',
    '  "experienceRewrites": [{ "role": "<title at company, copied exactly>", "text": "<2 to 3 sentences plus up to 3 bullets>" }],',
    '  "skillsToAdd": ["<skills the candidate has evidence for and should list>"],',
    '  "featuredSuggestions": ["<what to put in the Featured section>"],',
    '  "profileChecklist": ["<concrete profile settings or completeness actions>"]',
    '}',
    '',
    'Only list a skill under skillsToAdd when the candidate facts evidence it. Never invent an employer, a title or a number.',
  ].join('\n');

  try {
    const reply = await callModel(buildPrompt(context, task));
    const data = parseJson(reply);
    return {
      engine: 'model',
      headline: String(data.headline || '').slice(0, 220),
      headlineAlternatives: (data.headlineAlternatives || []).slice(0, 3),
      about: String(data.about || ''),
      experienceRewrites: (data.experienceRewrites || []).slice(0, 6),
      skillsToAdd: (data.skillsToAdd || []).slice(0, 25),
      featuredSuggestions: (data.featuredSuggestions || []).slice(0, 5),
      profileChecklist: (data.profileChecklist || []).slice(0, 8),
      consistencyNote:
        'These recommendations are generated from the same career profile as your resume, so the two tell one consistent story.',
    };
  } catch (err) {
    logger.error(`[career-tools] LinkedIn generation failed: ${err.message}`);
    return buildLinkedInFallback(resume, profile);
  }
}

/** Deterministic fallback — assembles from verified data, generates nothing. */
function buildLinkedInFallback(resume, profile) {
  const current = resume.experience?.[0];
  const topSkills = Object.values(resume.skills || {}).flat().slice(0, 12);

  const headline = [
    current?.title || resume.personal?.headline || resume.target?.jobTitle,
    topSkills.slice(0, 3).join(' · '),
  ]
    .filter(Boolean)
    .join(' | ')
    .slice(0, 220);

  return {
    engine: 'rules',
    engineNote:
      'AI generation is unavailable right now, so this is assembled directly from your existing profile rather than rewritten.',
    headline,
    headlineAlternatives: [],
    about: resume.summary || '',
    experienceRewrites: (resume.experience || []).slice(0, 4).map((r) => ({
      role: [r.title, r.company].filter(Boolean).join(' at '),
      text: [...(r.achievements || []), ...(r.responsibilities || [])].slice(0, 4).join('\n'),
    })),
    skillsToAdd: topSkills,
    featuredSuggestions: (resume.portfolio || []).slice(0, 3),
    profileChecklist: [
      'Use a current professional photo and a background image.',
      'Set your location to the market you are targeting.',
      'Turn on "Open to work" privately if you are searching while employed.',
      'Add your top skills in order — the first three carry the most weight in search.',
    ],
    consistencyNote:
      'Built from the same career profile as your resume, so the two stay consistent.',
  };
}

/* ------------------------------------------------------------------ *
 * Cover letter (spec §25)
 * ------------------------------------------------------------------ */

export async function generateCoverLetter(resume, { profile, jobIntel, keywordResult, company, hiringManager, tone = 'professional', confirmedFacts = [] }) {
  if (!jobIntel) throw ApiError.badRequest('A target job description is needed to write a targeted cover letter.');

  const context = buildRewriteContext(resume, { jobIntel, keywordResult, profile, confirmedFacts });
  const companyName = company || jobIntel.role?.company || '';

  const task = [
    `Write a targeted cover letter for the ${jobIntel.role?.jobTitle || 'target role'}${companyName ? ` at ${companyName}` : ''}.`,
    '',
    'CRITICAL: you know nothing about this employer beyond what the job description states. Do not praise the company, reference its mission, culture, products, growth, reputation or market position. Do not write "I have long admired" or anything like it. Connect the candidate\'s evidence to the stated requirements and nothing else.',
    '',
    `Tone: ${tone}. Length: 220 to 300 words. Four paragraphs.`,
    '1. Why this role, and the single strongest piece of matching evidence.',
    '2. The most relevant experience, with specifics that already exist in the candidate facts.',
    '3. A second relevant capability, and how it maps to a stated responsibility.',
    '4. A short, direct close.',
    '',
    'Return JSON: { "salutation": "<greeting>", "body": "<the four paragraphs, separated by \\n\\n>", "closing": "<sign-off line>", "subjectLine": "<for an email application>" }',
  ].join('\n');

  try {
    const reply = await callModel(buildPrompt(context, task));
    const data = parseJson(reply);
    return {
      engine: 'model',
      salutation: data.salutation || (hiringManager ? `Dear ${hiringManager},` : 'Dear Hiring Manager,'),
      body: String(data.body || ''),
      closing: data.closing || 'Yours sincerely,',
      subjectLine: data.subjectLine || `Application: ${jobIntel.role?.jobTitle || ''}`.trim(),
      candidateName: resume.personal?.name || '',
      note: 'This letter references only your own verified experience and the job description. No claims are made about the employer.',
    };
  } catch (err) {
    logger.error(`[career-tools] cover letter generation failed: ${err.message}`);
    return buildCoverLetterFallback(resume, { profile, jobIntel, keywordResult, companyName, hiringManager });
  }
}

/**
 * Rule-based cover letter, used when no model is available.
 *
 * It is assembled only from text that already exists: the candidate's own
 * titles, companies and bullets, and the job's own title and keywords.
 * Keywords are mentioned only when the resume already evidences them
 * (EXACT or RELATED), so the letter never claims a skill the CV does not
 * show. Nothing is said about the employer beyond its name.
 */
export function buildCoverLetterFallback(resume, { profile, jobIntel, keywordResult, companyName = '', hiringManager = '' }) {
  // Job titles pulled from a JD heading often carry a location suffix.
  const jobTitle = String(jobIntel?.role?.jobTitle || 'this role').split(/\s+[—–|]\s+|\s+-\s+/)[0].trim();
  const at = companyName ? ` at ${companyName}` : '';
  const roles = resume.experience || [];
  const current = roles[0];
  // Whole years only, and none under one year — "0.3 years" undersells a fresher.
  const years = profile?.yearsOfExperience >= 1 ? Math.floor(profile.yearsOfExperience) : null;
  const joinList = (items) => (items.length < 2 ? items.join('') : `${items.slice(0, -1).join(', ')} and ${items[items.length - 1]}`);

  const evidenced = (keywordResult?.keywords || [])
    .filter((k) => k.status === MATCH.EXACT || k.status === MATCH.RELATED)
    .map((k) => k.term)
    // A single generic word ("management") says nothing in a letter.
    .filter((t) => t && t.trim().includes(' '))
    .slice(0, 4);

  const bulletsOf = (role) => [...(role?.achievements || []), ...(role?.responsibilities || [])].filter(Boolean);
  const strip = (s) => String(s).trim().replace(/[.;]+$/, '');
  const lower = (s) => (s ? s.charAt(0).toLowerCase() + s.slice(1) : s);

  const opening = current?.title
    ? `I am applying for the ${jobTitle} position${at}. I currently work as ${current.title}${current.company ? ` at ${current.company}` : ''}${years ? `, with ${years} ${years === 1 ? 'year' : 'years'} of professional experience` : ''}, and I would like to show how my experience relates to the requirements in the job description.`
    : `I am applying for the ${jobTitle} position${at}, and I would like to show how my experience relates to the requirements in the job description.`;

  const currentBullets = bulletsOf(current).slice(0, 2).map(strip);
  const middle = currentBullets.length
    ? `In my current role I ${currentBullets.map(lower).join(', and ')}.`
    : (resume.projects || []).length
      ? `Most recently I worked on ${(resume.projects || []).slice(0, 2).map((p) => p.name || p.title).filter(Boolean).join(' and ')}.`
      : '';

  const previous = roles[1];
  const previousBullet = bulletsOf(previous).map(strip)[0];
  const second = evidenced.length
    ? `The role calls for ${joinList(evidenced)}, which are areas my resume already demonstrates${previous && previousBullet ? ` — for example, as ${previous.title}${previous.company ? ` at ${previous.company}` : ''}, I ${lower(previousBullet)}` : ''}.`
    : previous && previousBullet
      ? `Before that, as ${previous.title}${previous.company ? ` at ${previous.company}` : ''}, I ${lower(previousBullet)}.`
      : '';

  const close = 'I would welcome the chance to discuss how this experience fits your team. Thank you for considering my application.';

  return {
    engine: 'rules',
    engineNote:
      'AI generation is unavailable right now, so this draft is assembled directly from your own resume lines and the job description. Edit it before sending.',
    salutation: hiringManager ? `Dear ${hiringManager},` : 'Dear Hiring Manager,',
    body: [opening, middle, second, close].filter(Boolean).join('\n\n'),
    closing: 'Yours sincerely,',
    subjectLine: `Application: ${jobTitle}${companyName ? ` — ${companyName}` : ''}`,
    candidateName: resume.personal?.name || '',
    note: 'This letter references only your own resume and the job description. No claims are made about the employer.',
  };
}

/* ------------------------------------------------------------------ *
 * Interview preparation (spec §26)
 * ------------------------------------------------------------------ */

/**
 * Generates interview questions across every category the spec asks for,
 * including the important one most tools skip: questions that challenge
 * the candidate's own resume claims (spec §24 of the platform spec).
 */
export async function generateInterviewPrep(resume, { profile, jobIntel, keywordResult, confirmedFacts = [] }) {
  const context = buildRewriteContext(resume, { jobIntel, keywordResult, profile, confirmedFacts });

  /* Deterministic first: every number on the resume becomes a question
     about how it was measured. These do not need a model and are the
     questions candidates are least prepared for. */
  const claimQuestions = buildClaimChallenges(resume);

  const task = [
    'Generate interview preparation for this candidate and target role.',
    '',
    'Return JSON with this shape:',
    '{',
    '  "roleQuestions": [{ "question": "", "whyAsked": "", "answerFramework": "" }],',
    '  "jdQuestions": [{ "question": "", "whyAsked": "", "answerFramework": "" }],',
    '  "behavioural": [{ "question": "", "whyAsked": "", "starGuidance": { "situation": "", "task": "", "action": "", "result": "" } }],',
    '  "technical": [{ "question": "", "whyAsked": "", "answerFramework": "" }],',
    '  "hrQuestions": [{ "question": "", "whyAsked": "", "answerFramework": "" }],',
    '  "leadership": [{ "question": "", "whyAsked": "", "answerFramework": "" }],',
    '  "questionsToAsk": ["<questions the candidate should ask the interviewer>"]',
    '}',
    '',
    '4 to 6 items per category; leave "technical" and "leadership" empty arrays where they do not apply to this role.',
    'For STAR guidance, point at the candidate\'s OWN experience from the facts above — name the actual role — rather than describing a generic situation. Never invent an example they did not give you.',
  ].join('\n');

  let generated = {};
  let engine = 'model';

  try {
    const reply = await callModel(buildPrompt(context, task));
    generated = parseJson(reply);
  } catch (err) {
    logger.error(`[career-tools] interview prep generation failed: ${err.message}`);
    engine = 'rules';
    generated = buildInterviewFallback(resume, profile, jobIntel);
  }

  return {
    engine,
    engineNote:
      engine === 'rules'
        ? 'AI generation is unavailable right now, so these are the standard questions for your role and the ones your own resume invites.'
        : null,
    resumeQuestions: claimQuestions,
    roleQuestions: generated.roleQuestions || [],
    jdQuestions: generated.jdQuestions || [],
    behavioural: generated.behavioural || [],
    technical: generated.technical || [],
    hrQuestions: generated.hrQuestions || [],
    leadership: generated.leadership || [],
    questionsToAsk: generated.questionsToAsk || [],
    counts: {
      resume: claimQuestions.length,
      total:
        claimQuestions.length +
        ['roleQuestions', 'jdQuestions', 'behavioural', 'technical', 'hrQuestions', 'leadership']
          .reduce((n, k) => n + (generated[k]?.length || 0), 0),
    },
  };
}

const NUMBER_CLAIM_RE = /([^.!?]*?(?:\d[\d,.]*\s?(?:%|percent|k\b|m\b|cr\b|lakh|crore|million|billion)|\b\d[\d,]{2,}\b|\b\d+\s*(?:people|members|vendors|clients|customers|accounts|projects|stores|hours|days|months))[^.!?]*)/gi;

/**
 * Turns every quantified claim on the resume into the question an
 * interviewer will ask about it (spec: "You stated that you improved
 * efficiency by 25%. How did you measure the improvement?").
 */
export function buildClaimChallenges(resume) {
  const questions = [];
  const seen = new Set();

  (resume.experience || []).forEach((role) => {
    [...(role.achievements || []), ...(role.responsibilities || [])].forEach((bullet) => {
      const matches = String(bullet).match(NUMBER_CLAIM_RE);
      if (!matches) return;
      matches.slice(0, 1).forEach((claim) => {
        const trimmed = claim.trim();
        if (!trimmed || seen.has(trimmed)) return;
        seen.add(trimmed);
        questions.push({
          claim: trimmed.length > 160 ? `${trimmed.slice(0, 157)}…` : trimmed,
          role: [role.title, role.company].filter(Boolean).join(' at '),
          question: `You state: “${trimmed.length > 110 ? `${trimmed.slice(0, 107)}…` : trimmed}”. How was that measured, and over what period?`,
          whyAsked:
            'Any number on your resume is an invitation to ask how you arrived at it. Know the baseline, the method and the timeframe before you walk in.',
          preparationPoints: [
            'What was the figure before you started?',
            'How was it measured, and by whom?',
            'Over what period did the change happen?',
            'What part of it was specifically your doing?',
          ],
        });
      });
    });
  });

  return questions.slice(0, 10);
}

function buildInterviewFallback(resume, profile, jobIntel) {
  const role = jobIntel?.role?.jobTitle || resume.target?.jobTitle || 'this role';
  const senior = ['manager', 'senior-manager', 'director', 'vp', 'c-suite'].includes(profile?.careerLevel);

  const frame = (question, whyAsked, answerFramework) => ({ question, whyAsked, answerFramework });

  return {
    roleQuestions: [
      frame(`Walk me through your experience as it relates to ${role}.`, 'Almost always the opening question.', 'Two minutes: current role, the thread connecting your history, why this role is the logical next step.'),
      frame(`What would your first ninety days in ${role} look like?`, 'Tests whether you have thought past the interview.', 'Learn, then diagnose, then act. Be specific about what you would want to understand first.'),
      frame('What part of this role do you expect to find hardest?', 'Tests self-awareness and honesty.', 'Name something real, then say how you would address it.'),
    ],
    jdQuestions: (jobIntel?.responsibilities || []).slice(0, 4).map((r) =>
      frame(`Tell me about your experience with: ${r}`, 'Taken directly from the job description.', 'One concrete example from your own history, with the outcome.')
    ),
    behavioural: [
      { question: 'Describe a time you had to deliver under a tight deadline.', whyAsked: 'Tests prioritisation under pressure.', starGuidance: { situation: 'Set the scene in one sentence.', task: 'What you specifically had to achieve.', action: 'What you did, in order.', result: 'What happened, with a number if you have one.' } },
      { question: 'Tell me about a time you disagreed with a colleague or manager.', whyAsked: 'Tests how you handle conflict.', starGuidance: { situation: 'The disagreement, stated neutrally.', task: 'What was at stake.', action: 'How you raised and resolved it.', result: 'The outcome and what you took from it.' } },
      { question: 'Describe a mistake you made and what you did about it.', whyAsked: 'Tests accountability.', starGuidance: { situation: 'A real, non-trivial mistake.', task: 'What went wrong.', action: 'How you owned and fixed it.', result: 'What changed afterwards.' } },
    ],
    technical: [],
    leadership: senior
      ? [
          frame('How do you handle an underperformer on your team?', 'Standard at management level.', 'Diagnose first, set clear expectations, document, support, then decide.'),
          frame('Describe a change you led that people resisted.', 'Tests influence without authority.', 'The resistance, how you understood it, and what actually moved people.'),
        ]
      : [],
    hrQuestions: [
      frame('Why are you leaving your current role?', 'Checks for red flags.', 'Forward-looking and neutral. Never criticise a former employer.'),
      frame('What are your salary expectations?', 'Anchoring.', 'Give a researched range and say it is negotiable on the whole package.'),
      frame('Where do you see yourself in three years?', 'Checks retention.', 'Growth in this function, not a different job.'),
    ],
    questionsToAsk: [
      'What does success in this role look like at six months?',
      'What is the biggest challenge facing the team right now?',
      'How is performance measured here?',
      'Why is this role open?',
      'What are the next steps in the process?',
    ],
  };
}
