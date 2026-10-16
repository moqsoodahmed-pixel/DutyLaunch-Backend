import { Router } from 'express';
import * as settlements from '../controllers/settlementController.js';
import { protect, restrictTo } from '../middleware/auth.js';
import { validate } from '../middleware/validate.js';
import { feeConfigSchema, settlementUpdateSchema } from '../validators/schemas.js';

const router = Router();
const adminOnly = [protect, restrictTo('admin')];

// Provider views own settlements
router.get('/mine', protect, restrictTo('institute', 'partner'), settlements.mySettlements);

// Admin settlements
router.get('/admin', ...adminOnly, settlements.adminListSettlements);
router.post('/generate', ...adminOnly, settlements.adminGenerateSettlement);
router.patch('/:id', ...adminOnly, validate(settlementUpdateSchema), settlements.adminUpdateSettlement);

// Fee configuration
router.get('/fees', ...adminOnly, settlements.listFeeConfigs);
router.post('/fees', ...adminOnly, validate(feeConfigSchema), settlements.upsertFeeConfig);
router.delete('/fees/:id', ...adminOnly, settlements.deleteFeeConfig);

export default router;
