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
  // AI provider for the career tools: 'router', 'openai' or 'groq'.
  //   router — free multi-provider mode: each task goes to Groq, Gemini or
  //            Mistral (see TASK_ROUTES in services/careerIntelligence/
  //            aiClient.js), with automatic fallback between them.
  // When unset: OpenAI if OPENAI_API_KEY is set, otherwise router if any of
  // GROQ_API_KEY / GEMINI_API_KEY / MISTRAL_API_KEY is set.
  AI_PROVIDER: '',
  // OpenAI Responses API. The model id is verified against the API project
  // on first use; an unavailable id fails loudly and is never substituted.
  OPENAI_MODEL: 'gpt-5.6-luna',
  OPENAI_TIMEOUT_MS: '60000',
  GROQ_MODEL: 'openai/gpt-oss-120b',
  // Comma-separated backups tried, in order, only if GROQ_MODEL itself comes
  // back as "model does not exist" (Groq's lineup changes over time — these
  // were confirmed available via GET /v1/models on this project's key).
  // Skips whisper-*/orpheus-* (speech models) and *-guard-* (moderation
  // classifiers, not general chat models).
  GROQ_MODEL_FALLBACKS: 'openai/gpt-oss-20b,qwen/qwen3.8-27b',
  GROQ_API_URL: 'https://api.groq.com/openai/v1/chat/completions',
  // Router mode only. Free key from https://aistudio.google.com/api-keys.
  // The "-latest" aliases always point at Google's current Flash models.
  GEMINI_MODEL: 'gemini-flash-latest',
  GEMINI_MODEL_FALLBACKS: 'gemini-flash-lite-latest',
  // Router mode only. Free "Experiment" key from https://console.mistral.ai.
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
    geminiApiKey: process.env.GEMINI_API_KEY || '',
    geminiModel: process.env.GEMINI_MODEL,
    mistralApiKey: process.env.MISTRAL_API_KEY || '',
    mistralModel: process.env.MISTRAL_MODEL,
    razorpayKeyId: process.env.RAZORPAY_KEY_ID || '',
    razorpayConfigured: Boolean(process.env.RAZORPAY_KEY_ID && process.env.RAZORPAY_KEY_SECRET),
  };
}

export const env = loadEnv();