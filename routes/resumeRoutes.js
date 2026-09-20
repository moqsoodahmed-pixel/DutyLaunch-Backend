import { Router } from 'express';
import * as resume from '../controllers/resumeController.js';
import { optionalAuth, protect } from '../middleware/auth.js';
import { uploadResumeMemory } from '../middleware/upload.js';
import { resumeLimiter } from '../middleware/rateLimiters.js';

const router = Router();

// Anyone can run an ATS check; when signed in, the result is saved to their history.
router.post('/analyze', resumeLimiter, optionalAuth, uploadResumeMemory.single('resume'), resume.analyzeResume);
router.get('/history', protect, resume.getMyResumeHistory);

export default router;
