import { spawn } from 'node:child_process';
import fs from 'node:fs';
import path from 'node:path';

const CHROME_PATH = 'C:\\Program Files\\Google\\Chrome\\Application\\chrome.exe';
const OUT_DIR = 'C:\\Users\\Chandubg\\.gemini\\antigravity\\brain\\1ac3a2b0-ad56-4a11-94cc-2d2568ee2629';
const TEMP_USER_DATA = path.join(process.env.TEMP || 'C:\\Temp', 'dl_cdp_modal_' + Date.now());

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
    '--remote-debugging-port=9225',
    `--user-data-dir=${TEMP_USER_DATA}`,
    '--window-size=1440,1100',
    '--disable-gpu',
    '--no-sandbox',
    'about:blank',
  ],
  { stdio: 'ignore' }
);

await sleep(1500);

const list = await fetch('http://127.0.0.1:9225/json/list').then((r) => r.json());
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
await sleep(1500);

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

// Check if manage button exists and click it
const evalRes = await send('Runtime.evaluate', {
  expression: `
    (() => {
      const btns = Array.from(document.querySelectorAll('button'));
      const manageBtn = btns.find(b => b.textContent.includes('Manage'));
      if (manageBtn) {
        manageBtn.click();
        return 'Manage button clicked!';
      }
      return 'Manage button NOT found. Buttons found: ' + btns.map(b => b.textContent.trim()).join(' | ');
    })()
  `,
});
console.log('Click result:', evalRes.result?.value);

await sleep(3000);

const { data: img } = await send('Page.captureScreenshot', { format: 'png' });
const p = path.join(OUT_DIR, '04_admin_order_details_drawer.png');
fs.writeFileSync(p, Buffer.from(img, 'base64'));
console.log('Saved 04_admin_order_details_drawer.png');

ws.close();
chromeProcess.kill();
