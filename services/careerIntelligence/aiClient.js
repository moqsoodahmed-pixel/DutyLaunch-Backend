/**
 * Lazy AI client for the Career Intelligence engine.
 *
 * The engine is deterministic by design: parsing, scoring, keyword
 * classification, integrity checking and template rendering all run
 * without a model. Only the generative steps (rewriting, LinkedIn,
 * cover letter, interview prep) call out to an LLM, and each of those
 * has a rule-based fallback.
 *
 * Importing the chat service directly at module load would drag the
 * whole application environment — Mongo models, env validation — into
 * every consumer of the engine, including tests and CLI tooling. So the
 * import happens on first use instead, and a failure to load it is
 * treated exactly like a model outage: the caller falls back to its
 * deterministic path rather than erroring.
 */

let cached = null;

async function loadClient() {
  if (cached) return cached;
  const mod = await import('../aiAssistantService.js');
  cached = mod.callGroq;
  return cached;
}

/** True when a model is configured and reachable in this environment. */
export function aiConfigured() {
  return Boolean(process.env.GROQ_API_KEY);
}

/**
 * Calls the chat model. Throws on any failure (including "no model
 * configured") so callers can fall back deterministically — they should
 * never surface a half-generated result.
 */
export async function callModel(messages, options = {}) {
  if (!aiConfigured()) {
    throw new Error('No AI model is configured in this environment.');
  }
  const call = await loadClient();
  return call(messages, options);
}

/** Test seam: lets a test inject a fake model without touching the network. */
export function __setModelClient(fn) {
  cached = fn;
}
