import crypto from 'node:crypto';
import { User } from '../models/User.js';
import { AuthEvent } from '../models/AuthEvent.js';
import { ApiError } from '../utils/ApiError.js';
import { signToken } from '../utils/token.js';
import { consentRecord, isConsentGiven, CONSENT_REQUIRED_MESSAGE } from '../utils/consent.js';
import { emailService } from './emailService.js';
import { logger, maskEmail } from '../utils/logger.js';

/** Append-only audit trail (DPDP Act 2023 + security). Never blocks the auth flow. */
async function recordAuthEvent(req, { user, email, type, method = 'password' }) {
  try {
    await AuthEvent.create({
      user: user?._id,
      email: (email || user?.email || '').toLowerCase(),
      type,
      method,
      ip: req?.ip,
      userAgent: String(req?.get?.('user-agent') || '').slice(0, 300),
    });
  } catch (err) {
    logger.warn(`[Auth] Failed to record ${type} audit event: ${err.message}`);
  }
}

export async function registerUser(req) {
  const { name, email, phone, password, role = 'user', company } = req.body;
  const exists = await User.findOne({ email });
  if (exists) throw ApiError.conflict('An account with that email already exists');

  // `user`, `employer` and `institute` can be self-registered; admins are
  // seeded or promoted. An institute account can only edit its own partner
  // profile, and that profile stays hidden until an admin approves it.
  const normalizedRole = role === 'partner' ? 'institute' : role;
  const safeRole = ['employer', 'institute'].includes(normalizedRole) ? normalizedRole : 'user';

  const user = await User.create({
    name,
    email,
    phone: phone || undefined,
    password,
    role: safeRole,
    ...(safeRole === 'employer' && company ? { company } : {}),
    // DPDP Act 2023: the checkbox is UI-only unless the server also records
    // and enforces it — `consent` is required by registerSchema.
    registrationConsent: consentRecord(req),
  });

  await recordAuthEvent(req, { user, type: 'register' });

  return { user, token: signToken({ sub: user._id, role: user.role }) };
}

export async function loginUser(req) {
  const { email, password } = req.body;
  const user = await User.findOne({ email }).select('+password');
  if (!user || !(await user.comparePassword(password))) {
    await recordAuthEvent(req, { email, type: 'login_failed' });
    throw ApiError.unauthorized('Email or password is incorrect');
  }
  if (!user.isActive) throw ApiError.forbidden('This account has been deactivated');

  user.lastLoginAt = new Date();
  await user.save({ validateBeforeSave: false });
  await recordAuthEvent(req, { user, type: 'login' });

  return { user, token: signToken({ sub: user._id, role: user.role }) };
}

export async function changePassword(userId, { currentPassword, newPassword }) {
  const user = await User.findById(userId).select('+password');
  if (!user) throw ApiError.notFound('Account not found');
  if (!(await user.comparePassword(currentPassword))) {
    throw ApiError.badRequest('Your current password is incorrect', [
      { field: 'currentPassword', message: 'Incorrect password' },
    ]);
  }
  user.password = newPassword;
  await user.save();
  return signToken({ sub: user._id, role: user.role });
}

export async function requestPasswordReset(email) {
  const normalizedEmail = (email || '').trim().toLowerCase();
  const user = await User.findOne({ email: normalizedEmail });

  // Security: always return identical success message to prevent user enumeration
  if (!user || !user.isActive) {
    logger.info(`[Auth] Password reset requested for non-existent or inactive email: ${maskEmail(normalizedEmail)}`);
    return {
      message: 'If that email is registered, instructions to reset your password have been sent.',
      emailDelivery: false,
    };
  }

  const resetToken = user.createPasswordResetToken();
  await user.save({ validateBeforeSave: false });

  const clientUrl = (process.env.CLIENT_URL || 'http://localhost:5173').split(',')[0].trim();
  const resetUrl = `${clientUrl}/reset-password?token=${resetToken}&email=${encodeURIComponent(user.email)}`;

  // Never log the reset URL itself — it carries the raw, unhashed token and
  // is a bearer credential for a one-hour account takeover window.
  logger.info(`[Auth] Generated password reset link for ${maskEmail(user.email)}`);

  const emailResult = await emailService.sendPasswordResetEmail({ user, resetUrl });

  return {
    message: 'If that email is registered, instructions to reset your password have been sent.',
    emailDelivery: Boolean(emailResult?.delivered),
    // Exposed in non-production environments to allow instant testing and verification
    ...(process.env.NODE_ENV !== 'production' ? { resetUrl, resetToken } : {}),
  };
}

