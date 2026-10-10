/**
 * AI provider boundary for the Career Intelligence engine.
 *
 * Every generative step in DutyLaunch (rewrites, cover letters, interview
 * questions, mock-interview feedback, career guidance) calls `callModel()`
 * and nothing else — no controller or React component talks to a model
 * directly. Scoring, parsing, keyword classification and integrity checks
 * stay deterministic and never call a model.
 *
 * Providers (AI_PROVIDER):
 *   router — multi-provider mode. Each task goes to the provider that
 *            suits it best (Gemini first for resume writing, then OpenAI,
 *            Groq / Mistral / Grok as fallbacks), with automatic fallback
 *            to the next provider when one is rate-limited or down. See
 *            TASK_ROUTES below. Gemini is no longer used.
 *   openai — OpenAI Responses API (POST /v1/responses). Default when
 *            OPENAI_API_KEY is set.
 *   groq   — the original single-provider Groq integration
 *            (aiAssistantService). Kept for backwards compatibility.
 *
 * Every call either returns the model's text or throws. Callers catch the
 * throw and fall back to their rule-based path, so a model outage never
 * surfaces a half-generated result.
 */

import { logger } from '../../utils/logger.js';

const OPENAI_BASE = 'https://api.openai.com/v1';

/* Settings are read on every call so tests and hot config changes work. */
function anyFreeKey() {
  return Boolean(
    process.env.GEMINI_API_KEY ||
    process.env.OPENAI_API_KEY ||
    process.env.GROQ_API_KEY ||
    process.env.MISTRAL_API_KEY ||
    process.env.GROK_API_KEY,
  );
}

function settings() {
  let provider = (process.env.AI_PROVIDER || '').trim().toLowerCase();
  if (provider === 'auto') provider = '';
  return {
    provider:
      provider ||
      (process.env.OPENAI_API_KEY ? 'openai' : anyFreeKey() ? 'router' : ''),
    openaiKey: process.env.OPENAI_API_KEY || '',
    openaiModel: (process.env.OPENAI_MODEL || 'gpt-4.1-mini').trim(),
    timeoutMs: Number(process.env.OPENAI_TIMEOUT_MS) || 60000,
  };
}

/* ------------------------------------------------------------------ *
 * Usage tracking (in-process). Counts only — never prompt or reply text,
 * because both contain candidates' personal data.
 * ------------------------------------------------------------------ */
const usage = { calls: 0, failures: 0, inputTokens: 0, outputTokens: 0, byTask: {}, byProvider: {} };

function recordUsage(task, u = {}, ok = true, provider = null) {
  if (provider) {
    const p = (usage.byProvider[provider] = usage.byProvider[provider] || { calls: 0, failures: 0 });
    p.calls += 1;
    if (!ok) p.failures += 1;
  }
  usage.calls += 1;
  if (!ok) usage.failures += 1;
  usage.inputTokens += u.input_tokens || 0;
  usage.outputTokens += u.output_tokens || 0;
  const t = (usage.byTask[task] = usage.byTask[task] || { calls: 0, inputTokens: 0, outputTokens: 0 });
  t.calls += 1;
  t.inputTokens += u.input_tokens || 0;
  t.outputTokens += u.output_tokens || 0;
}

export function getAiUsage() {
  return JSON.parse(JSON.stringify(usage));
}

/* ------------------------------------------------------------------ *
 * OpenAI (Responses API)
 * ------------------------------------------------------------------ */

let modelCheck = null; // { model, ok, message } — cached per model id

async function verifyOpenAiModel(cfg, fetchImpl) {
  if (modelCheck && modelCheck.model === cfg.openaiModel) return modelCheck;
  let result;
  try {
    const res = await fetchImpl(`${OPENAI_BASE}/models/${encodeURIComponent(cfg.openaiModel)}`, {
      headers: { Authorization: `Bearer ${cfg.openaiKey}` },
      signal: AbortSignal.timeout(15000),
    });
    if (res.ok) result = { model: cfg.openaiModel, ok: true };
    else if (res.status === 401) result = { model: cfg.openaiModel, ok: false, message: 'OPENAI_API_KEY was rejected by OpenAI (401). Check the key.' };
    else if (res.status === 404)
      result = {
        model: cfg.openaiModel,
        ok: false,
        message: `OPENAI_MODEL "${cfg.openaiModel}" is not available to this OpenAI API project. Set OPENAI_MODEL to a model your project can access. No other model is substituted automatically.`,
      };
    else return { model: cfg.openaiModel, ok: true, unverified: true }; // transient — let the call itself decide
  } catch (err) {
    return { model: cfg.openaiModel, ok: true, unverified: true, message: err.message };
  }
  modelCheck = result;
  if (!result.ok) logger.error(`[ai] ${result.message}`);
  return result;
}

