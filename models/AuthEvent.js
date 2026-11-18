import mongoose from 'mongoose';

/**
 * DPDP Act 2023 / security audit trail: who signed in or out, when, and
 * from where. Kept as its own append-only collection (not fields on User)
 * so the history survives account changes and can't be edited after the
 * fact by anything touching the user document.
 */
export const AUTH_EVENT_TYPES = ['register', 'login', 'logout', 'login_failed'];

const authEventSchema = new mongoose.Schema(
  {
    user: { type: mongoose.Schema.Types.ObjectId, ref: 'User', index: true },
    // Kept even when the login attempt failed or the account is unknown.
    email: { type: String, trim: true, lowercase: true },
    type: { type: String, enum: AUTH_EVENT_TYPES, required: true, index: true },
    method: { type: String, enum: ['password', 'google'], default: 'password' },
    ip: { type: String, trim: true },
    userAgent: { type: String, trim: true, maxlength: 300 },
    at: { type: Date, default: Date.now, index: true },
  },
  { timestamps: false }
);

authEventSchema.index({ user: 1, at: -1 });

export const AuthEvent = mongoose.model('AuthEvent', authEventSchema);
