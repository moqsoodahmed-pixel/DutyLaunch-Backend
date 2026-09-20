import mongoose from 'mongoose';
import slugify from 'slugify';

/**
 * CV bundles shown on /pricing. Prices are seeded from DutyLaunch's published
 * rate card and are edited in the admin, never hard-coded in the client.
 */
const cvPackageSchema = new mongoose.Schema(
  {
    name: { type: String, required: true, unique: true, trim: true, maxlength: 80 },
    slug: { type: String, unique: true, index: true },
    experienceBand: { type: String, required: true, trim: true },
    experienceMin: { type: Number, required: true, min: 0 },
    experienceMax: { type: Number, default: null },
    price: { type: Number, required: true, min: 0 },
    currency: { type: String, default: 'INR' },
    tagline: { type: String, maxlength: 200 },
    bestFor: { type: String, maxlength: 200 },
    features: [{ label: { type: String, trim: true }, included: { type: Boolean, default: true } }],
    deliveryDays: { type: String, default: '2-3 days' },
    revisionWindow: { type: String, default: '1 month unlimited revisions' },
    isPopular: { type: Boolean, default: false },
    order: { type: Number, default: 0 },
    status: { type: String, enum: ['draft', 'published'], default: 'published', index: true },
  },
  { timestamps: true }
);

cvPackageSchema.pre('validate', function setSlug(next) {
  if (this.isModified('name') || !this.slug) {
    this.slug = slugify(this.name, { lower: true, strict: true });
  }
  next();
});

export const CVPackage = mongoose.model('CVPackage', cvPackageSchema);