/** Pulls the text out of a Responses API result. */
export function extractResponseText(body) {
  if (!body) return '';
  if (typeof body.output_text === 'string' && body.output_text) return body.output_text;
  return (body.output || [])
    .filter((item) => item.type === 'message')
    .flatMap((item) => item.content || [])
    .filter((c) => c.type === 'output_text' && typeof c.text === 'string')
    .map((c) => c.text)
    .join('');
}

async function callOpenAi(messages, options, cfg, fetchImpl) {
  const check = await verifyOpenAiModel(cfg, fetchImpl);
  if (!check.ok) throw new Error(check.message);

  const body = {
    model: cfg.openaiModel,
    input: messages.map((m) => ({ role: m.role === 'system' ? 'developer' : m.role, content: String(m.content) })),
    max_output_tokens: options.maxOutputTokens || 4000,
  };
  // json_object mode requires the word "JSON" in the prompt; every JSON task says it.
  if (options.json) body.text = { format: { type: 'json_object' } };

  const task = options.task || 'general';
  const RETRYABLE = new Set([408, 409, 429, 500, 502, 503, 504]);

  for (let attempt = 0; attempt < 3; attempt += 1) {
    let res;
    try {
      res = await fetchImpl(`${OPENAI_BASE}/responses`, {
        method: 'POST',
        headers: { Authorization: `Bearer ${cfg.openaiKey}`, 'Content-Type': 'application/json' },
        body: JSON.stringify(body),
        signal: AbortSignal.timeout(cfg.timeoutMs),
      });
    } catch (err) {
      if (attempt < 2) {
        await new Promise((r) => setTimeout(r, 1000 * (attempt + 1)));
        continue;
      }
      recordUsage(task, {}, false);
      throw new Error(`OpenAI request failed: ${err.name === 'TimeoutError' ? 'timed out' : err.message}`);
    }

    const json = await res.json().catch(() => null);
    if (res.ok) {
      recordUsage(task, json?.usage);
      logger.info(`[ai] openai ${task}: ${json?.usage?.input_tokens || 0} in / ${json?.usage?.output_tokens || 0} out tokens`);
      if (json?.status === 'incomplete') {
        throw new Error(`OpenAI response incomplete (${json?.incomplete_details?.reason || 'unknown reason'}).`);
      }
      const text = extractResponseText(json);
      if (!text) throw new Error('OpenAI returned an empty response.');
      return text;
    }
    if (RETRYABLE.has(res.status) && attempt < 2) {
      await new Promise((r) => setTimeout(r, 1000 * (attempt + 1)));
      continue;
    }
    recordUsage(task, {}, false);
    // The error body can echo the request; log only status and error type.
    logger.error(`[ai] openai ${task} failed: HTTP ${res.status} ${json?.error?.type || ''}`);
    throw new Error(`OpenAI request failed with HTTP ${res.status}.`);
  }
  throw new Error('OpenAI request failed after retries.');
}

/* ------------------------------------------------------------------ *
 * Groq (existing integration)
 * ------------------------------------------------------------------ */

async function callGroqProvider(messages, options) {
  const mod = await import('../aiAssistantService.js');
  const reply = await mod.callGroq(messages);
  recordUsage(options.task || 'general');
  return reply;
}


/* ------------------------------------------------------------------ *
 * Router: free multi-provider mode (AI_PROVIDER=router)
 *
 * OpenAI, Groq, Mistral and Grok all accept OpenAI-style chat-completion
 * requests, so one function calls all three. Each task has a preferred
 * order of providers; providers without a key are skipped, and a provider
 * that is rate-limited, down or returns a cut-off answer hands the task to
 * the next one. If every provider fails, callModel throws and the caller
 * uses its rule-based fallback, exactly as before.
 * ------------------------------------------------------------------ */

const listOf = (...values) =>
  values
    .flatMap((v) => String(v || '').split(','))
    .map((v) => v.trim())
    .filter((v, i, arr) => v && arr.indexOf(v) === i);

