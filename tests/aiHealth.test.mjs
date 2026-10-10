import test from 'node:test';
import assert from 'node:assert/strict';
import { callModel, isProviderUsable, resetProviderHealth, __setModelClient } from '../services/careerIntelligence/aiClient.js';
import { proposeRewrites } from '../services/careerIntelligence/rewriter.js';
import { parseResumeJson } from '../services/careerIntelligence/resumeSchema.js';

/**
 * A slow or overloaded AI provider must cost ONE wait, not one wait per
 * request. (Real case: Gemini timing out after 90 s on every rewrite batch
 * made a resume optimisation take 3–4 minutes and the browser gave up.)
 * No network, no keys: fetch is faked.
 */

const messages = [{ role: 'system', content: 'rules' }, { role: 'user', content: 'Return JSON.' }];

const chatOk = (text) => new Response(JSON.stringify({ choices: [{ message: { content: text }, finish_reason: 'stop' }], usage: {} }), { status: 200 });
const geminiOk = (text) => new Response(JSON.stringify({ candidates: [{ content: { parts: [{ text }] }, finishReason: 'STOP' }], usageMetadata: {} }), { status: 200 });
const timeoutError = () => Object.assign(new Error('The operation was aborted due to timeout'), { name: 'TimeoutError' });

test.beforeEach(() => {
  resetProviderHealth();
  process.env.AI_PROVIDER = 'router';
  process.env.GEMINI_API_KEY = 'gk';
  process.env.GROQ_API_KEY = 'qk';
  for (const k of ['OPENAI_API_KEY', 'GROK_API_KEY', 'MISTRAL_API_KEY', 'AI_TIMEOUT_MS', 'SLOW_PROVIDER_COOLDOWN_MS', 'AI_OPTIMIZE_BUDGET_MS']) delete process.env[k];
  __setModelClient(null);
});
test.after(() => resetProviderHealth());

test('after Gemini times out once, the next requests go straight to Groq', async () => {
  const urls = [];
  const fetchImpl = async (url) => {
    urls.push(/generativelanguage/.test(url) ? 'gemini' : 'groq');
    if (/generativelanguage/.test(url)) throw timeoutError();
    return chatOk('from groq');
  };
  assert.equal(await callModel(messages, { task: 'resume-rewrite', fetchImpl }), 'from groq');
  assert.deepEqual(urls, ['gemini', 'groq'], 'the first request pays for the failed Gemini attempt');

  urls.length = 0;
  assert.equal(await callModel(messages, { task: 'resume-rewrite', fetchImpl }), 'from groq');
  assert.equal(await callModel(messages, { task: 'resume-rewrite', fetchImpl }), 'from groq');
  assert.deepEqual(urls, ['groq', 'groq'], 'Gemini is not tried again while it is slow');
});

test('"service unavailable" (503) counts as slow too', async () => {
  const urls = [];
  const fetchImpl = async (url) => {
    urls.push(/generativelanguage/.test(url) ? 'gemini' : 'groq');
    if (/generativelanguage/.test(url)) return new Response(JSON.stringify({ error: { code: 503, status: 'UNAVAILABLE' } }), { status: 503 });
    return chatOk('from groq');
  };
  await callModel(messages, { task: 'resume-summary', fetchImpl });
  urls.length = 0;
  await callModel(messages, { task: 'resume-summary', fetchImpl });
  assert.deepEqual(urls, ['groq']);
});

test('a slow provider is still the last resort when the others fail', async () => {
  let geminiFails = true;
  const urls = [];
  const fetchImpl = async (url) => {
    const who = /generativelanguage/.test(url) ? 'gemini' : 'groq';
    urls.push(who);
    if (who === 'gemini') {
      if (geminiFails) throw timeoutError();
      return geminiOk('from gemini');
    }
    // Groq answers, but with nothing in it: a failure that is NOT "slow".
    return chatOk('');
  };
  await assert.rejects(() => callModel(messages, { task: 'resume-rewrite', fetchImpl }), /Every AI provider failed/);
  urls.length = 0;
  geminiFails = false; // Gemini has recovered, but is still "slow" on the list
  assert.equal(await callModel(messages, { task: 'resume-rewrite', fetchImpl }), 'from gemini');
  assert.deepEqual(urls, ['groq', 'gemini'], 'tried after Groq, not before');
});

