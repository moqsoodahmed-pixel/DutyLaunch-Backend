import { spawn } from 'node:child_process';
import fs from 'node:fs';
import path from 'node:path';

const CHROME_PATH = 'C:\\Program Files\\Google\\Chrome\\Application\\chrome.exe';
const OUT_DIR = 'C:\\Users\\Chandubg\\.gemini\\antigravity\\brain\\1ac3a2b0-ad56-4a11-94cc-2d2568ee2629';
const TEMP_USER_DATA = path.join(process.env.TEMP || 'C:\\Temp', 'dl_chrome_verify_' + Date.now());

async function takeScreenshot(url, filename, width = 1440, height = 960) {
  const outPath = path.join(OUT_DIR, filename);
  console.log(`Capturing ${url} -> ${filename} ...`);
  return new Promise((resolve, reject) => {
    const args = [
      '--headless=new',
      `--user-data-dir=${TEMP_USER_DATA}`,
      `--screenshot=${outPath}`,
      `--window-size=${width},${height}`,
      '--hide-scrollbars',
      '--disable-gpu',
      '--no-sandbox',
      '--virtual-time-budget=4000',
      url,
    ];

    const child = spawn(CHROME_PATH, args, { stdio: 'inherit' });
    child.on('close', (code) => {
      if (fs.existsSync(outPath) && fs.statSync(outPath).size > 0) {
        console.log(`✔ Saved: ${filename} (${(fs.statSync(outPath).size / 1024).toFixed(1)} KB)`);
        resolve(outPath);
      } else {
        console.error(`Failed to capture ${filename}, exit code: ${code}`);
        resolve(null);
      }
    });
    child.on('error', (err) => {
      console.error(`Error spawning chrome:`, err);
      reject(err);
    });
  });
}

async function run() {
  await takeScreenshot('http://localhost:5173/resume-builder', '01_resume_builder_service.png', 1440, 1080);
  await takeScreenshot('http://localhost:5173/pricing', '02_pricing_page.png', 1440, 1080);
  await takeScreenshot('http://localhost:5173/resume-checker', '03_ats_checker_disclaimer.png', 1440, 1080);
  console.log('Screenshots captured!');
}

run().catch(console.error);
