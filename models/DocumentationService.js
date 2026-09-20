import mongoose from 'mongoose';
import slugify from 'slugify';

const documentationSchema = new mongoose.Schema(
  {
    name: { type: String, required: true, trim: true, maxlength: 120 },
    slug: { type: String, unique: true, index: true },
    category: {
      type: String,
      enum: ['Attestation', 'Apostille', 'Certificates', 'Translation', 'Commercial'],
      required: true,
      index: true,
    },
    description: { type: String, required: true, maxlength: 600 },
    documentsRequired: [{ type: String, trim: true }],
    steps: [{ type: String, trim: true }],
    price: { type: Number, min: 0 },
    currency: { type: String, default: 'INR' },
    priceOnRequest: { type: Boolean, default: true },
    processingTime: { type: String, trim: true },
    status: { type: String, enum: ['draft', 'published', 'archived'], default: 'published', index: true },
    order: { type: Number, default: 0 },
  },
  { timestamps: true }
);

documentationSchema.pre('validate', function setSlug(next) {
  if (this.isModified('name') || !this.slug) {
    this.slug = slugify(this.name, { lower: true, strict: true });
  }
  next();
});

export const DocumentationService = mongoose.model('DocumentationService', documentationSchema);
