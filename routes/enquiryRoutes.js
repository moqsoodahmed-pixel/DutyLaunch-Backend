import { Router } from 'express';
import * as enquiry from '../controllers/enquiryController.js';
import { validate } from '../middleware/validate.js';
import { formLimiter } from '../middleware/rateLimiters.js';
import { consultationSchema, contactSchema, statusUpdateSchema } from '../validators/schemas.js';
import { protect, restrictTo } from '../middleware/auth.js';

const consultationRouter = Router();
const contactRouter = Router();
const adminOnly = [protect, restrictTo('admin')];

consultationRouter.post('/', formLimiter, validate(consultationSchema), enquiry.createConsultation);
consultationRouter.get('/', ...adminOnly, enquiry.listConsultations);
consultationRouter.patch('/:id', ...adminOnly, validate(statusUpdateSchema), enquiry.updateConsultation);

contactRouter.post('/', formLimiter, validate(contactSchema), enquiry.createContactMessage);
contactRouter.get('/', ...adminOnly, enquiry.listContactMessages);
contactRouter.patch('/:id', ...adminOnly, validate(statusUpdateSchema), enquiry.updateContactMessage);

export { consultationRouter, contactRouter };
