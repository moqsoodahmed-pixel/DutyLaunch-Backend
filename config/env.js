import dotenv from 'dotenv';

dotenv.config();

const required = ['MONGODB_URI', 'JWT_SECRET'];

const optionalDefaults = {
  NODE_ENV: 'development',
  PORT: '8080',
  CLIENT_URL: 'http://localhost:5173',
  JWT_EXPIRES_IN: '7d',
  JWT_COOKIE_NAME: 'dl_token',
  UPLOAD_DIR: 'uploads',
  MAX_UPLOAD_MB: '5',
  RATE_LIMIT_WINDOW_MIN: '15',
  RATE_LIMIT_MAX: '300',
  // AI provider for the career tools: 'router', 'gemini', 'openai', 'groq',
  // 'grok' or 'mistral'.
  //   router — multi-provider mode: each task goes to the best available
  //            provider (Gemini first for resume writing, then OpenAI, Groq,
  //            Grok, Mistral), with automatic fallback. Recommended.
  //   gemini — Google Gemini only (requires GEMINI_API_KEY)
  //   openai — OpenAI only (requires OPENAI_API_KEY)
  //   groq   — Groq only (AI_PROVIDER=groq forces single-provider Groq)
  //   grok   — xAI Grok only (requires GROK_API_KEY)
  //   mistral — Mistral only (requires MISTRAL_API_KEY)
  // When unset: OpenAI if OPENAI_API_KEY is set, otherwise router if any of
  // GEMINI_API_KEY / GROQ_API_KEY / MISTRAL_API_KEY / GROK_API_KEY is set.
  AI_PROVIDER: '',
  // Google Gemini via its native API (works with AIza and AQ. keys). Create a key at
  // https://aistudio.google.com/apikey . Models: gemini-2.5-flash (default),
  // gemini-2.5-flash-lite, gemini-3-flash-preview.
  GEMINI_MODEL: 'gemini-2.5-flash',
  GEMINI_MODEL_FALLBACKS: 'gemini-2.5-flash-lite,gemini-3-flash-preview',
  // OpenAI (ChatGPT). Used by the router (Chat Completions) and by
  // AI_PROVIDER=openai (Responses API).
  OPENAI_MODEL: 'gpt-4.1-mini',
  OPENAI_TIMEOUT_MS: '60000',
  // Groq — real Groq models (not OpenAI-proxy models).
  // llama-3.3-70b-versatile is the recommended high-quality free model.
  GROQ_MODEL: 'llama-3.3-70b-versatile',
  // Fallbacks tried in order only when the primary model returns "model not found".
  GROQ_MODEL_FALLBACKS: 'llama-3.1-70b-versatile,llama3-70b-8192,mixtral-8x7b-32768',
  GROQ_API_URL: 'https://api.groq.com/openai/v1/chat/completions',
  // xAI Grok — OpenAI-compatible endpoint.
  GROK_MODEL: 'grok-3-mini',
  GROK_MODEL_FALLBACKS: 'grok-2-1212',
  // Mistral — free "Experiment" key from https://console.mistral.ai.
  MISTRAL_MODEL: 'mistral-small-latest',
  // Per-request timeout for router calls (ms). Interview Q&A is a long answer.
  AI_TIMEOUT_MS: '90000',
  // Razorpay. Keys: RAZORPAY_KEY_ID, RAZORPAY_KEY_SECRET (required to take
  // payments) and RAZORPAY_WEBHOOK_SECRET (optional). No defaults on purpose.
  // GST_PRICING must match GST_PRICING in the frontend's src/data/legal.js:
  // 'exclusive' adds GST_RATE% at checkout, 'inclusive' charges the shown price.
  GST_PRICING: 'exclusive',
  GST_RATE: '18',
  // Price of each paid Resume Builder template, in rupees before GST.
  TEMPLATE_PRICE: '199',
};

/**
 * Validates the environment once at boot so the process fails loudly
 * instead of crashing later inside a request handler.
 */
export function loadEnv() {
  const missing = required.filter((key) => !process.env[key]);

  if (missing.length) {
    // eslint-disable-next-line no-console
    console.error(
      `\n[env] Missing required environment variables: ${missing.join(', ')}\n` +
        '      Copy .env.example to .env and fill in the values.\n'
    );
    process.exit(1);
  }

  for (const [key, value] of Object.entries(optionalDefaults)) {
    if (!process.env[key]) process.env[key] = value;
  }

  if (process.env.NODE_ENV === 'production' && process.env.JWT_SECRET.length < 32) {
    // eslint-disable-next-line no-console
    console.error('[env] JWT_SECRET must be at least 32 characters in production.');
    process.exit(1);
  }

  return {
    nodeEnv: process.env.NODE_ENV,
    isProd: process.env.NODE_ENV === 'production',
    port: Number(process.env.PORT),
    mongoUri: process.env.MONGODB_URI,
    clientUrls: (process.env.CLIENT_URL || '')
      .split(',')
      .map((u) => u.trim())
      .filter(Boolean),
    jwtSecret: process.env.JWT_SECRET,
    magicalApiKey: process.env.MAGICAL_API_KEY || null,
    jwtExpiresIn: process.env.JWT_EXPIRES_IN,
    jwtCookieName: process.env.JWT_COOKIE_NAME,
    uploadDir: process.env.UPLOAD_DIR,
    maxUploadBytes: Number(process.env.MAX_UPLOAD_MB) * 1024 * 1024,
    rateLimitWindowMs: Number(process.env.RATE_LIMIT_WINDOW_MIN) * 60 * 1000,
    rateLimitMax: Number(process.env.RATE_LIMIT_MAX),
    // Free-tier Groq key from https://console.groq.com/keys — the AI Career
    // Assistant endpoint checks this at request time (not at boot) so the
    // rest of the API keeps working even before it's configured.
    aiProvider: (process.env.AI_PROVIDER || '').trim().toLowerCase(),
    geminiApiKey: process.env.GEMINI_API_KEY || '',
    geminiModel: process.env.GEMINI_MODEL,
    openaiApiKey: process.env.OPENAI_API_KEY || '',
    openaiModel: process.env.OPENAI_MODEL,
    openaiTimeoutMs: Number(process.env.OPENAI_TIMEOUT_MS) || 60000,
    groqApiKey: process.env.GROQ_API_KEY || '',
    groqModel: process.env.GROQ_MODEL,
    groqModelFallbacks: (process.env.GROQ_MODEL_FALLBACKS || '')
      .split(',')
      .map((m) => m.trim())
      .filter(Boolean),
    groqApiUrl: process.env.GROQ_API_URL,
    grokApiKey: process.env.GROK_API_KEY || '',
    grokModel: process.env.GROK_MODEL,
    mistralApiKey: process.env.MISTRAL_API_KEY || '',
    mistralModel: process.env.MISTRAL_MODEL,
    razorpayKeyId: process.env.RAZORPAY_KEY_ID || '',
    razorpayConfigured: Boolean(process.env.RAZORPAY_KEY_ID && process.env.RAZORPAY_KEY_SECRET),
  };
}

export const env = loadEnv();