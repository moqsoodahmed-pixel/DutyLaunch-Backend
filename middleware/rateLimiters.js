import rateLimit from 'express-rate-limit';
import { env } from '../config/env.js';

const json = (message) => (req, res) =>
  res.status(429).json({ success: false, message, errors: [] });

export const apiLimiter = rateLimit({
  windowMs: env.rateLimitWindowMs,
  max: env.rateLimitMax,
  standardHeaders: true,
  legacyHeaders: false,
  handler: json('Too many requests. Try again in a few minutes.'),
});

export const authLimiter = rateLimit({
  windowMs: 15 * 60 * 1000,
  max: 10,
  skipSuccessfulRequests: true,
  standardHeaders: true,
  legacyHeaders: false,
  handler: json('Too many sign-in attempts. Try again in 15 minutes.'),
});

export const resumeLimiter = rateLimit({
  windowMs: 15 * 60 * 1000,
  max: 20,
  standardHeaders: true,
  legacyHeaders: false,
  handler: json('You have run several resume checks already. Try again in a few minutes.'),
});

export const aiLimiter = rateLimit({
  windowMs: 60 * 1000,
  max: 15,
  standardHeaders: true,
  legacyHeaders: false,
  handler: json('You are sending messages too quickly. Wait a moment and try again.'),
});

export const formLimiter = rateLimit({
  windowMs: 60 * 60 * 1000,
  max: 12,
  standardHeaders: true,
  legacyHeaders: false,
  handler: json('You have sent several enquiries already. Try again later or email us directly.'),
});
