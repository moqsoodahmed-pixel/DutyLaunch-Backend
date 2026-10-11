import { requireConsent } from '../utils/consent.js';
import { Router } from 'express';
import * as resume from '../controllers/resumeController.js';
import { protect } from '../middleware/auth.js';
import { uploadResumeMemory } from '../middleware/upload.js';
import { resumeLimiter } from '../middleware/rateLimiters.js';

const router = Router();

// The ATS check requires a signed-in user; the result is saved to their history.
router.post('/analyze', resumeLimiter, protect, uploadResumeMemory.single('resume'), requireConsent, resume.analyzeResume);
router.get('/history', protect, resume.getMyResumeHistory);

export default router;
