import mongoose from 'mongoose';

export const INTERVIEW_TYPES = ['hr', 'technical', 'behavioral', 'situational', 'managerial', 'project', 'coding', 'system-design', 'mixed'];
// 'mixed' asks for a spread of easy/medium/hard questions in one session,
// rather than one uniform level — see DIFFICULTY_FOCUS in studioAi.js.
export const INTERVIEW_DIFFICULTIES = ['easy', 'medium', 'hard', 'mixed'];

/**
 * One document per saved Top-10 question set (kind: 'top10') or mock
 * interview (kind: 'mock'). A mock interview can start from a Top-10 set
 * (`sourceSetId`), which is how Phase 2 builds on Phase 1.
 */
const questionSchema = new mongoose.Schema(
  {
    number: Number,
    question: { type: String, maxlength: 1200 },
    category: { type: String, maxlength: 60 },
    difficulty: { type: String, maxlength: 20 },
    whyRelevant: { type: String, maxlength: 1500 },
    interviewerExpects: { type: String, maxlength: 1500 },
    sampleAnswer: { type: String, maxlength: 5000 },
    keyPoints: [{ type: String, maxlength: 400 }],
    followUp: { type: String, maxlength: 600 },
    /* Details in the sample answer the candidate must replace or confirm. */
    placeholders: [{ type: String, maxlength: 300 }],
    basedOn: { type: String, maxlength: 300 }, // which verified fact the question draws on
    edited: { type: Boolean, default: false },
  },
  { _id: false }
);

const feedbackSchema = new mongoose.Schema(
  {
    score: Number, // practice assessment 0–100, never an employer score
    scores: {
      relevance: Number, completeness: Number, clarity: Number, structure: Number,
      examples: Number, technicalAccuracy: Number, problemSolving: Number,
    },
    summary: { type: String, maxlength: 2000 },
    strengths: [{ type: String, maxlength: 400 }],
    missingPoints: [{ type: String, maxlength: 400 }],
    suggestions: [{ type: String, maxlength: 400 }],
    star: { situation: String, task: String, action: String, result: String },
    modelAnswer: { type: String, maxlength: 5000 },
    conceptsToReview: [{ type: String, maxlength: 300 }],
    engine: { type: String, enum: ['model', 'rules'] },
  },
  { _id: false }
);

const turnSchema = new mongoose.Schema(
  {
    question: { type: String, maxlength: 1200 },
    category: { type: String, maxlength: 60 },
    isFollowUp: { type: Boolean, default: false },
    answer: { type: String, maxlength: 8000 },
    answeredAt: Date,
    answerMode: { type: String, enum: ['text', 'voice'], default: 'text' },
    feedback: { type: feedbackSchema, default: undefined },
  },
  { _id: true }
);

const interviewSessionSchema = new mongoose.Schema(
  {
    user: { type: mongoose.Schema.Types.ObjectId, ref: 'User', required: true, index: true },
    kind: { type: String, enum: ['top10', 'mock'], required: true },
    title: { type: String, trim: true, maxlength: 160 },
    jobTitle: { type: String, trim: true, maxlength: 160 },
    company: { type: String, trim: true, maxlength: 160 },
    jobDescription: { type: String, maxlength: 20000 },
    versionId: { type: mongoose.Schema.Types.ObjectId },
    experienceLevel: { type: String, maxlength: 40 },
    interviewType: { type: String, enum: INTERVIEW_TYPES, default: 'mixed' },
    difficulty: { type: String, enum: INTERVIEW_DIFFICULTIES, default: 'medium' },
    engine: { type: String, enum: ['model', 'rules'] },

    /* top10 */
    questions: [questionSchema],

    /* mock */
    sourceSetId: { type: mongoose.Schema.Types.ObjectId },
    plannedQuestions: [{ question: String, category: String, isFollowUp: { type: Boolean, default: false }, _id: false }],
    questionCount: { type: Number, min: 1, max: 20 },
    durationMinutes: { type: Number, min: 5, max: 120 },
    turns: [turnSchema],
    currentIndex: { type: Number, default: 0 },
    followUpsAsked: { type: Number, default: 0 },
    status: { type: String, enum: ['in-progress', 'completed', 'abandoned'], default: 'in-progress' },
    startedAt: Date,
    completedAt: Date,
    report: {
      overallScore: Number,
      summary: String,
      strengths: [String],
      improvements: [String],
      topicsToRevise: [String],
      nextSteps: [String],
      engine: { type: String, enum: ['model', 'rules'] },
    },

    downloadCount: { type: Number, default: 0 },
    retainUntil: Date,
  },
  { timestamps: true }
);

interviewSessionSchema.index({ user: 1, kind: 1, updatedAt: -1 });
interviewSessionSchema.index({ retainUntil: 1 }, { expireAfterSeconds: 0 });
interviewSessionSchema.pre('save', function retain(next) {
  const until = new Date();
  until.setMonth(until.getMonth() + 24);
  this.retainUntil = until;
  next();
});

export const InterviewSession = mongoose.model('InterviewSession', interviewSessionSchema);