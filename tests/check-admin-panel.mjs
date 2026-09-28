#!/usr/bin/env node
/**
 * check-admin-panel.mjs
 *
 * One-shot health check for the DutyLaunch admin panel's backend: logs in
 * as an admin and hits every read endpoint behind the admin sidebar
 * (Dashboard, Consultations, Messages, Jobs, Applications, Users, Partner
 * institutes, Scoring weights, Articles, Courses, FAQs, Testimonials),
 * then reports which ones respond correctly.
 *
 * Usage:
 *   node scripts/check-admin-panel.mjs
 *   node scripts/check-admin-panel.mjs --url=https://api.dutylaunch.in/api --email=admin@dutylaunch.com --password=********
 *
 * Config (CLI flags win over env vars):
 *   --url       / API_BASE_URL    Base API URL, default http://localhost:8080/api
 *   --email     / ADMIN_EMAIL     Admin login email
 *   --password  / ADMIN_PASSWORD  Admin login password
 *
 * If ADMIN_EMAIL / ADMIN_PASSWORD are not set, this falls back to reading
 * SEED_ADMIN_EMAIL / SEED_ADMIN_PASSWORD (the same variables seed/seed.js
 * reads), and after that to the seed script's own literal fallback
 * (admin@dutylaunch.com / ChangeMe123) — printing a loud warning if that
 * last resort is what actually gets used, since it means the account is
 * still on its default password.
 *
 * Exits 0 if every check passes, 1 otherwise — safe to wire into CI.
 */

const args = Object.fromEntries(
  process.argv.slice(2)
    .filter((a) => a.startsWith('--'))
    .map((a) => {
      const [k, ...rest] = a.slice(2).split('=');
      return [k, rest.join('=') || true];
    })
);

const BASE_URL = (args.url || process.env.API_BASE_URL || 'http://localhost:8080/api').replace(/\/+$/, '');
const EMAIL = args.email || process.env.ADMIN_EMAIL || process.env.SEED_ADMIN_EMAIL || 'admin@dutylaunch.com';
const PASSWORD = args.password || process.env.ADMIN_PASSWORD || process.env.SEED_ADMIN_PASSWORD || 'ChangeMe123';
const USING_FALLBACK_PASSWORD = !args.password && !process.env.ADMIN_PASSWORD && !process.env.SEED_ADMIN_PASSWORD;

const C = { green: '\x1b[32m', red: '\x1b[31m', yellow: '\x1b[33m', dim: '\x1b[2m', bold: '\x1b[1m', reset: '\x1b[0m' };
const ok = (s) => `${C.green}✓${C.reset} ${s}`;
const bad = (s) => `${C.red}✗${C.reset} ${s}`;
const results = [];
let token = null;

function authHeaders() {
  return token ? { Authorization: `Bearer ${token}` } : {};
}

async function call(method, path, { body, auth = true } = {}) {
  const started = performance.now();
  let res, json;
  try {
    res = await fetch(`${BASE_URL}${path}`, {
      method,
      headers: {
        'Content-Type': 'application/json',
        ...(auth ? authHeaders() : {}),
      },
      body: body ? JSON.stringify(body) : undefined,
    });
    json = await res.json().catch(() => null);
  } catch (err) {
    return { networkError: err, ms: performance.now() - started };
  }
  return { res, json, ms: performance.now() - started };
}

/** Runs one check, records the outcome, and never throws — a failure here
 *  should not stop the rest of the checks from running. */
async function check(label, fn) {
  const startTime = performance.now();
  try {
    const detail = await fn();
    const ms = Math.round(performance.now() - startTime);
    results.push({ label, pass: true, ms, detail });
    console.log(ok(`${label}  ${C.dim}(${ms}ms)${C.reset}${detail ? `  ${C.dim}${detail}${C.reset}` : ''}`));
  } catch (err) {
    const ms = Math.round(performance.now() - startTime);
    results.push({ label, pass: false, ms, detail: err.message });
    console.log(bad(`${label}  ${C.dim}(${ms}ms)${C.reset}`));
    console.log(`  ${C.red}${err.message}${C.reset}`);
  }
}

