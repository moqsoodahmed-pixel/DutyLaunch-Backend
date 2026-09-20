import mongoose from 'mongoose';

export const CONSULTATION_SERVICES = [
  'Career services',
  'CV & LinkedIn',
  'Interview preparation',
  'Higher education',
  'Professional courses',
  'UAE job seeker package',
  'Documentation & attestation',
  'Something else',
];

export const EXPERIENCE_BANDS = ['Student', '0-3 years', '4-7 years', '8-14 years', '15+ years'];

const consultationSchema = new mongoose.Schema(
  {
    name: { type: String, required: true, trim: true, maxlength: 80 },
    email: { type: String, required: true, lowercase: true, trim: true, index: true },
    phone: { type: String, required: true, trim: true, maxlength: 20 },
    service: { type: String, enum: CONSULTATION_SERVICES, required: true, index: true },
    experience: { type: String, enum: EXPERIENCE_BANDS, required: true },
    message: { type: String, maxlength: 2000 },
    preferredSlot: { type: String, maxlength: 80 },
    source: { type: String, default: 'website' },
    status: {
      type: String,
      enum: ['new', 'contacted', 'scheduled', 'converted', 'closed'],
      default: 'new',
      index: true,
    },
    internalNote: { type: String, maxlength: 1000 },
    handledBy: { type: mongoose.Schema.Types.ObjectId, ref: 'User' },
  },
  { timestamps: true }
);

consultationSchema.index({ createdAt: -1 });

export const Consultation = mongoose.model('Consultation', consultationSchema);