export const ROUTER_PROVIDERS = {
  groq: {
    label: 'Groq',
    url: () => process.env.GROQ_API_URL || 'https://api.groq.com/openai/v1/chat/completions',
    key: () => process.env.GROQ_API_KEY || '',
    // Default to real Groq models (llama-3.3-70b-versatile is the top free model).
    // The env var GROQ_MODEL can override this; GROQ_MODEL_FALLBACKS are tried
    // in order only when the primary model returns "model does not exist".
    models: () => listOf(
      process.env.GROQ_MODEL || 'llama-3.3-70b-versatile',
      process.env.GROQ_MODEL_FALLBACKS || 'llama-3.1-70b-versatile,llama3-70b-8192,mixtral-8x7b-32768',
    ),
    // Groq's free tier allows ~8,000 tokens per minute per model, so a
    // single request must stay well under that.
    maxTokensCap: () => Number(process.env.GROQ_MAX_OUTPUT_TOKENS) || 6000,
    // reasoning_effort is only supported by the gpt-oss series; real Groq
    // models (llama, mixtral, qwen) do not support it and will reject 400.
    reasoningEffort: (model) => (/gpt-oss/i.test(model) ? 'low' : null),
  },
  // Google Gemini through Google's NATIVE generateContent API. The native API
  // accepts both the classic "AIza..." keys and the newer "AQ...." keys that
  // Google AI Studio now issues (the OpenAI-compatible endpoint can reject
  // "AQ." keys). Create a key at https://aistudio.google.com/apikey
  gemini: {
    label: 'Gemini',
    native: 'gemini',
    url: (model) => `${process.env.GEMINI_BASE_URL || 'https://generativelanguage.googleapis.com/v1beta'}/models/${encodeURIComponent(model)}:generateContent`,
    key: () => process.env.GEMINI_API_KEY || '',
    models: () => listOf(
      process.env.GEMINI_MODEL || 'gemini-2.5-flash',
      process.env.GEMINI_MODEL_FALLBACKS || 'gemini-2.5-flash-lite,gemini-3-flash-preview',
    ),
    maxTokensCap: () => Number(process.env.GEMINI_MAX_OUTPUT_TOKENS) || 16000,
    reasoningEffort: () => null,
    // Resume rewriting must stay faithful, not creative.
    temperature: () => 0.3,
  },

  // OpenAI (ChatGPT models) via the Chat Completions endpoint. First choice for
  // resume rewriting, ATS keyword alignment and summaries because it follows
  // the strict "no invented facts" rules best. OPENAI_MODEL picks the model
  // (default gpt-4.1-mini); OPENAI_MODEL_FALLBACKS are tried in order only
  // when the primary model is missing from the project.
  openai: {
    label: 'OpenAI',
    url: () => `${process.env.OPENAI_BASE_URL || OPENAI_BASE}/chat/completions`,
    key: () => process.env.OPENAI_API_KEY || '',
    models: () => listOf(
      process.env.OPENAI_MODEL || 'gpt-4.1-mini',
      process.env.OPENAI_MODEL_FALLBACKS,
    ),
    maxTokensCap: () => Number(process.env.OPENAI_MAX_OUTPUT_TOKENS) || 16000,
    reasoningEffort: () => null,
    // gpt-5 / o-series reject `max_tokens` and any non-default temperature.
    tokenParam: () => 'max_completion_tokens',
    temperature: (model) => (/^(o\d|gpt-5)/i.test(model) ? null : 0.3),
  },
  mistral: {
    label: 'Mistral',
    url: () => 'https://api.mistral.ai/v1/chat/completions',
    key: () => process.env.MISTRAL_API_KEY || '',
    models: () => listOf(process.env.MISTRAL_MODEL || 'mistral-small-latest', process.env.MISTRAL_MODEL_FALLBACKS),
    maxTokensCap: () => Number(process.env.MISTRAL_MAX_OUTPUT_TOKENS) || 8000,
    reasoningEffort: () => null,
  },
  // xAI Grok — OpenAI-compatible endpoint.
  // Activate with AI_PROVIDER=router and GROK_API_KEY set, or with
  // AI_PROVIDER=grok for single-provider mode (uses onlyProviders).
  grok: {
    label: 'Grok (xAI)',
    url: () => 'https://api.x.ai/v1/chat/completions',
    key: () => process.env.GROK_API_KEY || '',
    models: () => listOf(process.env.GROK_MODEL || 'grok-3-mini', process.env.GROK_MODEL_FALLBACKS || 'grok-2-1212'),
    maxTokensCap: () => Number(process.env.GROK_MAX_OUTPUT_TOKENS) || 8000,
    reasoningEffort: () => null,
  },
};

