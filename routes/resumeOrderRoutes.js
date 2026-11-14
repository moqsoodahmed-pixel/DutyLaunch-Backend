import { Router } from 'express';
import { protect, restrictTo } from '../middleware/auth.js';
import {
  uploadResumeOrderFiles,
  uploadAdminResumeOrderFiles,
} from '../middleware/upload.js';
import * as orderController from '../controllers/resumeOrderController.js';

const router = Router();

// Candidate endpoints
router.post(
  '/',
  protect,
  uploadResumeOrderFiles,
  orderController.createResumeOrder
);
router.get('/my-orders', protect, orderController.getMyResumeOrders);
router.get('/my-orders/:id', protect, orderController.getMyResumeOrderById);
router.get('/:id/download/:fileType', protect, orderController.downloadOrderFile);

// Admin endpoints (Super Admin, Assistant Admin, Master Admin, Admin)
router.get(
  '/admin/all',
  protect,
  restrictTo('admin'),
  orderController.adminListAllOrders
);
router.get(
  '/admin/:id',
  protect,
  restrictTo('admin'),
  orderController.adminGetOrderById
);
router.patch(
  '/admin/:id/status',
  protect,
  restrictTo('admin'),
  orderController.adminUpdateStatus
);
router.patch(
  '/admin/:id/assign',
  protect,
  restrictTo('admin'),
  orderController.adminAssignStaff
);
router.post(
  '/admin/:id/notes',
  protect,
  restrictTo('admin'),
  orderController.adminAddInternalNote
);
router.post(
  '/admin/:id/upload-completed',
  protect,
  restrictTo('admin'),
  uploadAdminResumeOrderFiles,
  orderController.adminUploadCompleted
);
router.post(
  '/admin/:id/replace-file',
  protect,
  restrictTo('admin'),
  uploadAdminResumeOrderFiles,
  orderController.adminReplaceFile
);
router.post(
  '/admin/:id/send-update',
  protect,
  restrictTo('admin'),
  orderController.adminSendCustomerUpdate
);

export default router;
