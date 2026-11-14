import { spawn } from 'node:child_process';
import fs from 'node:fs';
import path from 'node:path';

const CHROME_PATH = 'C:\\Program Files\\Google\\Chrome\\Application\\chrome.exe';
const OUT_DIR = 'C:\\Users\\Chandubg\\.gemini\\antigravity\\brain\\1ac3a2b0-ad56-4a11-94cc-2d2568ee2629';
const TEMP_USER_DATA = path.join(process.env.TEMP || 'C:\\Temp', 'dl_cdp_' + Date.now());

async function sleep(ms) {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

class CDPClient {
  constructor(wsUrl) {
    this.ws = new WebSocket(wsUrl);
    this.id = 1;
    this.callbacks = new Map();
  }

  async connect() {
    return new Promise((resolve, reject) => {
      this.ws.onopen = resolve;
      this.ws.onerror = reject;
      this.ws.onmessage = (event) => {
        const msg = JSON.parse(event.data);
        if (msg.id && this.callbacks.has(msg.id)) {
          const { resolve, reject } = this.callbacks.get(msg.id);
          this.callbacks.delete(msg.id);
          if (msg.error) reject(msg.error);
          else resolve(msg.result);
        }
      };
    });
  }

  send(method, params = {}) {
    const id = this.id++;
    return new Promise((resolve, reject) => {
      this.callbacks.set(id, { resolve, reject });
      this.ws.send(JSON.stringify({ id, method, params }));
    });
  }

  close() {
    this.ws.close();
  }
}

async function run() {
  console.log('Authenticating candidate and admin...');
  // Find our existing test candidate from DB or login
  const candRes = await fetch('http://localhost:8080/api/auth/login', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ email: 'candidate_1794643590762@example.com', password: 'Password123!' }),
  });
  const candLogin = await candRes.json();
  const candToken = candLogin.data.token;
  const candUser = candLogin.data.user;
  console.log(`Candidate authenticated: ${candUser.email} (${candUser.name})`);

  const adminRes = await fetch('http://localhost:8080/api/auth/login', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ email: 'admin@dutylaunch.com', password: 'ChangeMe123' }),
  });
  const adminLogin = await adminRes.json();
  const adminToken = adminLogin.data.token;
  const adminUser = adminLogin.data.user;
  console.log(`Admin authenticated: ${adminUser.email} (role: ${adminUser.role})`);

  console.log('Spawning Chrome with remote debugging on port 9222...');
  const chromeProcess = spawn(
    CHROME_PATH,
    [
      '--headless=new',
      '--remote-debugging-port=9222',
      `--user-data-dir=${TEMP_USER_DATA}`,
      '--window-size=1440,1100',
      '--disable-gpu',
      '--no-sandbox',
      'about:blank',
    ],
    { stdio: 'ignore' }
  );

  let version = null;
  for (let i = 0; i < 20; i++) {
    await sleep(300);
    try {
      const res = await fetch('http://127.0.0.1:9222/json/version');
      if (res.ok) {
        version = await res.json();
        break;
      }
    } catch {}
  }

  if (!version) throw new Error('Chrome did not start CDP on port 9222');

  const list = await fetch('http://127.0.0.1:9222/json/list').then((r) => r.json());
  const pageTarget = list.find((t) => t.type === 'page') || list[0];
  const client = new CDPClient(pageTarget.webSocketDebuggerUrl);
  await client.connect();

  await client.send('Page.enable');
  await client.send('Runtime.enable');

  async function takeScreenshot(filename, clip = null) {
    const params = { format: 'png' };
    if (clip) params.clip = clip;
    const { data } = await client.send('Page.captureScreenshot', params);
    const filePath = path.join(OUT_DIR, filename);
    fs.writeFileSync(filePath, Buffer.from(data, 'base64'));
    console.log(`Saved screenshot: ${filename} (${(fs.statSync(filePath).size / 1024).toFixed(1)} KB)`);
    return filePath;
  }

  // Helper to inject auth session
  async function setSession(token, user) {
    const userJson = JSON.stringify(user);
    await client.send('Runtime.evaluate', {
      expression: `
        sessionStorage.setItem('dl.token', ${JSON.stringify(token)});
        sessionStorage.setItem('dl.user', ${JSON.stringify(userJson)});
        localStorage.setItem('dl.token', ${JSON.stringify(token)});
      `,
    });
  }

  // 1. Candidate on /resume-builder (Service page + Pricing packages)
  console.log('\n--- 1. Candidate on /resume-builder ---');
  await client.send('Page.navigate', { url: 'http://localhost:5173/login' });
  await sleep(1000);
  await setSession(candToken, candUser);
  await client.send('Page.navigate', { url: 'http://localhost:5173/resume-builder' });
  await sleep(3000);
  await takeScreenshot('01_candidate_resume_builder_top.png');

  // Scroll down to see pricing packages and upload zone
  await client.send('Runtime.evaluate', { expression: `window.scrollBy(0, 550);` });
  await sleep(1000);
  await takeScreenshot('01b_candidate_packages_and_pricing.png');

  await client.send('Runtime.evaluate', { expression: `window.scrollBy(0, 650);` });
  await sleep(1000);
  await takeScreenshot('01c_candidate_upload_zone.png');

  // 2. Candidate on /my-resumes
  console.log('\n--- 2. Candidate on /my-resumes ---');
  await client.send('Page.navigate', { url: 'http://localhost:5173/my-resumes' });
  await sleep(3000);
  await takeScreenshot('02_candidate_my_resume_orders.png');

  // 3. Admin on /admin/resume-orders
  console.log('\n--- 3. Admin on /admin/resume-orders ---');
  await setSession(adminToken, adminUser);
  await client.send('Page.navigate', { url: 'http://localhost:5173/admin/resume-orders' });
  await sleep(3500);
  await takeScreenshot('03_admin_resume_orders_management.png');

  // 4. Click order in Admin table to open Management Drawer
  console.log('\n--- 4. Open Order Detail Drawer in Admin ---');
  await client.send('Runtime.evaluate', {
    expression: `
      const manageBtn = Array.from(document.querySelectorAll('button')).find(b => b.textContent.includes('Manage'));
      if (manageBtn) {
        manageBtn.click();
      } else {
        const row = document.querySelector('tbody tr');
        if (row) row.click();
      }
    `,
  });
  await sleep(2000);
  await takeScreenshot('04_admin_order_details_drawer.png');

  // 5. ATS Resume Checker page
  console.log('\n--- 5. ATS Resume Checker page ---');
  await client.send('Page.navigate', { url: 'http://localhost:5173/resume-checker' });
  await sleep(3000);
  await takeScreenshot('05_ats_checker_disclaimer.png');

  client.close();
  chromeProcess.kill();
  console.log('\nVisual verification suite finished successfully!');
}

run().catch((err) => {
  console.error('Visual verification failed:', err);
  process.exit(1);
});
