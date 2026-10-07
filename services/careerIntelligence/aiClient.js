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
 *   router — free multi-provider mode. Each task goes to the provider that
 *            suits it best (Groq, Gemini or Mistral), with automatic
 *            fallback to the next provider when one is rate-limited or
 *            down. See TASK_ROUTES below. Default when no OpenAI key is set
 *            and at least one free key (GROQ/GEMINI/MISTRAL) is present.
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
  return Boolean(process.env.GROQ_API_KEY || process.env.GEMINI_API_KEY || process.env.MISTRAL_API_KEY);
}

function settings() {
  let provider = (process.env.AI_PROVIDER || '').trim().toLowerCase();
  if (provider === 'auto') provider = '';
  return {
    provider:
      provider ||
      (process.env.OPENAI_API_KEY ? 'openai' : anyFreeKey() ? 'router' : ''),
    openaiKey: process.env.OPENAI_API_KEY || '',
    openaiModel: (process.env.OPENAI_MODEL || 'gpt-5.6-luna').trim(),
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
 * Groq, Gemini and Mistral all accept OpenAI-style chat-completion
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
    models: () => listOf(process.env.GROQ_MODEL || 'openai/gpt-oss-120b', process.env.GROQ_MODEL_FALLBACKS),
    // Groq's free tier allows ~8,000 tokens per minute per model, so a
    // single request must stay well under that.
    maxTokensCap: () => Number(process.env.GROQ_MAX_OUTPUT_TOKENS) || 6000,
    reasoningEffort: (model) => (/gpt-oss/i.test(model) ? 'low' : null),
  },
  gemini: {
    label: 'Gemini',
    url: () => 'https://generativelanguage.googleapis.com/v1beta/openai/chat/completions',
    key: () => process.env.GEMINI_API_KEY || '',
    models: () => listOf(process.env.GEMINI_MODEL || 'gemini-flash-latest', process.env.GEMINI_MODEL_FALLBACKS || 'gemini-flash-lite-latest'),
    maxTokensCap: () => Number(process.env.GEMINI_MAX_OUTPUT_TOKENS) || 16000,
    // Gemini Flash "thinks" before answering and that counts against
    // max_tokens; keeping effort low leaves room for the actual answer.
    reasoningEffort: () => 'low',
  },
  mistral: {
    label: 'Mistral',
    url: () => 'https://api.mistral.ai/v1/chat/completions',
    key: () => process.env.MISTRAL_API_KEY || '',
    models: () => listOf(process.env.MISTRAL_MODEL || 'mistral-small-latest', process.env.MISTRAL_MODEL_FALLBACKS),
    maxTokensCap: () => Number(process.env.MISTRAL_MAX_OUTPUT_TOKENS) || 8000,
    reasoningEffort: () => null,
  },
};

/**
 * Which provider handles which task, in order of preference.
 *   Groq    — fast, follows strict rewrite rules: resume, LinkedIn, mock interview
 *   Mistral — natural, human-sounding prose: cover letters
 *   Gemini  — large outputs: top-10 interview Q&A, interview prep
 */
export const TASK_ROUTES = {
  // Step 4: Generate professional resume
  'resume-rewrite': ['groq', 'gemini', 'mistral'],
  'resume-summary': ['groq', 'gemini', 'mistral'],
  // Step 6: Generate cover letter
  'cover-letter-paragraph': ['mistral', 'groq', 'gemini'],
  'cover-letter': ['mistral', 'groq', 'gemini'],
  // Step 7: Top 10 interview Q&A
  'interview-top10': ['gemini', 'mistral', 'groq'],
  'interview-regenerate': ['gemini', 'groq', 'mistral'],
  'interview-prep': ['gemini', 'mistral', 'groq'],
  // Mock interview (Phase 2) — speed matters most
  'mock-plan': ['groq', 'gemini', 'mistral'],
  'mock-evaluate': ['groq', 'gemini', 'mistral'],
  'mock-report': ['groq', 'gemini', 'mistral'],
  // Career tools
  'linkedin-optimise': ['groq', 'gemini', 'mistral'],
  default: ['groq', 'gemini', 'mistral'],
};

