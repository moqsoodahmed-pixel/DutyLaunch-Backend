import { User } from '../models/User.js';
import { ApiError } from '../utils/ApiError.js';
import { signToken } from '../utils/token.js';

export async function registerUser({ name, email, phone, password, role = 'user', company }) {
  const exists = await User.findOne({ email });
  if (exists) throw ApiError.conflict('An account with that email already exists');

  // Only `user` and `employer` can be self-registered; admins are seeded or promoted.
  const safeRole = role === 'employer' ? 'employer' : 'user';

  const user = await User.create({
    name,
    email,
    phone,
    password,
    role: safeRole,
    ...(safeRole === 'employer' && company ? { company } : {}),
  });

  return { user, token: signToken({ sub: user._id, role: user.role }) };
}

export async function loginUser({ email, password }) {
  const user = await User.findOne({ email }).select('+password');
  if (!user || !(await user.comparePassword(password))) {
    throw ApiError.unauthorized('Email or password is incorrect');
  }
  if (!user.isActive) throw ApiError.forbidden('This account has been deactivated');

  user.lastLoginAt = new Date();
  await user.save({ validateBeforeSave: false });

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
