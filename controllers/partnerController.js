import mongoose from 'mongoose';
import { PartnerInstitute, EducationProgram, Course, Enrolment, Payment, Settlement } from '../models/index.js';
import { ApiError } from '../utils/ApiError.js';
import { asyncHandler } from '../utils/asyncHandler.js';
import { sendSuccess, paginationMeta } from '../utils/apiResponse.js';
import { getPagination, escapeRegex } from '../utils/pagination.js';

/* Public fields safe for display on listings and profiles */
const PUBLIC_FIELDS =
  '_id name displayName legalName orgType track location address city state country mode about website logoUrl coverImageUrl programmes status createdAt';

/* Changing who you are after approval sends the profile back for review */
const IDENTITY_FIELDS = ['name', 'legalName', 'website', 'orgType'];

/* ---------- public ---------- */

/** GET /partners — approved partners only. */
export const listPublic = asyncHandler(async (req, res) => {
  const filter = { status: 'approved' };
  if (req.query.track) filter.track = { $in: [String(req.query.track), 'both'] };
  if (req.query.orgType) filter.orgType = String(req.query.orgType);
  if (req.query.programme) filter.programmes = String(req.query.programme);

  const partners = await PartnerInstitute.find(filter)
    .select(PUBLIC_FIELDS)
    .sort({ name: 1 })
    .limit(100)
    .lean();

  sendSuccess(res, { message: 'Partner organizations', data: partners });
});

/**
 * GET /partners/:id — Public University / Partner profile
 * Returns approved organization details and its approved & published programmes / courses.
 */
export const getPublicById = asyncHandler(async (req, res) => {
  if (!mongoose.Types.ObjectId.isValid(req.params.id)) {
    throw ApiError.notFound('Partner organization not found or not published');
  }
  const partner = await PartnerInstitute.findOne({ _id: req.params.id, status: 'approved' })
    .select(PUBLIC_FIELDS)
    .lean();

  if (!partner) throw ApiError.notFound('Partner organization not found or not published');

  // Load approved & published programmes for universities
  const [programmes, courses] = await Promise.all([
    EducationProgram.find({ institution: partner._id, approvalStatus: 'approved', status: 'published' })
      .sort({ createdAt: -1 })
      .lean(),
    Course.find({ institution: partner._id, approvalStatus: 'approved', status: 'published' })
      .sort({ createdAt: -1 })
      .lean(),
  ]);

  sendSuccess(res, {
    message: 'Partner profile',
    data: {
      partner,
      programmes,
      courses,
    },
  });
});

/* ---------- the partner's own portal & profile ---------- */