/** A GET that must come back 200 with success:true, used for every admin
 *  list screen in the sidebar. Returns a short human-readable detail
 *  string (item/total count) for the log line.
 *
 *  Also checks, as a second and separate result, that the same endpoint
 *  rejects a request with no token. This project applies the admin check
 *  per-route on most resources (blogs, courses, faqs, testimonials,
 *  consultations, contact) rather than once for a whole router, so a
 *  future edit could drop it from a single route without breaking
 *  anything else — testing only one endpoint's auth, as a stand-in for
 *  all of them, would miss exactly that. */
async function checkAdminList(label, path) {
  await check(label, async () => {
    const { res, json, networkError } = await call('GET', path);
    if (networkError) throw new Error(`could not reach ${path} — ${networkError.message}`);
    if (res.status !== 200) throw new Error(`GET ${path} → ${res.status} ${json?.message || ''}`);
    if (json?.success !== true) throw new Error(`GET ${path} responded 200 but success was not true`);
    if (json.data === undefined) throw new Error(`GET ${path} had no data field`);
    const count = Array.isArray(json.data) ? json.data.length : Object.keys(json.data ?? {}).length;
    const total = json.meta?.total;
    return total !== undefined ? `${count} returned, ${total} total` : `${count} item(s)`;
  });
  await check(`  ↳ rejects requests with no token`, async () => {
    const { res, networkError } = await call('GET', path, { auth: false });
    if (networkError) throw new Error(networkError.message);
    if (res.status !== 401 && res.status !== 403) {
      throw new Error(`expected 401/403 with no token, got ${res.status} — this data may be publicly exposed`);
    }
  });
}

console.log(`${C.bold}DutyLaunch admin panel — backend check${C.reset}`);
console.log(`${C.dim}${BASE_URL}${C.reset}\n`);

// 1. Is the server even up, before we try anything that needs a database.
//    A network error here means nothing downstream can work either, so
//    stop immediately rather than printing sixteen more "fetch failed"
//    lines that all have the same one root cause.
let serverUnreachable = false;
await check('Server reachable (/health)', async () => {
  const { res, json, networkError } = await call('GET', '/health', { auth: false });
  if (networkError) {
    serverUnreachable = true;
    throw new Error(
      `${networkError.message} — is the backend running, and is --url/API_BASE_URL pointed at the right host?`
    );
  }
  if (res.status !== 200 || json?.success !== true) throw new Error(`unexpected response: ${res.status}`);
});

if (serverUnreachable) {
  console.log(`\n${C.red}${C.bold}Stopping here — the server can't be reached, so nothing else can be checked.${C.reset}`);
  printSummaryAndExit();
}

// 2. Log in. Everything else depends on this, so stop here if it fails
//    rather than printing 13 more misleading failures.
if (USING_FALLBACK_PASSWORD) {
  console.log(
    `${C.yellow}⚠ No ADMIN_PASSWORD / SEED_ADMIN_PASSWORD set — trying the seed script's default ` +
      `(admin@dutylaunch.com / ChangeMe123). If this logs in, change that password.${C.reset}`
  );
}

let loginFailed = false;
await check(`Admin login (${EMAIL})`, async () => {
  const { res, json, networkError } = await call('POST', '/auth/login', {
    auth: false,
    body: { email: EMAIL, password: PASSWORD },
  });
  if (networkError) {
    loginFailed = true;
    throw new Error(networkError.message);
  }
  if (res.status !== 200 || !json?.data?.token) {
    loginFailed = true;
    throw new Error(
      `${res.status} ${json?.message || 'login rejected'} — check --email/--password or ADMIN_EMAIL/ADMIN_PASSWORD`
    );
  }
  if (json.data.user?.role !== 'admin') {
    loginFailed = true;
    throw new Error(`signed in, but this account's role is "${json.data.user?.role}", not "admin"`);
  }
  token = json.data.token;
});

if (loginFailed) {
  console.log(`\n${C.red}${C.bold}Stopping here — every other check needs a valid admin session.${C.reset}`);
  printSummaryAndExit();
}

// 3. Token actually authenticates, independent of the login response itself.
await check('Session is valid (/auth/me)', async () => {
  const { res, json, networkError } = await call('GET', '/auth/me');
  if (networkError) throw new Error(networkError.message);
  if (res.status !== 200 || json?.data?.user?.role !== 'admin') {
    throw new Error(`token did not authenticate as admin (${res.status})`);
  }
});