/**
 * Which provider handles which task, in order of preference.
 *   Gemini  — Google: resume rewriting, ATS keywords, summaries,
 *             job descriptions, LinkedIn, interview content
 *   OpenAI  — ChatGPT models: next in line when configured and funded
 *   Groq    — fast; first choice for the live mock interview, fallback elsewhere
 *   Mistral — natural prose; first choice for cover letters
 *   Grok    — xAI; used as a fallback when GROK_API_KEY is configured
 *
 * Only providers whose key() is non-empty are included at runtime (see
 * routeFor()). Providers without a key are silently skipped.
 */
export const TASK_ROUTES = {
  // Resume writing / ATS optimisation
  'resume-rewrite': ['gemini', 'openai', 'groq', 'grok', 'mistral'],
  'resume-summary': ['gemini', 'openai', 'groq', 'grok', 'mistral'],
  'builder-suggestions': ['gemini', 'openai', 'groq', 'grok', 'mistral'],
  'job-description': ['gemini', 'openai', 'groq', 'grok', 'mistral'],
  // Cover letters (Mistral produces more natural prose)
  'cover-letter-paragraph': ['mistral', 'gemini', 'openai', 'groq', 'grok'],
  'cover-letter': ['mistral', 'gemini', 'openai', 'groq', 'grok'],
  // Interview Q&A (large structured outputs)
  'interview-top10': ['gemini', 'openai', 'grok', 'mistral', 'groq'],
  'interview-regenerate': ['gemini', 'openai', 'groq', 'grok', 'mistral'],
  'interview-prep': ['gemini', 'openai', 'mistral', 'grok', 'groq'],
  // Mock interview — speed matters most
  'mock-plan': ['groq', 'gemini', 'openai', 'grok', 'mistral'],
  'mock-evaluate': ['groq', 'gemini', 'openai', 'grok', 'mistral'],
  'mock-report': ['groq', 'gemini', 'openai', 'grok', 'mistral'],
  // Career tools
  'linkedin-optimise': ['gemini', 'openai', 'groq', 'grok', 'mistral'],
  // General AI assistant chat
  'assistant-chat': ['groq', 'gemini', 'openai', 'grok', 'mistral'],
  default: ['gemini', 'openai', 'groq', 'grok', 'mistral'],
};

/* ------------------------------------------------------------------ *
 * Provider cooldown. A provider that says "no credit left" or "bad key"
 * will keep saying so, so it is skipped for a while instead of costing every
 * request a failed call (and, with several parallel requests, a lot of waiting).
 * Rate limits are different — they clear within a minute and are retried.
 * ------------------------------------------------------------------ */

const QUOTA_CODES = new Set([
  'insufficient_quota',
  'credit_balance_exhausted',
  'billing_not_active',
  'billing_hard_limit_reached',
  'account_deactivated',
]);

const cooldowns = new Map(); // provider -> { until, reason }

const cooldownMs = () => Number(process.env.PROVIDER_COOLDOWN_MS) || 5 * 60 * 1000;

function isCoolingDown(name) {
  const c = cooldowns.get(name);
  if (!c) return false;
  if (Date.now() >= c.until) {
    cooldowns.delete(name);
    return false;
  }
  return true;
}

/* A provider that just timed out, was unreachable or answered "service
   unavailable" is not broken — it is slow right now. Instead of making every
   following request wait for it again (up to a minute each), it is tried LAST
   for a couple of minutes ("soft" cooldown), so one slow provider costs one
   wait, not one wait per request. */
const slowCooldownMs = () => Number(process.env.SLOW_PROVIDER_COOLDOWN_MS) || 2 * 60 * 1000;
const isSlowFailure = (err) => !err.quota && (/timed out|network error/i.test(err.message) || (err.status >= 500 && err.status < 600));

function markSlow(name, err) {
  if (isCoolingDown(name)) return;
  cooldowns.set(name, { until: Date.now() + slowCooldownMs(), reason: err.message, soft: true });
  logger.warn(`[ai] ${name} looks slow or overloaded; other providers go first for ${Math.round(slowCooldownMs() / 1000)}s`);
}

/** Forgets every cooldown (used by tests). */
export function resetProviderHealth() {
  cooldowns.clear();
}

function disableProvider(name, reason) {
  if (isCoolingDown(name)) return;
  cooldowns.set(name, { until: Date.now() + cooldownMs(), reason });
  let hint = '';
  if (name === 'openai' && /credit/.test(reason)) {
    hint = ' Add credit at platform.openai.com/settings/organization/billing (API credit is separate from a ChatGPT subscription).';
  } else if (name === 'gemini' && /key was rejected/.test(reason)) {
    hint = ' Create a new key at https://aistudio.google.com/apikey and update GEMINI_API_KEY in .env.';
  } else if (/key was rejected/.test(reason)) {
    hint = ` Check the ${name.toUpperCase()}_API_KEY value in .env (create a new key if needed).`;
  }
  logger.error(`[ai] ${name} disabled for ${Math.round(cooldownMs() / 60000)} min: ${reason}.${hint}`);
}

