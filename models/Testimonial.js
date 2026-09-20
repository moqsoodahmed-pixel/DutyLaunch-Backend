import mongoose from 'mongoose';

/**
 * Testimonials are only ever rendered from verified, client-supplied records.
 * The seed script intentionally creates none — see README "Content to supply".
 */
const testimonialSchema = new mongoose.Schema(
  {
    name: { type: String, required: true, trim: true, maxlength: 80 },
    role: { type: String, trim: true, maxlength: 120 },
    location: { type: String, trim: true, maxlength: 80 },
    service: { type: String, trim: true, maxlength: 80 },
    quote: { type: String, required: true, maxlength: 600 },
    rating: { type: Number, min: 1, max: 5 },
    avatar: { type: String },
    consentOnFile: { type: Boolean, default: false },
    isPublished: { type: Boolean, default: false, index: true },
    order: { type: Number, default: 0 },
  },
  { timestamps: true }
);

export const Testimonial = mongoose.model('Testimonial', testimonialSchema);
