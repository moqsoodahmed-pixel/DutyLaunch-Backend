import { asyncHandler } from '../utils/asyncHandler.js';
import { sendSuccess, paginationMeta } from '../utils/apiResponse.js';
import { ApiError } from '../utils/ApiError.js';
import { Course, CourseCategory, PartnerInstitute } from '../models/index.js';
import { listPublished, findOneOrFail } from '../services/contentService.js';
import { getPagination, escapeRegex } from '../utils/pagination.js';

/* ---------- Public ---------- */

export const listCourses = asyncHandler(async (req, res) => {
  const filters = { status: 'published', approvalStatus: 'approved' };
  if (req.query.track) filters.track = req.query.track;
  if (req.query.level) filters.level = req.query.level;
  if (req.query.deliveryFormat) filters.deliveryFormat = req.query.deliveryFormat;
  if (req.query.institution) filters.institution = req.query.institution;
  if (req.query.category) {
    const category = await CourseCategory.findOne({ slug: req.query.category });
    if (category) filters.category = category._id;
  }

  const { items, total, page, limit } = await listPublished(Course, req.query, {
    searchFields: ['title', 'summary', 'location'],
    filters,
    sort: { createdAt: -1 },
    populate: [
      { path: 'category', select: 'name slug icon' },
      { path: 'institution', select: 'name displayName logoUrl coverImageUrl location city state mode orgType status' },
    ],
  });

  sendSuccess(res, { message: 'Courses', data: items, meta: paginationMeta({ page, limit, total }) });
});

export const listCategories = asyncHandler(async (req, res) => {
  const categories = await CourseCategory.find().sort({ order: 1, name: 1 }).lean();
  sendSuccess(res, { message: 'Course categories', data: categories });
});

export const getCourse = asyncHandler(async (req, res) => {
  const isObjectId = /^[a-f\d]{24}$/i.test(req.params.slug);
  const query = isObjectId
    ? { _id: req.params.slug, status: 'published', approvalStatus: 'approved' }
    : { slug: req.params.slug, status: 'published', approvalStatus: 'approved' };

  const course = await findOneOrFail(
    Course,
    query,
    {
      populate: [
        { path: 'category', select: 'name slug icon' },
        { path: 'institution', select: 'name displayName legalName logoUrl coverImageUrl location address city state country mode about website contactEmail contactPhone orgType status' },
      ],
      message: 'That course is not available or not yet published',
    }
  );

  const related = await Course.find({ _id: { $ne: course._id }, status: 'published', approvalStatus: 'approved', track: course.track })
    .limit(3)
    .populate([
      { path: 'category', select: 'name slug icon' },
      { path: 'institution', select: 'name displayName logoUrl coverImageUrl location city state mode orgType status' },
    ])
    .lean();

  sendSuccess(res, { message: 'Course', data: { course, related } });
});

/* ---------- Partner (EdTech) Management ---------- */

/** GET /courses/mine — list courses belonging to the signed-in partner. */
export const listMine = asyncHandler(async (req, res) => {
  const partner = await PartnerInstitute.findOne({ owner: req.user._id });
  if (!partner) {
    return sendSuccess(res, { message: 'Your courses', data: [] });
  }

  const courses = await Course.find({ institution: partner._id })
    .populate('category', 'name slug')
    .sort({ createdAt: -1 })
    .lean();

  sendSuccess(res, { message: 'Your courses', data: courses });
});

/** Helper to validate scheduled start/end dates */
function validateDates(startDate, endDate) {
  if (startDate && endDate) {
    const start = new Date(startDate);
    const end = new Date(endDate);
    if (end < start) {
      throw ApiError.badRequest('End date cannot be earlier than start date');
    }
  }
}

/** POST /courses — create a new course under the verified partner institution. */
export const createCourse = asyncHandler(async (req, res) => {
  const partnerId = req.partner?._id;
  if (!partnerId && req.user.role !== 'admin') {
    throw ApiError.forbidden('Organization must be verified before creating courses');
  }

  const payload = { ...req.body };
  if (partnerId) {
    payload.institution = partnerId;
  }

  if (payload.startDate === '') delete payload.startDate;
  if (payload.endDate === '') delete payload.endDate;

  validateDates(payload.startDate, payload.endDate);

  // Handle free vs paid pricing
  if (payload.isFree) {
    payload.price = 0;
    payload.priceOnRequest = false;
  }

  if (payload.submitForReview) {
    payload.approvalStatus = 'pending';
    payload.status = 'draft';
  } else if (!payload.approvalStatus) {
    payload.approvalStatus = req.user.role === 'admin' ? 'approved' : 'draft';
  }

  const course = await Course.create(payload);
  sendSuccess(res, {
    statusCode: 201,
    message: course.approvalStatus === 'pending' ? 'Course created and submitted for review' : 'Course draft created',
    data: course,
  });
});

