import { asyncHandler } from '../utils/asyncHandler.js';
import { sendSuccess } from '../utils/apiResponse.js';
import { DocumentationService } from '../models/index.js';
import { findOneOrFail } from '../services/contentService.js';

export const listServices = asyncHandler(async (req, res) => {
  const filter = { status: 'published' };
  if (req.query.category) filter.category = req.query.category;
  const items = await DocumentationService.find(filter).sort({ order: 1, name: 1 }).lean();
  const categories = await DocumentationService.distinct('category', { status: 'published' });
  sendSuccess(res, { message: 'Documentation services', data: items, meta: { categories: categories.sort() } });
});

export const getService = asyncHandler(async (req, res) => {
  const service = await findOneOrFail(
    DocumentationService,
    { slug: req.params.slug, status: 'published' },
    { message: 'That service is not listed' }
  );
  sendSuccess(res, { message: 'Documentation service', data: service });
});

export const createService = asyncHandler(async (req, res) => {
  const service = await DocumentationService.create(req.body);
  sendSuccess(res, { statusCode: 201, message: 'Service created', data: service });
});

export const updateService = asyncHandler(async (req, res) => {
  const service = await findOneOrFail(DocumentationService, { _id: req.params.id }, { message: 'Service not found' });
  Object.assign(service, req.body);
  await service.save();
  sendSuccess(res, { message: 'Service updated', data: service });
});

export const deleteService = asyncHandler(async (req, res) => {
  const service = await findOneOrFail(DocumentationService, { _id: req.params.id }, { message: 'Service not found' });
  await service.deleteOne();
  sendSuccess(res, { message: 'Service deleted', data: { id: service._id } });
});
