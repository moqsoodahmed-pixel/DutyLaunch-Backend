import { asyncHandler } from '../utils/asyncHandler.js';
import { sendSuccess } from '../utils/apiResponse.js';
import { cookieOptions } from '../utils/token.js';
import { env } from '../config/env.js';
import { registerUser, loginUser, changePassword } from '../services/authService.js';

function withCookie(res, token) {
  res.cookie(env.jwtCookieName, token, cookieOptions);
}

export const register = asyncHandler(async (req, res) => {
  const { user, token } = await registerUser(req.body);
  withCookie(res, token);
  sendSuccess(res, {
    statusCode: 201,
    message: 'Account created',
    data: { user: user.toPublic(), token },
  });
});

export const login = asyncHandler(async (req, res) => {
  const { user, token } = await loginUser(req.body);
  withCookie(res, token);
  sendSuccess(res, { message: 'Signed in', data: { user: user.toPublic(), token } });
});

export const logout = asyncHandler(async (req, res) => {
  res.clearCookie(env.jwtCookieName, { ...cookieOptions, maxAge: 0 });
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

/**
 * Password reset is intentionally acknowledge-only until an email provider is
 * configured (see README → "Not yet wired"). It never reveals whether an
 * account exists.
 */
export const forgotPassword = asyncHandler(async (req, res) => {
  sendSuccess(res, {
    message: 'If that email is registered, a reset link is on its way.',
    data: { emailDelivery: false },
  });
});
