import path from 'node:path';
import fs from 'node:fs';
import {
  ResumeBuildOrder,
  RESUME_ORDER_STATUSES,
  generateOrderNumber,
} from '../models/ResumeBuildOrder.js';
import { Payment } from '../models/Payment.js';
import { CVPackage } from '../models/CVPackage.js';
import { User } from '../models/User.js';
import { UploadedFile } from '../models/UploadedFile.js';
import { ApiError } from '../utils/ApiError.js';
import { asyncHandler } from '../utils/asyncHandler.js';
import { sendSuccess, paginationMeta } from '../utils/apiResponse.js';
import { getPagination, escapeRegex } from '../utils/pagination.js';
import { isUserAdmin } from '../middleware/auth.js';
import { emailService } from '../services/emailService.js';
import { notificationService } from '../services/notificationService.js';
import { logger } from '../utils/logger.js';

/** Helper to persist uploaded file to MongoDB UploadedFile collection */
async function persistUploadedFile(file, folder = 'resumes') {
  if (!file) return null;
  const filename = path.basename(file.filename || file.originalname);
  let fileBuffer = null;

  if (file.path && fs.existsSync(file.path)) {
    try {
      fileBuffer = await fs.promises.readFile(file.path);
    } catch (err) {
      logger.warn(`[ResumeOrder] Could not read file from disk: ${err.message}`);
    }
  } else if (file.buffer) {
    fileBuffer = file.buffer;
  }

  let fileDoc = null;
  if (fileBuffer) {
    try {
      fileDoc = await UploadedFile.findOneAndUpdate(
        { filename, folder },
        {
          filename,
          folder,
          originalname: file.originalname,
          mimetype: file.mimetype,
          size: file.size,
          data: fileBuffer,
        },
        { upsert: true, new: true }
      );
    } catch (err) {
      logger.error(`[ResumeOrder] Failed to persist file in UploadedFile: ${err.message}`);
    }
  }

  return {
    filename,
    originalname: file.originalname,
    mimetype: file.mimetype,
    size: file.size,
    storagePath: file.path || `/api/uploads/files/${folder}/${filename}`,
    uploadedAt: new Date(),
    fileId: fileDoc?._id || undefined,
  };
}

/* ------------------------------------------------------------------ *
 * User / Candidate Handlers
 * ------------------------------------------------------------------ */

/**
 * POST /api/resume-orders
 * Create a new Resume Build Request after purchasing a package.
 */
