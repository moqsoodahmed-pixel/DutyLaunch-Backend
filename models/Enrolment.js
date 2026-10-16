import mongoose from 'mongoose';

export const ENROLMENT_STATUS = ['confirmed', 'pending_verification', 'cancelled', 'refunded'];

const learningAccessSchema = new mongoose.Schema(
  {
    method: { type: String, default: 'online' },
    instructions: { type: String, trim: true, maxlength: 2000 },
    portalUrl: { type: String, trim: true },
    venue: { type: String, trim: true },
  },
  { _id: false }
);

const enrolmentSchema = new mongoose.Schema(
  {
    user: { type: mongoose.Schema.Types.ObjectId, ref: 'User', required: true, index: true },
    partner: { type: mongoose.Schema.Types.ObjectId, ref: 'PartnerInstitute', index: true },
    itemType: { type: String, enum: ['course', 'education_program', 'education-program'], required: true, index: true },
    itemId: { type: mongoose.Schema.Types.ObjectId, required: true, index: true },
    offeringTitle: { type: String, required: true, trim: true, maxlength: 200 },
    payment: { type: mongoose.Schema.Types.ObjectId, ref: 'Payment' },
    status: { type: String, enum: ENROLMENT_STATUS, default: 'confirmed', index: true },
    deliveryFormat: { type: String, default: 'Online' },
    learningAccess: { type: learningAccessSchema, default: () => ({}) },
    enrolledAt: { type: Date, default: Date.now },
  },
  { timestamps: true }
);

// Prevent duplicate enrolments for the same candidate and offering
enrolmentSchema.index({ user: 1, itemType: 1, itemId: 1 }, { unique: true });

enrolmentSchema.methods.toPublic = function toPublic() {
  return {
    id: this._id,
    user: this.user,
    partner: this.partner,
    itemType: this.itemType,
    itemId: this.itemId,
    offeringTitle: this.offeringTitle,
    payment: this.payment,
    status: this.status,
    deliveryFormat: this.deliveryFormat,
    learningAccess: this.learningAccess,
    enrolledAt: this.enrolledAt,
    createdAt: this.createdAt,
  };
};

export const Enrolment = mongoose.model('Enrolment', enrolmentSchema);
