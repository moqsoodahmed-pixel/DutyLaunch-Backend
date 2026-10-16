import { asyncHandler } from '../utils/asyncHandler.js';
import { sendSuccess, paginationMeta } from '../utils/apiResponse.js';
import { ApiError } from '../utils/ApiError.js';
import { EducationProgram, PartnerInstitute } from '../models/index.js';
import { listPublished, findOneOrFail } from '../services/contentService.js';
import { getPagination, escapeRegex } from '../utils/pagination.js';

/* ---------- Public ---------- */

export const listPrograms = asyncHandler(async (req, res) => {
  const filters = { status: 'published', approvalStatus: 'approved' };
  if (req.query.level) filters.level = req.query.level;
  if (req.query.field) filters.field = req.query.field;
  if (req.query.destination) filters.destinations = req.query.destination;
  if (req.query.deliveryFormat) filters.deliveryFormat = req.query.deliveryFormat;
  if (req.query.institution) filters.institution = req.query.institution;

  const { items, total, page, limit } = await listPublished(EducationProgram, req.query, {
    searchFields: ['title', 'summary', 'field', 'qualification'],
    filters,
    sort: { createdAt: -1 },
    populate: { path: 'institution', select: 'name displayName logoUrl location mode orgType status' },
  });

  sendSuccess(res, { message: 'Higher education programmes', data: items, meta: paginationMeta({ page, limit, total }) });
});

export const getProgramFilters = asyncHandler(async (req, res) => {
  const [levels, fields, destinations, deliveryFormats] = await Promise.all([
    EducationProgram.distinct('level', { status: 'published', approvalStatus: 'approved' }),
    EducationProgram.distinct('field', { status: 'published', approvalStatus: 'approved' }),
    EducationProgram.distinct('destinations', { status: 'published', approvalStatus: 'approved' }),
    EducationProgram.distinct('deliveryFormat', { status: 'published', approvalStatus: 'approved' }),
  ]);
  sendSuccess(res, {
    message: 'Programme filters',
    data: {
      levels,
      fields: fields.sort(),
      destinations: destinations.sort(),
      deliveryFormats,
    },
  });
});

export const getProgram = asyncHandler(async (req, res) => {
  const isObjectId = /^[a-f\d]{24}$/i.test(req.params.slug);
  const query = isObjectId
    ? { _id: req.params.slug, status: 'published', approvalStatus: 'approved' }
    : { slug: req.params.slug, status: 'published', approvalStatus: 'approved' };

  const program = await findOneOrFail(EducationProgram, query, {
    populate: { path: 'institution', select: 'name displayName logoUrl coverImageUrl location about website mode' },
    message: 'That programme is not available or not yet published',
  });

  sendSuccess(res, { message: 'Programme details', data: program });
});

/* ---------- Partner (University) Management ---------- */

/** GET /education/mine — list programmes belonging to the signed-in partner institution. */
export const listMine = asyncHandler(async (req, res) => {
  const partner = await PartnerInstitute.findOne({ owner: req.user._id });
  if (!partner) {
    return sendSuccess(res, { message: 'Your programmes', data: [] });
  }

  const programmes = await EducationProgram.find({ institution: partner._id })
    .sort({ createdAt: -1 })
    .lean();

  sendSuccess(res, { message: 'Your education programmes', data: programmes });
});

/** POST /education — create a new programme under the verified partner institution. */
export const createProgram = asyncHandler(async (req, res) => {
  // Enforced by requireVerifiedPartner middleware: req.partner is guaranteed to be approved
  const partnerId = req.partner?._id;
  if (!partnerId && req.user.role !== 'admin') {
    throw ApiError.forbidden('Organization must be verified before creating programmes');
  }

  const payload = { ...req.body };
  if (partnerId) {
    payload.institution = partnerId;
  }

  // Determine initial approval status
  if (payload.submitForReview) {
    payload.approvalStatus = 'pending';
    payload.status = 'draft'; // only published once admin approves
  } else if (!payload.approvalStatus) {
    payload.approvalStatus = req.user.role === 'admin' ? 'approved' : 'draft';
  }

  const program = await EducationProgram.create(payload);

  sendSuccess(res, {
    statusCode: 201,
    message: program.approvalStatus === 'pending' ? 'Programme created and submitted for review' : 'Programme draft created',
    data: program,
  });
});