export const createResumeOrder = asyncHandler(async (req, res) => {
  const { paymentId, packageId, userInstructions, targetRole, targetIndustry } = req.body;

  // 1. Verify Payment
  let payment = null;
  if (paymentId) {
    payment = await Payment.findOne({
      _id: paymentId,
      user: req.user._id,
      status: 'paid',
    });
  } else {
    // Look up the most recent unassigned paid cv-package payment for this user
    const existingOrders = await ResumeBuildOrder.find({ user: req.user._id }).select('payment');
    const usedPaymentIds = existingOrders.map((o) => o.payment?.toString()).filter(Boolean);

    payment = await Payment.findOne({
      user: req.user._id,
      itemType: 'cv-package',
      status: 'paid',
      _id: { $nin: usedPaymentIds },
    }).sort({ createdAt: -1 });
  }

  // If in dev and no payment was found but packageId was sent, create a test paid payment
  if (!payment && packageId && process.env.NODE_ENV === 'development') {
    const pkg = await CVPackage.findById(packageId);
    if (pkg) {
      payment = await Payment.create({
        user: req.user._id,
        itemType: 'cv-package',
        itemId: pkg._id,
        itemName: `${pkg.name} CV bundle`,
        baseAmount: pkg.price * 100,
        amount: pkg.price * 100,
        currency: pkg.currency || 'INR',
        status: 'paid',
        receipt: `receipt_mock_${Date.now()}`,
        razorpayOrderId: `order_mock_${Date.now()}`,
        paidAt: new Date(),
      });
      logger.info(`[ResumeOrder] Dev mode auto-generated payment record ${payment._id}`);
    }
  }

  if (!payment) {
    throw ApiError.badRequest(
      'A valid, completed payment for a Resume Building Package is required before submitting documents.'
    );
  }

  // Verify this payment hasn't already been used
  const existingOrder = await ResumeBuildOrder.findOne({ payment: payment._id });
  if (existingOrder) {
    throw ApiError.badRequest('This payment has already been linked to a Resume Build Order.');
  }

  // Look up Package
  const pkg =
    (payment.itemId ? await CVPackage.findById(payment.itemId) : null) ||
    (packageId ? await CVPackage.findById(packageId) : null) ||
    (await CVPackage.findOne({ status: 'published' }).sort({ order: 1 }));

  // 2. Validate Files (at least one resume or CV required)
  const resumeFile = req.files?.resume?.[0];
  const cvFile = req.files?.cv?.[0];

  if (!resumeFile && !cvFile) {
    throw ApiError.badRequest('Please upload either your Existing Resume or Existing CV (PDF, DOC, or DOCX).');
  }

  const savedResume = resumeFile ? await persistUploadedFile(resumeFile) : null;
  const savedCv = cvFile ? await persistUploadedFile(cvFile) : null;

  // 3. Expected delivery: 24 hours from now (within a day)
  const expectedDeliveryDate = new Date(Date.now() + 24 * 60 * 60 * 1000);

  // 4. File History
  const fileHistory = [];
  if (savedResume) {
    fileHistory.push({
      fileType: 'original_resume',
      ...savedResume,
      uploadedBy: req.user._id,
      uploadedByRole: 'user',
      version: 1,
      note: 'Initial customer upload',
    });
  }
  if (savedCv) {
    fileHistory.push({
      fileType: 'original_cv',
      ...savedCv,
      uploadedBy: req.user._id,
      uploadedByRole: 'user',
      version: 1,
      note: 'Initial customer upload',
    });
  }

  // 5. Initial Timeline
  const orderNumber = generateOrderNumber();
  const timeline = [
    {
      status: 'pending',
      title: 'Order Placed & Files Submitted',
      description:
        'Your resume build request and original files were safely received. Our team will review your requirements and begin work.',
      performedBy: req.user._id,
      performedByName: req.user.name,
      performedByRole: 'user',
      timestamp: new Date(),
      isCustomerVisible: true,
    },
  ];

  const order = await ResumeBuildOrder.create({
    orderNumber,
    user: req.user._id,
    package: pkg?._id,
    packageName: pkg?.name || payment.itemName,
    experienceBand: pkg?.experienceBand || 'General Experience',
    price: payment.amount ? payment.amount / 100 : pkg?.price || 399,
    currency: payment.currency || 'INR',
    payment: payment._id,
    paymentStatus: 'paid',
    paymentAmount: payment.amount ? payment.amount / 100 : pkg?.price || 399,
    purchaseDate: payment.paidAt || new Date(),
    status: 'pending',
    turnaroundNotice:
      'Your resume and CV will be professionally crafted and delivered within a day.',
    expectedDeliveryDate,
    userInstructions: userInstructions || '',
    targetRole: targetRole || '',
    targetIndustry: targetIndustry || '',
    originalResume: savedResume,
    originalCv: savedCv,
    fileHistory,
    timeline,
  });

  // 6. Emails and Notifications
  await emailService.sendPurchaseConfirmationEmail({ user: req.user, order });
  await emailService.sendRequestReceivedEmail({ user: req.user, order });

  await notificationService.notifyUser({
    userId: req.user._id,
    type: 'order_created',
    title: 'Resume Build Request Received',
    message: `Order #${order.orderNumber} is under review. Turnaround: within a day.`,
    link: '/my-resumes',
    metadata: { orderId: order._id, orderNumber: order.orderNumber },
  });

  await notificationService.notifyAdmins({
    type: 'order_created',
    title: 'New Resume Build Request',
    message: `${req.user.name} placed a new request (${order.packageName}, ₹${order.price}).`,
    link: '/admin/resume-orders',
    metadata: { orderId: order._id, orderNumber: order.orderNumber },
  });

  sendSuccess(res, {
    statusCode: 201,
    message: 'Resume build request created successfully.',
    data: order,
  });
});

/**
 * GET /api/resume-orders/my-orders
 * List orders belonging to the authenticated candidate.
 */
export const getMyResumeOrders = asyncHandler(async (req, res) => {
  const orders = await ResumeBuildOrder.find({ user: req.user._id })
    .sort({ createdAt: -1 })
    .lean();

  sendSuccess(res, {
    message: 'Your resume orders',
    data: orders,
  });
});

