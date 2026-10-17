import express from 'express';
import helmet from 'helmet';
import cors from 'cors';
import cookieParser from 'cookie-parser';
import compression from 'compression';
import morgan from 'morgan';

import { env } from './config/env.js';
import apiRoutes from './routes/index.js';
import { apiLimiter } from './middleware/rateLimiters.js';
import { mongoSanitize } from './middleware/sanitize.js';
import { errorHandler, notFoundHandler } from './middleware/errorHandler.js';

const app = express();

// Behind Render/Railway/Nginx the client IP arrives in X-Forwarded-For.
app.set('trust proxy', 1);

app.use(
  helmet({
    crossOriginResourcePolicy: { policy: 'cross-origin' },
    hsts: { maxAge: 31536000, includeSubDomains: true, preload: true },
    frameguard: { action: 'sameorigin' },
    contentSecurityPolicy: env.isProd ? undefined : false,
  })
);

const DEFAULT_ORIGINS = [
  'https://dutylaunch.com',
  'https://www.dutylaunch.com',
  'http://localhost:5173',
  'http://127.0.0.1:5173',
  'http://localhost:5174',
  'http://127.0.0.1:5174',
];

app.use(
  cors({
    origin(origin, callback) {
      // Same-origin/server-to-server requests arrive without an Origin header.
      if (!origin) return callback(null, true);
      const allowed = [...env.clientUrls, ...DEFAULT_ORIGINS];
      const match =
        allowed.includes(origin) ||
        allowed.some((u) => u && origin === u.replace(/\/$/, '')) ||
        /^https:\/\/[a-z0-9-]+\.pages\.dev$/.test(origin) ||
        /^https?:\/\/(localhost|127\.0\.0\.1)(:\d+)?$/.test(origin);
      if (match) return callback(null, true);
      return callback(new Error('Not allowed by CORS'));
    },
    credentials: true,
    methods: ['GET', 'POST', 'PUT', 'PATCH', 'DELETE', 'OPTIONS'],
  })
);

app.use(
  express.json({
    // Career Intelligence routes accept an inline resume JSON in the body
    // (POST /api/career/optimize, /analyze, /export, etc.). A stripped resume
    // (rawText cleared) is typically 20–80 KB; keeping 500 KB gives plenty of
    // headroom without opening the door to arbitrarily large payloads.
    limit: '500kb',
    // Razorpay webhooks are signed over the exact bytes received, so keep a
    // copy of the raw body for that one route.
    verify: (req, res, buf) => {
      if (req.originalUrl?.startsWith('/api/payments/webhook')) req.rawBody = buf;
    },
  })
);
app.use(express.urlencoded({ extended: true, limit: '500kb' }));
app.use(cookieParser());
app.use(compression());
app.use(mongoSanitize);

if (!env.isProd) app.use(morgan('dev'));

app.use('/api', apiLimiter, apiRoutes);

// NOTE: server/uploads is deliberately NOT served by express.static.
// Files are streamed through authorised controllers only.

app.use(notFoundHandler);
app.use(errorHandler);

export default app;
