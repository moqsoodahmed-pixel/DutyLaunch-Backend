import { asyncHandler } from '../utils/asyncHandler.js';
import { sendSuccess, paginationMeta } from '../utils/apiResponse.js';
import { Course, CourseCategory } from '../models/index.js';
import { listPublished, findOneOrFail } from '../services/contentService.js';

export const listCourses = asyncHandler(async (req, res) => {
  const filters = { status: 'published' };
  if (req.query.track) filters.track = req.query.track;
  if (req.query.level) filters.level = req.query.level;
  if (req.query.category) {
    const category = await CourseCategory.findOne({ slug: req.query.category });
    if (category) filters.category = category._id;
  }

  const { items, total, page, limit } = await listPublished(Course, req.query, {
    searchFields: ['title', 'summary'],
    filters,
    sort: { createdAt: -1 },
    populate: { path: 'category', select: 'name slug icon' },
  });

  sendSuccess(res, { message: 'Courses', data: items, meta: paginationMeta({ page, limit, total }) });
});

export const listCategories = asyncHandler(async (req, res) => {
  const categories = await CourseCategory.find().sort({ order: 1, name: 1 }).lean();
  sendSuccess(res, { message: 'Course categories', data: categories });
});

export const getCourse = asyncHandler(async (req, res) => {
  const course = await findOneOrFail(
    Course,
    { slug: req.params.slug, status: 'published' },
    { populate: { path: 'category', select: 'name slug icon' }, message: 'That course is not available' }
  );
  const related = await Course.find({ _id: { $ne: course._id }, status: 'published', track: course.track })
    .limit(3)
    .select('title slug summary duration level price priceOnRequest')
    .lean();
  sendSuccess(res, { message: 'Course', data: { course, related } });
});

export const createCourse = asyncHandler(async (req, res) => {
  const course = await Course.create(req.body);
  sendSuccess(res, { statusCode: 201, message: 'Course created', data: course });
});

export const updateCourse = asyncHandler(async (req, res) => {
  const course = await findOneOrFail(Course, { _id: req.params.id }, { message: 'Course not found' });
  Object.assign(course, req.body);
  await course.save();
  sendSuccess(res, { message: 'Course updated', data: course });
});

export const deleteCourse = asyncHandler(async (req, res) => {
  const course = await findOneOrFail(Course, { _id: req.params.id }, { message: 'Course not found' });
  await course.deleteOne();
  sendSuccess(res, { message: 'Course deleted', data: { id: course._id } });
});

export const listAllCourses = asyncHandler(async (req, res) => {
  const { items, total, page, limit } = await listPublished(Course, req.query, {
    searchFields: ['title'],
    filters: req.query.status ? { status: req.query.status } : {},
    sort: { updatedAt: -1 },
    populate: { path: 'category', select: 'name' },
    defaultLimit: 20,
  });
  sendSuccess(res, { message: 'All courses', data: items, meta: paginationMeta({ page, limit, total }) });
});
