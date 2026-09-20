import { asyncHandler } from '../utils/asyncHandler.js';
import { sendSuccess } from '../utils/apiResponse.js';
import { Testimonial } from '../models/index.js';
import { findOneOrFail } from '../services/contentService.js';

export const listTestimonials = asyncHandler(async (req, res) => {
  const items = await Testimonial.find({ isPublished: true }).sort({ order: 1, createdAt: -1 }).lean();
  sendSuccess(res, { message: 'Testimonials', data: items });
});

export const listAllTestimonials = asyncHandler(async (req, res) => {
  const items = await Testimonial.find().sort({ order: 1, createdAt: -1 }).lean();
  sendSuccess(res, { message: 'All testimonials', data: items });
});

export const createTestimonial = asyncHandler(async (req, res) => {
  const testimonial = await Testimonial.create(req.body);
  sendSuccess(res, { statusCode: 201, message: 'Testimonial created', data: testimonial });
});

export const updateTestimonial = asyncHandler(async (req, res) => {
  const testimonial = await findOneOrFail(Testimonial, { _id: req.params.id }, { message: 'Testimonial not found' });
  Object.assign(testimonial, req.body);
  await testimonial.save();
  sendSuccess(res, { message: 'Testimonial updated', data: testimonial });
});

export const deleteTestimonial = asyncHandler(async (req, res) => {
  const testimonial = await findOneOrFail(Testimonial, { _id: req.params.id }, { message: 'Testimonial not found' });
  await testimonial.deleteOne();
  sendSuccess(res, { message: 'Testimonial deleted', data: { id: testimonial._id } });
});
