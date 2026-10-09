import { Router } from 'express';
import * as ai from '../controllers/aiController.js';
import { protect, restrictTo } from '../middleware/auth.js';
import { validate } from '../middleware/validate.js';
import { aiChatSchema } from '../validators/schemas.js';
import { aiLimiter } from '../middleware/rateLimiters.js';

const router = Router();

router.post('/assistant', protect, aiLimiter, validate(aiChatSchema), ai.chatWithAssistant);

// Admin-only: check which AI providers are active (no keys exposed).
router.get('/status', protect, restrictTo('admin'), ai.getAiStatus);

export default router;