/** PUT /courses/:id — update course with ownership enforcement. */
export const updateCourse = asyncHandler(async (req, res) => {
  const course = await findOneOrFail(Course, { _id: req.params.id }, { message: 'Course not found' });

  if (req.user.role === 'admin' && course.institution) {
    throw ApiError.forbidden('Admin cannot directly edit partner courses. Use moderation actions instead.');
  }

  if (req.user.role !== 'admin') {
    if (!req.partner || String(course.institution) !== String(req.partner._id)) {
      throw ApiError.forbidden('You can only modify courses belonging to your own organization');
    }
  }

  const updates = { ...req.body };
  delete updates.institution;

  if (updates.startDate === '') updates.startDate = undefined;
  if (updates.endDate === '') updates.endDate = undefined;

  validateDates(updates.startDate || course.startDate, updates.endDate || course.endDate);

  if (updates.isFree) {
    updates.price = 0;
    updates.priceOnRequest = false;
  }

  if (updates.submitForReview || course.approvalStatus === 'changes_requested' || course.approvalStatus === 'rejected') {
    updates.approvalStatus = 'pending';
    updates.adminFeedback = undefined;
  } else if (course.approvalStatus === 'approved' && req.user.role !== 'admin') {
    const isMaterialChange = ['title', 'price', 'isFree', 'deliveryFormat', 'syllabusUrl'].some(
      (k) => k in updates && String(updates[k]) !== String(course[k])
    );
    if (isMaterialChange) {
      updates.approvalStatus = 'pending';
    }
  }

  Object.assign(course, updates);
  await course.save();

  sendSuccess(res, {
    message: course.approvalStatus === 'pending' ? 'Course updated and submitted for review' : 'Course updated',
    data: course,
  });
});

/** DELETE /courses/:id — delete course with ownership enforcement. */
export const deleteCourse = asyncHandler(async (req, res) => {
  const course = await findOneOrFail(Course, { _id: req.params.id }, { message: 'Course not found' });

  if (req.user.role !== 'admin') {
    if (!req.partner || String(course.institution) !== String(req.partner._id)) {
      throw ApiError.forbidden('You can only delete courses belonging to your own organization');
    }
  }

  await course.deleteOne();
  sendSuccess(res, { message: 'Course deleted', data: { id: course._id } });
});

/* ---------- Admin Moderation & Listing ---------- */

export const listAllCourses = asyncHandler(async (req, res) => {
  const { page, limit, skip } = getPagination(req.query, { defaultLimit: 20 });
  const filter = {};
  if (req.query.status) filter.status = req.query.status;
  if (req.query.approvalStatus) filter.approvalStatus = req.query.approvalStatus;
  if (req.query.institution) filter.institution = req.query.institution;
  if (req.query.q) {
    filter.title = new RegExp(escapeRegex(req.query.q), 'i');
  }

  const [items, total] = await Promise.all([
    Course.find(filter)
      .populate('category', 'name')
      .populate('institution', 'name displayName orgType location status')
      .populate('reviewedBy', 'name email')
      .sort({ updatedAt: -1 })
      .skip(skip)
      .limit(limit)
      .lean(),
    Course.countDocuments(filter),
  ]);

  sendSuccess(res, { message: 'All courses', data: items, meta: paginationMeta({ page, limit, total }) });
});

export const adminModerateCourse = asyncHandler(async (req, res) => {
  const course = await findOneOrFail(Course, { _id: req.params.id }, { message: 'Course not found' });

  course.approvalStatus = req.body.approvalStatus;
  course.adminFeedback = req.body.adminFeedback || undefined;
  course.reviewedAt = new Date();
  course.reviewedBy = req.user._id;

  if (req.body.approvalStatus === 'approved') {
    course.status = req.body.status || 'published';
  } else if (['rejected', 'changes_requested', 'draft'].includes(req.body.approvalStatus)) {
    course.status = 'draft';
  }

  await course.save();

  sendSuccess(res, {
    message: `Course review status set to ${course.approvalStatus}`,
    data: course,
  });
});
