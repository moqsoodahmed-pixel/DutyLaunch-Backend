import { spawn } from 'node:child_process';
import fs from 'node:fs';
import path from 'node:path';

const CHROME_PATH = 'C:\\Program Files\\Google\\Chrome\\Application\\chrome.exe';
const OUT_DIR = 'C:\\Users\\Chandubg\\.gemini\\antigravity\\brain\\1ac3a2b0-ad56-4a11-94cc-2d2568ee2629';
const TEMP_USER_DATA = path.join(process.env.TEMP || 'C:\\Temp', 'dl_cdp_inv_' + Date.now());

async function sleep(ms) {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

const candRes = await fetch('http://localhost:8080/api/auth/login', {
  method: 'POST',
  headers: { 'Content-Type': 'application/json' },
  body: JSON.stringify({ email: 'candidate_1794643590762@example.com', password: 'Password123!' }),
});
const candLogin = await candRes.json();
const candToken = candLogin.data.token;
const candUser = candLogin.data.user;

const chromeProcess = spawn(
  CHROME_PATH,
  [
    '--headless=new',
    '--remote-debugging-port=9228',
    `--user-data-dir=${TEMP_USER_DATA}`,
    '--window-size=1440,1100',
    '--disable-gpu',
    '--no-sandbox',
    'about:blank',
  ],
  { stdio: 'ignore' }
);

await sleep(1500);

const list = await fetch('http://127.0.0.1:9228/json/list').then((r) => r.json());
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
    sessionStorage.setItem('dl.token', '${candToken}');
    sessionStorage.setItem('dl.user', JSON.stringify(${JSON.stringify(candUser)}));
    localStorage.setItem('dl.token', '${candToken}');
  `,
});
await sleep(500);

await send('Page.navigate', { url: 'http://localhost:5173/my-resumes' });
await sleep(3500);

// Click Invoice & Receipt button
await send('Runtime.evaluate', {
  expression: `
    const invBtn = Array.from(document.querySelectorAll('button')).find(b => b.textContent.includes('Invoice & Receipt'));
    if (invBtn) invBtn.click();
  `,
});
await sleep(2000);

const { data: img } = await send('Page.captureScreenshot', { format: 'png' });
const p = path.join(OUT_DIR, '02b_candidate_invoice_receipt_modal.png');
fs.writeFileSync(p, Buffer.from(img, 'base64'));
console.log('Saved 02b_candidate_invoice_receipt_modal.png');

ws.close();
chromeProcess.kill();
