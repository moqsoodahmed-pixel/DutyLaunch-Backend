import { Router } from 'express';
import { z } from 'zod';
import * as payments from '../controllers/paymentController.js';
import { protect } from '../middleware/auth.js';
import { validate } from '../middleware/validate.js';
import { PAYMENT_ITEM_TYPES } from '../models/Payment.js';

const router = Router();

const objectId = z.string().regex(/^[a-f\d]{24}$/i, 'Invalid id');
const razorpayId = (prefix) => z.string().trim().regex(new RegExp(`^${prefix}_[A-Za-z0-9]+$`), 'Invalid id').max(64);

// itemId: a database id for CV bundles and courses, or a template id such
// as "dl-modern" for Resume Builder templates (checked in the controller).
const createOrderSchema = z.object({
  itemType: z.enum(PAYMENT_ITEM_TYPES),
  itemId: z.union([objectId, z.string().trim().regex(/^[a-z0-9-]{2,40}$/, 'Invalid id')]),
});

const verifySchema = z.object({
  razorpay_order_id: razorpayId('order'),
  razorpay_payment_id: razorpayId('pay'),
  razorpay_signature: z.string().trim().regex(/^[a-f0-9]{64}$/i, 'Invalid signature'),
});

const failedSchema = z.object({
  razorpay_order_id: razorpayId('order'),
  reason: z.string().trim().max(300).optional(),
});

const consumeFreeTemplateSchema = z.object({
  templateId: z.string().trim().regex(/^[a-z0-9-]{2,40}$/, 'Invalid id'),
});

// Public: whether payments are switched on (no secrets).
router.get('/config', payments.getConfig);

// Razorpay server-to-server events. Authenticated by signature, not by session.
router.post('/webhook', payments.webhook);

router.post('/orders', protect, validate(createOrderSchema), payments.createOrder);
router.post('/verify', protect, validate(verifySchema), payments.verifyPayment);
router.post('/failed', protect, validate(failedSchema), payments.markFailed);
router.get('/mine', protect, payments.myPayments);
router.get('/entitlements', protect, payments.entitlements);
router.post('/consume-free-template', protect, validate(consumeFreeTemplateSchema), payments.consumeFreeTemplate);

export default router;