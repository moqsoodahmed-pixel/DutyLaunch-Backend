import test from 'node:test';
import assert from 'node:assert/strict';
import { callModel, aiProvider, aiStatus, getAiUsage, TASK_ROUTES, isProviderUsable, __resetProviderCooldowns } from '../services/careerIntelligence/aiClient.js';

/**
 * Router-mode tests (AI_PROVIDER=router). A fake fetch stands in for
 * OpenAI, Groq, Grok and Mistral, so these run offline without real keys.
 */

const GROQ    = /api\.groq\.com/;
const OPENAI  = /api\.openai\.com/;
const MISTRAL = /api\.mistral\.ai/;
const GROK    = /api\.x\.ai/;

const ok   = (text, finish = 'stop') => ({ status: 200, body: { choices: [{ message: { content: text }, finish_reason: finish }], usage: { prompt_tokens: 10, completion_tokens: 5 } } });
const fail = (status, error = {})    => ({ status, body: { error } });

/** script: { groq: [resp, ...], openai: [...], mistral: [...], grok: [...] } */
function fakeProviders(script = {}) {
  const calls = [];
  const queues = Object.fromEntries(Object.entries(script).map(([k, v]) => [k, [...v]]));
  const fetchImpl = async (url, opts = {}) => {
    const name = GROQ.test(url) ? 'groq' : OPENAI.test(url) ? 'openai' : MISTRAL.test(url) ? 'mistral' : GROK.test(url) ? 'grok' : 'unknown';
    calls.push({ name, url, body: JSON.parse(opts.body), headers: opts.headers });
    const next = (queues[name] || []).shift() || ok(`{"from":"${name}"}`);
    return new Response(JSON.stringify(next.body), { status: next.status });
  };
  return { fetchImpl, calls };
}

const messages = [{ role: 'system', content: 'rules' }, { role: 'user', content: 'Return JSON.' }];

test.beforeEach(() => {
  __resetProviderCooldowns();
  process.env.AI_PROVIDER = 'router';
  process.env.GROQ_API_KEY    = 'gsk_test';
  process.env.OPENAI_API_KEY  = 'sk_test';
  process.env.MISTRAL_API_KEY = 'mis_test';
  // Use real Groq model names (not OpenAI-proxied ones).
  process.env.GROQ_MODEL          = 'llama-3.3-70b-versatile';
  process.env.GROQ_MODEL_FALLBACKS = 'llama-3.1-70b-versatile';
  delete process.env.OPENAI_MODEL;
  delete process.env.OPENAI_MODEL_FALLBACKS;
  delete process.env.MISTRAL_MODEL;
  delete process.env.GROQ_API_URL;
  // Grok is optional — clear it so tests without a key behave predictably.
  delete process.env.GROK_API_KEY;
  delete process.env.GROK_MODEL;
});

test('router mode is active when free keys are present', () => {
  assert.equal(aiProvider(), 'router');
  const status = aiStatus();
  assert.equal(status.provider, 'router');
  // cover-letter-paragraph: mistral first, then openai, then groq (grok skipped — no key)
  assert.deepEqual(status.routes['cover-letter-paragraph'], ['mistral', 'openai', 'groq']);
  // Resume rewriting goes to OpenAI first.
  assert.deepEqual(status.routes['resume-rewrite'], ['openai', 'groq', 'mistral']);
  assert.equal(status.providers.openai.model, 'gpt-4.1-mini');
  assert.equal(status.providers.gemini, undefined, 'Gemini is no longer a provider');
  // Keys must never appear in the status object
  assert.equal(JSON.stringify(status).includes('gsk_test'), false, 'status never includes keys');
});

test('unset AI_PROVIDER with only free keys picks the router', () => {
  delete process.env.AI_PROVIDER;
  delete process.env.OPENAI_API_KEY;
  assert.equal(aiProvider(), 'router');
});

test('unset AI_PROVIDER with an OpenAI key uses OpenAI directly', () => {
  delete process.env.AI_PROVIDER;
  assert.equal(aiProvider(), 'openai');
});

