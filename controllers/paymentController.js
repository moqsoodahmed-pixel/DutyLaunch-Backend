import crypto from 'node:crypto';
import mongoose from 'mongoose';
import { CVPackage, Course, Payment } from '../models/index.js';
import { ApiError } from '../utils/ApiError.js';
import { asyncHandler } from '../utils/asyncHandler.js';
import { sendSuccess } from '../utils/apiResponse.js';
import { logger } from '../utils/logger.js';
import { FREE_TEMPLATE_IDS, PAID_TEMPLATE_IDS, canonicalTemplateId, templateInfo, templatePrice } from '../config/templates.js';
import {
  createRazorpayOrder,
  razorpayConfigured,
  razorpayKeys,
  razorpayMode,
  verifyPaymentSignature,
  verifyWebhookSignature,
} from '../services/razorpayService.js';

/* ------------------------------------------------------------------ *
 * Pricing
 *
 * GST_PRICING must match GST_PRICING in the frontend (src/data/legal.js):
 *   'exclusive' → the shown price is before GST; 18% is added at checkout
 *   'inclusive' → the shown price is the final amount
 * ------------------------------------------------------------------ */

function gstSettings() {
  const mode = (process.env.GST_PRICING || 'exclusive').trim().toLowerCase();
  const rate = Number(process.env.GST_RATE ?? 18);
  return { exclusive: mode !== 'inclusive', rate: Number.isFinite(rate) && rate >= 0 ? rate : 18 };
}

/** Rupees → paise breakdown for one item. */
export function priceBreakdown(rupees) {
  const { exclusive, rate } = gstSettings();
  const baseAmount = Math.round(Number(rupees) * 100);
  const gstAmount = exclusive ? Math.round((baseAmount * rate) / 100) : 0;
  return { baseAmount, gstAmount, gstRate: exclusive ? rate : 0, amount: baseAmount + gstAmount };
}

/** Looks up the item and its price on the server. The browser never sends a price. */
async function resolveItem(itemType, itemId, user) {
  if (itemType === 'template') {
    const tpl = templateInfo(itemId);
    if (!tpl) throw ApiError.badRequest('Unknown template.');
    if (tpl.free) throw ApiError.badRequest('This template is free — no payment needed.');
    const owned = await Payment.exists({ user: user._id, itemType: 'template', itemKey: tpl.id, status: 'paid' });
    if (owned) throw ApiError.badRequest('You already own this template.');
    return { name: `${tpl.name} template`, price: templatePrice(), currency: 'INR', key: tpl.id };
  }
  if (!mongoose.isValidObjectId(itemId)) throw ApiError.badRequest('Invalid item.');
  if (itemType === 'cv-package') {
    const pkg = await CVPackage.findOne({ _id: itemId, status: 'published' }).lean();
    if (!pkg) throw ApiError.notFound('This CV bundle is no longer available.');
    if (!(pkg.price > 0)) throw ApiError.badRequest('This CV bundle does not have a price set yet.');
    return { name: `${pkg.name} CV bundle`, price: pkg.price, currency: pkg.currency || 'INR' };
  }
  if (itemType === 'course') {
    const course = await Course.findOne({ _id: itemId, status: 'published' }).lean();
    if (!course) throw ApiError.notFound('This course is no longer available.');
    if (course.priceOnRequest || !(course.price > 0)) {
      throw ApiError.badRequest('This course is priced on request. Book a consultation and a counsellor will share the fee.');
    }
    return { name: course.title, price: course.price, currency: course.currency || 'INR' };
  }
  throw ApiError.badRequest('Unknown item type.');
}

/* ------------------------------------------------------------------ *
 * Handlers
 * ------------------------------------------------------------------ */

/** GET /api/payments/config — lets the client know whether to show "Pay" buttons. */
export const getConfig = asyncHandler(async (req, res) => {
  const { exclusive, rate } = gstSettings();
  sendSuccess(res, {
    data: {
      enabled: razorpayConfigured(),
      mode: razorpayMode(),
      gst: { exclusive, rate },
      templates: { free: FREE_TEMPLATE_IDS, paid: PAID_TEMPLATE_IDS, price: templatePrice() },
    },
  });
});

/**
 * GET /api/payments/entitlements — what the signed-in user has paid for.
 * The Resume Builder uses this to decide which paid templates are unlocked;
 * nothing is unlocked from the browser alone.
 */
export const entitlements = asyncHandler(async (req, res) => {
  const paid = await Payment.find({ user: req.user._id, itemType: 'template', status: 'paid' }).select('itemKey').lean();
  const owned = [...new Set(paid.map((p) => canonicalTemplateId(p.itemKey)).filter(Boolean))];
  sendSuccess(res, {
    data: {
      templates: owned,
      freeTemplates: FREE_TEMPLATE_IDS,
      paidTemplates: PAID_TEMPLATE_IDS,
      templatePrice: templatePrice(),
    },
  });
});

