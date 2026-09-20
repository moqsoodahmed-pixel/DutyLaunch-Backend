import mongoose from 'mongoose';

export const APPLICATION_STATUS = [
  'submitted',
  'under-review',
  'shortlisted',
  'interviewing',
  'offered',
  'rejected',
  'withdrawn',
];

const applicationSchema = new mongoose.Schema(
  {
    job: { type: mongoose.Schema.Types.ObjectId, ref: 'Job', required: true, index: true },
    candidate: { type: mongoose.Schema.Types.ObjectId, ref: 'User', required: true, index: true },
    employer: { type: mongoose.Schema.Types.ObjectId, ref: 'User', index: true },
    resumeKey: { type: String, required: true, select: false },
    resumeName: { type: String, required: true },
    coverLetter: { type: String, maxlength: 4000 },
    status: { type: String, enum: APPLICATION_STATUS, default: 'submitted', index: true },
    statusHistory: [
      {
        status: { type: String, enum: APPLICATION_STATUS },
        note: { type: String, maxlength: 500 },
        changedAt: { type: Date, default: Date.now },
      },
    ],
    appliedAt: { type: Date, default: Date.now },
  },
  { timestamps: true }
);

applicationSchema.index({ job: 1, candidate: 1 }, { unique: true });

export const JobApplication = mongoose.model('JobApplication', applicationSchema);