/** PUT /education/:id — update a programme (ownership enforced). */
export const updateProgram = asyncHandler(async (req, res) => {
  const program = await findOneOrFail(EducationProgram, { _id: req.params.id }, { message: 'Programme not found' });

  // Ownership verification: user can only edit their own institution's programme unless admin
  if (req.user.role !== 'admin') {
    if (!req.partner || String(program.institution) !== String(req.partner._id)) {
      throw ApiError.forbidden('You can only modify programmes belonging to your own institution');
    }
  }

  const updates = { ...req.body };
  delete updates.institution; // prevent re-assigning ownership

  // If submitting for review or resubmitting after changes requested / rejected
  if (updates.submitForReview || program.approvalStatus === 'changes_requested' || program.approvalStatus === 'rejected') {
    updates.approvalStatus = 'pending';
    updates.adminFeedback = undefined;
  } else if (program.approvalStatus === 'approved' && req.user.role !== 'admin') {
    // Material edits to an approved programme require re-review
    const isMaterialChange = ['title', 'level', 'fee', 'deliveryFormat', 'syllabusUrl'].some(
      (k) => k in updates && String(updates[k]) !== String(program[k])
    );
    if (isMaterialChange) {
      updates.approvalStatus = 'pending';
    }
  }

  Object.assign(program, updates);
  await program.save();

  sendSuccess(res, {
    message: program.approvalStatus === 'pending' ? 'Programme updated and submitted for review' : 'Programme updated',
    data: program,
  });
});

/** DELETE /education/:id — delete a programme (ownership enforced). */
export const deleteProgram = asyncHandler(async (req, res) => {
  const program = await findOneOrFail(EducationProgram, { _id: req.params.id }, { message: 'Programme not found' });

  if (req.user.role !== 'admin') {
    if (!req.partner || String(program.institution) !== String(req.partner._id)) {
      throw ApiError.forbidden('You can only delete programmes belonging to your own institution');
    }
  }

  await program.deleteOne();
  sendSuccess(res, { message: 'Programme deleted', data: { id: program._id } });
});

/* ---------- Admin Moderation ---------- */

/** GET /admin/education/all — admin listing with search, approvalStatus, institution filter. */
export const adminListAll = asyncHandler(async (req, res) => {
  const { page, limit, skip } = getPagination(req.query, { defaultLimit: 20 });
  const filter = {};
  if (req.query.approvalStatus) filter.approvalStatus = String(req.query.approvalStatus);
  if (req.query.status) filter.status = String(req.query.status);
  if (req.query.institution) filter.institution = req.query.institution;
  if (req.query.q) {
    const regex = new RegExp(escapeRegex(req.query.q), 'i');
    filter.$or = [{ title: regex }, { qualification: regex }, { field: regex }];
  }

  const [items, total] = await Promise.all([
    EducationProgram.find(filter)
      .populate('institution', 'name displayName orgType location status')
      .populate('reviewedBy', 'name email')
      .sort({ createdAt: -1 })
      .skip(skip)
      .limit(limit)
      .lean(),
    EducationProgram.countDocuments(filter),
  ]);

  sendSuccess(res, {
    message: 'All programmes',
    data: items,
    meta: paginationMeta({ page, limit, total }),
  });
});

/** PATCH /admin/education/:id/moderate — approve, reject, or request changes. */
export const adminModerate = asyncHandler(async (req, res) => {
  const program = await findOneOrFail(EducationProgram, { _id: req.params.id }, { message: 'Programme not found' });

  program.approvalStatus = req.body.approvalStatus;
  program.adminFeedback = req.body.adminFeedback || undefined;
  program.reviewedAt = new Date();
  program.reviewedBy = req.user._id;

  if (req.body.approvalStatus === 'approved') {
    // When approved, automatically set status to published if requested or keep published
    program.status = req.body.status || 'published';
  } else if (['rejected', 'changes_requested', 'draft'].includes(req.body.approvalStatus)) {
    program.status = 'draft'; // unpublished
  }

  await program.save();

  sendSuccess(res, {
    message: `Programme review status set to ${program.approvalStatus}`,
    data: program,
  });
});
