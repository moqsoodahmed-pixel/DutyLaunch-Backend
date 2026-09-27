import mongoose from 'mongoose';

/**
 * The Master Career Profile (spec §3 / §43).
 *
 * One per candidate. It holds the complete verified career history and is
 * the source every targeted resume is derived from. Two invariants the
 * schema is shaped to protect:
 *
 *   1. `master` is never destroyed or trimmed when a targeted version is
 *      created — versions are separate subdocuments.
 *   2. `master._source` carries the original parsed document, so any
 *      version can be integrity-checked against what the candidate
 *      actually uploaded, however many rewrites later.
 *
 * Resume JSON is stored as Mixed rather than a mirrored Mongoose schema:
 * the contract is owned by resumeSchema.js and validated with Zod at the
 * controller boundary. Mirroring it here would give us two definitions to
 * keep in step, and the one that silently drifts is always the second.
 */

export const VERSION_KINDS = ['original', 'optimized', 'targeted', 'manual'];

const evidenceRecordSchema = new mongoose.Schema(
  {
    questionId: { type: String, trim: true },
    claim: { type: String, trim: true, maxlength: 400 },
    field: { type: String, trim: true, maxlength: 80 },
    value: { type: String, trim: true, maxlength: 600 },
    confirmed: { type: Boolean, default: false },
    confirmedAt: { type: Date },
  },
  { _id: false }
);

const changeEntrySchema = new mongoose.Schema(
  {
    id: String,
    action: { type: String, enum: ['accept', 'edit', 'reject'] },
    original: String,
    final: String,
    reason: String,
    keywordsAligned: [String],
  },
  { _id: false }
);

const versionSchema = new mongoose.Schema(
  {
    label: { type: String, required: true, trim: true, maxlength: 120 },
    kind: { type: String, enum: VERSION_KINDS, default: 'optimized' },
    resume: { type: mongoose.Schema.Types.Mixed, required: true },

    /* What this version was built for. */
    target: {
      jobTitle: { type: String, trim: true, maxlength: 160 },
      company: { type: String, trim: true, maxlength: 160 },
      country: { type: String, trim: true, maxlength: 60 },
      jobDescription: { type: String, maxlength: 40000 },
      job: { type: mongoose.Schema.Types.ObjectId, ref: 'Job' },
    },

    templateId: { type: String, trim: true, default: 'ats-modern' },

    /* Scores at the moment this version was saved, so version history
       shows movement rather than just a list of names. */
    health: {
      score: { type: Number, min: 0, max: 100 },
      categories: { type: mongoose.Schema.Types.Mixed },
    },
    match: {
      overall: { type: Number, min: 0, max: 100 },
      dimensions: { type: mongoose.Schema.Types.Mixed },
    },

    changelog: [changeEntrySchema],

    /* Result of the last integrity run against this version. Export is
       gated on this (spec §27, §33). */
    integrity: {
      passed: { type: Boolean, default: false },
      blocked: { type: Boolean, default: false },
      findingCount: { type: Number, default: 0 },
      checkedAt: Date,
    },

    exportedAt: Date,
    exportCount: { type: Number, default: 0 },
  },
  { timestamps: true }
);

const careerProfileSchema = new mongoose.Schema(
  {
    user: { type: mongoose.Schema.Types.ObjectId, ref: 'User', required: true, unique: true, index: true },

    /* The master resume. Complete, verified, never trimmed. */
    master: { type: mongoose.Schema.Types.Mixed, default: null },

    /* Derived analysis, refreshed on each run. Not a claim about the
       candidate — analysis only (spec §6). */
    profile: { type: mongoose.Schema.Types.Mixed, default: null },

    /* Everything the candidate has explicitly confirmed. This is what
       lets a generated metric be legitimate (spec §9, §13). */
    confirmedFacts: [evidenceRecordSchema],

    versions: [versionSchema],

    /* Career preferences (spec §3 of the platform spec). */
    preferences: {
      targetRoles: [{ type: String, trim: true, maxlength: 120 }],
      targetIndustries: [{ type: String, trim: true, maxlength: 120 }],
      preferredLocations: [{ type: String, trim: true, maxlength: 120 }],
      country: { type: String, trim: true, maxlength: 60, default: 'India' },
      careerGoals: { type: String, trim: true, maxlength: 2000 },
      learningGoals: { type: String, trim: true, maxlength: 2000 },
      openToRelocation: { type: Boolean, default: false },
    },

    /* Consent, recorded explicitly rather than assumed (spec §35, §39). */
    consent: {
      aiProcessing: { type: Boolean, default: false },
      aiProcessingAt: Date,
      analytics: { type: Boolean, default: false },
      analyticsAt: Date,
      /* Training consent defaults to false and is never implied by use
         of the product. */
      modelTraining: { type: Boolean, default: false },
      modelTrainingAt: Date,
    },

    /* Retention. A profile with no activity is deleted on this date
       (spec §39: automatic deletion policy). */
    retainUntil: { type: Date },

    lastAnalyzedAt: Date,
  },
  { timestamps: true }
);

careerProfileSchema.index({ 'versions.updatedAt': -1 });
careerProfileSchema.index({ retainUntil: 1 }, { expireAfterSeconds: 0 });

/** Rolls the retention window forward on every meaningful interaction. */
careerProfileSchema.methods.touchRetention = function touchRetention(months = 24) {
  const until = new Date();
  until.setMonth(until.getMonth() + months);
  this.retainUntil = until;
  return this;
};

/** The version a candidate is currently working on. */
careerProfileSchema.methods.latestVersion = function latestVersion() {
  if (!this.versions?.length) return null;
  return [...this.versions].sort((a, b) => b.updatedAt - a.updatedAt)[0];
};

careerProfileSchema.virtual('versionCount').get(function versionCount() {
  return this.versions?.length || 0;
});

careerProfileSchema.set('toJSON', { virtuals: true });

export const CareerProfile = mongoose.model('CareerProfile', careerProfileSchema);
