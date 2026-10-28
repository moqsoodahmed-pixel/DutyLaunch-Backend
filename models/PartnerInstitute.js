import mongoose from 'mongoose';

/**
 * A college, university or training company that partners with DutyLaunch.
 *
 * Created by the institute itself: it registers an account with role
 * 'institute', then fills in this profile. Profiles start as 'pending' and are
 * only shown on the public programme pages once an admin approves them —
 * otherwise anyone could list themselves on the site as a DutyLaunch partner
 * under any name.
 *
 * `programmes` holds the programme/course slugs the institute offers, matching
 * the frontend catalogue (src/data/programmes.js) — e.g. 'b-tech', 'mba',
 * 'data-science'. That is what places an approved institute on
 * /higher-education/b-tech, /professional-courses/data-science, etc.
 */
export const PARTNER_ORG_TYPES = ['university', 'edtech'];
export const PARTNER_TRACKS = ['education', 'courses', 'both'];
export const PARTNER_MODES = ['Online', 'Distance', 'Regular', 'Classroom', 'Hybrid'];
export const PARTNER_STATUS = [
  'incomplete',
  'pending',
  'changes_requested',
  'approved',
  'rejected',
  'suspended',
];

const partnerSchema = new mongoose.Schema(
  {
    owner: { type: mongoose.Schema.Types.ObjectId, ref: 'User', required: true, unique: true },
    orgType: { type: String, enum: PARTNER_ORG_TYPES, default: 'university', index: true },
    name: { type: String, required: true, trim: true, maxlength: 140 },
    legalName: { type: String, trim: true, maxlength: 140 },
    displayName: { type: String, trim: true, maxlength: 140 },
    track: { type: String, enum: PARTNER_TRACKS, default: 'education', index: true },
    location: { type: String, required: true, trim: true, maxlength: 100 },
    address: { type: String, trim: true, maxlength: 300 },
    city: { type: String, trim: true, maxlength: 80 },
    state: { type: String, trim: true, maxlength: 80 },
    country: { type: String, trim: true, maxlength: 80, default: 'India' },
    mode: { type: String, enum: PARTNER_MODES, default: 'Online' },
    about: { type: String, trim: true, maxlength: 1200 },
    website: { type: String, trim: true, maxlength: 200 },
    contactPerson: { type: String, trim: true, maxlength: 80 },
    contactEmail: { type: String, trim: true, lowercase: true, maxlength: 100 },
    contactPhone: { type: String, trim: true, maxlength: 30 },
    logoUrl: { type: String, trim: true },
    coverImageUrl: { type: String, trim: true },
    verificationDetails: {
      registrationNumber: { type: String, trim: true, maxlength: 100 },
      accreditationAffiliation: { type: String, trim: true, maxlength: 200 },
      documentUrl: { type: String, trim: true },
      documentName: { type: String, trim: true },
    },
    programmes: {
      type: [String],
      default: [],
      index: true,
    },
    status: { type: String, enum: PARTNER_STATUS, default: 'pending', index: true },
    isApproved: { type: Boolean, default: false, index: true },
    pendingChanges: { type: mongoose.Schema.Types.Mixed, default: null },
    reviewNote: { type: String, trim: true, maxlength: 1000 },
    reviewedAt: Date,
    reviewedBy: { type: mongoose.Schema.Types.ObjectId, ref: 'User' },
  },
  { timestamps: true }
);

export const PartnerInstitute = mongoose.model('PartnerInstitute', partnerSchema);

