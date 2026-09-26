import { PartnerInstitute } from '../models/index.js';
import { ApiError } from '../utils/ApiError.js';
import { asyncHandler } from '../utils/asyncHandler.js';
import { sendSuccess, paginationMeta } from '../utils/apiResponse.js';
import { getPagination, escapeRegex } from '../utils/pagination.js';

/* Only these fields are ever shown on the public site — no phone, owner or
   review notes. Enquiries go through DutyLaunch, not straight to the partner. */
const PUBLIC_FIELDS = 'name track location mode about website programmes';

/* Changing who you are after approval sends the profile back for review, so an
   approved listing can't be renamed into a different institution. */
const IDENTITY_FIELDS = ['name', 'website'];

/* ---------- public ---------- */

/** GET /partners?track=education&programme=b-tech — approved partners only. */
export const listPublic = asyncHandler(async (req, res) => {
  const filter = { status: 'approved' };
  if (req.query.track) filter.track = String(req.query.track);
  if (req.query.programme) filter.programmes = String(req.query.programme);
  const partners = await PartnerInstitute.find(filter).select(PUBLIC_FIELDS).sort({ name: 1 }).limit(50).lean();
  sendSuccess(res, { message: 'Partner institutes', data: partners });
});

/* ---------- the institute's own profile ---------- */

/** GET /partners/me — null until the institute fills its profile in. */
export const getMine = asyncHandler(async (req, res) => {
  const profile = await PartnerInstitute.findOne({ owner: req.user._id }).lean();
  sendSuccess(res, { message: 'Your partner profile', data: profile });
});

/** PUT /partners/me — create or update. New profiles start as 'pending'. */
export const upsertMine = asyncHandler(async (req, res) => {
  const updates = { ...req.body };
  const existing = await PartnerInstitute.findOne({ owner: req.user._id });

  if (!existing) {
    const created = await PartnerInstitute.create({ ...updates, owner: req.user._id, status: 'pending' });
    return sendSuccess(res, {
      statusCode: 201,
      message: 'Profile submitted — our team will review it shortly',
      data: created,
    });
  }

  const identityChanged = IDENTITY_FIELDS.some((f) => f in updates && (updates[f] || '') !== (existing[f] || ''));
  Object.assign(existing, updates);
  // Re-review after an identity change, or when a rejected profile is fixed.
  if ((existing.status === 'approved' && identityChanged) || existing.status === 'rejected') {
    existing.status = 'pending';
    existing.reviewNote = undefined;
  }
  await existing.save();
  sendSuccess(res, {
    message: existing.status === 'pending' ? 'Profile saved and sent for review' : 'Profile updated',
    data: existing,
  });
});

/* ---------- admin ---------- */

/** GET /admin/partners?status=pending&q=… */
export const adminList = asyncHandler(async (req, res) => {
  const { page, limit, skip } = getPagination(req.query, { defaultLimit: 20 });
  const filter = {};
  if (req.query.status) filter.status = String(req.query.status);
  if (req.query.q) filter.name = new RegExp(escapeRegex(req.query.q), 'i');
  const [items, total] = await Promise.all([
    PartnerInstitute.find(filter).populate('owner', 'name email phone').sort({ createdAt: -1 }).skip(skip).limit(limit).lean(),
    PartnerInstitute.countDocuments(filter),
  ]);
  sendSuccess(res, { message: 'Partner institutes', data: items, meta: paginationMeta({ page, limit, total }) });
});

/** PATCH /admin/partners/:id/status — approve / reject / back to pending. */
export const adminSetStatus = asyncHandler(async (req, res) => {
  const partner = await PartnerInstitute.findById(req.params.id);
  if (!partner) throw ApiError.notFound('Partner institute not found');
  partner.status = req.body.status;
  partner.reviewNote = req.body.reviewNote || undefined;
  partner.reviewedAt = new Date();
  await partner.save();
  sendSuccess(res, { message: `Partner ${partner.status}`, data: partner });
});
