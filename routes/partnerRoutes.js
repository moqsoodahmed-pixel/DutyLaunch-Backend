import { Router } from 'express';
import * as partners from '../controllers/partnerController.js';
import { protect, restrictTo } from '../middleware/auth.js';
import { validate } from '../middleware/validate.js';
import { partnerProfileSchema } from '../validators/schemas.js';

const router = Router();

// An institute/partner managing its own profile.
router
  .route('/me')
  .get(protect, restrictTo('institute', 'partner'), partners.getMine)
  .put(protect, restrictTo('institute', 'partner'), validate(partnerProfileSchema), partners.upsertMine);

router.post('/me/submit', protect, restrictTo('institute', 'partner'), partners.submitMineForReview);

// Public: approved partners only.
router.get('/', partners.listPublic);
router.get('/:id', partners.getPublicById);

export default router;
