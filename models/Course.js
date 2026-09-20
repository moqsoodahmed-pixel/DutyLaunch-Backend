import mongoose from 'mongoose';
import slugify from 'slugify';

export const COURSE_LEVELS = ['Beginner', 'Intermediate', 'Advanced'];
export const COURSE_TRACKS = ['professional', 'upskill', 'certification'];

const courseSchema = new mongoose.Schema(
  {
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
    price: { type: Number, min: 0 },
    currency: { type: String, default: 'INR' },
    priceOnRequest: { type: Boolean, default: false },
    duration: { type: String, trim: true },
    level: { type: String, enum: COURSE_LEVELS, default: 'Beginner' },
    mode: { type: String, enum: ['Online', 'Live online', 'Blended'], default: 'Live online' },
    thumbnail: { type: String },
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