/** True when a provider has a key and is not in cooldown. */
export function isProviderUsable(name) {
  return Boolean(ROUTER_PROVIDERS[name]?.key()) && (!isCoolingDown(name) || Boolean(cooldowns.get(name)?.soft));
}

/**
 * How many AI requests may safely run at the same time. Paid or generous
 * providers handle a few in parallel; the free tiers of the fallbacks allow only
 * a few requests/tokens per minute, so a burst just makes them all fail.
 */
export function aiParallelism() {
  if (isProviderUsable('openai')) return 3;
  if (isProviderUsable('gemini')) return 2;
  return 1;
}

/** Test seam. */
export function __resetProviderCooldowns() {
  cooldowns.clear();
}

function routeFor(task, only = null) {
  const chain = only || TASK_ROUTES[task] || TASK_ROUTES.default;
  const configured = chain.filter((name) => ROUTER_PROVIDERS[name]?.key());
  const usable = configured.filter((name) => !isCoolingDown(name));
  // Slow (not broken) providers go last, as a final resort.
  const slow = configured.filter((name) => isCoolingDown(name) && cooldowns.get(name)?.soft);
  // If everything is cooling down (say, credit was just added), try anyway
  // rather than refusing to work for the rest of the cooldown.
  return usable.length ? [...usable, ...slow] : configured;
}

/* Rewriting is short work (a few hundred tokens). If a provider has not
   answered within ~40 s it is stuck or overloaded: move on to the next one
   instead of waiting 90 s. Long-output tasks (interview Q&A…) keep the long
   limit. Override with options.timeoutMs or AI_TIMEOUT_MS. */
const FAST_TASK_TIMEOUT_MS = {
  'resume-rewrite': 40000,
  'resume-summary': 30000,
  'job-description': 40000,
  'builder-suggestions': 30000,
  'cover-letter-paragraph': 40000,
  'cover-letter': 50000,
};
const requestTimeoutMs = (options = {}) =>
  Number(options.timeoutMs) || FAST_TASK_TIMEOUT_MS[options.task] || Number(process.env.AI_TIMEOUT_MS) || 90000;

class ProviderError extends Error {
  constructor(message, { status = null, modelMissing = false, retryAfterMs = null, quota = false } = {}) {
    super(message);
    this.quota = quota;
    this.status = status;
    this.modelMissing = modelMissing;
    this.retryAfterMs = retryAfterMs;
  }
}

/* Free plans limit requests/tokens PER MINUTE. When a provider says "too
   many requests", it usually also says how long to wait. */
const RATE_LIMITED = new Set([413, 429]);
const MAX_WAIT_MS = 25000;

/** "7", "7.5s", "1m2.3s", "250ms" → milliseconds (null if unreadable). */
export function parseWait(value) {
  const v = String(value || '').trim();
  if (!v) return null;
  if (/^\d+(\.\d+)?$/.test(v)) return Math.round(Number(v) * 1000);
  let ms = 0;
  let matched = false;
  for (const [, n, unit] of v.matchAll(/(\d+(?:\.\d+)?)(ms|s|m|h)/g)) {
    matched = true;
    ms += Number(n) * { ms: 1, s: 1000, m: 60000, h: 3600000 }[unit];
  }
  return matched ? Math.round(ms) : null;
}

function retryAfterFrom(res, body) {
  const h = (k) => (res.headers?.get ? res.headers.get(k) : null);
  const fromHeader = parseWait(h('retry-after')) ?? parseWait(h('x-ratelimit-reset-tokens')) ?? parseWait(h('x-ratelimit-reset-requests'));
  if (fromHeader != null) return fromHeader;
  // Some providers put it in the error body: details[].retryDelay = "27s"
  const details = (Array.isArray(body) ? body[0]?.error : body?.error)?.details || [];
  for (const d of details) {
    const w = parseWait(d?.retryDelay);
    if (w != null) return w;
  }
  return null;
}

const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

const MODEL_MISSING = /model.*(not\s*found|does not exist|not exist|unknown|invalid|decommissioned|not supported)|no such model/i;