/**
 * GET /api/resume-orders/my-orders/:id
 * Get single order details for candidate.
 */
export const getMyResumeOrderById = asyncHandler(async (req, res) => {
  const order = await ResumeBuildOrder.findOne({
    _id: req.params.id,
    user: req.user._id,
  }).lean();

  if (!order) throw ApiError.notFound('Order not found.');

  sendSuccess(res, {
    message: 'Order details',
    data: order,
  });
});

/**
 * GET /api/resume-orders/:id/download/:fileType
 * Secure file download with role-based access control.
 * Allowed file types: 'original-resume', 'original-cv', 'completed-resume', 'completed-cv'
 */
export const downloadOrderFile = asyncHandler(async (req, res) => {
  const { id, fileType } = req.params;
  const order = await ResumeBuildOrder.findById(id);
  if (!order) throw ApiError.notFound('Order not found.');

  // Check RBAC: User must be order owner or an authorized admin
  const isAdmin = isUserAdmin(req.user);
  if (!isAdmin && !order.user.equals(req.user._id)) {
    throw ApiError.forbidden('You do not have permission to download files for this order.');
  }

  let fileMeta = null;
  if (fileType === 'original-resume') fileMeta = order.originalResume;
  else if (fileType === 'original-cv') fileMeta = order.originalCv;
  else if (fileType === 'completed-resume') fileMeta = order.completedResume;
  else if (fileType === 'completed-cv') fileMeta = order.completedCv;
  else throw ApiError.badRequest('Invalid file type requested.');

  if (!fileMeta || !fileMeta.filename) {
    throw ApiError.notFound('The requested file is not available for this order.');
  }

  // Attempt to load from MongoDB UploadedFile first
  const dbFile = await UploadedFile.findOne({ filename: fileMeta.filename });
  if (dbFile && dbFile.data) {
    res.setHeader('Content-Type', dbFile.mimetype || 'application/octet-stream');
    res.setHeader(
      'Content-Disposition',
      `attachment; filename="${encodeURIComponent(dbFile.originalname || fileMeta.originalname || fileMeta.filename)}"`
    );
    return res.send(dbFile.data);
  }

  // Otherwise fallback to disk storage
  const diskPath = path.resolve(process.cwd(), 'uploads', 'resumes', fileMeta.filename);
  if (fs.existsSync(diskPath)) {
    res.setHeader('Content-Type', fileMeta.mimetype || 'application/octet-stream');
    res.setHeader(
      'Content-Disposition',
      `attachment; filename="${encodeURIComponent(fileMeta.originalname || fileMeta.filename)}"`
    );
    return fs.createReadStream(diskPath).pipe(res);
  }

  throw ApiError.notFound('File data could not be located on the server.');
});

/* ------------------------------------------------------------------ *
 * Admin Handlers
 * ------------------------------------------------------------------ */

/**
 * GET /api/resume-orders/admin/all
 * List all orders with filters, search, sorting, and pagination.
 */
export const adminListAllOrders = asyncHandler(async (req, res) => {
  const { page, limit, skip } = getPagination(req.query, { defaultLimit: 20 });
  const filter = {};

  if (req.query.status && req.query.status !== 'all') {
    filter.status = req.query.status;
  }

  if (req.query.q) {
    const rx = new RegExp(escapeRegex(req.query.q), 'i');
    filter.$or = [{ orderNumber: rx }, { packageName: rx }, { targetRole: rx }];

    // Also search by user name/email if query matches
    const matchingUsers = await User.find({
      $or: [{ name: rx }, { email: rx }, { phone: rx }],
    }).select('_id');

    if (matchingUsers.length) {
      filter.$or.push({ user: { $in: matchingUsers.map((u) => u._id) } });
    }
  }

  // Sorting
  let sortOption = { createdAt: -1 };
  if (req.query.sortBy === 'expectedDeliveryDate') {
    sortOption = { expectedDeliveryDate: req.query.sortOrder === 'asc' ? 1 : -1 };
  } else if (req.query.sortBy === 'price') {
    sortOption = { price: req.query.sortOrder === 'asc' ? 1 : -1 };
  } else if (req.query.sortBy === 'status') {
    sortOption = { status: req.query.sortOrder === 'asc' ? 1 : -1 };
  }

  const [orders, total, counts] = await Promise.all([
    ResumeBuildOrder.find(filter)
      .sort(sortOption)
      .skip(skip)
      .limit(limit)
      .populate('user', 'name email phone profile')
      .populate('assignedStaff.user', 'name email role')
      .lean(),
    ResumeBuildOrder.countDocuments(filter),
    ResumeBuildOrder.aggregate([
      {
        $group: {
          _id: '$status',
          count: { $sum: 1 },
        },
      },
    ]),
  ]);

  const stats = {
    total: 0,
    pending: 0,
    assigned: 0,
    in_progress: 0,
    quality_check: 0,
    completed: 0,
    rejected: 0,
  };

  counts.forEach((c) => {
    if (stats[c._id] !== undefined) stats[c._id] = c.count;
    stats.total += c.count;
  });

  sendSuccess(res, {
    message: 'Resume build orders',
    data: orders,
    meta: paginationMeta({ page, limit, total }),
    stats,
  });
});

