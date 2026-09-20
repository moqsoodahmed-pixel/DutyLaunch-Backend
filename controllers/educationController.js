import { asyncHandler } from '../utils/asyncHandler.js';
import { sendSuccess, paginationMeta } from '../utils/apiResponse.js';
import { EducationProgram } from '../models/index.js';
import { listPublished, findOneOrFail } from '../services/contentService.js';

export const listPrograms = asyncHandler(async (req, res) => {
  const filters = { status: 'published' };
  if (req.query.level) filters.level = req.query.level;
  if (req.query.field) filters.field = req.query.field;
  if (req.query.destination) filters.destinations = req.query.destination;

  const { items, total, page, limit } = await listPublished(EducationProgram, req.query, {
    searchFields: ['title', 'summary', 'field'],
    filters,
    sort: { title: 1 },
  });
  sendSuccess(res, { message: 'Programmes', data: items, meta: paginationMeta({ page, limit, total }) });
});

export const getProgramFilters = asyncHandler(async (req, res) => {
  const [levels, fields, destinations] = await Promise.all([
    EducationProgram.distinct('level', { status: 'published' }),
    EducationProgram.distinct('field', { status: 'published' }),
    EducationProgram.distinct('destinations', { status: 'published' }),
  ]);
  sendSuccess(res, { message: 'Programme filters', data: { levels, fields: fields.sort(), destinations: destinations.sort() } });
});

export const getProgram = asyncHandler(async (req, res) => {
  const program = await findOneOrFail(
    EducationProgram,
    { slug: req.params.slug, status: 'published' },
    { message: 'That programme is not available' }
  );
  sendSuccess(res, { message: 'Programme', data: program });
});

export const createProgram = asyncHandler(async (req, res) => {
  const program = await EducationProgram.create(req.body);
  sendSuccess(res, { statusCode: 201, message: 'Programme created', data: program });
});

export const updateProgram = asyncHandler(async (req, res) => {
  const program = await findOneOrFail(EducationProgram, { _id: req.params.id }, { message: 'Programme not found' });
  Object.assign(program, req.body);
  await program.save();
  sendSuccess(res, { message: 'Programme updated', data: program });
});

export const deleteProgram = asyncHandler(async (req, res) => {
  const program = await findOneOrFail(EducationProgram, { _id: req.params.id }, { message: 'Programme not found' });
  await program.deleteOne();
  sendSuccess(res, { message: 'Programme deleted', data: { id: program._id } });
});