/** POST /api/payments/orders  { itemType, itemId } */
export const createOrder = asyncHandler(async (req, res) => {
  const { itemType, itemId } = req.body;
  const item = await resolveItem(itemType, itemId, req.user);
  const breakdown = priceBreakdown(item.price);
  if (breakdown.amount < 100) throw ApiError.badRequest('The amount is below the minimum the payment gateway accepts.');

  // Razorpay receipts are at most 40 characters.
  const receipt = `dl_${Date.now().toString(36)}_${crypto.randomBytes(4).toString('hex')}`;
  const order = await createRazorpayOrder({
    amount: breakdown.amount,
    currency: item.currency,
    receipt,
    notes: { userId: String(req.user._id), itemType, itemId: String(item.key || itemId), item: item.name.slice(0, 200) },
  });

  const payment = await Payment.create({
    user: req.user._id,
    itemType,
    ...(item.key ? { itemKey: item.key } : { itemId }),
    itemName: item.name,
    ...breakdown,
    currency: item.currency,
    receipt,
    razorpayOrderId: order.id,
  });

  sendSuccess(res, {
    statusCode: 201,
    message: 'Payment started',
    data: {
      paymentId: payment._id,
      orderId: order.id,
      keyId: razorpayKeys().keyId, // the key id is public by design; the secret never leaves the server
      amount: breakdown.amount,
      currency: item.currency,
      itemName: item.name,
      breakdown,
      prefill: {
        name: req.user.name || '',
        email: req.user.email || '',
        contact: req.user.phone || '',
      },
    },
  });
});

/** POST /api/payments/verify  { razorpay_order_id, razorpay_payment_id, razorpay_signature } */
export const verifyPayment = asyncHandler(async (req, res) => {
  const { razorpay_order_id: orderId, razorpay_payment_id: paymentId, razorpay_signature: signature } = req.body;

  const payment = await Payment.findOne({ razorpayOrderId: orderId, user: req.user._id });
  if (!payment) throw ApiError.notFound('We could not find this payment.');

  if (!verifyPaymentSignature({ orderId, paymentId, signature })) {
    logger.warn(`[payments] signature mismatch for order ${orderId}`);
    throw ApiError.badRequest('We could not verify this payment. If money was deducted, contact support with your payment id.');
  }

  if (payment.status !== 'paid') {
    payment.status = 'paid';
    payment.razorpayPaymentId = paymentId;
    payment.razorpaySignature = signature;
    payment.paidAt = new Date();
    payment.failureReason = undefined;
    payment.confirmedBy = payment.confirmedBy || 'checkout';
    await payment.save();
    logger.info(`[payments] paid: ${payment.itemType} ${payment.itemId} order ${orderId}`);
  }

  sendSuccess(res, { message: 'Payment successful', data: payment.toPublic() });
});

/** POST /api/payments/failed  { razorpay_order_id, reason? } — recorded when Checkout reports a failure. */
export const markFailed = asyncHandler(async (req, res) => {
  const { razorpay_order_id: orderId, reason } = req.body;
  const payment = await Payment.findOne({ razorpayOrderId: orderId, user: req.user._id });
  if (!payment) throw ApiError.notFound('We could not find this payment.');
  // A later successful retry inside the same Checkout window still wins.
  if (payment.status === 'created') {
    payment.status = 'failed';
    payment.failureReason = String(reason || 'Payment failed').slice(0, 300);
    await payment.save();
  }
  sendSuccess(res, { data: payment.toPublic() });
});

/** GET /api/payments/mine — the signed-in user's payments, newest first. */
export const myPayments = asyncHandler(async (req, res) => {
  const payments = await Payment.find({ user: req.user._id, status: { $in: ['paid', 'failed'] } })
    .sort({ createdAt: -1 })
    .limit(100);
  sendSuccess(res, { data: payments.map((p) => p.toPublic()) });
});

/**
 * POST /api/payments/webhook — Razorpay server-to-server events.
 * Confirms payments even if the user closed the browser before the
 * Checkout callback ran. Needs RAZORPAY_WEBHOOK_SECRET.
 */
export const webhook = asyncHandler(async (req, res) => {
  if (!razorpayKeys().webhookSecret) return res.status(503).json({ success: false, message: 'Webhook not configured' });
  if (!verifyWebhookSignature(req.rawBody, req.headers['x-razorpay-signature'])) {
    logger.warn('[payments] webhook signature mismatch');
    return res.status(400).json({ success: false, message: 'Invalid signature' });
  }

  const event = req.body?.event;
  const entity = req.body?.payload?.payment?.entity;
  const orderId = entity?.order_id || req.body?.payload?.order?.entity?.id;

  if (orderId) {
    const payment = await Payment.findOne({ razorpayOrderId: orderId });
    if (payment) {
      if ((event === 'payment.captured' || event === 'order.paid') && payment.status !== 'paid') {
        payment.status = 'paid';
        payment.razorpayPaymentId = entity?.id || payment.razorpayPaymentId;
        payment.paidAt = new Date();
        payment.failureReason = undefined;
        payment.confirmedBy = 'webhook';
        await payment.save();
        logger.info(`[payments] paid via webhook: order ${orderId}`);
      } else if (event === 'payment.failed' && payment.status === 'created') {
        payment.status = 'failed';
        payment.failureReason = String(entity?.error_description || 'Payment failed').slice(0, 300);
        await payment.save();
      }
    }
  }

  // Always acknowledge quickly so Razorpay does not keep retrying.
  return res.json({ success: true });
});