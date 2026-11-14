import { spawn } from 'node:child_process';
import path from 'node:path';

const CHROME_PATH = 'C:\\Program Files\\Google\\Chrome\\Application\\chrome.exe';
const TEMP_USER_DATA = path.join(process.env.TEMP || 'C:\\Temp', 'dl_cdp_debug_' + Date.now());

async function sleep(ms) {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

const adminLogin = await fetch('http://localhost:8080/api/auth/login', {
  method: 'POST',
  headers: { 'Content-Type': 'application/json' },
  body: JSON.stringify({ email: 'admin@dutylaunch.com', password: 'ChangeMe123' }),
}).then(r => r.json());

const adminToken = adminLogin.data.token;
const adminUser = adminLogin.data.user;

const chromeProcess = spawn(
  CHROME_PATH,
  [
    '--headless=new',
    '--remote-debugging-port=9223',
    `--user-data-dir=${TEMP_USER_DATA}`,
    '--window-size=1440,1100',
    '--disable-gpu',
    '--no-sandbox',
    'about:blank',
  ],
  { stdio: 'ignore' }
);

await sleep(1500);

const list = await fetch('http://127.0.0.1:9223/json/list').then((r) => r.json());
const ws = new WebSocket(list[0].webSocketDebuggerUrl);

ws.onmessage = (event) => {
  const msg = JSON.parse(event.data);
  if (msg.method === 'Console.messageAdded' || msg.method === 'Runtime.consoleAPICalled') {
    console.log('[Browser Console]', JSON.stringify(msg.params));
  }
  if (msg.method === 'Network.responseReceived') {
    console.log('[Browser Network Response]', msg.params.response.url, msg.params.response.status);
  }
};

await new Promise((r) => (ws.onopen = r));

function send(method, params = {}) {
  ws.send(JSON.stringify({ id: Math.floor(Math.random() * 100000), method, params }));
}

send('Page.enable');
send('Runtime.enable');
send('Network.enable');

// Navigate to login first
send('Page.navigate', { url: 'http://localhost:5173/login' });
await sleep(1000);

// Set session
send('Runtime.evaluate', {
  expression: `
    sessionStorage.setItem('dl.token', '${adminToken}');
    sessionStorage.setItem('dl.user', JSON.stringify(${JSON.stringify(adminUser)}));
    localStorage.setItem('dl.token', '${adminToken}');
  `,
});
await sleep(500);

// Navigate to admin
console.log('Navigating to admin resume orders...');
send('Page.navigate', { url: 'http://localhost:5173/admin/resume-orders' });
await sleep(4000);

// Evaluate what state is
send('Runtime.evaluate', {
  expression: `
    console.log('Token in storage:', sessionStorage.getItem('dl.token'));
    console.log('User in storage:', sessionStorage.getItem('dl.user'));
    fetch('/api/resume-orders/admin/all', {
      headers: { Authorization: 'Bearer ' + sessionStorage.getItem('dl.token') }
    }).then(r => r.json()).then(d => console.log('Fetch result inside browser:', JSON.stringify(d)));
  `,
});

await sleep(3000);

ws.close();
chromeProcess.kill();
