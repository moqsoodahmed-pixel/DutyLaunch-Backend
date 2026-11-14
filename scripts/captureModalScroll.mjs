import { spawn } from 'node:child_process';
import fs from 'node:fs';
import path from 'node:path';

const CHROME_PATH = 'C:\\Program Files\\Google\\Chrome\\Application\\chrome.exe';
const OUT_DIR = 'C:\\Users\\Chandubg\\.gemini\\antigravity\\brain\\1ac3a2b0-ad56-4a11-94cc-2d2568ee2629';
const TEMP_USER_DATA = path.join(process.env.TEMP || 'C:\\Temp', 'dl_cdp_modal_scroll_' + Date.now());

async function sleep(ms) {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

const adminLogin = await fetch('http://localhost:8080/api/auth/login', {
  method: 'POST',
  headers: { 'Content-Type': 'application/json' },
  body: JSON.stringify({ email: 'admin@dutylaunch.com', password: 'ChangeMe123' }),
}).then((r) => r.json());

const adminToken = adminLogin.data.token;
const adminUser = adminLogin.data.user;

const chromeProcess = spawn(
  CHROME_PATH,
  [
    '--headless=new',
    '--remote-debugging-port=9227',
    `--user-data-dir=${TEMP_USER_DATA}`,
    '--window-size=1440,1100',
    '--disable-gpu',
    '--no-sandbox',
    'about:blank',
  ],
  { stdio: 'ignore' }
);

await sleep(1500);

const list = await fetch('http://127.0.0.1:9227/json/list').then((r) => r.json());
const ws = new WebSocket(list[0].webSocketDebuggerUrl);

let msgId = 1;
const callbacks = new Map();
ws.onmessage = (event) => {
  const msg = JSON.parse(event.data);
  if (msg.id && callbacks.has(msg.id)) {
    const { resolve, reject } = callbacks.get(msg.id);
    callbacks.delete(msg.id);
    if (msg.error) reject(msg.error);
    else resolve(msg.result);
  }
};

await new Promise((r) => (ws.onopen = r));

function send(method, params = {}) {
  const id = msgId++;
  return new Promise((resolve, reject) => {
    callbacks.set(id, { resolve, reject });
    ws.send(JSON.stringify({ id, method, params }));
  });
}

await send('Page.enable');
await send('Runtime.enable');

await send('Page.navigate', { url: 'http://localhost:5173/login' });
await sleep(1000);

await send('Runtime.evaluate', {
  expression: `
    sessionStorage.setItem('dl.token', '${adminToken}');
    sessionStorage.setItem('dl.user', JSON.stringify(${JSON.stringify(adminUser)}));
    localStorage.setItem('dl.token', '${adminToken}');
  `,
});
await sleep(500);

await send('Page.navigate', { url: 'http://localhost:5173/admin/resume-orders' });
await sleep(3500);

await send('Runtime.evaluate', {
  expression: `
    const manageBtn = Array.from(document.querySelectorAll('button')).find(b => b.textContent.includes('Manage'));
    if (manageBtn) manageBtn.click();
  `,
});
await sleep(2000);

// Scroll inside the modal container
await send('Runtime.evaluate', {
  expression: `
    const scrollContainer = document.querySelector('[role="dialog"] .overflow-y-auto');
    if (scrollContainer) scrollContainer.scrollTop = 500;
  `,
});
await sleep(1000);

const { data: img } = await send('Page.captureScreenshot', { format: 'png' });
const p = path.join(OUT_DIR, '04b_admin_order_modal_controls.png');
fs.writeFileSync(p, Buffer.from(img, 'base64'));
console.log('Saved 04b_admin_order_modal_controls.png');

// Scroll further down to see Timeline and Notes
await send('Runtime.evaluate', {
  expression: `
    const scrollContainer = document.querySelector('[role="dialog"] .overflow-y-auto');
    if (scrollContainer) scrollContainer.scrollTop = 1100;
  `,
});
await sleep(1000);

const { data: img2 } = await send('Page.captureScreenshot', { format: 'png' });
const p2 = path.join(OUT_DIR, '04c_admin_order_modal_timeline.png');
fs.writeFileSync(p2, Buffer.from(img2, 'base64'));
console.log('Saved 04c_admin_order_modal_timeline.png');

ws.close();
chromeProcess.kill();