/**
 * GET /api/resume-orders/admin/:id
 * Get single order for admin management.
 */
export const adminGetOrderById = asyncHandler(async (req, res) => {
  const order = await ResumeBuildOrder.findById(req.params.id)
    .populate('user', 'name email phone profile')
    .populate('assignedStaff.user', 'name email role')
    .populate('internalNotes.createdBy', 'name email role')
    .lean();

  if (!order) throw ApiError.notFound('Order not found.');

  sendSuccess(res, {
    message: 'Order details',
    data: order,
  });
});

/**
 * PATCH /api/resume-orders/admin/:id/status
 * Update status (Pending -> Assigned -> In Progress -> Quality Check -> Completed / Rejected).
 */
export const adminUpdateStatus = asyncHandler(async (req, res) => {
  const { status, note, expectedDeliveryDate } = req.body;
  if (!RESUME_ORDER_STATUSES.includes(status)) {
    throw ApiError.badRequest(`Invalid status. Must be one of: ${RESUME_ORDER_STATUSES.join(', ')}`);
  }

  const order = await ResumeBuildOrder.findById(req.params.id).populate('user', 'name email phone');
  if (!order) throw ApiError.notFound('Order not found.');

  const oldStatus = order.status;
  order.status = status;

  if (expectedDeliveryDate) {
    order.expectedDeliveryDate = new Date(expectedDeliveryDate);
  }

  if (status === 'completed' && !order.completionDate) {
    order.completionDate = new Date();
  }

  if (status === 'rejected' && note) {
    order.rejectionReason = note;
  }

  // Append to timeline
  const statusTitles = {
    pending: 'Order Marked as Pending Review',
    assigned: 'Order Assigned to Specialist',
    in_progress: 'Writing & Optimization In Progress',
    quality_check: 'Executive Quality Check & ATS Review',
    completed: 'Resume & CV Crafting Completed',
    rejected: 'Order Rejected / Placed on Hold',
  };

  order.timeline.push({
    status,
    title: statusTitles[status] || `Status updated to ${status}`,
    description: note || `Order status updated from ${oldStatus} to ${status}.`,
    performedBy: req.user._id,
    performedByName: req.user.name,
    performedByRole: req.user.role,
    timestamp: new Date(),
    isCustomerVisible: true,
  });

  await order.save();

  // Send status change notifications & emails
  if (status === 'in_progress') {
    await emailService.sendWorkStartedEmail({ user: order.user, order });
  } else if (status === 'completed') {
    await emailService.sendCompletedEmail({ user: order.user, order });
  } else if (status === 'rejected') {
    await emailService.sendRejectedEmail({ user: order.user, order, reason: note });
  }

  await notificationService.notifyUser({
    userId: order.user._id,
    type: 'order_status_updated',
    title: `Order #${order.orderNumber} Status Updated`,
    message: `Your resume build status is now: ${status.replace('_', ' ').toUpperCase()}`,
    link: '/my-resumes',
    metadata: { orderId: order._id, status },
  });

  sendSuccess(res, {
    message: `Order status updated to ${status}`,
    data: order,
  });
});

/**
 * PATCH /api/resume-orders/admin/:id/assign
 * Assign staff member to this order.
 */
