import dotenv from 'dotenv';

dotenv.config();

const required = ['MONGODB_URI', 'JWT_SECRET'];

const optionalDefaults = {
  NODE_ENV: 'development',
  PORT: '5000',
  CLIENT_URL: 'http://localhost:5173',
  JWT_EXPIRES_IN: '7d',
  JWT_COOKIE_NAME: 'dl_token',
  UPLOAD_DIR: 'uploads',
  MAX_UPLOAD_MB: '5',
  RATE_LIMIT_WINDOW_MIN: '15',
  RATE_LIMIT_MAX: '300',
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
    jwtExpiresIn: process.env.JWT_EXPIRES_IN,
    jwtCookieName: process.env.JWT_COOKIE_NAME,
    uploadDir: process.env.UPLOAD_DIR,
    maxUploadBytes: Number(process.env.MAX_UPLOAD_MB) * 1024 * 1024,
    rateLimitWindowMs: Number(process.env.RATE_LIMIT_WINDOW_MIN) * 60 * 1000,
    rateLimitMax: Number(process.env.RATE_LIMIT_MAX),
  };
}

export const env = loadEnv();
