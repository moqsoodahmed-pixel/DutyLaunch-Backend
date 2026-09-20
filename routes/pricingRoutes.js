import { Router } from 'express';
import * as pricing from '../controllers/pricingController.js';
import { protect, restrictTo } from '../middleware/auth.js';

const router = Router();

router.get('/cv-packages', pricing.listPackages);
router.get('/admin/cv-packages', protect, restrictTo('admin'), pricing.listAllPackages);
router.put('/cv-packages/:id', protect, restrictTo('admin'), pricing.updatePackage);

export default router;