export const adminAssignStaff = asyncHandler(async (req, res) => {
  const { staffUserId, staffName, staffEmail, note } = req.body;

  const order = await ResumeBuildOrder.findById(req.params.id).populate('user', 'name email phone');
  if (!order) throw ApiError.notFound('Order not found.');

  let staffUser = null;
  if (staffUserId) {
    staffUser = await User.findById(staffUserId);
  }

  const assignedName = staffUser ? staffUser.name : staffName || 'Assigned Specialist';
  const assignedEmail = staffUser ? staffUser.email : staffEmail || '';

  order.assignedStaff = {
    user: staffUser?._id || undefined,
    name: assignedName,
    email: assignedEmail,
    assignedAt: new Date(),
    assignedBy: req.user._id,
  };

  if (order.status === 'pending') {
    order.status = 'assigned';
  }

  order.timeline.push({
    status: order.status,
    title: `Assigned to ${assignedName}`,
    description: note || `Order assigned to ${assignedName} for drafting and optimization.`,
    performedBy: req.user._id,
    performedByName: req.user.name,
    performedByRole: req.user.role,
    timestamp: new Date(),
    isCustomerVisible: true,
  });

  await order.save();

  await emailService.sendRequestAssignedEmail({
    user: order.user,
    order,
    staffName: assignedName,
  });

  await notificationService.notifyUser({
    userId: order.user._id,
    type: 'order_assigned',
    title: `Specialist Assigned for Order #${order.orderNumber}`,
    message: `${assignedName} has been assigned to craft your resume.`,
    link: '/my-resumes',
    metadata: { orderId: order._id, assignedName },
  });

  sendSuccess(res, {
    message: `Order successfully assigned to ${assignedName}`,
    data: order,
  });
});

/**
 * POST /api/resume-orders/admin/:id/notes
 * Add internal admin note.
 */
export const adminAddInternalNote = asyncHandler(async (req, res) => {
  const { note } = req.body;
  if (!note || !note.trim()) throw ApiError.badRequest('Note content is required.');

  const order = await ResumeBuildOrder.findById(req.params.id);
  if (!order) throw ApiError.notFound('Order not found.');

  order.internalNotes.push({
    note: note.trim(),
    createdBy: req.user._id,
    createdByName: req.user.name,
    createdByRole: req.user.role,
    createdAt: new Date(),
  });

  await order.save();

  sendSuccess(res, {
    message: 'Internal note added.',
    data: order.internalNotes,
  });
});

/**
 * POST /api/resume-orders/admin/:id/upload-completed
 * Upload finished Resume and/or CV.
 */
export const adminUploadCompleted = asyncHandler(async (req, res) => {
  const order = await ResumeBuildOrder.findById(req.params.id).populate('user', 'name email phone');
  if (!order) throw ApiError.notFound('Order not found.');

  const completedResumeFile = req.files?.completedResume?.[0];
  const completedCvFile = req.files?.completedCv?.[0];

  if (!completedResumeFile && !completedCvFile) {
    throw ApiError.badRequest('Please attach a completed Resume and/or CV (PDF, DOC, or DOCX).');
  }

  const savedResume = completedResumeFile ? await persistUploadedFile(completedResumeFile) : null;
  const savedCv = completedCvFile ? await persistUploadedFile(completedCvFile) : null;

  if (savedResume) {
    order.completedResume = savedResume;
    order.fileHistory.push({
      fileType: 'completed_resume',
      ...savedResume,
      uploadedBy: req.user._id,
      uploadedByRole: req.user.role,
      version:
        order.fileHistory.filter((f) => f.fileType === 'completed_resume').length + 1,
      note: req.body.note || 'Final completed resume uploaded and verified',
    });
  }

  if (savedCv) {
    order.completedCv = savedCv;
    order.fileHistory.push({
      fileType: 'completed_cv',
      ...savedCv,
      uploadedBy: req.user._id,
      uploadedByRole: req.user.role,
      version:
        order.fileHistory.filter((f) => f.fileType === 'completed_cv').length + 1,
      note: req.body.note || 'Final completed CV uploaded and verified',
    });
  }

  // Update status to completed by default unless explicitly kept in QA
  if (req.body.markCompleted !== 'false') {
    order.status = 'completed';
    order.completionDate = new Date();
  }

  order.timeline.push({
    status: order.status,
    title: 'Completed Resume & CV Delivered',
    description:
      req.body.note ||
      'Your finalized, professional Resume and CV have been uploaded and verified for delivery.',
    performedBy: req.user._id,
    performedByName: req.user.name,
    performedByRole: req.user.role,
    timestamp: new Date(),
    isCustomerVisible: true,
  });

  await order.save();

  // Send completion notifications and emails
  await emailService.sendCompletedEmail({ user: order.user, order });

  await notificationService.notifyUser({
    userId: order.user._id,
    type: 'order_completed',
    title: `Your Completed Resume is Ready! (Order #${order.orderNumber})`,
    message: 'Our team has finished crafting your resume and CV. Download them from your dashboard now.',
    link: '/my-resumes',
    metadata: { orderId: order._id, orderNumber: order.orderNumber },
  });

  sendSuccess(res, {
    message: 'Completed files uploaded and order updated successfully.',
    data: order,
  });
});

