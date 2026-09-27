import mongoose from 'mongoose';

/**
 * Admin-editable scoring configuration (spec §37).
 *
 * A single active document overrides the defaults in
 * services/careerIntelligence/scoringConfig.js. Stored as Mixed and
 * deep-merged at read time, so an override can change one weight without
 * having to restate the whole tree — and so adding a new default in code
 * does not require a migration.
 *
 * Only one document may be active at a time; older ones are kept as an
 * audit trail of how the score has changed over time, which matters when
 * a candidate asks why their number moved.
 */

const scoringConfigSchema = new mongoose.Schema(
  {
    name: { type: String, required: true, trim: true, maxlength: 120 },
    notes: { type: String, trim: true, maxlength: 2000 },
    active: { type: Boolean, default: false, index: true },

    /* Partial override, deep-merged over DEFAULT_CONFIG. */
    config: { type: mongoose.Schema.Types.Mixed, default: () => ({}) },

    updatedBy: { type: mongoose.Schema.Types.ObjectId, ref: 'User' },
  },
  { timestamps: true }
);

/** Deactivates every other config when one is activated. */
scoringConfigSchema.pre('save', async function ensureSingleActive(next) {
  if (this.active && this.isModified('active')) {
    await this.constructor.updateMany({ _id: { $ne: this._id }, active: true }, { $set: { active: false } });
  }
  next();
});

/** Returns the active override, or null when defaults apply. */
scoringConfigSchema.statics.activeOverride = async function activeOverride() {
  const doc = await this.findOne({ active: true }).lean();
  return doc?.config || null;
};

export const ScoringConfig = mongoose.model('ScoringConfig', scoringConfigSchema);