// 4. The dashboard the screenshot is showing.
let dashboardCounts = null;
await check('Dashboard stats (/admin/dashboard)', async () => {
  const { res, json, networkError } = await call('GET', '/admin/dashboard');
  if (networkError) throw new Error(networkError.message);
  if (res.status !== 200 || json?.success !== true) throw new Error(`${res.status} ${json?.message || ''}`);
  const c = json.data?.counts;
  const shapeOk =
    c &&
    ['totalUsers', 'totalEmployers', 'totalJobs', 'publishedJobs', 'totalApplications', 'totalCourses',
      'totalPosts', 'totalConsultations', 'newConsultations', 'unreadMessages', 'totalFaqs']
      .every((k) => typeof c[k] === 'number') &&
    Array.isArray(json.data.consultationTrend) &&
    Array.isArray(json.data.applicationsByStatus) &&
    Array.isArray(json.data.topCategories);
  if (!shapeOk) throw new Error('response is missing expected counts/trend fields');
  dashboardCounts = c;
  return (
    `candidates=${c.totalUsers} employers=${c.totalEmployers} publishedJobs=${c.publishedJobs} ` +
    `applications=${c.totalApplications} newConsultations=${c.newConsultations} unread=${c.unreadMessages} ` +
    `courses=${c.totalCourses} articles=${c.totalPosts}`
  );
});

await check('  ↳ rejects requests with no token', async () => {
  const { res, networkError } = await call('GET', '/admin/dashboard', { auth: false });
  if (networkError) throw new Error(networkError.message);
  if (res.status !== 401 && res.status !== 403) {
    throw new Error(`expected 401/403 with no token, got ${res.status} — admin data may be exposed`);
  }
});

// 5. Every list screen in the sidebar, in the order it appears on screen.
await checkAdminList('Consultations (/consultations)', '/consultations');
await checkAdminList('Messages (/contact)', '/contact');
await checkAdminList('Jobs (/admin/jobs)', '/admin/jobs');
await checkAdminList('Applications (/admin/applications)', '/admin/applications');
await checkAdminList('Users (/admin/users)', '/admin/users');
await checkAdminList('Partner institutes (/admin/partners)', '/admin/partners');
await checkAdminList('Scoring weights (/admin/scoring)', '/admin/scoring');
await checkAdminList('Articles (/blogs/admin/all)', '/blogs/admin/all');
await checkAdminList('Courses (/courses/admin/all)', '/courses/admin/all');
await checkAdminList('FAQs (/faqs/admin/all)', '/faqs/admin/all');
await checkAdminList('Testimonials (/testimonials/admin/all)', '/testimonials/admin/all');

// 6. Sanity-check the dashboard's own numbers against an independent query,
//    instead of just trusting the single aggregation pipeline that built
//    them. "New consultations" is the clearest one to cross-check: the
//    dashboard's count and a live status=new query should always agree.
await check("Dashboard number checks out (newConsultations vs live query)", async () => {
  const { res, json, networkError } = await call('GET', '/consultations?status=new&limit=1');
  if (networkError) throw new Error(networkError.message);
  if (res.status !== 200) throw new Error(`${res.status}`);
  const liveTotal = json?.meta?.total;
  if (dashboardCounts && liveTotal !== undefined && liveTotal !== dashboardCounts.newConsultations) {
    throw new Error(`dashboard says ${dashboardCounts.newConsultations}, live query says ${liveTotal}`);
  }
  return `both report ${liveTotal}`;
});

printSummaryAndExit();

function printSummaryAndExit() {
  const passed = results.filter((r) => r.pass).length;
  const failed = results.length - passed;
  console.log(`\n${C.bold}${passed}/${results.length} checks passed${C.reset}`);
  if (failed > 0) {
    console.log(`${C.red}Failed:${C.reset}`);
    for (const r of results.filter((r) => !r.pass)) console.log(`  ${C.red}•${C.reset} ${r.label} — ${r.detail}`);
  }
  process.exit(failed > 0 ? 1 : 0);
}
