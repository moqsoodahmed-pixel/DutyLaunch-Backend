import mongoose from 'mongoose';
import slugify from 'slugify';

export const JOB_TYPES = ['Full-time', 'Part-time', 'Contract', 'Internship', 'Remote'];
export const JOB_STATUS = ['draft', 'pending', 'published', 'closed'];
export const WORK_MODES = ['On-site', 'Hybrid', 'Remote'];

const jobSchema = new mongoose.Schema(
  {
    title: { type: String, required: true, trim: true, maxlength: 140 },
    slug: { type: String, unique: true, index: true },
    company: { type: String, required: true, trim: true, maxlength: 120 },
    companyLogo: { type: String },
    employer: { type: mongoose.Schema.Types.ObjectId, ref: 'User', index: true },
    location: { type: String, required: true, trim: true, maxlength: 120 },
    country: { type: String, trim: true, default: 'India', index: true },
    workMode: { type: String, enum: WORK_MODES, default: 'On-site' },
    jobType: { type: String, enum: JOB_TYPES, default: 'Full-time', index: true },
    category: { type: String, required: true, trim: true, index: true },
    experience: {
      min: { type: Number, default: 0, min: 0 },
      max: { type: Number, default: 0, min: 0 },
    },
    salary: {
      min: { type: Number },
      max: { type: Number },
      currency: { type: String, default: 'INR', enum: ['INR', 'AED', 'USD', 'GBP', 'EUR'] },
      period: { type: String, default: 'year', enum: ['month', 'year'] },
      disclosed: { type: Boolean, default: true },
    },
    description: { type: String, required: true },
    responsibilities: [{ type: String, trim: true }],
    requirements: [{ type: String, trim: true }],
    skills: [{ type: String, trim: true, index: true }],
    applyUrl: { type: String, trim: true },
    status: { type: String, enum: JOB_STATUS, default: 'draft', index: true },
    isFeatured: { type: Boolean, default: false },
    applicationCount: { type: Number, default: 0 },
    viewCount: { type: Number, default: 0 },
    expiresAt: { type: Date },
    publishedAt: { type: Date },
  },
  { timestamps: true, toJSON: { virtuals: true }, toObject: { virtuals: true } }
);

jobSchema.index({ title: 'text', company: 'text', description: 'text', skills: 'text' });
jobSchema.index({ status: 1, publishedAt: -1 });

jobSchema.virtual('isExpired').get(function isExpired() {
  return Boolean(this.expiresAt && this.expiresAt < new Date());
});

jobSchema.pre('validate', async function setSlug(next) {
  if (this.isModified('title') || !this.slug) {
    const base = slugify(`${this.title} ${this.company}`, { lower: true, strict: true });
    let candidate = base;
    let n = 1;
    // eslint-disable-next-line no-await-in-loop
    while (await mongoose.models.Job.exists({ slug: candidate, _id: { $ne: this._id } })) {
      n += 1;
      candidate = `${base}-${n}`;
    }
    this.slug = candidate;
  }
  if (this.isModified('status') && this.status === 'published' && !this.publishedAt) {
    this.publishedAt = new Date();
  }
  return next();
});

export const Job = mongoose.model('Job', jobSchema);
