import { asyncHandler } from '../utils/asyncHandler.js';
import { sendSuccess } from '../utils/apiResponse.js';
import { FAQ, FAQ_CATEGORIES } from '../models/index.js';
import { findOneOrFail } from '../services/contentService.js';
import { escapeRegex } from '../utils/pagination.js';

export const listFaqs = asyncHandler(async (req, res) => {
  const filter = { isPublished: true };
  if (req.query.category && req.query.category !== 'All') filter.category = req.query.category;
  if (req.query.q) {
    const rx = new RegExp(escapeRegex(req.query.q), 'i');
    filter.$or = [{ question: rx }, { answer: rx }];
  }

  const items = await FAQ.find(filter).sort({ category: 1, order: 1 }).lean();
  sendSuccess(res, { message: 'FAQs', data: items, meta: { categories: FAQ_CATEGORIES } });
});

export const listAllFaqs = asyncHandler(async (req, res) => {
  const items = await FAQ.find().sort({ category: 1, order: 1 }).lean();
  sendSuccess(res, { message: 'All FAQs', data: items, meta: { categories: FAQ_CATEGORIES } });
});

export const createFaq = asyncHandler(async (req, res) => {
  const faq = await FAQ.create(req.body);
  sendSuccess(res, { statusCode: 201, message: 'FAQ created', data: faq });
});

export const updateFaq = asyncHandler(async (req, res) => {
  const faq = await findOneOrFail(FAQ, { _id: req.params.id }, { message: 'FAQ not found' });
  Object.assign(faq, req.body);
  await faq.save();
  sendSuccess(res, { message: 'FAQ updated', data: faq });
});

export const deleteFaq = asyncHandler(async (req, res) => {
  const faq = await findOneOrFail(FAQ, { _id: req.params.id }, { message: 'FAQ not found' });
  await faq.deleteOne();
  sendSuccess(res, { message: 'FAQ deleted', data: { id: faq._id } });
});
