import { Router } from 'express';
import * as admin from '../controllers/adminController.js';
import * as partners from '../controllers/partnerController.js';
import * as scoring from '../controllers/scoringController.js';
import { protect, restrictTo } from '../middleware/auth.js';
import { validate } from '../middleware/validate.js';
import { adminUserUpdateSchema, partnerStatusSchema, scoringConfigSchema } from '../validators/schemas.js';

const router = Router();
router.use(protect, restrictTo('admin'));

router.get('/dashboard', admin.dashboard);
router.get('/users', admin.listUsers);
router.patch('/users/:id', validate(adminUserUpdateSchema), admin.updateUser);
router.get('/jobs', admin.listAllJobs);
router.patch('/jobs/:id/moderate', admin.moderateJob);
router.get('/applications', admin.listAllApplications);
router.get('/resume-checks', admin.listResumeChecks);
router.get('/partners', partners.adminList);
router.patch('/partners/:id/status', validate(partnerStatusSchema), partners.adminSetStatus);

/* Scoring weights (spec §37). Literal paths before /:id. */
router.get('/scoring', scoring.list);
router.post('/scoring', validate(scoringConfigSchema), scoring.create);
router.post('/scoring/use-defaults', scoring.useDefaults);
router.put('/scoring/:id', validate(scoringConfigSchema), scoring.update);
router.post('/scoring/:id/activate', scoring.activate);
router.delete('/scoring/:id', scoring.remove);

export default router;