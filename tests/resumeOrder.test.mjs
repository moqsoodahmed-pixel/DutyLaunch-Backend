import test from 'node:test';
import assert from 'node:assert/strict';
import { generateOrderNumber, RESUME_ORDER_STATUSES } from '../models/ResumeBuildOrder.js';
import { ADMIN_ROLES, isUserAdmin } from '../middleware/auth.js';
import { emailService } from '../services/emailService.js';

test('ResumeBuildOrder generates correct order number format', () => {
  const num1 = generateOrderNumber();
  const num2 = generateOrderNumber();
  assert.match(num1, /^DL-RBO-\d{6}-\d{4}$/);
  assert.match(num2, /^DL-RBO-\d{6}-\d{4}$/);
  assert.notEqual(num1, num2);
});

test('ResumeBuildOrder statuses include the entire defined workflow', () => {
  assert.deepEqual(RESUME_ORDER_STATUSES, [
    'pending',
    'assigned',
    'in_progress',
    'quality_check',
    'completed',
    'rejected',
  ]);
});

test('ADMIN_ROLES includes Super Admin, Assistant Admin, Master Admin, and Admin', () => {
  assert.ok(ADMIN_ROLES.includes('admin'));
  assert.ok(ADMIN_ROLES.includes('super_admin'));
  assert.ok(ADMIN_ROLES.includes('assistant_admin'));
  assert.ok(ADMIN_ROLES.includes('master_admin'));

  assert.equal(isUserAdmin({ role: 'super_admin' }), true);
  assert.equal(isUserAdmin({ role: 'assistant_admin' }), true);
  assert.equal(isUserAdmin({ role: 'master_admin' }), true);
  assert.equal(isUserAdmin({ role: 'admin' }), true);
  assert.equal(isUserAdmin({ role: 'user' }), false);
  assert.equal(isUserAdmin({ role: 'employer' }), false);
});

test('Email service includes mandatory ATS score disclaimer footnote', async () => {
  const mockUser = { name: 'Test User', email: 'test@example.com' };
  const mockOrder = {
    orderNumber: 'DL-RBO-202611-1234',
    packageName: 'Mid-Level Professional',
    experienceBand: '3 to 5 years',
    price: 799,
    status: 'pending',
  };

  const res = await emailService.sendPurchaseConfirmationEmail({ user: mockUser, order: mockOrder });
  assert.equal(res.sent, true);
  assert.ok(res.html.includes('This ATS Score is generated using DutyLaunch\'s internal evaluation system'));
  assert.ok(res.html.includes('It is intended only as a reference based on our internal scoring methodology'));
  assert.ok(res.html.includes('It is NOT a universal ATS score'));
});

test('Email service creates proper emails for completed delivery', async () => {
  const mockUser = { name: 'Test User', email: 'test@example.com' };
  const mockOrder = {
    orderNumber: 'DL-RBO-202611-1234',
    packageName: 'Senior Professional',
    experienceBand: '6 to 8 years',
    price: 999,
    status: 'completed',
  };

  const res = await emailService.sendCompletedEmail({ user: mockUser, order: mockOrder });
  assert.equal(res.sent, true);
  assert.ok(res.subject.includes('Completed'));
  assert.ok(res.html.includes('Download Your Completed Files'));
});
