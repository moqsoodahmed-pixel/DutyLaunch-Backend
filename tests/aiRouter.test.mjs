import test from 'node:test';
import assert from 'node:assert/strict';
import { callModel, aiProvider, aiStatus, getAiUsage, TASK_ROUTES } from '../services/careerIntelligence/aiClient.js';

/**
 * Router-mode tests (AI_PROVIDER=router). A fake fetch stands in for
 * Groq, Gemini and Mistral, so these run offline and never need real keys.
 */

const GROQ = /api\.groq\.com/;
const GEMINI = /generativelanguage\.googleapis\.com/;
const MISTRAL = /api\.mistral\.ai/;

const ok = (text, finish = 'stop') => ({ status: 200, body: { choices: [{ message: { content: text }, finish_reason: finish }], usage: { prompt_tokens: 10, completion_tokens: 5 } } });
const fail = (status, error = {}) => ({ status, body: { error } });

/** script: { groq: [resp, ...], gemini: [...], mistral: [...] } — each call shifts one response. */
function fakeProviders(script = {}) {
  const calls = [];
  const queues = Object.fromEntries(Object.entries(script).map(([k, v]) => [k, [...v]]));
  const fetchImpl = async (url, opts = {}) => {
    const name = GROQ.test(url) ? 'groq' : GEMINI.test(url) ? 'gemini' : MISTRAL.test(url) ? 'mistral' : 'unknown';
    calls.push({ name, url, body: JSON.parse(opts.body), headers: opts.headers });
    const next = (queues[name] || []).shift() || ok(`{"from":"${name}"}`);
    return new Response(JSON.stringify(next.body), { status: next.status });
  };
  return { fetchImpl, calls };
}

const messages = [{ role: 'system', content: 'rules' }, { role: 'user', content: 'Return JSON.' }];

test.beforeEach(() => {
  process.env.AI_PROVIDER = 'router';
  delete process.env.OPENAI_API_KEY;
  process.env.GROQ_API_KEY = 'gsk_test';
  process.env.GEMINI_API_KEY = 'gem_test';
  process.env.MISTRAL_API_KEY = 'mis_test';
  process.env.GROQ_MODEL = 'openai/gpt-oss-120b';
  process.env.GROQ_MODEL_FALLBACKS = 'openai/gpt-oss-20b';
  delete process.env.GEMINI_MODEL;
  delete process.env.GEMINI_MODEL_FALLBACKS;
  delete process.env.MISTRAL_MODEL;
  delete process.env.GROQ_API_URL;
});

test('router mode is active when free keys are present', () => {
  assert.equal(aiProvider(), 'router');
  const status = aiStatus();
  assert.equal(status.provider, 'router');
  assert.deepEqual(status.routes['cover-letter-paragraph'], ['mistral', 'groq', 'gemini']);
  assert.equal(status.providers.gemini.model, 'gemini-flash-latest');
  assert.equal(JSON.stringify(status).includes('gsk_test'), false, 'status never includes keys');
});

test('unset AI_PROVIDER with only free keys picks the router', () => {
  delete process.env.AI_PROVIDER;
  assert.equal(aiProvider(), 'router');
});

test('each Career Studio step goes to its own provider', async () => {
  const expect = {
    'resume-rewrite': 'groq',
    'cover-letter-paragraph': 'mistral',
    'interview-top10': 'gemini',
    'mock-evaluate': 'groq',
  };
  for (const [task, provider] of Object.entries(expect)) {
    const { fetchImpl, calls } = fakeProviders();
    // eslint-disable-next-line no-await-in-loop
    const text = await callModel(messages, { json: true, task, fetchImpl });
    assert.equal(text, `{"from":"${provider}"}`, task);
    assert.equal(calls.length, 1);
    assert.equal(calls[0].name, provider);
  }
});

test('sends the key as a Bearer token, JSON mode, and caps Groq tokens', async () => {
  const { fetchImpl, calls } = fakeProviders();
  await callModel(messages, { json: true, task: 'resume-rewrite', maxOutputTokens: 9000, fetchImpl });
  const c = calls[0];
  assert.equal(c.headers.Authorization, 'Bearer gsk_test');
  assert.equal(c.body.model, 'openai/gpt-oss-120b');
  assert.deepEqual(c.body.response_format, { type: 'json_object' });
  assert.equal(c.body.reasoning_effort, 'low');
  assert.equal(c.body.max_tokens, 6000, 'stays under the Groq free-tier per-minute token limit');
});

test('a rate-limited provider hands the task to the next one', async () => {
  const { fetchImpl, calls } = fakeProviders({ mistral: [fail(429, { code: 'rate_limited' })] });
  const text = await callModel(messages, { task: 'cover-letter-paragraph', fetchImpl });
  assert.equal(text, '{"from":"groq"}');
  assert.deepEqual(calls.map((c) => c.name), ['mistral', 'groq']);
  assert.equal(getAiUsage().byProvider.mistral.failures >= 1, true);
});

test('a provider without a key is skipped', async () => {
  delete process.env.GEMINI_API_KEY;
  const { fetchImpl, calls } = fakeProviders();
  const text = await callModel(messages, { task: 'interview-top10', fetchImpl });
  assert.equal(text, '{"from":"mistral"}');
  assert.deepEqual(calls.map((c) => c.name), ['mistral']);
});

