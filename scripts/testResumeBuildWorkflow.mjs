import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';

const API_BASE = 'http://localhost:8080/api';

async function req(url, options = {}) {
  const res = await fetch(`${API_BASE}${url}`, options);
  const data = await res.json().catch(() => null);
  return { status: res.status, headers: res.headers, data };
}

async function runTest() {
  console.log('--- Starting DutyLaunch Resume Build Workflow Integration Test ---');

  // 1. Verify Packages & Pricing
  console.log('1. Checking CV Packages from /api/pricing/cv-packages ...');
  const pkgRes = await req('/pricing/cv-packages');
  assert.equal(pkgRes.status, 200);
  const packages = pkgRes.data.data;
  console.log('Packages returned:', packages.map((p) => ({ name: p.name, band: p.experienceBand, price: p.price })));

  const p02 = packages.find((p) => p.experienceMin === 0 && p.experienceMax === 2);
  const p35 = packages.find((p) => p.experienceMin === 3 && p.experienceMax === 5);
  const p68 = packages.find((p) => p.experienceMin === 6 && p.experienceMax === 8);
  const p9p = packages.find((p) => p.experienceMin === 9);

  assert.ok(p02, '0-2 years package found');
  assert.equal(p02.price, 399, '0-2 years is 399');

  assert.ok(p35, '3-5 years package found');
  assert.equal(p35.price, 799, '3-5 years is 799');

  assert.ok(p68, '6-8 years package found');
  assert.equal(p68.price, 999, '6-8 years is 999');

  assert.ok(p9p, '9+ years package found');
  assert.equal(p9p.price, 1199, '9+ years is 1199');
  console.log('✔ All 4 packages and prices match user requirements exactly: 399, 799, 999, 1199');

  // 2. Candidate Sign In
  console.log('\n2. Signing in Candidate Chandu Bg ...');
  // Register or sign in candidate
  let candidateToken = null;
  const loginRes = await req('/auth/login', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ email: 'chandubg5678@gmail.com', password: 'Password123' }),
  });

  if (loginRes.status === 200 && loginRes.data?.data?.token) {
    candidateToken = loginRes.data.data.token;
  } else {
    // If password different, register test candidate
    const regRes = await req('/auth/register', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        name: 'Test Candidate',
        email: `candidate_${Date.now()}@example.com`,
        phone: '+91 9876543210',
        password: 'Password123!',
      }),
    });
    assert.equal(regRes.status, 201);
    candidateToken = regRes.data.data.token;
  }
  console.log('✔ Candidate authenticated.');

  // 3. Admin Sign In
  console.log('\n3. Signing in Admin ...');
  const adminLogin = await req('/auth/login', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ email: 'admin@dutylaunch.com', password: 'ChangeMe123' }),
  });
  assert.equal(adminLogin.status, 200, 'Admin login succeeded');
  const adminToken = adminLogin.data.data.token;
  console.log('✔ Admin authenticated.');

  // 4. Create Order & Payment for Package (e.g. Mid-Level Professional 3-5 years, ₹799)
  console.log('\n4. Candidate purchasing Mid-Level Package (₹799) ...');
  const orderRes = await req('/payments/orders', {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      Authorization: `Bearer ${candidateToken}`,
    },
    body: JSON.stringify({
      itemType: 'cv-package',
      itemId: p35._id,
    }),
  });
  assert.equal(orderRes.status, 201);
  const paymentOrder = orderRes.data.data;
  console.log(`Payment order created: ID ${paymentOrder.orderId}, Amount ${paymentOrder.amount} paise`);

  // Verify payment
  const verifyRes = await req('/payments/verify', {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      Authorization: `Bearer ${candidateToken}`,
    },
    body: JSON.stringify({
      razorpay_order_id: paymentOrder.orderId,
      razorpay_payment_id: `pay_${Date.now()}`,
      razorpay_signature: 'a'.repeat(64),
    }),
  });
  assert.equal(verifyRes.status, 200);
  const verifiedPayment = verifyRes.data.data;
  console.log('✔ Payment verified as paid.');

  // 5. Submit Resume Build Request with files & instructions
  console.log('\n5. Candidate submitting Resume Build Request with files ...');
  const formData = new FormData();
  formData.append('paymentId', verifiedPayment.id);
  formData.append('packageId', p35._id);
  formData.append('targetRole', 'Senior Full Stack Engineer');
  formData.append('targetIndustry', 'FinTech & Cloud Platforms');
  formData.append('userInstructions', 'Please highlight 4 years of Node.js, React, and system architecture.');

  const dummyResume = new Blob(['Sample Resume Content: 4 years experience in Full Stack development.'], {
    type: 'application/pdf',
  });
  formData.append('resume', dummyResume, 'chandu_original_resume.pdf');

  const dummyCv = new Blob(['Sample CV Content: Publications, awards, and project leadership.'], {
    type: 'application/pdf',
  });
  formData.append('cv', dummyCv, 'chandu_original_cv.pdf');

  const createRes = await fetch(`${API_BASE}/resume-orders`, {
    method: 'POST',
    headers: {
      Authorization: `Bearer ${candidateToken}`,
    },
    body: formData,
  });
  const createdOrderBody = await createRes.json();
  assert.equal(createRes.status, 201);
  const order = createdOrderBody.data;
  console.log(`✔ Order created successfully!`);
  console.log(`   Order Number: ${order.orderNumber}`);
  console.log(`   Initial Status: ${order.status}`);
  console.log(`   Turnaround SLA Notice: "${order.turnaroundNotice}"`);
  assert.equal(order.status, 'pending');
  assert.ok(order.turnaroundNotice.toLowerCase().includes('within a day'));

  // 6. Candidate checking their orders list
  console.log('\n6. Candidate fetching "My Resume Orders" ...');
  const myOrdersRes = await req('/resume-orders/my-orders', {
    headers: { Authorization: `Bearer ${candidateToken}` },
  });
  assert.equal(myOrdersRes.status, 200);
  assert.ok(myOrdersRes.data.data.some((o) => o._id === order._id));
  console.log(`✔ Order ${order.orderNumber} appears in candidate's My Resume Orders.`);

  // 7. Test Secure Download: Candidate downloading their own file
  console.log('\n7. Candidate securely downloading own original resume ...');
  const downloadRes = await fetch(`${API_BASE}/resume-orders/${order._id}/download/original-resume`, {
    headers: { Authorization: `Bearer ${candidateToken}` },
  });
  assert.equal(downloadRes.status, 200);
  console.log('✔ Candidate downloaded their own file (200 OK).');

  // 8. Test Security: Other user trying to download candidate's file should be 403 Forbidden!
  console.log('\n8. Security check: Unauthorized user attempting to download candidate file ...');
  const hackerRes = await req('/auth/register', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({
      name: 'Other User',
      email: `other_${Date.now()}@example.com`,
      phone: '+91 9123456789',
      password: 'Password123!',
    }),
  });
  const otherToken = hackerRes.data.data.token;

  const forbiddenDownload = await fetch(`${API_BASE}/resume-orders/${order._id}/download/original-resume`, {
    headers: { Authorization: `Bearer ${otherToken}` },
  });
  assert.equal(forbiddenDownload.status, 403, 'Unauthorized download was blocked with 403 Forbidden');
  console.log('✔ RBAC security verified: Unauthorized user receives 403 Forbidden.');

  // 9. Admin Panel: List all orders
  console.log('\n9. Admin viewing Resume Build Management section ...');
  const adminListRes = await req('/resume-orders/admin/all', {
    headers: { Authorization: `Bearer ${adminToken}` },
  });
  assert.equal(adminListRes.status, 200);
  const foundOrder = adminListRes.data.data.find((o) => o._id === order._id);
  assert.ok(foundOrder, 'Order found in admin panel');
  console.log(`✔ Admin retrieved order ${foundOrder.orderNumber} with stats:`, adminListRes.data.stats);

  // 10. Admin: Assign Staff
  console.log('\n10. Admin assigning specialist staff ...');
  const assignRes = await req(`/resume-orders/admin/${order._id}/assign`, {
    method: 'PATCH',
    headers: {
      'Content-Type': 'application/json',
      Authorization: `Bearer ${adminToken}`,
    },
    body: JSON.stringify({
      staffName: 'Priya Sharma (Senior Executive Writer)',
      staffEmail: 'priya@dutylaunch.com',
      note: 'Assigned to senior IT & FinTech writer',
    }),
  });
  assert.equal(assignRes.status, 200);
  assert.equal(assignRes.data.data.status, 'assigned');
  console.log(`✔ Order assigned to Priya Sharma. Status is now: ${assignRes.data.data.status}`);

  // 11. Admin: Change status to In Progress, then Quality Check
  console.log('\n11. Admin updating status to "in_progress" then "quality_check" ...');
  const progressRes = await req(`/resume-orders/admin/${order._id}/status`, {
    method: 'PATCH',
    headers: {
      'Content-Type': 'application/json',
      Authorization: `Bearer ${adminToken}`,
    },
    body: JSON.stringify({
      status: 'in_progress',
      note: 'First draft completed, restructuring bullets for impact.',
    }),
  });
  assert.equal(progressRes.status, 200);
  assert.equal(progressRes.data.data.status, 'in_progress');

  const qaRes = await req(`/resume-orders/admin/${order._id}/status`, {
    method: 'PATCH',
    headers: {
      'Content-Type': 'application/json',
      Authorization: `Bearer ${adminToken}`,
    },
    body: JSON.stringify({
      status: 'quality_check',
      note: 'Running internal ATS audit and proofreading.',
    }),
  });
  assert.equal(qaRes.status, 200);
  assert.equal(qaRes.data.data.status, 'quality_check');
  console.log('✔ Status successfully transitioned to in_progress and quality_check.');

  // 12. Admin: Add internal note
  console.log('\n12. Admin adding internal note ...');
  const noteRes = await req(`/resume-orders/admin/${order._id}/notes`, {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      Authorization: `Bearer ${adminToken}`,
    },
    body: JSON.stringify({ note: 'Candidate verified on LinkedIn, strong credentials in React & AWS.' }),
  });
  assert.equal(noteRes.status, 200);
  console.log('✔ Internal note saved.');

  // 13. Admin: Upload Completed Resume and Completed CV
  console.log('\n13. Admin uploading finalized Completed Resume and Completed CV ...');
  const completedForm = new FormData();
  const finishedResume = new Blob(['FINAL PROFESSIONAL RESUME: Handcrafted by DutyLaunch Team.'], {
    type: 'application/pdf',
  });
  completedForm.append('completedResume', finishedResume, 'chandu_final_executive_resume.pdf');

  const finishedCv = new Blob(['FINAL PROFESSIONAL CV: Handcrafted by DutyLaunch Team.'], {
    type: 'application/pdf',
  });
  completedForm.append('completedCv', finishedCv, 'chandu_final_executive_cv.pdf');
  completedForm.append('note', 'Final QA approved and ready for delivery.');
  completedForm.append('markCompleted', 'true');

  const uploadCompleteRes = await fetch(`${API_BASE}/resume-orders/admin/${order._id}/upload-completed`, {
    method: 'POST',
    headers: { Authorization: `Bearer ${adminToken}` },
    body: completedForm,
  });
  const completedBody = await uploadCompleteRes.json();
  assert.equal(uploadCompleteRes.status, 200);
  assert.equal(completedBody.data.status, 'completed');
  assert.ok(completedBody.data.completedResume?.filename);
  assert.ok(completedBody.data.completedCv?.filename);
  console.log(`✔ Finished documents delivered! Status is now: ${completedBody.data.status}`);

  // 14. Candidate checking updated order on their end
  console.log('\n14. Candidate verifying completed order on user end ...');
  const candidateCheck = await req(`/resume-orders/my-orders/${order._id}`, {
    headers: { Authorization: `Bearer ${candidateToken}` },
  });
  assert.equal(candidateCheck.status, 200);
  const updatedOrder = candidateCheck.data.data;
  assert.equal(updatedOrder.status, 'completed');
  console.log(`✔ Candidate sees live status: ${updatedOrder.status}`);
  console.log(`   Completion Date: ${updatedOrder.completionDate}`);
  console.log(`   Completed Resume: ${updatedOrder.completedResume.originalname}`);
  console.log(`   Completed CV: ${updatedOrder.completedCv.originalname}`);

  // 15. Candidate downloading completed resume
  console.log('\n15. Candidate downloading final completed resume ...');
  const candidateDownload = await fetch(`${API_BASE}/resume-orders/${order._id}/download/completed-resume`, {
    headers: { Authorization: `Bearer ${candidateToken}` },
  });
  assert.equal(candidateDownload.status, 200);
  console.log('✔ Candidate downloaded final completed resume (200 OK).');

  // 16. In-App Notifications check
  console.log('\n16. Checking candidate notifications ...');
  const notifRes = await req('/notifications/mine', {
    headers: { Authorization: `Bearer ${candidateToken}` },
  });
  assert.equal(notifRes.status, 200);
  console.log(`✔ Candidate has ${notifRes.data.data.notifications.length} in-app notification(s), ${notifRes.data.data.unreadCount} unread.`);

  console.log('\n======================================================');
  console.log('ALL WORKFLOW VERIFICATION CHECKS PASSED WITH 100% PROOF!');
  console.log('======================================================\n');
}

runTest().catch((err) => {
  console.error('Test execution failed:', err);
  process.exit(1);
});

