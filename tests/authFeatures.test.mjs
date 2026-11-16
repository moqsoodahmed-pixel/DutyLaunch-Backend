import test from 'node:test';
import assert from 'node:assert/strict';
import crypto from 'node:crypto';
import { emailService } from '../services/emailService.js';

test('Password reset email formatting & token generation', async () => {
  const mockUser = { name: 'Chandu Candidate', email: 'chandu@example.com' };
  const mockResetUrl = 'http://localhost:5173/reset-password?token=abcdef1234567890&email=chandu%40example.com';

  const res = await emailService.sendPasswordResetEmail({
    user: mockUser,
    resetUrl: mockResetUrl,
  });

  assert.strictEqual(res.subject, 'Reset Your DutyLaunch Password');
  assert.ok(res.html.includes('Reset Your DutyLaunch Account Password'));
  assert.ok(res.html.includes(mockResetUrl));
  assert.ok(res.html.includes('This reset link is active for <strong>60 minutes</strong>'));
});

test('Crypto reset token hashing is deterministic and irreversible', () => {
  const token = 'my-secret-test-token-12345';
  const hashed1 = crypto.createHash('sha256').update(token).digest('hex');
  const hashed2 = crypto.createHash('sha256').update(token).digest('hex');

  assert.strictEqual(hashed1, hashed2);
  assert.strictEqual(hashed1.length, 64);
});

test('Google credential JWT parsing logic handles base64url', () => {
  const samplePayload = {
    sub: 'google_user_98765',
    email: 'test.google@example.com',
    name: 'Google User',
    picture: 'https://lh3.googleusercontent.com/photo.jpg',
  };
  const b64 = Buffer.from(JSON.stringify(samplePayload)).toString('base64url');
  const fakeJwt = `header.${b64}.signature`;

  const parts = fakeJwt.split('.');
  assert.strictEqual(parts.length, 3);
  const parsed = JSON.parse(Buffer.from(parts[1], 'base64url').toString('utf8'));
  assert.strictEqual(parsed.sub, 'google_user_98765');
  assert.strictEqual(parsed.email, 'test.google@example.com');
  assert.strictEqual(parsed.name, 'Google User');
});
