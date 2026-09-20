import { Router } from 'express';
import * as admin from '../controllers/adminController.js';
import { protect, restrictTo } from '../middleware/auth.js';
import { validate } from '../middleware/validate.js';
import { adminUserUpdateSchema } from '../validators/schemas.js';

const router = Router();
router.use(protect, restrictTo('admin'));

router.get('/dashboard', admin.dashboard);
router.get('/users', admin.listUsers);
router.patch('/users/:id', validate(adminUserUpdateSchema), admin.updateUser);
router.get('/jobs', admin.listAllJobs);
router.patch('/jobs/:id/moderate', admin.moderateJob);
router.get('/applications', admin.listAllApplications);

export default router;