/** Builds a ProviderError from a failed HTTP response. Never includes the response text. */
function providerErrorFrom(p, model, res, json) {
  // Error bodies can echo the prompt (candidate data): keep only the
  // status and a short machine-readable error code in logs.
  const err = Array.isArray(json) ? json[0]?.error : json?.error;
  // OpenAI-style errors carry a string code; Google's carry a numeric code and a string status.
  const code = (typeof err?.code === 'string' && err.code) || err?.type || err?.status || err?.code || '';
  const detail = typeof err?.message === 'string' ? err.message.slice(0, 200) : '';
  const extra = JSON.stringify(err?.details || []);
  // Google answers an invalid key with HTTP 400 "API key not valid", and a
  // used-up DAILY quota with 429 + a PerDay quota id. Waiting fixes neither.
  const badKey = /api key not valid|api_key_invalid|api key expired|permission_denied/i.test(`${detail} ${extra}`);
  const dailyQuota = res.status === 429 && /perday|per day/i.test(`${detail} ${extra}`);
  return new ProviderError(`${p.label} ${model}: HTTP ${res.status}${code ? ` ${code}` : ''}`, {
    status: res.status,
    retryAfterMs: RATE_LIMITED.has(res.status) ? retryAfterFrom(res, json) : null,
    // OpenAI answers 429 "insufficient_quota" when billing/credit is exhausted.
    // Waiting will not help, so it must not trigger the rate-limit retry.
    quota: QUOTA_CODES.has(code) || res.status === 401 || res.status === 403 || badKey || dailyQuota,
    modelMissing: res.status === 404 || ((res.status === 400 || res.status === 422) && MODEL_MISSING.test(detail)),
  });
}

/**
 * Gemini's native API. The key goes in the x-goog-api-key header (never in the
 * URL, so it cannot leak into logs). System messages become systemInstruction.
 */
async function postGemini(name, model, messages, options, fetchImpl, { withExtras }) {
  const p = ROUTER_PROVIDERS[name];
  const maxTokens = Math.min(options.maxOutputTokens || 4000, p.maxTokensCap());
  const system = messages.filter((m) => m.role === 'system').map((m) => String(m.content)).join('\n\n');
  const contents = messages
    .filter((m) => m.role !== 'system')
    .map((m) => ({ role: m.role === 'assistant' ? 'model' : 'user', parts: [{ text: String(m.content) }] }));

  const generationConfig = { maxOutputTokens: maxTokens };
  const temperature = p.temperature ? p.temperature(model) : 0.4;
  if (temperature != null) generationConfig.temperature = temperature;
  if (withExtras) {
    if (options.json) generationConfig.responseMimeType = 'application/json';
    // Gemini 2.5 Flash models can skip "thinking" (budget 0), which keeps the
    // whole token budget for the answer. Pro/3 models cannot, so they are left alone.
    if (/2\.5-flash/.test(model)) generationConfig.thinkingConfig = { thinkingBudget: 0 };
    // Gemini 3.x always thinks first, which can take a minute on a rewrite.
    // GEMINI_THINKING_LEVEL (e.g. "low" or "minimal") shortens it. Optional:
    // test it with curl first, a model that does not know the level answers 400.
    else if (process.env.GEMINI_THINKING_LEVEL) generationConfig.thinkingConfig = { thinkingLevel: process.env.GEMINI_THINKING_LEVEL.trim().toLowerCase() };
  }

  const body = { contents, generationConfig };
  if (system) body.systemInstruction = { parts: [{ text: system }] };

  let res;
  try {
    res = await fetchImpl(p.url(model), {
      method: 'POST',
      headers: { 'x-goog-api-key': p.key(), 'Content-Type': 'application/json' },
      body: JSON.stringify(body),
      signal: AbortSignal.timeout(requestTimeoutMs(options)),
    });
  } catch (err) {
    throw new ProviderError(`${p.label} ${model}: ${err.name === 'TimeoutError' ? 'timed out' : 'network error'}`);
  }

  const json = await res.json().catch(() => null);
  if (!res.ok) throw providerErrorFrom(p, model, res, json);

  if (json?.promptFeedback?.blockReason) throw new ProviderError(`${p.label} ${model}: request blocked (${json.promptFeedback.blockReason})`);
  const cand = json?.candidates?.[0];
  const text = (cand?.content?.parts || []).map((part) => (typeof part?.text === 'string' ? part.text : '')).join('').trim();
  if (!text) throw new ProviderError(`${p.label} ${model}: empty response`);
  if (cand.finishReason === 'MAX_TOKENS' && options.json) {
    throw new ProviderError(`${p.label} ${model}: answer was cut off (max tokens)`);
  }
  const u = json?.usageMetadata || {};
  return { text, usage: { prompt_tokens: u.promptTokenCount, completion_tokens: u.candidatesTokenCount } };
}

