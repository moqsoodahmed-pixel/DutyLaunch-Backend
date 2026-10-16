import mongoose from 'mongoose';
import slugify from 'slugify';

export const EDUCATION_LEVELS = ['Undergraduate', 'Postgraduate', 'Diploma', 'Doctorate', 'Certificate'];
export const PROGRAM_DELIVERY_FORMATS = ['Online', 'Offline', 'Hybrid', 'Self-paced'];
export const PROGRAM_APPROVAL_STATUS = ['draft', 'pending', 'changes_requested', 'approved', 'rejected'];

const programSchema = new mongoose.Schema(
  {
    institution: { type: mongoose.Schema.Types.ObjectId, ref: 'PartnerInstitute', index: true },
    title: { type: String, required: true, trim: true, maxlength: 160 },
    slug: { type: String, unique: true, index: true },
    level: {
      type: String,
      enum: EDUCATION_LEVELS,
      required: true,
      index: true,
    },
    qualification: { type: String, trim: true, maxlength: 120 },
    field: { type: String, required: true, trim: true, index: true },
    destinations: [{ type: String, trim: true }],
    summary: { type: String, required: true, maxlength: 280 },
    description: { type: String, required: true },
    intakes: [{ type: String, trim: true }],
    duration: { type: String, trim: true },
    deliveryFormat: { type: String, enum: PROGRAM_DELIVERY_FORMATS, default: 'Online' },
    fee: { type: Number, min: 0, default: 0 },
    currency: { type: String, default: 'INR' },
    image: { type: String, trim: true },
    syllabusUrl: { type: String, trim: true },
    syllabusName: { type: String, trim: true },
    enrolmentInstructions: { type: String, trim: true, maxlength: 1200 },
    entryRequirements: [{ type: String, trim: true }],
    supportIncluded: [{ type: String, trim: true }],
    outcomes: [{ type: String, trim: true }],
    startDate: { type: Date },
    endDate: { type: Date },
    approvalStatus: { type: String, enum: PROGRAM_APPROVAL_STATUS, default: 'approved', index: true },
    adminFeedback: { type: String, trim: true, maxlength: 1000 },
    reviewedAt: { type: Date },
    reviewedBy: { type: mongoose.Schema.Types.ObjectId, ref: 'User' },
    status: { type: String, enum: ['draft', 'published', 'archived'], default: 'draft', index: true },
  },
  { timestamps: true }
);

programSchema.pre('validate', function setSlug(next) {
  if (this.isModified('title') || !this.slug) {
    this.slug = slugify(this.title, { lower: true, strict: true });
  }
  next();
});

export const EducationProgram = mongoose.model('EducationProgram', programSchema);
