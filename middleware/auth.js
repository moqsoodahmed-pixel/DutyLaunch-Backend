import { User } from '../models/User.js';
import { ApiError } from '../utils/ApiError.js';
import { asyncHandler } from '../utils/asyncHandler.js';
import { verifyToken } from '../utils/token.js';
import { env } from '../config/env.js';

function extractToken(req) {
  const header = req.headers.authorization;
  if (header?.startsWith('Bearer ')) return header.slice(7);
  return req.cookies?.[env.jwtCookieName] || null;
}

/** Requires a valid session. */
export const protect = asyncHandler(async (req, res, next) => {
  const token = extractToken(req);
  if (!token) throw ApiError.unauthorized();

  const decoded = verifyToken(token);
  const user = await User.findById(decoded.sub).select('+passwordChangedAt');

  if (!user || !user.isActive) throw ApiError.unauthorized('This account is no longer active');
  if (user.hasPasswordChangedAfter(decoded.iat)) {
    throw ApiError.unauthorized('Your password changed. Sign in again.');
  }

  req.user = user;
  next();
});

/** Attaches the user when a token is present, but never blocks the request. */
export const optionalAuth = asyncHandler(async (req, res, next) => {
  const token = extractToken(req);
  if (!token) return next();
  try {
    const decoded = verifyToken(token);
    const user = await User.findById(decoded.sub);
    if (user?.isActive) req.user = user;
  } catch {
    /* ignore — the route is public */
  }
  return next();
});

/** Role gate. Usage: restrictTo('admin'), restrictTo('admin', 'employer') */
export const restrictTo =
  (...roles) =>
  (req, res, next) => {
    if (!req.user) return next(ApiError.unauthorized());
    if (!roles.includes(req.user.role)) return next(ApiError.forbidden());
    return next();
  };