async function postChat(name, model, messages, options, fetchImpl, { withExtras }) {
  const p = ROUTER_PROVIDERS[name];
  if (p.native === 'gemini') return postGemini(name, model, messages, options, fetchImpl, { withExtras });
  const maxTokens = Math.min(options.maxOutputTokens || 4000, p.maxTokensCap());
  const body = { model, messages: messages.map((m) => ({ role: m.role, content: String(m.content) })) };
  body[p.tokenParam ? p.tokenParam(model) : 'max_tokens'] = maxTokens;
  const temperature = p.temperature ? p.temperature(model) : 0.4;
  if (temperature != null) body.temperature = temperature;
  if (withExtras) {
    if (options.json) body.response_format = { type: 'json_object' };
    const effort = p.reasoningEffort(model);
    if (effort) body.reasoning_effort = effort;
  }

  let res;
  try {
    res = await fetchImpl(p.url(model), {
      method: 'POST',
      headers: { Authorization: `Bearer ${p.key()}`, 'Content-Type': 'application/json' },
      body: JSON.stringify(body),
      signal: AbortSignal.timeout(requestTimeoutMs(options)),
    });
  } catch (err) {
    throw new ProviderError(`${p.label} ${model}: ${err.name === 'TimeoutError' ? 'timed out' : 'network error'}`);
  }

  const json = await res.json().catch(() => null);
  if (!res.ok) throw providerErrorFrom(p, model, res, json);

  const choice = json?.choices?.[0];
  const text = typeof choice?.message?.content === 'string' ? choice.message.content.trim() : '';
  if (!text) throw new ProviderError(`${p.label} ${model}: empty response`);
  if (choice.finish_reason === 'length' && options.json) {
    throw new ProviderError(`${p.label} ${model}: answer was cut off (max tokens)`);
  }
  return { text, usage: json?.usage || {} };
}

async function callRouterProvider(name, messages, options, fetchImpl) {
  const p = ROUTER_PROVIDERS[name];
  let lastErr = null;
  for (const model of p.models()) {
    for (const withExtras of [true, false]) {
      try {
        // eslint-disable-next-line no-await-in-loop
        const { text, usage: u } = await postChat(name, model, messages, options, fetchImpl, { withExtras });
        return { text, model, usage: u };
      } catch (err) {
        lastErr = err;
        // A 400 can mean the model rejected JSON mode or reasoning_effort:
        // retry once with a plain request before giving up on this model.
        // (Not when the 400 is a rejected API key: no request shape fixes that.)
        if (withExtras && err.status === 400 && !err.modelMissing && !err.quota) continue;
        break;
      }
    }
    // Only a missing/retired model moves on to the next model id; rate
    // limits, bad keys and outages hand the task to the next provider.
    if (!lastErr?.modelMissing) throw lastErr;
  }
  throw lastErr || new ProviderError(`${p.label}: no model configured`);
}

async function callRouted(messages, options, fetchImpl) {
  const task = options.task || 'general';
  const chain = routeFor(task, options.onlyProviders);
  if (!chain.length) throw new Error('No AI model is configured in this environment.');

  const failures = [];
  const errors = [];
  for (const name of chain) {
    try {
      // eslint-disable-next-line no-await-in-loop
      const { text, model, usage: u } = await callRouterProvider(name, messages, options, fetchImpl);
      const input = u.prompt_tokens || u.input_tokens || 0;
      const output = u.completion_tokens || u.output_tokens || 0;
      recordUsage(task, { input_tokens: input, output_tokens: output }, true, name);
      logger.info(`[ai] ${name} (${model}) ${task}: ${input} in / ${output} out tokens${failures.length ? ` after ${failures.length} fallback(s)` : ''}`);
      return text;
    } catch (err) {
      recordUsage(task, {}, false, name);
      failures.push(err.message);
      errors.push(err);
      if (isSlowFailure(err)) markSlow(name, err);
      if (err.quota) disableProvider(name, err.status === 401 || err.status === 403 || err.status === 400 ? 'the API key was rejected' : /PerDay|daily/i.test(err.message) ? 'the daily free quota is used up' : 'no API credit left (billing)');
      logger.warn(`[ai] ${task} failed on ${name}: ${err.message}`);
    }
  }
  // Every provider was busy because of per-minute free limits: wait as long
  // as they asked (at most 25 s) and try the whole chain once more.
  const limited = errors.filter((e) => RATE_LIMITED.has(e.status) && !e.quota);
  if (limited.length && !options._retried) {
    const asked = Math.max(...limited.map((e) => e.retryAfterMs ?? 0));
    const wait = Math.min(MAX_WAIT_MS, Math.max(asked || 0, options._retryBaseMs ?? 8000));
    logger.warn(`[ai] ${task}: all providers rate-limited, retrying in ${Math.round(wait / 1000)}s`);
    await sleep(wait);
    return callRouted(messages, { ...options, _retried: true }, fetchImpl);
  }
  const err = new Error(`Every AI provider failed for ${task}: ${failures.join('; ')}`);
  err.rateLimited = limited.length > 0 && limited.length === errors.length;
  throw err;
}

