import { Enrolment, Course, EducationProgram, PartnerInstitute, User } from '../models/index.js';
import { ApiError } from '../utils/ApiError.js';
import { asyncHandler } from '../utils/asyncHandler.js';
import { sendSuccess, paginationMeta } from '../utils/apiResponse.js';
import { getPagination } from '../utils/pagination.js';

/** GET /api/enrolments/mine — candidate's own enrolments */
export const myEnrolments = asyncHandler(async (req, res) => {
  const enrolments = await Enrolment.find({ user: req.user._id })
    .populate('partner', 'name displayName orgType location logoUrl contactEmail')
    .populate('payment', 'amount status receipt paidAt')
    .sort({ createdAt: -1 })
    .lean();

  sendSuccess(res, { message: 'Your enrolments', data: enrolments });
});

/** POST /api/enrolments/apply — candidate submits details to enrol in higher education or course */
export const applyProgram = asyncHandler(async (req, res) => {
  const { itemId, itemType = 'education_program', fullName, name, email, phone, mobileNo, currentDegree } = req.body;
  if (!itemId) throw ApiError.badRequest('Missing programme or course id');

  const candidateName = String(fullName || name || req.user?.name || '').trim();
  const candidateEmail = String(email || req.user?.email || '').trim().toLowerCase();
  const candidatePhone = String(phone || mobileNo || req.user?.phone || '').trim();
  const candidateDegree = String(currentDegree || '').trim();

  if (!candidateName) throw ApiError.badRequest('Please enter your full name');
  if (!candidateEmail) throw ApiError.badRequest('Please enter your email address');
  if (!candidatePhone) throw ApiError.badRequest('Please enter your mobile number');
  if (!candidateDegree) throw ApiError.badRequest('Please enter your current degree');

  let offering;
  let partnerId;
  let title;
  let deliveryFormat = 'Offline';

  if (itemType === 'course') {
    offering = await Course.findOne({ _id: itemId, status: 'published' }).lean();
    if (!offering) throw ApiError.notFound('Course not found');
    partnerId = offering.institution;
    title = offering.title;
    deliveryFormat = offering.deliveryFormat || offering.mode || 'Online';
  } else {
    offering = await EducationProgram.findOne({ _id: itemId, status: 'published' }).lean();
    if (!offering) throw ApiError.notFound('Higher education programme not found');
    partnerId = offering.institution;
    title = offering.title;
    deliveryFormat = offering.deliveryFormat || 'Offline';
  }

  // Associate user account if logged in or existing by email
  let userId = req.user?._id;
  if (!userId && candidateEmail) {
    const existing = await User.findOne({ email: candidateEmail });
    if (existing) userId = existing._id;
  }

  const enrolment = await Enrolment.create({
    user: userId || undefined,
    partner: partnerId,
    itemType: itemType === 'course' ? 'course' : 'education_program',
    itemId,
    offeringTitle: title,
    status: 'confirmed',
    deliveryFormat,
    candidateDetails: {
      fullName: candidateName,
      email: candidateEmail,
      phone: candidatePhone,
      currentDegree: candidateDegree,
    },
    learningAccess: {
      method: (deliveryFormat || 'offline').toLowerCase(),
      instructions: offering.enrolmentInstructions || 'A university counsellor will contact you regarding formal admissions and onboarding.',
    },
  });

  sendSuccess(res, {
    statusCode: 201,
    message: 'Enrolment application submitted successfully',
    data: enrolment,
  });
});