test('a slow provider still counts as configured (the app must not say "AI not set up")', async () => {
  const fetchImpl = async (url) => {
    if (/generativelanguage/.test(url)) throw timeoutError();
    return chatOk('ok');
  };
  await callModel(messages, { task: 'resume-rewrite', fetchImpl });
  assert.equal(isProviderUsable('gemini'), true);
});

test('rewriting uses a short timeout, long-output tasks keep the long one, options.timeoutMs wins', async () => {
  const seen = [];
  const original = AbortSignal.timeout;
  AbortSignal.timeout = (ms) => {
    seen.push(ms);
    return original.call(AbortSignal, ms);
  };
  try {
    const fetchImpl = async (url) => (/generativelanguage/.test(url) ? geminiOk('x') : chatOk('x'));
    await callModel(messages, { task: 'resume-rewrite', fetchImpl });
    await callModel(messages, { task: 'resume-summary', fetchImpl });
    await callModel(messages, { task: 'interview-top10', fetchImpl });
    await callModel(messages, { task: 'resume-rewrite', timeoutMs: 5000, fetchImpl });
  } finally {
    AbortSignal.timeout = original;
  }
  assert.deepEqual(seen, [40000, 30000, 90000, 5000]);
});

/* ---------------- the optimisation time budget ---------------- */

function resumeWithBullets(n) {
  return parseResumeJson({
    personal: { name: 'Test Candidate', headline: 'Software Engineer', email: 't@example.com' },
    experience: [
      {
        title: 'Software Engineer',
        company: 'Acme Corp',
        startDate: 'Jan 2021',
        endDate: 'Dec 2023',
        responsibilities: Array.from({ length: n }, (_, i) => `Responsible for maintaining backend service number ${i + 1} for clients`),
      },
    ],
    skills: { technical: ['Node.js', 'Git'] },
  });
}

function countingModel() {
  const calls = { batches: 0 };
  __setModelClient(async (msgs) => {
    const content = msgs.find((m) => m.role === 'user')?.content || '';
    await new Promise((r) => setTimeout(r, 10));
    if (content.includes('"bullet":')) {
      calls.batches += 1;
      const rows = [...content.matchAll(/\{"id":"([^"]+)","role":"[^"]*","bullet":"([^"]+)"\}/g)];
      return JSON.stringify(
        rows.map(([, id, bullet]) => ({
          id,
          // "Responsible for maintaining backend service number 3 for clients" → "Maintained backend service number 3 for clients."
          rewritten: bullet.replace(/^Responsible for maintaining/, 'Maintained') + '.',
          changed: true,
          reason: 'Starts with an action verb.',
          keywordsAligned: [],
        }))
      );
    }
    return JSON.stringify({ rewritten: '', changed: false });
  });
  return calls;
}

test('time budget: when it is used up, remaining batches are not sent and the candidate is told', async () => {
  process.env.AI_OPTIMIZE_BUDGET_MS = '1';
  const calls = countingModel();
  const out = await proposeRewrites(resumeWithBullets(20), { scope: 'experience' });
  __setModelClient(null);
  assert.equal(calls.batches, 1, 'only the first batch was sent');
  assert.equal(out.engine, 'model', 'the AI did work — this is a partial result, not a failure');
  assert.equal(out.failureReason, 'partial');
  assert.match(out.warnings[0], /could not be rewritten/i);
  assert.ok(out.proposals.length > 0, 'what was rewritten is kept');
});

test('time budget: with enough time every batch is sent', async () => {
  process.env.AI_OPTIMIZE_BUDGET_MS = '60000';
  const calls = countingModel();
  await proposeRewrites(resumeWithBullets(20), { scope: 'experience' });
  __setModelClient(null);
  assert.equal(calls.batches, 3, '20 bullets → 3 batches of 8');
});