test('a 400 retries once without JSON mode / reasoning_effort', async () => {
  const { fetchImpl, calls } = fakeProviders({ groq: [fail(400, { code: 'invalid_request_error', message: 'response_format not supported' })] });
  const text = await callModel(messages, { json: true, task: 'mock-plan', fetchImpl });
  assert.equal(text, '{"from":"groq"}');
  assert.equal(calls.length, 2);
  assert.ok(calls[0].body.response_format);
  assert.equal(calls[1].body.response_format, undefined);
  assert.equal(calls[1].body.reasoning_effort, undefined);
});

test('a retired model moves to the fallback model of the same provider', async () => {
  const { fetchImpl, calls } = fakeProviders({ groq: [fail(404, { code: 'model_not_found', message: 'The model does not exist' })] });
  await callModel(messages, { task: 'resume-rewrite', fetchImpl });
  assert.deepEqual(calls.map((c) => c.body.model), ['openai/gpt-oss-120b', 'openai/gpt-oss-20b']);
});

test('a cut-off JSON answer is not accepted; the next provider is tried', async () => {
  const { fetchImpl, calls } = fakeProviders({ gemini: [ok('{"questions":[', 'length'), ok('{"questions":[', 'length')] });
  const text = await callModel(messages, { json: true, task: 'interview-top10', fetchImpl });
  assert.equal(text, '{"from":"mistral"}');
  assert.equal(calls.at(-1).name, 'mistral');
});

test('when every provider fails, callModel throws so callers use their rule-based fallback', async () => {
  const down = [fail(503), fail(503), fail(503), fail(503)];
  const { fetchImpl } = fakeProviders({ groq: down, gemini: down, mistral: down });
  await assert.rejects(() => callModel(messages, { task: 'resume-rewrite', fetchImpl }), (err) => {
    assert.match(err.message, /Every AI provider failed for resume-rewrite/);
    return true;
  });
});

test('error messages never include the provider response text', async () => {
  const leak = fail(500, { message: 'echo of candidate phone 98765 43210' });
  const { fetchImpl } = fakeProviders({ groq: [leak], gemini: [leak, leak], mistral: [leak] });
  await assert.rejects(() => callModel(messages, { task: 'resume-rewrite', fetchImpl }), (err) => {
    assert.doesNotMatch(err.message, /98765/);
    return true;
  });
});

test('no free keys and no OpenAI key means no provider', async () => {
  delete process.env.GROQ_API_KEY;
  delete process.env.GEMINI_API_KEY;
  delete process.env.MISTRAL_API_KEY;
  assert.equal(aiProvider(), '');
  await assert.rejects(() => callModel(messages), /No AI model is configured/);
});

test('every task the app sends has a route', () => {
  for (const task of ['resume-rewrite', 'resume-summary', 'cover-letter-paragraph', 'cover-letter', 'interview-top10', 'interview-regenerate', 'interview-prep', 'mock-plan', 'mock-evaluate', 'mock-report', 'linkedin-optimise']) {
    assert.ok(TASK_ROUTES[task], task);
  }
});

test('AI_PROVIDER=groq uses only Groq, with the full token budget (not the old 700 cap)', async () => {
  process.env.AI_PROVIDER = 'groq';
  const { fetchImpl, calls } = fakeProviders();
  const text = await callModel(messages, { json: true, task: 'job-description', maxOutputTokens: 2000, fetchImpl });
  assert.equal(text, '{"from":"groq"}');
  assert.deepEqual(calls.map((c) => c.name), ['groq']);
  assert.equal(calls[0].body.max_tokens, 2000);
});

test('AI_PROVIDER=groq never falls back to Gemini or Mistral', async () => {
  process.env.AI_PROVIDER = 'groq';
  const down = [{ status: 503, body: { error: {} } }, { status: 503, body: { error: {} } }];
  const { fetchImpl, calls } = fakeProviders({ groq: down });
  await assert.rejects(() => callModel(messages, { task: 'cover-letter', fetchImpl }));
  assert.ok(calls.every((c) => c.name === 'groq'));
});

test('when every provider is rate-limited, the router waits and retries once', async () => {
  process.env.AI_PROVIDER = 'router';
  let calls = 0;
  const fetchImpl = async () => {
    calls += 1;
    if (calls <= 3) return new Response(JSON.stringify({ error: { code: 'rate_limit_exceeded' } }), { status: 429, headers: { 'retry-after': '0.05' } });
    return new Response(JSON.stringify({ choices: [{ message: { content: '{"ok":true}' }, finish_reason: 'stop' }], usage: {} }), { status: 200 });
  };
  const text = await callModel(messages, { task: 'cover-letter', fetchImpl, _retryBaseMs: 0 });
  assert.equal(text, '{"ok":true}');
  assert.equal(calls, 4, '3 providers busy, then one retry succeeds');
});

test('it retries only once, then reports that the free limit was reached', async () => {
  process.env.AI_PROVIDER = 'router';
  const fetchImpl = async () => new Response(JSON.stringify({ error: {} }), { status: 429, headers: { 'retry-after': '0' } });
  await assert.rejects(() => callModel(messages, { task: 'cover-letter', fetchImpl, _retryBaseMs: 0 }), (err) => err.rateLimited === true);
});

test('wait times are read from provider headers', async () => {
  const { parseWait } = await import('../services/careerIntelligence/aiClient.js');
  assert.equal(parseWait('7'), 7000);
  assert.equal(parseWait('7.5s'), 7500);
  assert.equal(parseWait('1m2s'), 62000);
  assert.equal(parseWait('250ms'), 250);
  assert.equal(parseWait(''), null);
});
