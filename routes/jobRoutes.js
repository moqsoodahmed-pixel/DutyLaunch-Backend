import { Router } from 'express';
import * as jobs from '../controllers/jobController.js';
import { protect, optionalAuth } from '../middleware/auth.js';
import { validate } from '../middleware/validate.js';
import { applicationSchema } from '../validators/schemas.js';
import { uploadResume } from '../middleware/upload.js';

const router = Router();

router.get('/', jobs.listJobs);
router.get('/filters', jobs.getJobFilters);
router.get('/:idOrSlug', optionalAuth, jobs.getJob);
router.post(
  '/:id/apply',
  protect,
  uploadResume.single('resume'),
  validate(applicationSchema),
  jobs.applyToJob
);

export default router;
