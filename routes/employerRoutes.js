import { Router } from 'express';
import * as jobs from '../controllers/jobController.js';
import { protect, restrictTo } from '../middleware/auth.js';
import { validate } from '../middleware/validate.js';
import { jobSchema, jobUpdateSchema, applicationStatusSchema } from '../validators/schemas.js';

const router = Router();
router.use(protect, restrictTo('employer', 'admin'));

router.route('/jobs').get(jobs.listMyJobs).post(validate(jobSchema), jobs.createJob);
router
  .route('/jobs/:id')
  .get(jobs.getMyJob)
  .patch(validate(jobUpdateSchema), jobs.updateJob)
  .delete(jobs.deleteJob);
router.get('/jobs/:id/applications', jobs.listJobApplications);

router.get('/applications', jobs.listEmployerApplications);
router.patch('/applications/:id/status', validate(applicationStatusSchema), jobs.setApplicationStatus);
router.get('/applications/:id/resume', jobs.downloadApplicationResume);

export default router;
