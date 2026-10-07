import test from 'node:test';
import assert from 'node:assert/strict';
import crypto from 'node:crypto';
import {
  createRazorpayOrder,
  verifyPaymentSignature,
  verifyWebhookSignature,
  razorpayMode,
  razorpayConfigured,
} from '../services/razorpayService.js';
import { priceBreakdown } from '../controllers/paymentController.js';

/** Razorpay tests. A fake fetch stands in for api.razorpay.com — no real keys or money. */

test.beforeEach(() => {
  process.env.RAZORPAY_KEY_ID = 'rzp_test_abc123';
  process.env.RAZORPAY_KEY_SECRET = 'test_secret';
  process.env.RAZORPAY_WEBHOOK_SECRET = 'hook_secret';
  delete process.env.GST_PRICING;
  delete process.env.GST_RATE;
});

const sign = (data, secret) => crypto.createHmac('sha256', secret).update(data).digest('hex');

test('detects test vs live keys', () => {
  assert.equal(razorpayConfigured(), true);
  assert.equal(razorpayMode(), 'test');
  process.env.RAZORPAY_KEY_ID = 'rzp_live_xyz';
  assert.equal(razorpayMode(), 'live');
});

test('a genuine checkout signature is accepted', () => {
  const signature = sign('order_ABC|pay_XYZ', 'test_secret');
  assert.equal(verifyPaymentSignature({ orderId: 'order_ABC', paymentId: 'pay_XYZ', signature }), true);
});

test('a forged or mismatched signature is rejected', () => {
  const signature = sign('order_ABC|pay_XYZ', 'wrong_secret');
  assert.equal(verifyPaymentSignature({ orderId: 'order_ABC', paymentId: 'pay_XYZ', signature }), false);
  const good = sign('order_ABC|pay_XYZ', 'test_secret');
  assert.equal(verifyPaymentSignature({ orderId: 'order_OTHER', paymentId: 'pay_XYZ', signature: good }), false, 'signature for another order');
  assert.equal(verifyPaymentSignature({ orderId: 'order_ABC', paymentId: 'pay_XYZ', signature: 'not-hex' }), false);
  assert.equal(verifyPaymentSignature({ orderId: 'order_ABC', paymentId: 'pay_XYZ', signature: undefined }), false);
});

test('webhook signature is checked against the raw body', () => {
  const raw = Buffer.from('{"event":"payment.captured"}');
  assert.equal(verifyWebhookSignature(raw, sign(raw, 'hook_secret')), true);
  assert.equal(verifyWebhookSignature(Buffer.from('{"event":"tampered"}'), sign(raw, 'hook_secret')), false);
  delete process.env.RAZORPAY_WEBHOOK_SECRET;
  assert.equal(verifyWebhookSignature(raw, sign(raw, 'hook_secret')), false, 'no secret configured = reject');
});

test('GST exclusive pricing adds 18% in paise', () => {
  assert.deepEqual(priceBreakdown(2999), { baseAmount: 299900, gstAmount: 53982, gstRate: 18, amount: 353882 });
});

test('GST inclusive pricing charges the shown price', () => {
  process.env.GST_PRICING = 'inclusive';
  assert.deepEqual(priceBreakdown(2999), { baseAmount: 299900, gstAmount: 0, gstRate: 0, amount: 299900 });
});

test('creates an order with Basic auth and amount in paise', async () => {
  let seen;
  const fetchImpl = async (url, opts) => {
    seen = { url, opts };
    return new Response(JSON.stringify({ id: 'order_TEST1', amount: 353882, currency: 'INR', status: 'created' }), { status: 200 });
  };
  const order = await createRazorpayOrder({ amount: 353882, receipt: 'dl_1' }, { fetchImpl });
  assert.equal(order.id, 'order_TEST1');
  assert.equal(seen.url, 'https://api.razorpay.com/v1/orders');
  assert.equal(seen.opts.headers.Authorization, `Basic ${Buffer.from('rzp_test_abc123:test_secret').toString('base64')}`);
  assert.equal(JSON.parse(seen.opts.body).amount, 353882);
});

test('missing keys give a clear 503, bad keys a clear message', async () => {
  delete process.env.RAZORPAY_KEY_SECRET;
  await assert.rejects(() => createRazorpayOrder({ amount: 100, receipt: 'r' }), (e) => e.statusCode === 503);
  process.env.RAZORPAY_KEY_SECRET = 'test_secret';
  const fetchImpl = async () => new Response(JSON.stringify({ error: { code: 'BAD_REQUEST_ERROR', description: 'Authentication failed' } }), { status: 401 });
  await assert.rejects(() => createRazorpayOrder({ amount: 100, receipt: 'r' }, { fetchImpl }), /rejected our keys/);
});
