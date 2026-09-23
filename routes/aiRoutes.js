import { Router } from 'express';
import * as ai from '../controllers/aiController.js';
import { protect } from '../middleware/auth.js';
import { validate } from '../middleware/validate.js';
import { aiChatSchema } from '../validators/schemas.js';
import { aiLimiter } from '../middleware/rateLimiters.js';

const router = Router();

router.post('/assistant', protect, aiLimiter, validate(aiChatSchema), ai.chatWithAssistant);

export default router;
