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
export const PARTNER_TRACKS = ['education', 'courses'];
export const PARTNER_MODES = ['Online', 'Distance', 'Regular', 'Classroom', 'Hybrid'];
export const PARTNER_STATUS = ['pending', 'approved', 'rejected'];

const partnerSchema = new mongoose.Schema(
  {
    owner: { type: mongoose.Schema.Types.ObjectId, ref: 'User', required: true, unique: true },
    name: { type: String, required: true, trim: true, maxlength: 120 },
    track: { type: String, enum: PARTNER_TRACKS, required: true, index: true },
    location: { type: String, required: true, trim: true, maxlength: 80 },
    mode: { type: String, enum: PARTNER_MODES, required: true },
    about: { type: String, trim: true, maxlength: 280 },
    website: { type: String, trim: true, maxlength: 200 },
    contactPhone: { type: String, trim: true, maxlength: 30 },
    programmes: {
      type: [String],
      validate: [(v) => Array.isArray(v) && v.length > 0, 'Choose at least one programme'],
      index: true,
    },
    status: { type: String, enum: PARTNER_STATUS, default: 'pending', index: true },
    reviewNote: { type: String, trim: true, maxlength: 500 },
    reviewedAt: Date,
  },
  { timestamps: true }
);

export const PartnerInstitute = mongoose.model('PartnerInstitute', partnerSchema);
