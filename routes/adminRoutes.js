import { Router } from 'express';
import * as admin from '../controllers/adminController.js';
import * as partners from '../controllers/partnerController.js';
import * as scoring from '../controllers/scoringController.js';
import * as education from '../controllers/educationController.js';
import * as course from '../controllers/courseController.js';
import { protect, restrictTo } from '../middleware/auth.js';
import { validate } from '../middleware/validate.js';
import {
  adminUserUpdateSchema,
  partnerStatusSchema,
  scoringConfigSchema,
  listingModerationSchema,
} from '../validators/schemas.js';

const router = Router();
router.use(protect, restrictTo('admin'));

router.get('/dashboard', admin.dashboard);
router.get('/users', admin.listUsers);
router.patch('/users/:id', validate(adminUserUpdateSchema), admin.updateUser);
router.get('/jobs', admin.listAllJobs);
router.patch('/jobs/:id/moderate', admin.moderateJob);
router.get('/applications', admin.listAllApplications);
router.get('/resume-checks', admin.listResumeChecks);

// Organization verification
router.get('/partners', partners.adminList);
router.get('/partners/:id', partners.adminGetOne);
router.patch('/partners/:id/status', validate(partnerStatusSchema), partners.adminSetStatus);

// Listing moderation (Higher education programmes & EdTech courses)
router.get('/education/all', education.adminListAll);
router.patch('/education/:id/moderate', validate(listingModerationSchema), education.adminModerate);
router.get('/courses/all', course.listAllCourses);
router.patch('/courses/:id/moderate', validate(listingModerationSchema), course.adminModerateCourse);

/* Scoring weights (spec §37). Literal paths before /:id. */
router.get('/scoring', scoring.list);
router.post('/scoring', validate(scoringConfigSchema), scoring.create);
router.post('/scoring/use-defaults', scoring.useDefaults);
router.put('/scoring/:id', validate(scoringConfigSchema), scoring.update);
router.post('/scoring/:id/activate', scoring.activate);
router.delete('/scoring/:id', scoring.remove);

export default router;