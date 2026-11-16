import { Router } from 'express';
import * as cms from '../controllers/cmsController.js';
import { protect, restrictTo } from '../middleware/auth.js';

const router = Router();

// Public route for frontend pages
router.get('/pricing', cms.getPublicPricing);

// Admin-only management endpoints
const adminOnly = [protect, restrictTo('admin')];

router.get('/admin/pricing', ...adminOnly, cms.getAllAdminPricing);
router.post('/admin/pricing', ...adminOnly, cms.createPricingItem);
router.put('/admin/pricing/:id', ...adminOnly, cms.updatePricingItem);
router.delete('/admin/pricing/:id', ...adminOnly, cms.deletePricingItem);
router.put('/admin/config', ...adminOnly, cms.updateGlobalConfig);
router.post('/admin/reset-defaults', ...adminOnly, cms.resetToDefaults);

export default router;
