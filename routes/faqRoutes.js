import { Router } from 'express';
import * as faq from '../controllers/faqController.js';
import { protect, restrictTo } from '../middleware/auth.js';
import { validate } from '../middleware/validate.js';
import { faqSchema } from '../validators/schemas.js';

const router = Router();
const adminOnly = [protect, restrictTo('admin')];

router.get('/', faq.listFaqs);
router.get('/admin/all', ...adminOnly, faq.listAllFaqs);
router.post('/', ...adminOnly, validate(faqSchema), faq.createFaq);
router.put('/:id', ...adminOnly, validate(faqSchema.partial()), faq.updateFaq);
router.delete('/:id', ...adminOnly, faq.deleteFaq);

export default router;
