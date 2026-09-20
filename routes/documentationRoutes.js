import { Router } from 'express';
import * as docs from '../controllers/documentationController.js';
import { protect, restrictTo } from '../middleware/auth.js';

const router = Router();
const adminOnly = [protect, restrictTo('admin')];

router.get('/', docs.listServices);
router.get('/:slug', docs.getService);
router.post('/', ...adminOnly, docs.createService);
router.put('/:id', ...adminOnly, docs.updateService);
router.delete('/:id', ...adminOnly, docs.deleteService);

export default router;
