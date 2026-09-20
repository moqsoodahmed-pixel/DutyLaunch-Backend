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
    crossOriginResourcePolicy: { policy: 'same-site' },
    contentSecurityPolicy: env.isProd ? undefined : false,
  })
);

app.use(
  cors({
    origin(origin, callback) {
      // Same-origin/server-to-server requests arrive without an Origin header.
      if (!origin || env.clientUrls.includes(origin)) return callback(null, true);
      return callback(new Error('Not allowed by CORS'));
    },
    credentials: true,
    methods: ['GET', 'POST', 'PUT', 'PATCH', 'DELETE', 'OPTIONS'],
  })
);

app.use(express.json({ limit: '200kb' }));
app.use(express.urlencoded({ extended: true, limit: '200kb' }));
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
