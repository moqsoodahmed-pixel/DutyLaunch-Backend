import mongoose from 'mongoose';

export const FEE_TYPES = ['percentage', 'fixed'];

const feeConfigSchema = new mongoose.Schema(
  {
    isDefault: { type: Boolean, default: false, index: true },
    provider: { type: mongoose.Schema.Types.ObjectId, ref: 'PartnerInstitute', index: true },
    itemType: { type: String, enum: ['course', 'education_program', 'education-program'], index: true },
    itemId: { type: mongoose.Schema.Types.ObjectId, index: true },
    feeType: { type: String, enum: FEE_TYPES, default: 'percentage' },
    feeValue: { type: Number, required: true, min: 0, default: 15 }, // e.g. 15% or fixed amount in Rupees
    notes: { type: String, trim: true, maxlength: 400 },
    isActive: { type: Boolean, default: true, index: true },
    updatedBy: { type: mongoose.Schema.Types.ObjectId, ref: 'User' },
  },
  { timestamps: true }
);

/**
 * Resolves the applicable fee configuration following the strict precedence:
 * 1. Offering-specific override (itemId)
 * 2. Provider-specific override (provider)
 * 3. Platform default (isDefault: true)
 * 4. Hardcoded fallback: 15% platform commission
 */
feeConfigSchema.statics.resolveFee = async function ({ providerId, itemType, itemId }) {
  if (itemId) {
    const itemOverride = await this.findOne({ itemId, isActive: true }).lean();
    if (itemOverride) return itemOverride;
  }
  if (providerId) {
    const providerOverride = await this.findOne({ provider: providerId, itemId: null, isActive: true }).lean();
    if (providerOverride) return providerOverride;
  }
  const defaultFee = await this.findOne({ isDefault: true, isActive: true }).lean();
  if (defaultFee) return defaultFee;

  return { feeType: 'percentage', feeValue: 15, isDefault: true };
};

export const FeeConfig = mongoose.model('FeeConfig', feeConfigSchema);
