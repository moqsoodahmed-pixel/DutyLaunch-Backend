import mongoose from 'mongoose';
import bcrypt from 'bcryptjs';

// 'institute' = a college / training company that manages a partner profile.
export const ROLES = ['user', 'employer', 'institute', 'admin'];

const profileSchema = new mongoose.Schema(
  {
    headline: { type: String, trim: true, maxlength: 120 },
    location: { type: String, trim: true, maxlength: 120 },
    experienceYears: { type: Number, min: 0, max: 60, default: 0 },
    currentRole: { type: String, trim: true, maxlength: 120 },
    skills: [{ type: String, trim: true, maxlength: 40 }],
    linkedinUrl: { type: String, trim: true },
    resumeKey: { type: String, select: false }, // storage key, never a public URL
    resumeName: { type: String },
    resumeUpdatedAt: { type: Date },
  },
  { _id: false }
);

const companySchema = new mongoose.Schema(
  {
    name: { type: String, trim: true, maxlength: 120 },
    website: { type: String, trim: true },
    industry: { type: String, trim: true, maxlength: 80 },
    size: { type: String, enum: ['1-10', '11-50', '51-200', '201-1000', '1000+'] },
    about: { type: String, trim: true, maxlength: 1200 },
    verified: { type: Boolean, default: false },
  },
  { _id: false }
);

const userSchema = new mongoose.Schema(
  {
    name: { type: String, required: [true, 'Name is required'], trim: true, maxlength: 80 },
    email: {
      type: String,
      required: [true, 'Email is required'],
      unique: true,
      lowercase: true,
      trim: true,
      match: [/^[^\s@]+@[^\s@]+\.[^\s@]+$/, 'Enter a valid email address'],
    },
    phone: { type: String, trim: true, maxlength: 20 },
    password: { type: String, required: true, minlength: 8, select: false },
    passwordChangedAt: { type: Date, select: false },
    role: { type: String, enum: ROLES, default: 'user', index: true },
    profile: { type: profileSchema, default: () => ({}) },
    company: { type: companySchema, default: undefined },
    savedJobs: [{ type: mongoose.Schema.Types.ObjectId, ref: 'Job' }],
    isActive: { type: Boolean, default: true },
    lastLoginAt: { type: Date },
  },
  { timestamps: true }
);

userSchema.index({ createdAt: -1 });

userSchema.pre('save', async function hashPassword(next) {
  if (!this.isModified('password')) return next();
  this.password = await bcrypt.hash(this.password, 12);
  if (!this.isNew) this.passwordChangedAt = new Date(Date.now() - 1000);
  return next();
});

userSchema.methods.comparePassword = function comparePassword(candidate) {
  return bcrypt.compare(candidate, this.password);
};

userSchema.methods.hasPasswordChangedAfter = function hasPasswordChangedAfter(iatSeconds) {
  if (!this.passwordChangedAt) return false;
  return Math.floor(this.passwordChangedAt.getTime() / 1000) > iatSeconds;
};

userSchema.methods.toPublic = function toPublic() {
  return {
    id: this._id,
    name: this.name,
    email: this.email,
    phone: this.phone,
    role: this.role,
    profile: {
      headline: this.profile?.headline,
      location: this.profile?.location,
      experienceYears: this.profile?.experienceYears ?? 0,
      currentRole: this.profile?.currentRole,
      skills: this.profile?.skills ?? [],
      linkedinUrl: this.profile?.linkedinUrl,
      resumeName: this.profile?.resumeName,
      resumeUpdatedAt: this.profile?.resumeUpdatedAt,
    },
    company: this.company,
    savedJobs: this.savedJobs,
    createdAt: this.createdAt,
  };
};

export const User = mongoose.model('User', userSchema);
