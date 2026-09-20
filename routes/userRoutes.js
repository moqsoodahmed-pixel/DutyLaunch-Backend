import { Router } from 'express';
import * as user from '../controllers/userController.js';
import { protect } from '../middleware/auth.js';
import { validate } from '../middleware/validate.js';
import { updateProfileSchema } from '../validators/schemas.js';
import { uploadResume } from '../middleware/upload.js';

const router = Router();
router.use(protect);

router.get('/profile', user.getProfile);
router.patch('/profile', validate(updateProfileSchema), user.updateProfile);
router.post('/profile/resume', uploadResume.single('resume'), user.uploadResume);
router.get('/profile/resume', user.downloadMyResume);

router.get('/applications', user.getMyApplications);
router.patch('/applications/:id/withdraw', user.withdrawApplication);

router.get('/saved-jobs', user.getSavedJobs);
router.post('/saved-jobs/:id', user.toggleSavedJob);

export default router;
