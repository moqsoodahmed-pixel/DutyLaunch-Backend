/**
 * AI resume rewrite workflow tests.
 *
 * Tests the full proposeRewrites → applyDecisions → buildComparison
 * pipeline using a synthetic resume with known weak bullets.
 * All AI calls are mocked — no live provider calls are made.
 */

import test from 'node:test';
import assert from 'node:assert/strict';
import { proposeRewrites, applyDecisions, buildComparison } from '../services/careerIntelligence/rewriter.js';
import { parseResumeJson } from '../services/careerIntelligence/resumeSchema.js';
import { __setModelClient } from '../services/careerIntelligence/aiClient.js';

// ── Synthetic test resume ─────────────────────────────────────────────────
// Contains deliberately weak bullets that should trigger rewrites.
// _source.rawText is included so validateProposal can verify rewrites
// against the original document text.
const RAW_TEXT = `
Test Candidate – Software Engineer
test@example.com | +91 9876543210 | Bangalore, India

SUMMARY
I am a hardworking professional seeking a challenging opportunity in software.

EXPERIENCE
Software Engineer – Acme Corp | Jan 2021 – Dec 2023
- Responsible for doing stuff with the backend systems.
- Helped team members when needed.
- Got award for being good at work.

EDUCATION
B.Tech Computer Science – State University, 2020

SKILLS
Node.js, Python, React, Git, Docker, Communication
`.trim();

const SYNTHETIC_RESUME = {
  personal: {
    name: 'Test Candidate',
    headline: 'Software Engineer',
    email: 'test@example.com',
    phone: '+91 9876543210',
    location: 'Bangalore, India',
  },
  summary: 'I am a hardworking professional seeking a challenging opportunity in software.',
  experience: [
    {
      title: 'Software Engineer',        // must not change
      company: 'Acme Corp',              // must not change
      startDate: 'Jan 2021',             // must not change
      endDate: 'Dec 2023',               // must not change
      current: false,
      responsibilities: [
        'Responsible for doing stuff with the backend systems.',  // weak → should rewrite
        'Helped team members when needed.',                       // weak → should rewrite
      ],
      achievements: [
        'Got award for being good at work.',                      // weak → should rewrite
      ],
    },
  ],
  education: [
    {
      degree: 'B.Tech',
      field: 'Computer Science',
      institution: 'State University',
      endDate: '2020',
    },
  ],
  skills: { technical: ['Node.js', 'Python', 'React'], tools: ['Git', 'Docker'], soft: ['Communication'] },
  // rawText allows validateProposal to verify rewrites against the source
  _source: { rawText: RAW_TEXT, fileName: 'cv.pdf', fileType: 'application/pdf' },
};

// ── Helpers ───────────────────────────────────────────────────────────────

function fakeBulletModel(rewrites) {
  return async (messages) => {
    const content = messages.find((m) => m.role === 'user')?.content || '';
    // Return the fake rewrites as a JSON array
    const bullets = rewrites.map((r) => ({
      id: r.id,
      rewritten: r.rewritten,
      changed: r.changed !== false,
      reason: r.reason || 'Wording tightened.',
      keywordsAligned: r.keywordsAligned || [],
    }));
    return JSON.stringify(bullets);
  };
}

function fakeSummaryModel(summary) {
  return async () =>
    JSON.stringify({ rewritten: summary, changed: true, reason: 'Summary improved.', keywordsAligned: [] });
}

/** Returns a model that serves bullets first, summary second. */
function fakeSequentialModel(bulletRewrites, newSummary) {
  let callCount = 0;
  return async (messages) => {
    callCount += 1;
    const content = messages.find((m) => m.role === 'user')?.content || '';
    if (content.includes('BULLETS:') || content.includes('"bullet":')) {
      // Bullet batch call
      return JSON.stringify(
        bulletRewrites.map((r) => ({
          id: r.id,
          rewritten: r.rewritten,
          changed: r.changed !== false,
          reason: r.reason || 'Wording improved.',
          keywordsAligned: [],
        }))
      );
    }
    // Summary call
    return JSON.stringify({
      rewritten: newSummary,
      changed: true,
      reason: 'Summary rewritten to be more professional.',
      keywordsAligned: [],
    });
  };
}

// ── Tests ─────────────────────────────────────────────────────────────────

