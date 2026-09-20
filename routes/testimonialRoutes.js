import { Router } from 'express';
import * as testimonial from '../controllers/testimonialController.js';
import { protect, restrictTo } from '../middleware/auth.js';
import { validate } from '../middleware/validate.js';
import { testimonialSchema } from '../validators/schemas.js';

const router = Router();
const adminOnly = [protect, restrictTo('admin')];

router.get('/', testimonial.listTestimonials);
router.get('/admin/all', ...adminOnly, testimonial.listAllTestimonials);
router.post('/', ...adminOnly, validate(testimonialSchema), testimonial.createTestimonial);
router.put('/:id', ...adminOnly, validate(testimonialSchema.partial()), testimonial.updateTestimonial);
router.delete('/:id', ...adminOnly, testimonial.deleteTestimonial);

export default router;
