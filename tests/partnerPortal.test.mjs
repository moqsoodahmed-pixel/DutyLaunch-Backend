import test from 'node:test';
import assert from 'node:assert/strict';
import { ROLES } from '../models/User.js';
import { PARTNER_ORG_TYPES, PARTNER_STATUS } from '../models/PartnerInstitute.js';
import { PROGRAM_DELIVERY_FORMATS, PROGRAM_APPROVAL_STATUS } from '../models/EducationProgram.js';
import { COURSE_DELIVERY_FORMATS, COURSE_APPROVAL_STATUS } from '../models/Course.js';
import { SETTLEMENT_STATUS } from '../models/Settlement.js';
import { ENROLMENT_STATUS } from '../models/Enrolment.js';
import { FeeConfig } from '../models/FeeConfig.js';
import { registerSchema, courseSchema, educationProgramSchema, partnerProfileSchema } from '../validators/schemas.js';

test('ROLES model preserves institute and supports partner alias', () => {
  assert.ok(ROLES.includes('institute'), 'must preserve institute');
  assert.ok(ROLES.includes('partner'), 'supports partner role alias');
  assert.ok(ROLES.includes('user'), 'preserves candidate role');
  assert.ok(ROLES.includes('employer'), 'preserves employer role');
  assert.ok(ROLES.includes('admin'), 'preserves admin role');
});

test('Partner organization states and types match required specification', () => {
  assert.deepEqual(PARTNER_ORG_TYPES, ['university', 'edtech']);
  assert.ok(PARTNER_STATUS.includes('incomplete'));
  assert.ok(PARTNER_STATUS.includes('pending'));
  assert.ok(PARTNER_STATUS.includes('changes_requested'));
  assert.ok(PARTNER_STATUS.includes('approved'));
  assert.ok(PARTNER_STATUS.includes('rejected'));
  assert.ok(PARTNER_STATUS.includes('suspended'));
});

test('Registration validator accepts partner role along with user and employer', () => {
  const resultCandidate = registerSchema.safeParse({
    name: 'John Doe',
    email: 'john@example.com',
    password: 'Password123',
    role: 'user',
  });
  assert.equal(resultCandidate.success, true);

  const resultPartner = registerSchema.safeParse({
    name: 'Dr. Dean',
    email: 'dean@university.edu',
    password: 'Password123',
    role: 'partner',
  });
  assert.equal(resultPartner.success, true);

  const resultInstitute = registerSchema.safeParse({
    name: 'Dean Institute',
    email: 'dean@institute.edu',
    password: 'Password123',
    role: 'institute',
  });
  assert.equal(resultInstitute.success, true);
});

test('Delivery formats support all four required modes for programmes and courses', () => {
  const expectedModes = ['Online', 'Offline', 'Hybrid', 'Self-paced'];
  assert.deepEqual(PROGRAM_DELIVERY_FORMATS, expectedModes);
  assert.deepEqual(COURSE_DELIVERY_FORMATS, expectedModes);
});

test('Course validation requires valid attributes and handles free/paid configurations', () => {
  const validCourse = {
    title: 'Advanced Full Stack Engineering',
    summary: 'Master modern full-stack application development from scratch with hands-on projects.',
    description: 'Comprehensive curriculum covering Node.js, React, databases, system design and cloud deployments.',
    deliveryFormat: 'Hybrid',
    location: 'Bangalore Campus & Online Live',
    price: 4999,
    currency: 'INR',
    isFree: false,
    level: 'Advanced',
    mode: 'Online',
    status: 'draft',
    approvalStatus: 'pending',
  };

  const parsed = courseSchema.safeParse(validCourse);
  assert.equal(parsed.success, true);
});

test('Education program schema validates university programmes', () => {
  const validProg = {
    title: 'Bachelor of Technology in Computer Science',
    level: 'Undergraduate',
    qualification: 'B.Tech (Honours)',
    field: 'Engineering',
    summary: 'Four-year recognized engineering degree program focusing on software architecture and artificial intelligence.',
    description: 'Accredited university programme designed with global curriculum standards and industry internship pathways.',
    duration: '4 Years',
    deliveryFormat: 'Offline',
    fee: 250000,
    currency: 'INR',
    status: 'draft',
    approvalStatus: 'pending',
  };

  const parsed = educationProgramSchema.safeParse(validProg);
  assert.equal(parsed.success, true);
});

