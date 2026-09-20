import mongoose from 'mongoose';
import slugify from 'slugify';

const programSchema = new mongoose.Schema(
  {
    title: { type: String, required: true, trim: true, maxlength: 160 },
    slug: { type: String, unique: true, index: true },
    level: {
      type: String,
      enum: ['Undergraduate', 'Postgraduate', 'Diploma', 'Doctorate', 'Certificate'],
      required: true,
      index: true,
    },
    field: { type: String, required: true, trim: true, index: true },
    destinations: [{ type: String, trim: true }],
    summary: { type: String, required: true, maxlength: 280 },
    description: { type: String, required: true },
    intakes: [{ type: String, trim: true }],
    duration: { type: String, trim: true },
    entryRequirements: [{ type: String, trim: true }],
    supportIncluded: [{ type: String, trim: true }],
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
