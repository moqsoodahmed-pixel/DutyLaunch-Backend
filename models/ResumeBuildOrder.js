import mongoose from 'mongoose';

export const RESUME_ORDER_STATUSES = [
  'pending',
  'assigned',
  'in_progress',
  'quality_check',
  'completed',
  'rejected',
];

const fileSchema = new mongoose.Schema(
  {
    filename: { type: String, trim: true },
    originalname: { type: String, trim: true },
    mimetype: { type: String, trim: true },
    size: { type: Number },
    storagePath: { type: String, trim: true },
    uploadedAt: { type: Date, default: Date.now },
    fileId: { type: mongoose.Schema.Types.ObjectId, ref: 'UploadedFile' },
  },
  { _id: false }
);

const fileHistorySchema = new mongoose.Schema(
  {
    fileType: {
      type: String,
      enum: ['original_resume', 'original_cv', 'completed_resume', 'completed_cv'],
      required: true,
    },
    filename: { type: String, trim: true },
    originalname: { type: String, trim: true },
    mimetype: { type: String, trim: true },
    size: { type: Number },
    storagePath: { type: String, trim: true },
    uploadedBy: { type: mongoose.Schema.Types.ObjectId, ref: 'User' },
    uploadedByRole: { type: String, trim: true },
    version: { type: Number, default: 1 },
    uploadedAt: { type: Date, default: Date.now },
    note: { type: String, trim: true },
  },
  { _id: true }
);

const internalNoteSchema = new mongoose.Schema(
  {
    note: { type: String, required: true, trim: true, maxlength: 2000 },
    createdBy: { type: mongoose.Schema.Types.ObjectId, ref: 'User' },
    createdByName: { type: String, trim: true },
    createdByRole: { type: String, trim: true },
    createdAt: { type: Date, default: Date.now },
  },
  { _id: true }
);

const timelineSchema = new mongoose.Schema(
  {
    status: { type: String, trim: true },
    title: { type: String, required: true, trim: true },
    description: { type: String, trim: true },
    performedBy: { type: mongoose.Schema.Types.ObjectId, ref: 'User' },
    performedByName: { type: String, trim: true },
    performedByRole: { type: String, trim: true },
    timestamp: { type: Date, default: Date.now },
    isCustomerVisible: { type: Boolean, default: true },
  },
  { _id: true }
);

const assignedStaffSchema = new mongoose.Schema(
  {
    user: { type: mongoose.Schema.Types.ObjectId, ref: 'User' },
    name: { type: String, trim: true },
    email: { type: String, trim: true },
    assignedAt: { type: Date, default: Date.now },
    assignedBy: { type: mongoose.Schema.Types.ObjectId, ref: 'User' },
  },
  { _id: false }
);

const customerUpdateSchema = new mongoose.Schema(
  {
    message: { type: String, required: true, trim: true, maxlength: 2000 },
    sentAt: { type: Date, default: Date.now },
    sentBy: { type: mongoose.Schema.Types.ObjectId, ref: 'User' },
  },
  { _id: true }
);

const resumeBuildOrderSchema = new mongoose.Schema(
  {
    orderNumber: { type: String, required: true, unique: true, index: true },
    user: { type: mongoose.Schema.Types.ObjectId, ref: 'User', required: true, index: true },
    package: { type: mongoose.Schema.Types.ObjectId, ref: 'CVPackage' },
    packageName: { type: String, required: true, trim: true },
    experienceBand: { type: String, trim: true },
    price: { type: Number, required: true, min: 0 },
    currency: { type: String, default: 'INR' },

    payment: { type: mongoose.Schema.Types.ObjectId, ref: 'Payment', index: true },
    paymentStatus: {
      type: String,
      enum: ['paid', 'pending', 'refunded'],
      default: 'paid',
      index: true,
    },
    paymentAmount: { type: Number, default: 0 },
    purchaseDate: { type: Date, default: Date.now },

    status: {
      type: String,
      enum: RESUME_ORDER_STATUSES,
      default: 'pending',
      index: true,
    },
    turnaroundNotice: {
      type: String,
      default: 'In 2–3 days our executive career specialists will craft and refine your CV.',
    },
    expectedDeliveryDate: { type: Date },
    completionDate: { type: Date },

    userInstructions: { type: String, trim: true, maxlength: 5000 },
    targetRole: { type: String, trim: true, maxlength: 200 },
    targetIndustry: { type: String, trim: true, maxlength: 200 },

    originalResume: { type: fileSchema, default: null },
    originalCv: { type: fileSchema, default: null },
    completedResume: { type: fileSchema, default: null },
    completedCv: { type: fileSchema, default: null },
    fileHistory: [fileHistorySchema],

    assignedStaff: { type: assignedStaffSchema, default: null },
    internalNotes: [internalNoteSchema],
    timeline: [timelineSchema],
    rejectionReason: { type: String, trim: true, maxlength: 1000 },
    customerUpdates: [customerUpdateSchema],
  },
  { timestamps: true }
);

resumeBuildOrderSchema.index({ user: 1, createdAt: -1 });
resumeBuildOrderSchema.index({ status: 1, createdAt: -1 });

export function generateOrderNumber() {
  const d = new Date();
  const yearMonth = `${d.getFullYear()}${String(d.getMonth() + 1).padStart(2, '0')}`;
  const random = Math.floor(1000 + Math.random() * 9000);
  return `DL-RBO-${yearMonth}-${random}`;
}

export const ResumeBuildOrder =
  mongoose.models.ResumeBuildOrder || mongoose.model('ResumeBuildOrder', resumeBuildOrderSchema);