export async function resetPasswordWithToken({ token, newPassword }) {
  if (!token || !newPassword) {
    throw ApiError.badRequest('Reset token and new password are required');
  }

  const hashedToken = crypto.createHash('sha256').update(token.trim()).digest('hex');
  const user = await User.findOne({
    passwordResetToken: hashedToken,
    passwordResetExpires: { $gt: new Date() },
  }).select('+password');

  if (!user) {
    throw ApiError.badRequest('Password reset link is invalid or has expired. Please request a new one.');
  }

  user.password = newPassword;
  user.passwordResetToken = undefined;
  user.passwordResetExpires = undefined;
  await user.save();

  logger.info(`[Auth] Password successfully reset for user ${maskEmail(user.email)}`);

  return {
    user,
    token: signToken({ sub: user._id, role: user.role }),
  };
}

export async function loginWithGoogle(req) {
  const { credential, email, name, avatar, googleId } = req.body;
  let gEmail = email;
  let gName = name;
  let gAvatar = avatar;
  let gId = googleId;

  // If a Google JWT credential was passed, decode payload
  if (credential) {
    try {
      const parts = credential.split('.');
      if (parts.length === 3) {
        const payload = JSON.parse(Buffer.from(parts[1], 'base64url').toString('utf8'));
        gEmail = payload.email || gEmail;
        gName = payload.name || gName;
        gAvatar = payload.picture || gAvatar;
        gId = payload.sub || gId;
      }
    } catch (err) {
      logger.warn(`[Auth] Failed to decode Google credential JWT: ${err.message}`);
    }
  }

  if (!gEmail) {
    throw ApiError.badRequest('Google authentication did not provide an email address');
  }

  const normalizedEmail = gEmail.trim().toLowerCase();
  let user = await User.findOne({
    $or: [{ email: normalizedEmail }, ...(gId ? [{ googleId: gId }] : [])],
  }).select('+password');

  if (user) {
    if (!user.isActive) throw ApiError.forbidden('This account has been deactivated');
    if (gId && !user.googleId) user.googleId = gId;
    if (gAvatar && !user.avatar) user.avatar = gAvatar;
    user.lastLoginAt = new Date();
    await user.save({ validateBeforeSave: false });
    await recordAuthEvent(req, { user, type: 'login', method: 'google' });
  } else {
    // No account exists for this Google identity — DPDP Act 2023 requires
    // a Data Principal's explicit, specific consent before we process their
    // personal data, and that has to come from the person themselves, not
    // be assumed because a Google popup succeeded. Block account creation
    // here and hand the frontend back the Google profile it already fetched
    // (name/email/avatar/googleId) so it can show a real consent screen and
    // retry this same call with consent:true, without reopening the OAuth
    // popup.
    if (!isConsentGiven(req.body?.consent)) {
      throw ApiError.preconditionRequired(
        CONSENT_REQUIRED_MESSAGE,
        [{ field: 'consent', message: CONSENT_REQUIRED_MESSAGE }],
        {
          requiresConsent: true,
          profile: { email: normalizedEmail, name: gName || '', avatar: gAvatar || null, googleId: gId || null },
        }
      );
    }

    const randomPassword = crypto.randomBytes(24).toString('hex') + 'Aa1!';
    user = await User.create({
      name: gName || 'Candidate',
      email: normalizedEmail,
      googleId: gId || undefined,
      avatar: gAvatar || undefined,
      password: randomPassword,
      role: 'user',
      registrationConsent: consentRecord(req),
    });
    logger.info(`[Auth] New account created via Google Sign-In for ${maskEmail(normalizedEmail)}`);
    await recordAuthEvent(req, { user, type: 'register', method: 'google' });
  }

  return {
    user,
    token: signToken({ sub: user._id, role: user.role }),
  };
}
