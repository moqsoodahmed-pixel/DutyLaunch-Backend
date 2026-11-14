import { spawn } from 'node:child_process';
import fs from 'node:fs';
import path from 'node:path';

const CHROME_PATH = 'C:\\Program Files\\Google\\Chrome\\Application\\chrome.exe';
const OUT_DIR = 'C:\\Users\\Chandubg\\.gemini\\antigravity\\brain\\1ac3a2b0-ad56-4a11-94cc-2d2568ee2629';
const TEMP_USER_DATA = path.join(process.env.TEMP || 'C:\\Temp', 'dl_cdp_proresumes_' + Date.now());

async function sleep(ms) {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

// 1. Authenticate candidate
let candToken = '';
let candUser = null;

let candRes = await fetch('http://localhost:8080/api/auth/login', {
  method: 'POST',
  headers: { 'Content-Type': 'application/json' },
  body: JSON.stringify({ email: 'chandubg5678@gmail.com', password: 'Password123' }),
});
let candLogin = await candRes.json();

if (!candLogin?.data?.token) {
  const regEmail = `chandu_demo_${Date.now()}@example.com`;
  candRes = await fetch('http://localhost:8080/api/auth/register', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({
      name: 'Chandu Bg',
      email: regEmail,
      phone: '+91 9876543210',
      password: 'Password123!',
    }),
  });
  candLogin = await candRes.json();
}

candToken = candLogin.data.token;
candUser = candLogin.data.user;
console.log('Candidate signed in successfully as:', candUser.name, candUser.email);

const chromeProcess = spawn(
  CHROME_PATH,
  [
    '--headless=new',
    '--remote-debugging-port=9232',
    `--user-data-dir=${TEMP_USER_DATA}`,
    '--window-size=1440,1100',
    '--disable-gpu',
    '--no-sandbox',
    'about:blank',
  ],
  { stdio: 'ignore' }
);

await sleep(1500);

const list = await fetch('http://127.0.0.1:9232/json/list').then((r) => r.json());
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

try {
  console.log('Connected to Chrome DevTools Protocol.');
  await send('Page.enable');
  await send('Runtime.enable');
  await send('DOM.enable');

  // Set auth credentials
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

  // 1. Navigate to /resume-builder
  console.log('Navigating to http://localhost:5173/resume-builder ...');
  await send('Page.navigate', { url: 'http://localhost:5173/resume-builder' });
  await sleep(2500);

  // Screenshot 1: Top section showing Header, How It Works, and Step 4 (No internal team)
  await send('Runtime.evaluate', { expression: 'window.scrollTo(0, 0);' });
  await sleep(500);
  const snap1 = await send('Page.captureScreenshot', { format: 'png' });
  fs.writeFileSync(path.join(OUT_DIR, '07_workflow_steps_no_internal_team.png'), Buffer.from(snap1.data, 'base64'));
  console.log('Saved 07_workflow_steps_no_internal_team.png');

  // Screenshot 2: Scroll down to Package Cards (ProResumes style)
  await send('Runtime.evaluate', { expression: 'window.scrollTo(0, 480);' });
  await sleep(800);
  const snap2 = await send('Page.captureScreenshot', { format: 'png' });
  fs.writeFileSync(path.join(OUT_DIR, '06_proresumes_style_pricing_cards.png'), Buffer.from(snap2.data, 'base64'));
  console.log('Saved 06_proresumes_style_pricing_cards.png');

  // Screenshot 3: Scroll further down to capture buttons and delivery badges fully
  await send('Runtime.evaluate', { expression: 'window.scrollTo(0, 1000);' });
  await sleep(800);
  const snap3 = await send('Page.captureScreenshot', { format: 'png' });
  fs.writeFileSync(path.join(OUT_DIR, '06b_proresumes_card_actions_delivery.png'), Buffer.from(snap3.data, 'base64'));
  console.log('Saved 06b_proresumes_card_actions_delivery.png');

  // Screenshot 4: Navigate to /pricing to verify public pricing cards
  console.log('Navigating to http://localhost:5173/pricing ...');
  await send('Page.navigate', { url: 'http://localhost:5173/pricing' });
  await sleep(2500);
  await send('Runtime.evaluate', { expression: 'window.scrollTo(0, 480);' });
  await sleep(800);
  const snap4 = await send('Page.captureScreenshot', { format: 'png' });
  fs.writeFileSync(path.join(OUT_DIR, '08_pricing_page_proresumes_cards.png'), Buffer.from(snap4.data, 'base64'));
  console.log('Saved 08_pricing_page_proresumes_cards.png');

  console.log('All screenshots captured successfully!');
} finally {
  try {
    ws.close();
  } catch {}
  try {
    chromeProcess.kill();
  } catch {}
}