test('each Career Studio step goes to its own provider', async () => {
  const expect = {
    'resume-rewrite':         'openai',
    'resume-summary':         'openai',
    'cover-letter-paragraph': 'mistral',
    'interview-top10':        'openai',
    'mock-evaluate':          'groq',
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

test('Groq: Bearer token, JSON mode, real Groq model, token cap', async () => {
  const { fetchImpl, calls } = fakeProviders();
  await callModel(messages, { json: true, task: 'mock-evaluate', maxOutputTokens: 9000, fetchImpl });
  const c = calls[0];
  assert.equal(c.headers.Authorization, 'Bearer gsk_test');
  // Should now use the real Groq model, not the OpenAI-proxied one
  assert.equal(c.body.model, 'llama-3.3-70b-versatile');
  assert.deepEqual(c.body.response_format, { type: 'json_object' });
  // reasoning_effort must NOT be sent for non-gpt-oss models
  assert.equal(c.body.reasoning_effort, undefined, 'reasoning_effort not sent to llama models');
  assert.equal(c.body.max_tokens, 6000, 'stays under the Groq free-tier per-minute token limit');
});

test('a rate-limited provider hands the task to the next one', async () => {
  const { fetchImpl, calls } = fakeProviders({ mistral: [fail(429, { code: 'rate_limited' })] });
  const text = await callModel(messages, { task: 'cover-letter-paragraph', fetchImpl });
  assert.equal(text, '{"from":"openai"}');
  assert.deepEqual(calls.map((c) => c.name), ['mistral', 'openai']);
  assert.equal(getAiUsage().byProvider.mistral.failures >= 1, true);
});

test('a provider without a key is skipped', async () => {
  delete process.env.OPENAI_API_KEY;
  const { fetchImpl, calls } = fakeProviders();
  const text = await callModel(messages, { task: 'interview-top10', fetchImpl });
  // openai is first but has no key, grok has no key — mistral is next
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
  await callModel(messages, { task: 'mock-plan', fetchImpl });
  assert.deepEqual(calls.map((c) => c.body.model), ['llama-3.3-70b-versatile', 'llama-3.1-70b-versatile']);
});

test('a cut-off JSON answer is not accepted; the next provider is tried', async () => {
  const { fetchImpl, calls } = fakeProviders({ openai: [ok('{"questions":[', 'length'), ok('{"questions":[', 'length')] });
  const text = await callModel(messages, { json: true, task: 'interview-top10', fetchImpl });
  assert.equal(text, '{"from":"mistral"}');
  assert.equal(calls.at(-1).name, 'mistral');
});

test('when every provider fails, callModel throws so callers use their rule-based fallback', async () => {
  const down = [fail(503), fail(503), fail(503), fail(503)];
  const { fetchImpl } = fakeProviders({ groq: down, openai: down, mistral: down });
  await assert.rejects(() => callModel(messages, { task: 'resume-rewrite', fetchImpl }), (err) => {
    assert.match(err.message, /Every AI provider failed for resume-rewrite/);
    return true;
  });
});

test('error messages never include the provider response text', async () => {
  const leak = fail(500, { message: 'echo of candidate phone 98765 43210' });
  const { fetchImpl } = fakeProviders({ groq: [leak], openai: [leak, leak], mistral: [leak] });
  await assert.rejects(() => callModel(messages, { task: 'resume-rewrite', fetchImpl }), (err) => {
    assert.doesNotMatch(err.message, /98765/);
    return true;
  });
});

test('no free keys and no OpenAI key means no provider', async () => {
  delete process.env.GROQ_API_KEY;
  delete process.env.OPENAI_API_KEY;
  delete process.env.MISTRAL_API_KEY;
  delete process.env.GROK_API_KEY;
  assert.equal(aiProvider(), '');
  await assert.rejects(() => callModel(messages), /No AI model is configured/);
});

test('every task the app sends has a route', () => {
  for (const task of [
    'resume-rewrite', 'resume-summary', 'cover-letter-paragraph', 'cover-letter',
    'interview-top10', 'interview-regenerate', 'interview-prep',
    'mock-plan', 'mock-evaluate', 'mock-report', 'linkedin-optimise',
    'assistant-chat',
  ]) {
    assert.ok(TASK_ROUTES[task], `task '${task}' has no route`);
  }
});

test('AI_PROVIDER=groq uses only Groq, with the full token budget', async () => {
  process.env.AI_PROVIDER = 'groq';
  const { fetchImpl, calls } = fakeProviders();
  const text = await callModel(messages, { json: true, task: 'job-description', maxOutputTokens: 2000, fetchImpl });
  assert.equal(text, '{"from":"groq"}');
  assert.deepEqual(calls.map((c) => c.name), ['groq']);
  assert.equal(calls[0].body.max_tokens, 2000);
});

test('AI_PROVIDER=groq never falls back to OpenAI or Mistral', async () => {
  process.env.AI_PROVIDER = 'groq';
  const down = [{ status: 503, body: { error: {} } }, { status: 503, body: { error: {} } }];
  const { fetchImpl, calls } = fakeProviders({ groq: down });
  await assert.rejects(() => callModel(messages, { task: 'cover-letter', fetchImpl }));
  assert.ok(calls.every((c) => c.name === 'groq'));
});

test('AI_PROVIDER=grok uses only Grok when GROK_API_KEY is set', async () => {
  process.env.AI_PROVIDER = 'grok';
  process.env.GROK_API_KEY = 'xai_test';
  process.env.GROK_MODEL = 'grok-3-mini';
  const { fetchImpl, calls } = fakeProviders();
  const text = await callModel(messages, { task: 'resume-rewrite', fetchImpl });
  assert.equal(text, '{"from":"grok"}');
  assert.deepEqual(calls.map((c) => c.name), ['grok']);
  assert.equal(calls[0].headers.Authorization, 'Bearer xai_test');
  assert.equal(calls[0].body.model, 'grok-3-mini');
});

test('grok is included in router fallback chain when GROK_API_KEY is set', async () => {
  process.env.GROK_API_KEY = 'xai_test';
  process.env.GROK_MODEL   = 'grok-3-mini';
  // resume-rewrite chain: openai → groq → grok → mistral
  // Fail openai and groq; grok should be tried and succeed.
  const { fetchImpl, calls } = fakeProviders({
    openai: [fail(503)],
    groq:   [fail(503)],
  });
  const text = await callModel(messages, { task: 'resume-rewrite', fetchImpl });
  assert.equal(text, '{"from":"grok"}');
  assert.deepEqual(calls.map((c) => c.name).slice(0, 2), ['openai', 'groq']);
  assert.ok(calls.some((c) => c.name === 'grok'), 'grok was tried after openai and groq');
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
  assert.equal(parseWait('7'),    7000);
  assert.equal(parseWait('7.5s'), 7500);
  assert.equal(parseWait('1m2s'), 62000);
  assert.equal(parseWait('250ms'), 250);
  assert.equal(parseWait(''), null);
});

test('reasoning_effort is sent for gpt-oss models but not for llama/mixtral', async () => {
  // gpt-oss model should get reasoning_effort=low
  process.env.GROQ_MODEL = 'openai/gpt-oss-120b';
  const { fetchImpl: f1, calls: c1 } = fakeProviders();
  await callModel(messages, { json: true, task: 'mock-plan', fetchImpl: f1 });
  assert.equal(c1[0].body.reasoning_effort, 'low', 'gpt-oss gets reasoning_effort');

  // llama model must NOT get reasoning_effort (it causes 400 errors)
  process.env.GROQ_MODEL = 'llama-3.3-70b-versatile';
  const { fetchImpl: f2, calls: c2 } = fakeProviders();
  await callModel(messages, { json: true, task: 'mock-plan', fetchImpl: f2 });
  assert.equal(c2[0].body.reasoning_effort, undefined, 'llama must not get reasoning_effort');
});

test('OpenAI: Bearer key, gpt-4.1-mini, max_completion_tokens, low temperature, JSON mode', async () => {
  const { fetchImpl, calls } = fakeProviders();
  await callModel(messages, { json: true, task: 'resume-rewrite', maxOutputTokens: 3000, fetchImpl });
  const c = calls[0];
  assert.equal(c.name, 'openai');
  assert.match(c.url, /api\.openai\.com\/v1\/chat\/completions/);
  assert.equal(c.headers.Authorization, 'Bearer sk_test');
  assert.equal(c.body.model, 'gpt-4.1-mini');
  assert.equal(c.body.max_completion_tokens, 3000);
  assert.equal(c.body.max_tokens, undefined);
  assert.equal(c.body.temperature, 0.3);
  assert.deepEqual(c.body.response_format, { type: 'json_object' });
});

test('OpenAI gpt-5 / o-series models are sent without temperature', async () => {
  process.env.OPENAI_MODEL = 'gpt-5-mini';
  const { fetchImpl, calls } = fakeProviders();
  await callModel(messages, { task: 'resume-rewrite', fetchImpl });
  assert.equal(calls[0].body.model, 'gpt-5-mini');
  assert.equal(calls[0].body.temperature, undefined);
});

test('OpenAI insufficient_quota falls back to Groq immediately, without the rate-limit wait', async () => {
  const { fetchImpl, calls } = fakeProviders({ openai: [fail(429, { code: 'insufficient_quota' })] });
  const text = await callModel(messages, { task: 'resume-rewrite', fetchImpl });
  assert.equal(text, '{"from":"groq"}');
  assert.deepEqual(calls.map((c) => c.name), ['openai', 'groq']);
});

test('quota exhaustion everywhere is not reported as a retryable rate limit', async () => {
  const q = [fail(429, { code: 'insufficient_quota' })];
  const { fetchImpl, calls } = fakeProviders({ openai: q, groq: [fail(429, { code: 'insufficient_quota' })], mistral: [fail(429, { code: 'insufficient_quota' })] });
  await assert.rejects(() => callModel(messages, { task: 'resume-rewrite', fetchImpl }), (err) => err.rateLimited === false);
  assert.equal(calls.length, 3, 'no second pass after quota errors');
});

test('Gemini is gone: a leftover GEMINI_API_KEY is never used', async () => {
  process.env.GEMINI_API_KEY = 'gem_leftover';
  const { fetchImpl, calls } = fakeProviders();
  await callModel(messages, { task: 'interview-top10', fetchImpl });
  assert.ok(calls.every((c) => c.name !== 'unknown'), 'only known providers are called');
  assert.equal(aiStatus().providers.gemini, undefined);
  delete process.env.GEMINI_API_KEY;
});

test('OpenAI "credit_balance_exhausted" is treated as no credit: skipped at once, no waiting', async () => {
  const { fetchImpl, calls } = fakeProviders({ openai: [fail(429, { code: 'credit_balance_exhausted' })] });
  const text = await callModel(messages, { task: 'resume-rewrite', fetchImpl });
  assert.equal(text, '{"from":"groq"}');
  assert.deepEqual(calls.map((c) => c.name), ['openai', 'groq']);
});

test('after a no-credit error OpenAI is not called again until the cooldown ends', async () => {
  const first = fakeProviders({ openai: [fail(429, { code: 'credit_balance_exhausted' })] });
  await callModel(messages, { task: 'resume-rewrite', fetchImpl: first.fetchImpl });
  assert.equal(isProviderUsable('openai'), false);
  assert.ok(aiStatus().unavailable.openai);

  const second = fakeProviders();
  await callModel(messages, { task: 'resume-rewrite', fetchImpl: second.fetchImpl });
  assert.deepEqual(second.calls.map((c) => c.name), ['groq'], 'OpenAI skipped during cooldown');
});

test('a rejected API key (401) also disables that provider for a while', async () => {
  const { fetchImpl } = fakeProviders({ openai: [fail(401, { code: 'invalid_api_key' })] });
  await callModel(messages, { task: 'resume-rewrite', fetchImpl });
  assert.equal(isProviderUsable('openai'), false);
});

test('an ordinary rate limit does NOT disable a provider', async () => {
  const { fetchImpl } = fakeProviders({ openai: [fail(429, { code: 'rate_limit_exceeded' })] });
  await callModel(messages, { task: 'resume-rewrite', fetchImpl });
  assert.equal(isProviderUsable('openai'), true);
});

test('when every provider is cooling down the router still tries instead of refusing', async () => {
  for (const name of ['openai', 'groq', 'mistral']) {
    const f = fakeProviders({ [name]: [fail(401, { code: 'invalid_api_key' })] });
    // eslint-disable-next-line no-await-in-loop
    await callModel(messages, { task: 'resume-rewrite', fetchImpl: f.fetchImpl, onlyProviders: [name] }).catch(() => {});
  }
  const { fetchImpl } = fakeProviders();
  const text = await callModel(messages, { task: 'resume-rewrite', fetchImpl });
  assert.match(text, /from/);
});