/** POST /api/enrolments/free — candidate enrols in a verified free course */
export const enrolFree = asyncHandler(async (req, res) => {
  const { itemType = 'course', itemId } = req.body;
  if (!itemId) throw ApiError.badRequest('Missing item id');

  let offering;
  let partnerId;
  let title;
  let deliveryFormat = 'Online';
  let learningAccess = { method: 'online', instructions: 'Course access details will be provided by your provider.' };

  if (itemType === 'course') {
    offering = await Course.findOne({ _id: itemId, status: 'published' }).lean();
    if (!offering) throw ApiError.notFound('Course not found');
    if (!offering.isFree && offering.price > 0 && !offering.priceOnRequest) {
      throw ApiError.badRequest('This course is not free. Please complete checkout to enrol.');
    }
    partnerId = offering.institution;
    title = offering.title;
    deliveryFormat = offering.deliveryFormat || offering.mode || 'Online';
    learningAccess = {
      method: (offering.deliveryFormat || 'online').toLowerCase(),
      instructions: offering.learningAccess || offering.enrolmentConditions || 'You are enrolled! Your course coordinator will reach out with start details.',
      venue: offering.location,
    };
  } else {
    offering = await EducationProgram.findOne({ _id: itemId, status: 'published' }).lean();
    if (!offering) throw ApiError.notFound('Programme not found');
    if (offering.fee > 0) {
      throw ApiError.badRequest('This programme has a fee. Please proceed with registration/payment.');
    }
    partnerId = offering.institution;
    title = offering.title;
    deliveryFormat = offering.deliveryFormat || 'Online';
    learningAccess = {
      method: (offering.deliveryFormat || 'online').toLowerCase(),
      instructions: offering.enrolmentInstructions || 'A DutyLaunch higher education advisor will contact you to complete formal enrollment.',
    };
  }

  // Idempotent check
  let enrolment = await Enrolment.findOne({
    user: req.user._id,
    itemType,
    itemId,
  });

  if (!enrolment) {
    try {
      enrolment = await Enrolment.create({
        user: req.user._id,
        partner: partnerId,
        itemType,
        itemId,
        offeringTitle: title,
        status: 'confirmed',
        deliveryFormat,
        learningAccess,
      });
    } catch (err) {
      if (err.code === 11000) {
        enrolment = await Enrolment.findOne({ user: req.user._id, itemType, itemId });
      } else {
        throw err;
      }
    }
  }

  sendSuccess(res, {
    statusCode: 201,
    message: 'Enrolment confirmed successfully',
    data: enrolment,
  });
});

/** GET /api/enrolments/partner — provider views candidates enrolled in their courses */
export const partnerEnrolments = asyncHandler(async (req, res) => {
  const partner = await PartnerInstitute.findOne({ owner: req.user._id });
  if (!partner) {
    return sendSuccess(res, { message: 'No partner profile', data: [] });
  }

  const { page, limit, skip } = getPagination(req.query, { defaultLimit: 20 });
  const filter = { partner: partner._id };

  const [items, total] = await Promise.all([
    Enrolment.find(filter)
      .populate('user', 'name email phone')
      .populate('payment', 'amount status receipt paidAt')
      .sort({ createdAt: -1 })
      .skip(skip)
      .limit(limit)
      .lean(),
    Enrolment.countDocuments(filter),
  ]);

  sendSuccess(res, {
    message: 'Enrolled students',
    data: items,
    meta: paginationMeta({ page, limit, total }),
  });
});

/** GET /api/enrolments/admin — admin view of all platform enrolments */
export const adminEnrolments = asyncHandler(async (req, res) => {
  const { page, limit, skip } = getPagination(req.query, { defaultLimit: 20 });
  const filter = {};
  if (req.query.partner) filter.partner = req.query.partner;
  if (req.query.status) filter.status = req.query.status;

  const [items, total] = await Promise.all([
    Enrolment.find(filter)
      .populate('user', 'name email phone')
      .populate('partner', 'name displayName orgType')
      .populate('payment', 'amount status receipt paidAt')
      .sort({ createdAt: -1 })
      .skip(skip)
      .limit(limit)
      .lean(),
    Enrolment.countDocuments(filter),
  ]);

  sendSuccess(res, {
    message: 'All platform enrolments',
    data: items,
    meta: paginationMeta({ page, limit, total }),
  });
});