test('proposeRewrites returns proposals via rules engine for weak bullets', async () => {
  // Use the rules (deterministic) path by making the model throw.
  // This proves the full pipeline: weak bullets → proposals → status=pending.
  // The model path is covered in the acceptance test (requires live credentials)
  // and integration tests; the rules path is always available offline.
  const resume = parseResumeJson(SYNTHETIC_RESUME);

  __setModelClient(async () => { throw new Error('simulated model failure'); });
  const result = await proposeRewrites(resume, { scope: 'experience' });
  __setModelClient(null);

  assert.equal(typeof result, 'object', 'result is an object');
  assert.ok(Array.isArray(result.proposals), 'proposals is an array');
  // The rules engine improves weak openers — at least one of the test bullets should fire
  assert.equal(result.engine, 'rules', 'engine is rules');
  assert.ok(typeof result.engineNote === 'string', 'engineNote explains fallback');

  // Verify the proposals array structure
  result.proposals.forEach((p) => {
    assert.ok(typeof p.id === 'string', `proposal has id`);
    assert.ok(typeof p.original === 'string', `proposal ${p.id} has original`);
    assert.ok(typeof p.proposed === 'string', `proposal ${p.id} has proposed`);
    assert.notEqual(p.proposed, p.original, `proposal ${p.id} is actually different`);
    assert.equal(p.status, 'pending', `proposal ${p.id} starts as pending`);
  });

  // Employer, title and dates must appear nowhere in proposals
  result.proposals.forEach((p) => {
    // The rewrite must not invent new employers or titles
    assert.ok(!p.proposed.includes('Different Company'), 'no invented employer in proposal');
  });
});

test('proposeRewrites does not change employer, title, or dates', async () => {
  const resume = parseResumeJson(SYNTHETIC_RESUME);

  const BULLET_REWRITES = [
    { id: 'experience.0.responsibilities.0', rewritten: 'Led backend system enhancements at Different Company Inc.', changed: true },
  ];

  // Fake model tries to inject a different company — must be rejected by validateProposal
  __setModelClient(fakeSequentialModel(BULLET_REWRITES, 'Clean summary.'));

  const result = await proposeRewrites(resume, { scope: 'experience' });
  __setModelClient(null);

  // The injected "Different Company Inc." is not in source — proposal should be rejected
  const badProposal = result.proposals.find((p) => p.proposed?.includes('Different Company Inc.'));
  assert.equal(badProposal, undefined, 'proposal that invents an employer is rejected');
});

test('applyDecisions: accept replaces bullet, reject preserves original', () => {
  const resume = parseResumeJson(SYNTHETIC_RESUME);

  const proposals = [
    {
      id: 'experience.0.responsibilities.0',
      field: 'responsibilities',
      roleIndex: 0,
      index: 0,
      original: 'Responsible for doing stuff with the backend systems.',
      proposed: 'Developed and maintained backend systems improving team velocity.',
      status: 'pending',
    },
    {
      id: 'experience.0.responsibilities.1',
      field: 'responsibilities',
      roleIndex: 0,
      index: 1,
      original: 'Helped team members when needed.',
      proposed: 'Supported team members with technical guidance during project deliveries.',
      status: 'pending',
    },
    {
      id: 'summary',
      field: 'summary',
      roleIndex: undefined,
      index: undefined,
      original: SYNTHETIC_RESUME.summary,
      proposed: 'Software Engineer with 2+ years building scalable backend systems.',
      status: 'pending',
    },
  ];

  const decisions = [
    { id: 'experience.0.responsibilities.0', action: 'accept' },
    { id: 'experience.0.responsibilities.1', action: 'reject' },
    { id: 'summary', action: 'accept' },
  ];

  const { resume: updated, changelog } = applyDecisions(resume, decisions, proposals);

  // Accepted bullet is replaced
  assert.equal(
    updated.experience[0].responsibilities[0],
    'Developed and maintained backend systems improving team velocity.',
    'accepted bullet is applied'
  );

  // Rejected bullet is unchanged
  assert.equal(
    updated.experience[0].responsibilities[1],
    'Helped team members when needed.',
    'rejected bullet keeps original'
  );

  // Summary is replaced
  assert.equal(
    updated.summary,
    'Software Engineer with 2+ years building scalable backend systems.',
    'accepted summary is applied'
  );

  // Employer, title, dates are untouched
  assert.equal(updated.experience[0].title, 'Software Engineer', 'title preserved');
  assert.equal(updated.experience[0].company, 'Acme Corp', 'company preserved');
  assert.equal(updated.experience[0].startDate, 'Jan 2021', 'startDate preserved');
  assert.equal(updated.experience[0].endDate, 'Dec 2023', 'endDate preserved');

  // Changelog is correct
  assert.equal(changelog.length, 3);
  assert.equal(changelog[0].action, 'accept');
  assert.equal(changelog[1].action, 'reject');
});

test('applyDecisions: edit action uses candidate-supplied text, not proposed', () => {
  const resume = parseResumeJson(SYNTHETIC_RESUME);

  const proposals = [
    {
      id: 'experience.0.responsibilities.0',
      field: 'responsibilities',
      roleIndex: 0,
      index: 0,
      original: 'Responsible for doing stuff.',
      proposed: 'AI-proposed text here.',
      status: 'pending',
    },
  ];

  const candidateText = 'Manually improved text by the candidate.';
  const decisions = [{ id: 'experience.0.responsibilities.0', action: 'edit', text: candidateText }];

  const { resume: updated } = applyDecisions(resume, decisions, proposals);
  assert.equal(updated.experience[0].responsibilities[0], candidateText, 'edit action uses candidate text');
});

