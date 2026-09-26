import { Router } from 'express';
import * as partners from '../controllers/partnerController.js';
import { protect, restrictTo } from '../middleware/auth.js';
import { validate } from '../middleware/validate.js';
import { partnerProfileSchema } from '../validators/schemas.js';

const router = Router();

// Public: approved partners only.
router.get('/', partners.listPublic);

// An institute managing its own profile.
router
  .route('/me')
  .get(protect, restrictTo('institute'), partners.getMine)
  .put(protect, restrictTo('institute'), validate(partnerProfileSchema), partners.upsertMine);

export default router;