/**
 * POST /api/resume-orders/admin/:id/replace-file
 * Replace an uploaded file (original or completed) and keep version history.
 */
export const adminReplaceFile = asyncHandler(async (req, res) => {
  const { fileType, note } = req.body;
  const uploadedFile = req.files?.file?.[0];

  if (!uploadedFile) throw ApiError.badRequest('Please upload a replacement file.');
  if (!['original_resume', 'original_cv', 'completed_resume', 'completed_cv'].includes(fileType)) {
    throw ApiError.badRequest('Invalid fileType specified.');
  }

  const order = await ResumeBuildOrder.findById(req.params.id);
  if (!order) throw ApiError.notFound('Order not found.');

  const savedFile = await persistUploadedFile(uploadedFile);

  const prevVersionCount = order.fileHistory.filter((f) => f.fileType === fileType).length;
  order.fileHistory.push({
    fileType,
    ...savedFile,
    uploadedBy: req.user._id,
    uploadedByRole: req.user.role,
    version: prevVersionCount + 1,
    note: note || `Replaced file by ${req.user.name}`,
  });

  if (fileType === 'original_resume') order.originalResume = savedFile;
  else if (fileType === 'original_cv') order.originalCv = savedFile;
  else if (fileType === 'completed_resume') order.completedResume = savedFile;
  else if (fileType === 'completed_cv') order.completedCv = savedFile;

  order.timeline.push({
    status: order.status,
    title: `File Updated: ${fileType.replace('_', ' ').toUpperCase()}`,
    description: note || `A revised file was uploaded by ${req.user.name}.`,
    performedBy: req.user._id,
    performedByName: req.user.name,
    performedByRole: req.user.role,
    timestamp: new Date(),
    isCustomerVisible: true,
  });

  await order.save();

  sendSuccess(res, {
    message: 'File successfully replaced and version logged.',
    data: order,
  });
});

/**
 * POST /api/resume-orders/admin/:id/send-update
 * Send customer message or request more information.
 */
export const adminSendCustomerUpdate = asyncHandler(async (req, res) => {
  const { message, type } = req.body;
  if (!message || !message.trim()) throw ApiError.badRequest('Message content is required.');

  const order = await ResumeBuildOrder.findById(req.params.id).populate('user', 'name email phone');
  if (!order) throw ApiError.notFound('Order not found.');

  order.customerUpdates.push({
    message: message.trim(),
    sentAt: new Date(),
    sentBy: req.user._id,
  });

  order.timeline.push({
    status: order.status,
    title: type === 'info_required' ? 'Information Required from Candidate' : 'Update Sent to Candidate',
    description: message.trim(),
    performedBy: req.user._id,
    performedByName: req.user.name,
    performedByRole: req.user.role,
    timestamp: new Date(),
    isCustomerVisible: true,
  });

  await order.save();

  if (type === 'info_required') {
    await emailService.sendMoreInfoRequiredEmail({ user: order.user, order, message: message.trim() });
  }

  await notificationService.notifyUser({
    userId: order.user._id,
    type: 'customer_update',
    title: `Update on Order #${order.orderNumber}`,
    message: message.trim(),
    link: '/my-resumes',
    metadata: { orderId: order._id },
  });

  sendSuccess(res, {
    message: 'Update sent to customer successfully.',
    data: order,
  });
});
