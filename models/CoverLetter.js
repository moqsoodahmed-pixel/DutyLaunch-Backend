import mongoose from 'mongoose';

export const COVER_LETTER_TONES = ['professional', 'confident', 'concise', 'entry-level', 'experienced', 'career-change'];

/**
 * A saved cover letter. `generated` keeps what the model (or rules
 * fallback) produced; `content` is what the candidate edited and uses.
 * Owned by exactly one user — every query filters on `user`.
 */
const coverLetterSchema = new mongoose.Schema(
  {
    user: { type: mongoose.Schema.Types.ObjectId, ref: 'User', required: true, index: true },
    versionId: { type: mongoose.Schema.Types.ObjectId }, // CareerProfile.versions._id
    title: { type: String, trim: true, maxlength: 160 },
    company: { type: String, trim: true, maxlength: 160 },
    jobTitle: { type: String, trim: true, maxlength: 160 },
    jobDescription: { type: String, maxlength: 20000 },
    tone: { type: String, enum: COVER_LETTER_TONES, default: 'professional' },
    generated: { type: String, maxlength: 12000 },
    content: { type: String, maxlength: 12000 },
    engine: { type: String, enum: ['model', 'rules'], default: 'model' },
    downloadCount: { type: Number, default: 0 },
    retainUntil: Date,
  },
  { timestamps: true }
);

coverLetterSchema.index({ user: 1, updatedAt: -1 });
coverLetterSchema.index({ retainUntil: 1 }, { expireAfterSeconds: 0 });
coverLetterSchema.pre('save', function retain(next) {
  const until = new Date();
  until.setMonth(until.getMonth() + 24);
  this.retainUntil = until;
  next();
});

export const CoverLetter = mongoose.model('CoverLetter', coverLetterSchema);
