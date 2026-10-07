import mongoose from 'mongoose';

/**
 * One Razorpay checkout attempt for a paid item (a CV bundle or a course).
 *
 * Amounts are stored in paise (the smallest currency unit), exactly as
 * Razorpay expects them, so no rounding happens between our record and the
 * gateway. The price is always read from the database on the server, never
 * from the browser.
 */
export const PAYMENT_STATUS = ['created', 'paid', 'failed'];
export const PAYMENT_ITEM_TYPES = ['cv-package', 'course'];

const paymentSchema = new mongoose.Schema(
  {
    user: { type: mongoose.Schema.Types.ObjectId, ref: 'User', required: true, index: true },
    itemType: { type: String, enum: PAYMENT_ITEM_TYPES, required: true },
    itemId: { type: mongoose.Schema.Types.ObjectId, required: true },
    itemName: { type: String, required: true, trim: true, maxlength: 160 },

    // All in paise. amount = baseAmount + gstAmount.
    baseAmount: { type: Number, required: true, min: 0 },
    gstAmount: { type: Number, default: 0, min: 0 },
    gstRate: { type: Number, default: 0 },
    amount: { type: Number, required: true, min: 100 }, // Razorpay minimum is ₹1
    currency: { type: String, default: 'INR' },

    status: { type: String, enum: PAYMENT_STATUS, default: 'created', index: true },
    receipt: { type: String, required: true },
    razorpayOrderId: { type: String, required: true, unique: true },
    razorpayPaymentId: { type: String, index: true },
    razorpaySignature: { type: String, select: false },
    failureReason: { type: String, maxlength: 300 },
    paidAt: { type: Date },
    // Where the paid status came from: the browser callback or Razorpay's webhook.
    confirmedBy: { type: String, enum: ['checkout', 'webhook'] },
  },
  { timestamps: true }
);

paymentSchema.index({ user: 1, createdAt: -1 });

paymentSchema.methods.toPublic = function toPublic() {
  return {
    id: this._id,
    itemType: this.itemType,
    itemId: this.itemId,
    itemName: this.itemName,
    baseAmount: this.baseAmount,
    gstAmount: this.gstAmount,
    gstRate: this.gstRate,
    amount: this.amount,
    currency: this.currency,
    status: this.status,
    receipt: this.receipt,
    razorpayOrderId: this.razorpayOrderId,
    razorpayPaymentId: this.razorpayPaymentId,
    paidAt: this.paidAt,
    createdAt: this.createdAt,
  };
};

export const Payment = mongoose.model('Payment', paymentSchema);