import mongoose from 'mongoose';

export const ENROLMENT_STATUS = ['confirmed', 'pending_verification', 'cancelled', 'refunded'];

const candidateDetailsSchema = new mongoose.Schema(
  {
    fullName: { type: String, trim: true },
    email: { type: String, trim: true, lowercase: true },
    phone: { type: String, trim: true },
    currentDegree: { type: String, trim: true },
  },
  { _id: false }
);

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
    user: { type: mongoose.Schema.Types.ObjectId, ref: 'User', index: true },
    partner: { type: mongoose.Schema.Types.ObjectId, ref: 'PartnerInstitute', index: true },
    itemType: { type: String, enum: ['course', 'education_program', 'education-program'], required: true, index: true },
    itemId: { type: mongoose.Schema.Types.ObjectId, required: true, index: true },
    offeringTitle: { type: String, required: true, trim: true, maxlength: 200 },
    payment: { type: mongoose.Schema.Types.ObjectId, ref: 'Payment' },
    status: { type: String, enum: ENROLMENT_STATUS, default: 'confirmed', index: true },
    deliveryFormat: { type: String, default: 'Online' },
    candidateDetails: { type: candidateDetailsSchema, default: () => ({}) },
    learningAccess: { type: learningAccessSchema, default: () => ({}) },
    enrolledAt: { type: Date, default: Date.now },
  },
  { timestamps: true }
);

// Unique index per user and offering (sparse to allow guest applications)
enrolmentSchema.index({ user: 1, itemType: 1, itemId: 1 }, { unique: true, sparse: true });
enrolmentSchema.index({ partner: 1, createdAt: -1 });

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
    candidateDetails: this.candidateDetails,
    learningAccess: this.learningAccess,
    enrolledAt: this.enrolledAt,
    createdAt: this.createdAt,
  };
};

export const Enrolment = mongoose.model('Enrolment', enrolmentSchema);