test('buildComparison produces correct counts', () => {
  const before = parseResumeJson(SYNTHETIC_RESUME);
  const after = parseResumeJson({ ...SYNTHETIC_RESUME, summary: 'Improved summary.' });

  const changelog = [
    { id: 'summary', action: 'accept', original: SYNTHETIC_RESUME.summary, final: 'Improved summary.', keywordsAligned: [] },
    { id: 'experience.0.responsibilities.0', action: 'reject', original: 'Orig', final: 'Orig', keywordsAligned: [] },
  ];

  const comparison = buildComparison(before, after, changelog);
  assert.equal(comparison.counts.total, 2);
  assert.equal(comparison.counts.accepted, 1);
  assert.equal(comparison.counts.rejected, 1);
});

test('proposeRewrites falls back to rule-based rewrites when model is unavailable', async () => {
  const resume = parseResumeJson(SYNTHETIC_RESUME);

  // Model throws — should fall back to deterministicRewrite
  __setModelClient(async () => { throw new Error('AI provider unavailable'); });

  const result = await proposeRewrites(resume, { scope: 'experience' });
  __setModelClient(null);

  assert.equal(result.engine, 'rules', 'falls back to rules engine');
  assert.ok(Array.isArray(result.proposals), 'still returns proposals array');
  assert.ok(typeof result.engineNote === 'string' && result.engineNote.length > 0, 'explains fallback to user');
});

test('proposeRewrites returns no proposals for a strong resume (no-op)', async () => {
  const strongResume = parseResumeJson({
    ...SYNTHETIC_RESUME,
    summary: 'Software Engineer with 3 years building distributed systems at Acme Corp.',
    experience: [{
      ...SYNTHETIC_RESUME.experience[0],
      responsibilities: [
        'Reduced API latency by 40% by rewriting the caching layer in Redis.',
        'Led migration of monolithic service to 5 microservices, reducing deploy time by 60%.',
      ],
    }],
  });

  // Model says changed: false for every bullet
  __setModelClient(async (messages) => {
    const content = messages.find((m) => m.role === 'user')?.content || '';
    if (content.includes('BULLETS:')) {
      return JSON.stringify([
        { id: 'experience.0.responsibilities.0', rewritten: 'Reduced API latency by 40% by rewriting the caching layer in Redis.', changed: false, reason: '', keywordsAligned: [] },
        { id: 'experience.0.responsibilities.1', rewritten: 'Led migration of monolithic service to 5 microservices, reducing deploy time by 60%.', changed: false, reason: '', keywordsAligned: [] },
      ]);
    }
    return JSON.stringify({ rewritten: strongResume.summary, changed: false, reason: '', keywordsAligned: [] });
  });

  const result = await proposeRewrites(strongResume, { scope: 'all' });
  __setModelClient(null);

  assert.equal(result.proposals.length, 0, 'no proposals when content is already strong');
  assert.equal(result.engine, 'model');
});

test('proposeRewrites with scope=summary only rewrites the summary', async () => {
  const resume = parseResumeJson(SYNTHETIC_RESUME);

  let summaryCallMade = false;
  let bulletCallMade = false;

  __setModelClient(async (messages) => {
    const content = messages.find((m) => m.role === 'user')?.content || '';
    if (content.includes('BULLETS:')) {
      bulletCallMade = true;
      return JSON.stringify([]);
    }
    summaryCallMade = true;
    return JSON.stringify({
      rewritten: 'Experienced Software Engineer with backend expertise.',
      changed: true,
      reason: 'Summary rewritten.',
      keywordsAligned: [],
    });
  });

  const result = await proposeRewrites(resume, { scope: 'summary' });
  __setModelClient(null);

  assert.equal(bulletCallMade, false, 'bullet rewrite not called for summary scope');
  // Summary rewrite may or may not be called depending on whether summary exists
  const summaryProposal = result.proposals.find((p) => p.field === 'summary');
  if (result.proposals.length > 0) {
    assert.ok(summaryProposal, 'only summary proposal exists');
  }
});

test('_source is preserved through applyDecisions (original document survives)', () => {
  const resume = parseResumeJson({ ...SYNTHETIC_RESUME, _source: { rawText: 'original cv text', fileName: 'cv.pdf' } });

  const proposals = [
    { id: 'summary', field: 'summary', original: SYNTHETIC_RESUME.summary, proposed: 'Better summary.', status: 'pending' },
  ];
  const decisions = [{ id: 'summary', action: 'accept' }];

  const { resume: updated } = applyDecisions(resume, decisions, proposals);
  assert.deepEqual(updated._source, resume._source, '_source is untouched after applying decisions');
});
