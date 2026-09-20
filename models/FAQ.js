import mongoose from 'mongoose';

export const FAQ_CATEGORIES = [
  'General',
  'Career Services',
  'Pricing & Payments',
  'Education',
  'UAE & Global Mobility',
  'Documentation',
  'Jobs & Applications',
];

const faqSchema = new mongoose.Schema(
  {
    question: { type: String, required: true, trim: true, maxlength: 220 },
    answer: { type: String, required: true, maxlength: 2000 },
    category: { type: String, enum: FAQ_CATEGORIES, default: 'General', index: true },
    order: { type: Number, default: 0 },
    isPublished: { type: Boolean, default: true, index: true },
  },
  { timestamps: true }
);

faqSchema.index({ question: 'text', answer: 'text' });

export const FAQ = mongoose.model('FAQ', faqSchema);
