import mongoose from 'mongoose';

const cmsGlobalConfigSchema = new mongoose.Schema(
  {
    gstPercentage: { type: Number, default: 18, min: 0, max: 100 },
    turnaroundDisclaimer: {
      type: String,
      default:
        '* Delivery Turnaround Guarantee: Delivery turnaround begins after candidate submits current CV and target career preferences.',
    },
    currency: { type: String, default: 'INR' },
    allowDiscounts: { type: Boolean, default: true },
    announcementBanner: {
      enabled: { type: Boolean, default: false },
      text: { type: String, default: 'Special Offer: Get 10% extra discount on executive career bundles!' },
      linkUrl: { type: String, default: '/resume-service' },
      badge: { type: String, default: 'Limited Time' },
    },
    updatedBy: { type: String, default: 'admin' },
  },
  { timestamps: true }
);

export const CmsGlobalConfig = mongoose.model('CmsGlobalConfig', cmsGlobalConfigSchema);
