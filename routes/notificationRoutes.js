import { Router } from 'express';
import { protect } from '../middleware/auth.js';
import * as notifController from '../controllers/notificationController.js';

const router = Router();
router.use(protect);

router.get('/mine', notifController.getMyNotifications);
router.patch('/:id/read', notifController.markNotificationRead);
router.patch('/read-all', notifController.markAllNotificationsRead);

export default router;
