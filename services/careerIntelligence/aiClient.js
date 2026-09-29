/**
 * AI provider boundary for the Career Intelligence engine.
 *
 * Every generative step in DutyLaunch (rewrites, cover letters, interview
 * questions, mock-interview feedback, career guidance) calls `callModel()`
 * and nothing else — no controller or React component talks to a model
 * directly. Scoring, parsing, keyword classification and integrity checks
 * stay deterministic and never call a model.
 *
 * Providers:
 *   openai — OpenAI Responses API (POST /v1/responses). Default when
 *            OPENAI_API_KEY is set.
 *   groq   — the existing Groq chat integration (aiAssistantService).
 *   (gemini is a planned provider; add it as another entry in PROVIDERS.)
 *
 * Every call either returns the model's text or throws. Callers catch the
 * throw and fall back to their rule-based path, so a model outage never
 * surfaces a half-generated result.
 */

import { logger } from '../../utils/logger.js';

const OPENAI_BASE = 'https://api.openai.com/v1';

/* Settings are read on every call so tests and hot config changes work. */
function settings() {
  const provider = (process.env.AI_PROVIDER || '').trim().toLowerCase();
  return {
    provider:
      provider ||
      (process.env.OPENAI_API_KEY ? 'openai' : process.env.GROQ_API_KEY ? 'groq' : ''),
    openaiKey: process.env.OPENAI_API_KEY || '',
    openaiModel: (process.env.OPENAI_MODEL || 'gpt-5.6-luna').trim(),
    timeoutMs: Number(process.env.OPENAI_TIMEOUT_MS) || 60000,
  };
}

/* ------------------------------------------------------------------ *
 * Usage tracking (in-process). Counts only — never prompt or reply text,
 * because both contain candidates' personal data.
 * ------------------------------------------------------------------ */
const usage = { calls: 0, failures: 0, inputTokens: 0, outputTokens: 0, byTask: {} };

function recordUsage(task, u = {}, ok = true) {
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
 * Public API
 * ------------------------------------------------------------------ */

let override = null; // test seam

/** Which provider will serve calls, or '' when none is configured. */
export function aiProvider() {
  const cfg = settings();
  if (cfg.provider === 'openai' && cfg.openaiKey) return 'openai';
  if (cfg.provider === 'groq' && process.env.GROQ_API_KEY) return 'groq';
  return '';
}

/** True when a model is configured in this environment. */
export function aiConfigured() {
  return Boolean(override) || Boolean(aiProvider());
}

/** Configuration status for health/admin screens. Never includes keys. */
export function aiStatus() {
  const cfg = settings();
  return {
    provider: aiProvider() || null,
    requestedProvider: cfg.provider || null,
    model: aiProvider() === 'openai' ? cfg.openaiModel : aiProvider() === 'groq' ? process.env.GROQ_MODEL || null : null,
    modelVerified: modelCheck ? modelCheck.ok && !modelCheck.unverified : null,
    modelProblem: modelCheck && !modelCheck.ok ? modelCheck.message : null,
  };
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