/** GET /partners/me — returns profile and real dashboard overview metrics. */
export const getMine = asyncHandler(async (req, res) => {
  const partner = await PartnerInstitute.findOne({ owner: req.user._id }).lean();

  if (!partner) {
    return sendSuccess(res, {
      message: 'No partner profile registered yet',
      data: null,
    });
  }

  // Calculate real dashboard statistics
  const [
    eduCounts,
    courseCounts,
    recentOrders,
    enrolmentCount,
    settlements,
  ] = await Promise.all([
    EducationProgram.aggregate([
      { $match: { institution: partner._id } },
      { $group: { _id: { approval: '$approvalStatus', status: '$status' }, count: { $sum: 1 } } },
    ]),
    Course.aggregate([
      { $match: { institution: partner._id } },
      { $group: { _id: { approval: '$approvalStatus', status: '$status' }, count: { $sum: 1 } } },
    ]),
    Payment.find({ partner: partner._id, status: 'paid' })
      .sort({ createdAt: -1 })
      .limit(10)
      .lean(),
    Enrolment.countDocuments({ partner: partner._id, status: { $in: ['confirmed', 'pending_verification'] } }),
    Settlement.find({ partner: partner._id })
      .sort({ createdAt: -1 })
      .limit(10)
      .lean(),
  ]);

  let publishedCount = 0;
  let draftCount = 0;
  let pendingCount = 0;
  let changesRequestedCount = 0;

  [...eduCounts, ...courseCounts].forEach((item) => {
    if (item._id.approval === 'approved' && item._id.status === 'published') publishedCount += item.count;
    else if (item._id.approval === 'draft') draftCount += item.count;
    else if (item._id.approval === 'pending') pendingCount += item.count;
    else if (item._id.approval === 'changes_requested' || item._id.approval === 'rejected') {
      changesRequestedCount += item.count;
    }
  });

  // Calculate financial balances
  let totalGrossPaise = 0;
  let platformFeePaise = 0;
  let providerPayablePaise = 0;

  recentOrders.forEach((order) => {
    totalGrossPaise += order.amount || 0;
    if (order.feeConfigSnapshot) {
      platformFeePaise += order.feeConfigSnapshot.platformFeePaise || 0;
      providerPayablePaise += order.feeConfigSnapshot.providerPayablePaise || 0;
    } else {
      // Default 15% platform commission calculation
      const comm = Math.round((order.amount || 0) * 0.15);
      platformFeePaise += comm;
      providerPayablePaise += (order.amount || 0) - comm;
    }
  });

  // Subtract paid settlements
  const paidSettlementsPaise = settlements
    .filter((s) => s.status === 'paid')
    .reduce((acc, cur) => acc + (cur.payableAmountPaise || 0), 0);

  const netCurrentPayablePaise = Math.max(0, providerPayablePaise - paidSettlementsPaise);

  sendSuccess(res, {
    message: 'Your partner profile and dashboard overview',
    data: {
      ...partner,
      stats: {
        publishedCount,
        draftCount,
        pendingCount,
        changesRequestedCount,
        enrolmentCount,
        totalOrdersCount: recentOrders.length,
        totalGrossPaise,
        platformFeePaise,
        providerPayablePaise,
        netCurrentPayablePaise,
      },
      recentOrders: recentOrders.map((o) => ({
        id: o._id,
        itemName: o.itemName,
        amount: o.amount,
        currency: o.currency,
        paidAt: o.paidAt,
        receipt: o.receipt,
      })),
      settlements,
    },
  });
});

/** PUT /partners/me — create or update organization profile. */
export const upsertMine = asyncHandler(async (req, res) => {
  const updates = { ...req.body };
  delete updates.status;
  delete updates.reviewedAt;
  delete updates.reviewedBy;
  delete updates.owner;
  delete updates.isApproved;
  delete updates.pendingChanges;

  const existing = await PartnerInstitute.findOne({ owner: req.user._id });

  if (!existing) {
    const created = await PartnerInstitute.create({
      ...updates,
      owner: req.user._id,
      status: req.body.status === 'incomplete' ? 'incomplete' : 'pending',
    });
    return sendSuccess(res, {
      statusCode: 201,
      message:
        created.status === 'pending'
          ? 'Profile submitted, our team will review it shortly'
          : 'Profile draft saved',
      data: created,
    });
  }

  const isAlreadyApproved = Boolean(
    existing.isApproved || existing.status === 'approved' || (existing.reviewedAt && existing.status !== 'rejected')
  );

  if (isAlreadyApproved) {
    // 1. Once organization type is approved, partner cannot change orgType
    if (updates.orgType && updates.orgType !== existing.orgType) {
      throw ApiError.badRequest(
        'Organization type cannot be changed once approved. Please contact DutyLaunch support if your legal entity structure has changed.'
      );
    }
    // Guarantee orgType remains locked
    updates.orgType = existing.orgType;

    // 2. Stage updates into pendingChanges so live profile remains active until admin approval
    const pendingData = {
      ...(existing.pendingChanges || {}),
      ...updates,
      verificationDetails: {
        ...((existing.pendingChanges && existing.pendingChanges.verificationDetails) || {}),
        ...(updates.verificationDetails || {}),
      },
      submittedAt: new Date(),
    };

    existing.pendingChanges = pendingData;
    existing.status = 'pending';
    existing.reviewNote = undefined;
    existing.markModified('pendingChanges');
    await existing.save();

    return sendSuccess(res, {
      message:
        'Your profile changes have been submitted for admin review. Once approved, the changes will be automatically applied to your live profile.',
      data: existing,
    });
  }

  // Not yet approved: direct update
  Object.assign(existing, updates);

  if (existing.status === 'rejected' || existing.status === 'changes_requested') {
    existing.status = 'pending';
    existing.reviewNote = undefined;
  }

  await existing.save();
  sendSuccess(res, {
    message: existing.status === 'pending' ? 'Profile saved and submitted for review' : 'Profile updated',
    data: existing,
  });
});

