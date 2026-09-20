import { asyncHandler } from '../utils/asyncHandler.js';
import { sendSuccess, paginationMeta } from '../utils/apiResponse.js';
import { Consultation, ContactMessage } from '../models/index.js';
import { getPagination } from '../utils/pagination.js';
import { findOneOrFail } from '../services/contentService.js';
import { logger } from '../utils/logger.js';

export const createConsultation = asyncHandler(async (req, res) => {
  const consultation = await Consultation.create(req.body);
  logger.info(`New consultation request #${consultation._id} (${consultation.service})`);
  sendSuccess(res, {
    statusCode: 201,
    message: 'Request received. A counsellor will call you within one working day.',
    data: { id: consultation._id },
  });
});

export const createContactMessage = asyncHandler(async (req, res) => {
  const message = await ContactMessage.create(req.body);
  sendSuccess(res, {
    statusCode: 201,
    message: 'Message sent. We reply within one working day.',
    data: { id: message._id },
  });
});

/* ---------- admin ---------- */
function buildAdminList(Model, label) {
  return asyncHandler(async (req, res) => {
    const { page, limit, skip } = getPagination(req.query, { defaultLimit: 20 });
    const filter = {};
    if (req.query.status) filter.status = req.query.status;

    const [items, total] = await Promise.all([
      Model.find(filter).sort({ createdAt: -1 }).skip(skip).limit(limit).lean(),
      Model.countDocuments(filter),
    ]);
    sendSuccess(res, { message: label, data: items, meta: paginationMeta({ page, limit, total }) });
  });
}

export const listConsultations = buildAdminList(Consultation, 'Consultation requests');
export const listContactMessages = buildAdminList(ContactMessage, 'Contact messages');

export const updateConsultation = asyncHandler(async (req, res) => {
  const consultation = await findOneOrFail(Consultation, { _id: req.params.id }, { message: 'Request not found' });
  if (req.body.status) consultation.status = req.body.status;
  if (req.body.internalNote !== undefined) consultation.internalNote = req.body.internalNote;
  consultation.handledBy = req.user._id;
  await consultation.save();
  sendSuccess(res, { message: 'Request updated', data: consultation });
});

export const updateContactMessage = asyncHandler(async (req, res) => {
  const message = await findOneOrFail(ContactMessage, { _id: req.params.id }, { message: 'Message not found' });
  if (req.body.status) message.status = req.body.status;
  await message.save();
  sendSuccess(res, { message: 'Message updated', data: message });
});