function routeFor(task) {
  const chain = TASK_ROUTES[task] || TASK_ROUTES.default;
  return chain.filter((name) => ROUTER_PROVIDERS[name]?.key());
}

class ProviderError extends Error {
  constructor(message, { status = null, modelMissing = false } = {}) {
    super(message);
    this.status = status;
    this.modelMissing = modelMissing;
  }
}

const MODEL_MISSING = /model.*(not\s*found|does not exist|not exist|unknown|invalid|decommissioned|not supported)|no such model/i;

async function postChat(name, model, messages, options, fetchImpl, { withExtras }) {
  const p = ROUTER_PROVIDERS[name];
  const maxTokens = Math.min(options.maxOutputTokens || 4000, p.maxTokensCap());
  const body = { model, messages: messages.map((m) => ({ role: m.role, content: String(m.content) })), max_tokens: maxTokens, temperature: 0.4 };
  if (withExtras) {
    if (options.json) body.response_format = { type: 'json_object' };
    const effort = p.reasoningEffort(model);
    if (effort) body.reasoning_effort = effort;
  }

  let res;
  try {
    res = await fetchImpl(p.url(), {
      method: 'POST',
      headers: { Authorization: `Bearer ${p.key()}`, 'Content-Type': 'application/json' },
      body: JSON.stringify(body),
      signal: AbortSignal.timeout(Number(process.env.AI_TIMEOUT_MS) || 90000),
    });
  } catch (err) {
    throw new ProviderError(`${p.label} ${model}: ${err.name === 'TimeoutError' ? 'timed out' : 'network error'}`);
  }

  const json = await res.json().catch(() => null);
  if (!res.ok) {
    // Error bodies can echo the prompt (candidate data): keep only the
    // status and a short machine-readable error code in logs.
    const err = Array.isArray(json) ? json[0]?.error : json?.error;
    const code = err?.code || err?.type || err?.status || '';
    const detail = typeof err?.message === 'string' ? err.message.slice(0, 200) : '';
    throw new ProviderError(`${p.label} ${model}: HTTP ${res.status}${code ? ` ${code}` : ''}`, {
      status: res.status,
      modelMissing: res.status === 404 || ((res.status === 400 || res.status === 422) && MODEL_MISSING.test(detail)),
    });
  }

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
        if (withExtras && err.status === 400 && !err.modelMissing) continue;
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
  const chain = routeFor(task);
  if (!chain.length) throw new Error('No AI model is configured in this environment.');

  const failures = [];
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
      logger.warn(`[ai] ${task} failed on ${name}: ${err.message}`);
    }
  }
  throw new Error(`Every AI provider failed for ${task}: ${failures.join('; ')}`);
}

/* ------------------------------------------------------------------ *
 * Public API
 * ------------------------------------------------------------------ */

let override = null; // test seam

/** Which provider will serve calls, or '' when none is configured. */
export function aiProvider() {
  const cfg = settings();
  if (cfg.provider === 'openai' && cfg.openaiKey) return 'openai';
  if (cfg.provider === 'groq' && process.env.GROQ_API_KEY) return 'groq';
  if (cfg.provider === 'router' && anyFreeKey()) return 'router';
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
  const status = {
    provider: provider || null,
    requestedProvider: cfg.provider || null,
    model: provider === 'openai' ? cfg.openaiModel : provider === 'groq' ? process.env.GROQ_MODEL || null : null,
    modelVerified: modelCheck ? modelCheck.ok && !modelCheck.unverified : null,
    modelProblem: modelCheck && !modelCheck.ok ? modelCheck.message : null,
  };
  if (provider === 'router') {
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
