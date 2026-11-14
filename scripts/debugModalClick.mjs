import { spawn } from 'node:child_process';
import path from 'node:path';

const CHROME_PATH = 'C:\\Program Files\\Google\\Chrome\\Application\\chrome.exe';
const TEMP_USER_DATA = path.join(process.env.TEMP || 'C:\\Temp', 'dl_cdp_debug_modal_' + Date.now());

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
    '--remote-debugging-port=9226',
    `--user-data-dir=${TEMP_USER_DATA}`,
    '--window-size=1440,1100',
    '--disable-gpu',
    '--no-sandbox',
    'about:blank',
  ],
  { stdio: 'ignore' }
);

await sleep(1500);

const list = await fetch('http://127.0.0.1:9226/json/list').then((r) => r.json());
const ws = new WebSocket(list[0].webSocketDebuggerUrl);

ws.onmessage = (event) => {
  const msg = JSON.parse(event.data);
  if (msg.method === 'Console.messageAdded' || msg.method === 'Runtime.consoleAPICalled') {
    console.log('[Browser Console]', JSON.stringify(msg.params));
  }
};

await new Promise((r) => (ws.onopen = r));

function send(method, params = {}) {
  ws.send(JSON.stringify({ id: Math.floor(Math.random() * 100000), method, params }));
}

send('Page.enable');
send('Runtime.enable');

send('Page.navigate', { url: 'http://localhost:5173/login' });
await sleep(1000);

send('Runtime.evaluate', {
  expression: `
    sessionStorage.setItem('dl.token', '${adminToken}');
    sessionStorage.setItem('dl.user', JSON.stringify(${JSON.stringify(adminUser)}));
    localStorage.setItem('dl.token', '${adminToken}');
  `,
});
await sleep(500);

send('Page.navigate', { url: 'http://localhost:5173/admin/resume-orders' });
await sleep(3500);

send('Runtime.evaluate', {
  expression: `
    const manageBtn = Array.from(document.querySelectorAll('button')).find(b => b.textContent.includes('Manage'));
    console.log('manageBtn:', manageBtn);
    if (manageBtn) {
      manageBtn.click();
      console.log('Clicked manage button!');
    }
  `,
});

await sleep(3000);

send('Runtime.evaluate', {
  expression: `
    console.log('Modal element:', document.querySelector('[role="dialog"]') || document.querySelector('.fixed'));
  `,
});

await sleep(1500);
ws.close();
chromeProcess.kill();