/* ------------------------------------------------------------------ *
 * Public API
 * ------------------------------------------------------------------ */

let override = null; // test seam

/** Which provider will serve calls, or '' when none is configured. */
export function aiProvider() {
  const cfg = settings();
  if (cfg.provider === 'openai' && cfg.openaiKey) return 'openai';
  if (cfg.provider === 'gemini' && process.env.GEMINI_API_KEY) return 'gemini';
  if (cfg.provider === 'groq' && process.env.GROQ_API_KEY) return 'groq';
  if (cfg.provider === 'grok' && process.env.GROK_API_KEY) return 'grok';
  if (cfg.provider === 'mistral' && process.env.MISTRAL_API_KEY) return 'mistral';
  if (cfg.provider === 'router' && anyFreeKey()) return 'router';
  // Auto-select: prefer router when multiple keys are set for better reliability.
  if (!cfg.provider) {
    if (cfg.openaiKey) return 'openai';
    if (anyFreeKey()) return 'router';
  }
  return '';
}

/** True when a model is configured in this environment. */
export function aiConfigured() {
  return Boolean(override) || Boolean(aiProvider());
}

/** Configuration status for health/admin screens. Never includes keys. */
export function aiStatus() {
  const cfg = settings();
  const provider = aiProvider();
  const singleProviderModel = {
    openai: cfg.openaiModel,
    gemini: process.env.GEMINI_MODEL || null,
    groq: process.env.GROQ_MODEL || null,
    grok: process.env.GROK_MODEL || null,
    mistral: process.env.MISTRAL_MODEL || null,
  };
  const status = {
    provider: provider || null,
    requestedProvider: cfg.provider || null,
    model: provider && provider !== 'router' ? (singleProviderModel[provider] || null) : null,
    modelVerified: modelCheck ? modelCheck.ok && !modelCheck.unverified : null,
    modelProblem: modelCheck && !modelCheck.ok ? modelCheck.message : null,
  };
  if (provider === 'router') {
    status.unavailable = Object.fromEntries([...cooldowns].filter(([n]) => isCoolingDown(n)).map(([n, c]) => [n, c.reason]));
    status.providers = Object.fromEntries(
      Object.entries(ROUTER_PROVIDERS).map(([name, p]) => [name, { configured: Boolean(p.key()), model: p.models()[0] || null }])
    );
    status.routes = Object.fromEntries(Object.keys(TASK_ROUTES).map((task) => [task, routeFor(task)]));
  }
  return status;
}

/**
 * Calls the configured model. Throws on any failure (including "no model
 * configured") so callers fall back deterministically.
 *
 * options: { json?: boolean, task?: string, maxOutputTokens?: number, fetchImpl? }
 */
export async function callModel(messages, options = {}) {
  if (override) return override(messages, options);
  const provider = aiProvider();
  if (!provider) throw new Error('No AI model is configured in this environment.');
  if (provider === 'openai') return callOpenAi(messages, options, settings(), options.fetchImpl || fetch);
  if (provider === 'router') return callRouted(messages, options, options.fetchImpl || fetch);
  // Single-provider modes: route through the same router so each task gets
  // its full token budget and JSON mode.
  if (provider === 'gemini') return callRouted(messages, { ...options, onlyProviders: ['gemini'] }, options.fetchImpl || fetch);
  if (provider === 'groq') return callRouted(messages, { ...options, onlyProviders: ['groq'] }, options.fetchImpl || fetch);
  if (provider === 'grok') return callRouted(messages, { ...options, onlyProviders: ['grok'] }, options.fetchImpl || fetch);
  if (provider === 'mistral') return callRouted(messages, { ...options, onlyProviders: ['mistral'] }, options.fetchImpl || fetch);
  return callGroqProvider(messages, options);
}

/** Test seam: inject a fake model without touching the network. */
export function __setModelClient(fn) {
  override = fn;
}

/** Test seam: forget the cached model verification. */
export function __resetModelCheck() {
  modelCheck = null;
}