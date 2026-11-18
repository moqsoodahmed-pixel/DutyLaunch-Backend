import { asyncHandler } from '../utils/asyncHandler.js';
import { sendSuccess } from '../utils/apiResponse.js';
import { cookieOptions } from '../utils/token.js';
import { env } from '../config/env.js';
import { AuthEvent } from '../models/AuthEvent.js';
import { logger } from '../utils/logger.js';
import {
  registerUser,
  loginUser,
  changePassword,
  requestPasswordReset,
  resetPasswordWithToken,
  loginWithGoogle,
} from '../services/authService.js';

function withCookie(res, token) {
  res.cookie(env.jwtCookieName, token, cookieOptions);
}

export const register = asyncHandler(async (req, res) => {
  const { user, token } = await registerUser(req);
  withCookie(res, token);
  sendSuccess(res, {
    statusCode: 201,
    message: 'Account created',
    data: { user: user.toPublic(), token },
  });
});

export const login = asyncHandler(async (req, res) => {
  const { user, token } = await loginUser(req);
  withCookie(res, token);
  sendSuccess(res, { message: 'Signed in', data: { user: user.toPublic(), token } });
});

// `optionalAuth` runs ahead of this route, so req.user is set when a valid
// session cookie/token is present — logout is audited the same as login.
export const logout = asyncHandler(async (req, res) => {
  res.clearCookie(env.jwtCookieName, { ...cookieOptions, maxAge: 0 });
  if (req.user) {
    AuthEvent.create({
      user: req.user._id,
      email: req.user.email,
      type: 'logout',
      ip: req.ip,
      userAgent: String(req.get?.('user-agent') || '').slice(0, 300),
    }).catch((err) => logger.warn(`[Auth] Failed to record logout audit event: ${err.message}`));
  }
  sendSuccess(res, { message: 'Signed out' });
});

export const me = asyncHandler(async (req, res) => {
  sendSuccess(res, { message: 'Current account', data: { user: req.user.toPublic() } });
});

export const updatePassword = asyncHandler(async (req, res) => {
  const token = await changePassword(req.user._id, req.body);
  withCookie(res, token);
  sendSuccess(res, { message: 'Password updated', data: { token } });
});

export const forgotPassword = asyncHandler(async (req, res) => {
  const result = await requestPasswordReset(req.body.email);
  sendSuccess(res, {
    message: result.message,
    data: result,
  });
});

export const resetPassword = asyncHandler(async (req, res) => {
  const { user, token } = await resetPasswordWithToken(req.body);
  withCookie(res, token);
  sendSuccess(res, {
    message: 'Password has been reset successfully. You are now signed in.',
    data: { user: user.toPublic(), token },
  });
});

export const googleAuth = asyncHandler(async (req, res) => {
  const { user, token } = await loginWithGoogle(req);
  withCookie(res, token);
  sendSuccess(res, {
    message: 'Signed in with Google',
    data: { user: user.toPublic(), token },
  });
});
