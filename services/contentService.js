import mongoose from 'mongoose';
import { ApiError } from '../utils/ApiError.js';
import { escapeRegex, getPagination } from '../utils/pagination.js';

/**
 * Generic list/read helpers shared by the content collections
 * (blogs, courses, programmes, documentation, FAQs, testimonials).
 */
export async function listPublished(Model, query, { searchFields = [], filters = {}, sort = { createdAt: -1 }, populate, defaultLimit = 12 } = {}) {
  const { page, limit, skip } = getPagination(query, { defaultLimit });
  const filter = { ...filters };

  if (query.q && searchFields.length) {
    const rawQ = String(query.q).trim();
    const flexiblePattern = escapeRegex(rawQ).replace(/\\\./g, '\\.?');
    const rx = new RegExp(flexiblePattern, 'i');
    filter.$or = searchFields.map((field) => ({ [field]: rx }));
  }

  let cursor = Model.find(filter).sort(sort).skip(skip).limit(limit);
  if (populate) cursor = cursor.populate(populate);

  const [items, total] = await Promise.all([cursor.lean(), Model.countDocuments(filter)]);
  return { items, total, page, limit };
}

export async function findOneOrFail(Model, filter, { populate, message = 'Not found' } = {}) {
  if (filter && filter._id && !mongoose.Types.ObjectId.isValid(filter._id)) {
    throw ApiError.notFound(message);
  }
  let cursor = Model.findOne(filter);
  if (populate) cursor = cursor.populate(populate);
  const doc = await cursor;
  if (!doc) throw ApiError.notFound(message);
  return doc;
}
