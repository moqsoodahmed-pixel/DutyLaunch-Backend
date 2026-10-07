import crypto from 'node:crypto';
import { ApiError } from '../utils/ApiError.js';
import { logger } from '../utils/logger.js';

/**
 * Thin wrapper around the Razorpay REST API. Uses fetch directly, so no
 * extra npm package is needed.
 *
 * Keys come from the environment (Railway → Variables):
 *   RAZORPAY_KEY_ID          rzp_test_... (test) or rzp_live_... (live)
 *   RAZORPAY_KEY_SECRET      the matching secret — server only, never sent to the browser
 *   RAZORPAY_WEBHOOK_SECRET  optional, the secret you set on the webhook in the Razorpay dashboard
 */

const API = 'https://api.razorpay.com/v1';

export function razorpayKeys() {
  return {
    keyId: (process.env.RAZORPAY_KEY_ID || '').trim(),
    keySecret: (process.env.RAZORPAY_KEY_SECRET || '').trim(),
    webhookSecret: (process.env.RAZORPAY_WEBHOOK_SECRET || '').trim(),
  };
}

export function razorpayConfigured() {
  const { keyId, keySecret } = razorpayKeys();
  return Boolean(keyId && keySecret);
}

export function razorpayMode() {
  const { keyId } = razorpayKeys();
  if (keyId.startsWith('rzp_live_')) return 'live';
  if (keyId.startsWith('rzp_test_')) return 'test';
  return keyId ? 'unknown' : null;
}

/**
 * Creates a Razorpay order. `amount` is in paise.
 * https://razorpay.com/docs/api/orders/create/
 */
export async function createRazorpayOrder({ amount, currency = 'INR', receipt, notes = {} }, { fetchImpl = fetch } = {}) {
  const { keyId, keySecret } = razorpayKeys();
  if (!keyId || !keySecret) {
    throw new ApiError(503, 'Online payment is not set up yet. Please contact us to complete your purchase.');
  }

  let res;
  try {
    res = await fetchImpl(`${API}/orders`, {
      method: 'POST',
      headers: {
        Authorization: `Basic ${Buffer.from(`${keyId}:${keySecret}`).toString('base64')}`,
        'Content-Type': 'application/json',
      },
      body: JSON.stringify({ amount, currency, receipt, notes }),
      signal: AbortSignal.timeout(15000),
    });
  } catch (err) {
    logger.error(`[payments] could not reach Razorpay: ${err.message}`);
    throw new ApiError(502, 'Could not reach the payment gateway. Try again in a moment.');
  }

  const body = await res.json().catch(() => null);
  if (!res.ok) {
    const code = body?.error?.code || '';
    const description = body?.error?.description || '';
    logger.error(`[payments] Razorpay order failed: HTTP ${res.status} ${code} ${description}`);
    if (res.status === 401) {
      throw new ApiError(502, 'The payment gateway rejected our keys. Check RAZORPAY_KEY_ID and RAZORPAY_KEY_SECRET.');
    }
    throw new ApiError(502, 'The payment gateway could not start this payment. Try again in a moment.');
  }
  return body; // { id: 'order_...', amount, currency, receipt, status: 'created', ... }
}

function safeEqualHex(expected, received) {
  if (typeof received !== 'string' || !/^[a-f0-9]+$/i.test(received)) return false;
  const a = Buffer.from(expected, 'hex');
  const b = Buffer.from(received, 'hex');
  return a.length === b.length && crypto.timingSafeEqual(a, b);
}

/**
 * Checks the signature Razorpay Checkout returns after a successful
 * payment: HMAC-SHA256 of "order_id|payment_id" with the key secret.
 * https://razorpay.com/docs/payments/payment-gateway/web-integration/standard/build-integration/#verify-payment-signature
 */
export function verifyPaymentSignature({ orderId, paymentId, signature }) {
  const { keySecret } = razorpayKeys();
  if (!keySecret || !orderId || !paymentId) return false;
  const expected = crypto.createHmac('sha256', keySecret).update(`${orderId}|${paymentId}`).digest('hex');
  return safeEqualHex(expected, signature);
}

/** Checks the X-Razorpay-Signature header of a webhook against the raw request body. */
export function verifyWebhookSignature(rawBody, signature) {
  const { webhookSecret } = razorpayKeys();
  if (!webhookSecret || !rawBody) return false;
  const expected = crypto.createHmac('sha256', webhookSecret).update(rawBody).digest('hex');
  return safeEqualHex(expected, signature);
}