import { PartnerInstitute } from '../models/index.js';
import { ApiError } from '../utils/ApiError.js';
import { asyncHandler } from '../utils/asyncHandler.js';

/**
 * Enforces mandatory business rule:
 * An organization must be verified (status === 'approved') before it can create,
 * submit or publish any university programme or course listing.
 * Attaches the verified PartnerInstitute document to `req.partner`.
 */
export const requireVerifiedPartner = asyncHandler(async (req, res, next) => {
  if (!req.user) throw ApiError.unauthorized();

  // Allow admin to manage listings
  if (req.user.role === 'admin') return next();

  if (!['institute', 'partner'].includes(req.user.role)) {
    throw ApiError.forbidden('Only partner accounts can manage education programmes and courses');
  }

  const partner = await PartnerInstitute.findOne({ owner: req.user._id });
  if (!partner) {
    throw ApiError.forbidden('Please complete your organization profile before managing listings');
  }

  if (partner.status === 'suspended') {
    throw ApiError.forbidden('Your partner organization has been suspended. Please contact support.');
  }

  const isApproved = partner.isApproved || partner.status === 'approved' || (partner.reviewedAt && partner.status !== 'rejected');
  if (!isApproved) {
    throw ApiError.forbidden(
      `Your organization status is "${partner.status}". Listings can only be created after your organization has been verified and approved by admin.`
    );
  }

  req.partner = partner;
  next();
});

/**
 * Attaches partner profile to req.partner if found, but does not strictly require approval
 * (e.g., when viewing own profile or draft listings).
 */
export const attachPartner = asyncHandler(async (req, res, next) => {
  if (req.user && ['institute', 'partner'].includes(req.user.role)) {
    const partner = await PartnerInstitute.findOne({ owner: req.user._id });
    if (partner) req.partner = partner;
  }
  next();
});
