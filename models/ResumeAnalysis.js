import mongoose from 'mongoose';

const categorySchema = new mongoose.Schema(
  {
    contact: { type: Number, min: 0, max: 100, default: 0 },
    formatting: { type: Number, min: 0, max: 100, default: 0 },
    keywords: { type: Number, min: 0, max: 100, default: 0 },
    experience: { type: Number, min: 0, max: 100, default: 0 },
    skills: { type: Number, min: 0, max: 100, default: 0 },
    education: { type: Number, min: 0, max: 100, default: 0 },
    achievements: { type: Number, min: 0, max: 100, default: 0 },
  },
  { _id: false }
);

const resumeAnalysisSchema = new mongoose.Schema(
  {
    user: { type: mongoose.Schema.Types.ObjectId, ref: 'User', index: true },
    fileName: { type: String, required: true },
    fileType: { type: String, required: true },
    score: { type: Number, required: true, min: 0, max: 100 },
    categoryScores: { type: categorySchema, default: () => ({}) },
    strengths: [{ type: String }],
    weaknesses: [{ type: String }],
    recommendations: [{ type: String }],
  },
  { timestamps: true }
);

resumeAnalysisSchema.index({ user: 1, createdAt: -1 });

export const ResumeAnalysis = mongoose.model('ResumeAnalysis', resumeAnalysisSchema);
