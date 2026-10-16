import mongoose from 'mongoose';
import slugify from 'slugify';

export const COURSE_LEVELS = ['Beginner', 'Intermediate', 'Advanced'];
export const COURSE_TRACKS = ['professional', 'upskill', 'certification'];
export const COURSE_DELIVERY_FORMATS = ['Online', 'Offline', 'Hybrid', 'Self-paced'];
export const COURSE_APPROVAL_STATUS = ['draft', 'pending', 'changes_requested', 'approved', 'rejected'];

const courseSchema = new mongoose.Schema(
  {
    institution: { type: mongoose.Schema.Types.ObjectId, ref: 'PartnerInstitute', index: true },
    title: { type: String, required: true, trim: true, maxlength: 140 },
    slug: { type: String, unique: true, index: true },
    summary: { type: String, required: true, maxlength: 280 },
    description: { type: String, required: true },
    category: { type: mongoose.Schema.Types.ObjectId, ref: 'CourseCategory', index: true },
    track: { type: String, enum: COURSE_TRACKS, default: 'professional', index: true },
    outcomes: [{ type: String, trim: true }],
    modules: [
      {
        title: { type: String, trim: true },
        detail: { type: String, trim: true },
      },
    ],
    isFree: { type: Boolean, default: false },
    price: { type: Number, min: 0 },
    currency: { type: String, default: 'INR' },
    priceOnRequest: { type: Boolean, default: false },
    duration: { type: String, trim: true },
    level: { type: String, enum: COURSE_LEVELS, default: 'Beginner' },
    mode: { type: String, enum: ['Online', 'Live online', 'Blended'], default: 'Live online' },
    deliveryFormat: { type: String, enum: COURSE_DELIVERY_FORMATS, default: 'Online' },
    location: { type: String, trim: true, maxlength: 120 },
    startDate: { type: Date },
    endDate: { type: Date },
    syllabusUrl: { type: String, trim: true },
    syllabusName: { type: String, trim: true },
    enrolmentConditions: { type: String, trim: true, maxlength: 1200 },
    learningAccess: { type: String, trim: true, maxlength: 1200 },
    thumbnail: { type: String },
    approvalStatus: { type: String, enum: COURSE_APPROVAL_STATUS, default: 'approved', index: true },
    adminFeedback: { type: String, trim: true, maxlength: 1000 },
    reviewedAt: { type: Date },
    reviewedBy: { type: mongoose.Schema.Types.ObjectId, ref: 'User' },
    status: { type: String, enum: ['draft', 'published', 'archived'], default: 'draft', index: true },
  },
  { timestamps: true }
);

courseSchema.index({ title: 'text', summary: 'text' });

courseSchema.pre('validate', function setSlug(next) {
  if (this.isModified('title') || !this.slug) {
    this.slug = slugify(this.title, { lower: true, strict: true });
  }
  next();
});

export const Course = mongoose.model('Course', courseSchema);
