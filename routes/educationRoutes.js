import { Router } from 'express';
import * as education from '../controllers/educationController.js';
import { protect, restrictTo } from '../middleware/auth.js';
import { requireVerifiedPartner } from '../middleware/partnerVerification.js';
import { validate } from '../middleware/validate.js';
import { educationProgramSchema } from '../validators/schemas.js';

const router = Router();
const partnerOrAdmin = [protect, restrictTo('admin', 'institute', 'partner')];

// Public routes
router.get('/programs', education.listPrograms);
router.get('/filters', education.getProgramFilters);
router.get('/programs/:slug', education.getProgram);

// Partner routes (University management)
router.get('/mine', protect, restrictTo('institute', 'partner'), education.listMine);

router.post(
  '/programs',
  ...partnerOrAdmin,
  requireVerifiedPartner,
  validate(educationProgramSchema),
  education.createProgram
);

router.put(
  '/programs/:id',
  ...partnerOrAdmin,
  requireVerifiedPartner,
  validate(educationProgramSchema),
  education.updateProgram
);

router.delete(
  '/programs/:id',
  ...partnerOrAdmin,
  requireVerifiedPartner,
  education.deleteProgram
);

export default router;
