import { Router } from 'express';
import * as auth from '../controllers/authController.js';
import { protect, optionalAuth } from '../middleware/auth.js';
import { validate } from '../middleware/validate.js';
import { authLimiter } from '../middleware/rateLimiters.js';
import {
  registerSchema,
  loginSchema,
  changePasswordSchema,
  forgotPasswordSchema,
  resetPasswordSchema,
  googleAuthSchema,
} from '../validators/schemas.js';

const router = Router();

router.post('/register', authLimiter, validate(registerSchema), auth.register);
router.post('/login', authLimiter, validate(loginSchema), auth.login);
router.post('/google', authLimiter, validate(googleAuthSchema), auth.googleAuth);
router.post('/logout', optionalAuth, auth.logout);
router.post('/forgot-password', authLimiter, validate(forgotPasswordSchema), auth.forgotPassword);
router.post('/reset-password', authLimiter, validate(resetPasswordSchema), auth.resetPassword);
router.get('/me', protect, auth.me);
router.patch('/password', protect, validate(changePasswordSchema), auth.updatePassword);

export default router;
