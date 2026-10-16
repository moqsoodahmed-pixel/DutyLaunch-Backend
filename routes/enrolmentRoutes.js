import { Router } from 'express';
import * as enrolments from '../controllers/enrolmentController.js';
import { protect, restrictTo } from '../middleware/auth.js';

const router = Router();

// Candidate enrolments
router.get('/mine', protect, enrolments.myEnrolments);
router.post('/free', protect, enrolments.enrolFree);

// Partner viewing enrolled candidates
router.get('/partner', protect, restrictTo('institute', 'partner'), enrolments.partnerEnrolments);

// Admin listing
router.get('/admin', protect, restrictTo('admin'), enrolments.adminEnrolments);

export default router;
