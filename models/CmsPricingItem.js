import mongoose from 'mongoose';

export const CMS_CATEGORIES = ['bundle', 'cv_only', 'addon', 'subscription', 'service'];

const deliverableSchema = new mongoose.Schema(
  {
    id: { type: String, default: () => new mongoose.Types.ObjectId().toString() },
    label: { type: String, required: true, trim: true },
    included: { type: Boolean, default: true },
    icon: { type: String, default: 'check' },
  },
  { _id: false }
);

const cmsPricingItemSchema = new mongoose.Schema(
  {
    key: { type: String, required: true, unique: true, trim: true, lowercase: true },
    category: { type: String, required: true, enum: CMS_CATEGORIES, index: true },
    name: { type: String, required: true, trim: true, maxlength: 100 },
    experienceBand: { type: String, trim: true, default: 'All Experience Levels' },
    experienceMin: { type: Number, default: 0 },
    experienceMax: { type: Number, default: null },
    price: { type: Number, required: true, min: 0 },
    originalPrice: { type: Number, default: 0 },
    hasStrikeThrough: { type: Boolean, default: true },
    currency: { type: String, default: 'INR' },
    saveText: { type: String, trim: true, default: '' },
    tagline: { type: String, trim: true, maxlength: 300, default: '' },
    bestFor: { type: String, trim: true, maxlength: 300, default: '' },
    deliverables: [deliverableSchema],
    deliveryDays: { type: String, trim: true, default: 'Delivery in 2–3 Days *' },
    revisionWindow: { type: String, trim: true, default: '1 month unlimited revisions' },
    isPopular: { type: Boolean, default: false },
    popularBadgeText: { type: String, trim: true, default: 'Most Popular' },
    order: { type: Number, default: 0 },
    status: { type: String, enum: ['published', 'draft', 'archived'], default: 'published', index: true },
    affectsSurfaces: [{ type: String, trim: true }],
  },
  { timestamps: true }
);

cmsPricingItemSchema.index({ category: 1, order: 1 });

export const CmsPricingItem = mongoose.model('CmsPricingItem', cmsPricingItemSchema);
