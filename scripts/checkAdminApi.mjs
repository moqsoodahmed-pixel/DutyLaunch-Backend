const adminRes = await fetch('http://localhost:8080/api/auth/login', {
  method: 'POST',
  headers: { 'Content-Type': 'application/json' },
  body: JSON.stringify({ email: 'admin@dutylaunch.com', password: 'ChangeMe123' }),
});
const adminLogin = await adminRes.json();
const adminToken = adminLogin.data.token;

const url = 'http://localhost:8080/api/resume-orders/admin/all?status=all&sortBy=createdAt&sortOrder=desc&page=1&limit=20';
const listRes = await fetch(url, {
  headers: { Authorization: `Bearer ${adminToken}` },
});
console.log('Status code:', listRes.status);
const listData = await listRes.json();
console.log('Count:', listData.data?.length, 'Stats:', listData.stats);
