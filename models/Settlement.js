import mongoose from 'mongoose';

export const SETTLEMENT_STATUS = [
  'pending',
  'eligible',
  'processing',
  'paid',
  'failed',
  'on_hold',
  'reversed',
];

const settlementSchema = new mongoose.Schema(
  {
    partner: { type: mongoose.Schema.Types.ObjectId, ref: 'PartnerInstitute', required: true, index: true },
    periodStart: { type: Date, default: Date.now },
    periodEnd: { type: Date, default: Date.now },
    grossAmountPaise: { type: Number, required: true, min: 0 },
    platformFeePaise: { type: Number, required: true, min: 0, default: 0 },
    taxDeductionPaise: { type: Number, default: 0, min: 0 },
    payableAmountPaise: { type: Number, required: true, min: 0 },
    currency: { type: String, default: 'INR' },
    status: { type: String, enum: SETTLEMENT_STATUS, default: 'pending', index: true },
    payoutReference: { type: String, trim: true, maxlength: 100 },
    batchId: { type: String, trim: true, maxlength: 80, index: true },
    payments: [{ type: mongoose.Schema.Types.ObjectId, ref: 'Payment' }],
    notes: { type: String, trim: true, maxlength: 1000 },
    paidAt: { type: Date },
    processedBy: { type: mongoose.Schema.Types.ObjectId, ref: 'User' },
  },
  { timestamps: true }
);

settlementSchema.methods.toPublic = function toPublic() {
  return {
    id: this._id,
    partner: this.partner,
    periodStart: this.periodStart,
    periodEnd: this.periodEnd,
    grossAmountPaise: this.grossAmountPaise,
    platformFeePaise: this.platformFeePaise,
    taxDeductionPaise: this.taxDeductionPaise,
    payableAmountPaise: this.payableAmountPaise,
    currency: this.currency,
    status: this.status,
    payoutReference: this.payoutReference,
    batchId: this.batchId,
    notes: this.notes,
    paidAt: this.paidAt,
    createdAt: this.createdAt,
  };
};

export const Settlement = mongoose.model('Settlement', settlementSchema);