/** POST /partners/me/submit — submit incomplete or changed profile for review. */
export const submitMineForReview = asyncHandler(async (req, res) => {
  const partner = await PartnerInstitute.findOne({ owner: req.user._id });
  if (!partner) throw ApiError.notFound('Please save your organization profile first');

  partner.status = 'pending';
  partner.reviewNote = undefined;
  await partner.save();

  sendSuccess(res, {
    message: 'Your organization profile has been submitted for admin verification',
    data: partner,
  });
});

/* ---------- admin ---------- */

/** GET /admin/partners — admin list with pagination, search, status, orgType filter. */
export const adminList = asyncHandler(async (req, res) => {
  const { page, limit, skip } = getPagination(req.query, { defaultLimit: 20 });
  const filter = {};
  if (req.query.status) filter.status = String(req.query.status);
  if (req.query.orgType) filter.orgType = String(req.query.orgType);
  if (req.query.q) {
    const regex = new RegExp(escapeRegex(req.query.q), 'i');
    filter.$or = [{ name: regex }, { legalName: regex }, { city: regex }];
  }

  const [items, total] = await Promise.all([
    PartnerInstitute.find(filter)
      .populate('owner', 'name email phone')
      .populate('reviewedBy', 'name email')
      .sort({ createdAt: -1 })
      .skip(skip)
      .limit(limit)
      .lean(),
    PartnerInstitute.countDocuments(filter),
  ]);

  sendSuccess(res, {
    message: 'Partner organizations',
    data: items,
    meta: paginationMeta({ page, limit, total }),
  });
});

/** GET /admin/partners/:id — single organization detail. */
export const adminGetOne = asyncHandler(async (req, res) => {
  if (!mongoose.Types.ObjectId.isValid(req.params.id)) {
    throw ApiError.notFound('Partner organization not found');
  }
  const partner = await PartnerInstitute.findById(req.params.id)
    .populate('owner', 'name email phone')
    .populate('reviewedBy', 'name email')
    .lean();

  if (!partner) throw ApiError.notFound('Partner organization not found');

  const [programmeCount, courseCount] = await Promise.all([
    EducationProgram.countDocuments({ institution: partner._id }),
    Course.countDocuments({ institution: partner._id }),
  ]);

  sendSuccess(res, {
    message: 'Partner organization details',
    data: { ...partner, programmeCount, courseCount },
  });
});

/** PATCH /admin/partners/:id/status — approve / reject / request changes / suspend. */
export const adminSetStatus = asyncHandler(async (req, res) => {
  if (!mongoose.Types.ObjectId.isValid(req.params.id)) {
    throw ApiError.notFound('Partner organization not found');
  }
  const partner = await PartnerInstitute.findById(req.params.id);
  if (!partner) throw ApiError.notFound('Partner organization not found');

  const nextStatus = req.body.status;

  if (nextStatus === 'approved') {
    partner.isApproved = true;

    // Automatically apply and save pending profile changes if any were submitted
    if (partner.pendingChanges && typeof partner.pendingChanges === 'object') {
      const changes = partner.pendingChanges;
      for (const [key, value] of Object.entries(changes)) {
        if (key === 'submittedAt' || key === 'status' || key === 'owner' || key === 'orgType' || key === 'isApproved') {
          continue;
        }
        if (key === 'verificationDetails' && typeof value === 'object' && value !== null) {
          partner.verificationDetails = {
            ...(partner.verificationDetails?.toObject?.() || partner.verificationDetails || {}),
            ...value,
          };
        } else {
          partner[key] = value;
        }
      }
      partner.pendingChanges = null;
      partner.markModified('pendingChanges');
      partner.markModified('verificationDetails');
    }
  } else {
    partner.isApproved = false;
  }

  partner.status = nextStatus;
  partner.reviewNote = req.body.reviewNote || undefined;
  partner.reviewedAt = new Date();
  partner.reviewedBy = req.user._id;
  await partner.save();

  sendSuccess(res, {
    message: `Partner organization status updated to ${partner.status}`,
    data: partner,
  });
});
