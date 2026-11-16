import { asyncHandler } from '../utils/asyncHandler.js';
import { sendSuccess } from '../utils/apiResponse.js';
import { cookieOptions } from '../utils/token.js';
import { env } from '../config/env.js';
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
  const { user, token } = await loginWithGoogle(req.body);
  withCookie(res, token);
  sendSuccess(res, {
    message: 'Signed in with Google',
    data: { user: user.toPublic(), token },
  });
});
