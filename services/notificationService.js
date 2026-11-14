import { Notification } from '../models/Notification.js';
import { User } from '../models/User.js';
import { ADMIN_ROLES } from '../middleware/auth.js';
import { logger } from '../utils/logger.js';

export const notificationService = {
  async notifyUser({ userId, type, title, message, link, metadata = {} }) {
    try {
      const notif = await Notification.create({
        user: userId,
        type: type || 'general',
        title,
        message,
        link: link || '/my-resumes',
        metadata,
      });
      return notif;
    } catch (err) {
      logger.error(`[Notification] Failed to notify user ${userId}: ${err.message}`);
      return null;
    }
  },

  async notifyAdmins({ type, title, message, link, metadata = {} }) {
    try {
      const admins = await User.find({ role: { $in: ADMIN_ROLES } }).select('_id');
      if (!admins.length) return [];

      const docs = admins.map((admin) => ({
        user: admin._id,
        type: type || 'general',
        title,
        message,
        link: link || '/admin/resume-orders',
        metadata,
      }));

      const created = await Notification.insertMany(docs);
      return created;
    } catch (err) {
      logger.error(`[Notification] Failed to notify admins: ${err.message}`);
      return [];
    }
  },
};