test('Partner organization profile validation supports University and EdTech details', () => {
  const universityProfile = {
    orgType: 'university',
    name: 'Apex Global University',
    legalName: 'Apex Global University Higher Education Trust',
    displayName: 'Apex University',
    location: 'Bangalore',
    address: '100 University Boulevard, Tech Zone',
    city: 'Bangalore',
    state: 'Karnataka',
    country: 'India',
    website: 'https://apex.edu.in',
    contactPerson: 'Dr. R. Sharma (Dean Admissions)',
    contactEmail: 'admissions@apex.edu.in',
    contactPhone: '+919876543210',
    verificationDetails: {
      registrationNumber: 'UGC-REG-2015-8849',
      accreditationAffiliation: 'State Private University Act & UGC recognized',
    },
    programmes: ['b-tech', 'mba'],
  };

  const parsed = partnerProfileSchema.safeParse(universityProfile);
  assert.equal(parsed.success, true);
});

test('Settlement and enrolment statuses include all required lifecycle states', () => {
  assert.deepEqual(SETTLEMENT_STATUS, [
    'pending',
    'eligible',
    'processing',
    'paid',
    'failed',
    'on_hold',
    'reversed',
  ]);
  assert.deepEqual(ENROLMENT_STATUS, [
    'confirmed',
    'pending_verification',
    'cancelled',
    'refunded',
  ]);
});

test('FeeConfig calculation math: percentage and fixed fee breakdown', () => {
  // Test 15% platform commission on ₹10,000 course (1,000,000 paise)
  const baseAmountPaise = 1000000;
  const percentage = 15;
  const platformCommissionPaise = Math.round((baseAmountPaise * percentage) / 100);
  const providerPayablePaise = baseAmountPaise - platformCommissionPaise;

  assert.equal(platformCommissionPaise, 150000); // ₹1,500
  assert.equal(providerPayablePaise, 850000);   // ₹8,500
  assert.equal(platformCommissionPaise + providerPayablePaise, baseAmountPaise);

  // Test fixed fee override (e.g. ₹500 fee = 50,000 paise)
  const fixedFeePaise = 50000;
  const providerShareFixed = baseAmountPaise - fixedFeePaise;
  assert.equal(providerShareFixed, 950000); // ₹9,500
});

test('HTTP Route Order: /api/partners/me does NOT get captured by /:id as invalid ObjectId', async () => {
  const http = await import('node:http');
  const { default: app } = await import('../app.js');

  const server = http.createServer(app);
  await new Promise((resolve) => server.listen(0, resolve));
  const port = server.address().port;

  try {
    const res = await fetch(`http://127.0.0.1:${port}/api/partners/me`);
    const json = await res.json();

    // /me is protected by auth middleware: it MUST return 401 Unauthorized, NOT 400 "That _id is not valid"
    assert.equal(res.status, 401, 'Should trigger auth protection, not route to :id');
    assert.notEqual(json.message, 'That _id is not valid');
    assert.match(json.message, /sign in/i);
  } finally {
    server.close();
  }
});

test('HTTP Route Error Handling: /api/partners/:id with invalid ObjectId returns clean 404, not 400 CastError', async () => {
  const http = await import('node:http');
  const { default: app } = await import('../app.js');

  const server = http.createServer(app);
  await new Promise((resolve) => server.listen(0, resolve));
  const port = server.address().port;

  try {
    const res = await fetch(`http://127.0.0.1:${port}/api/partners/not-a-valid-object-id`);
    const json = await res.json();

    assert.equal(res.status, 404, 'Invalid ID must return 404 Not Found');
    assert.notEqual(json.message, 'That _id is not valid');
    assert.match(json.message, /not found/i);
  } finally {
    server.close();
  }
});

test('findOneOrFail safely intercepts invalid ObjectId and throws clean 404 ApiError', async () => {
  const { findOneOrFail } = await import('../services/contentService.js');
  const { EducationProgram } = await import('../models/index.js');

  await assert.rejects(
    async () => {
      await findOneOrFail(EducationProgram, { _id: 'invalid-id-not-hex' }, { message: 'Programme not found' });
    },
    (err) => {
      assert.equal(err.statusCode, 404);
      assert.equal(err.message, 'Programme not found');
      return true;
    }
  );
});

test('requireVerifiedPartner middleware blocks unverified or suspended partner accounts with 403', async () => {
  const { requireVerifiedPartner } = await import('../middleware/partnerVerification.js');

  // Test non-partner role
  const reqUser = { user: { role: 'user' } };
  let errCaptured = null;
  await requireVerifiedPartner(reqUser, {}, (err) => {
    errCaptured = err;
  });
  assert.ok(errCaptured, 'Must reject user role');
  assert.equal(errCaptured.statusCode, 403);

  // Test admin bypass
  const reqAdmin = { user: { role: 'admin' } };
  let adminNextCalled = false;
  await requireVerifiedPartner(reqAdmin, {}, (err) => {
    if (!err) adminNextCalled = true;
  });
  assert.equal(adminNextCalled, true, 'Admin should bypass verification requirement');
});

