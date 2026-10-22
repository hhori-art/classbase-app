// Local visual QA runner.
//
// Logs into the LOCAL security app (next dev on 127.0.0.1:3100, Firebase emulators with the
// demo project `demo-classbase-security`) as each role, visits a page list at 375px (mobile
// emulation) and 1280px, saves full-page screenshots and runs automatic layout checks.
//
// Uses the Chrome DevTools Protocol directly (Node global WebSocket + installed Chrome).
//
// Usage:
//   node scripts/visual-qa/run.mjs                 # assumes emulators + app are running
//   node scripts/visual-qa/run.mjs --start --seed  # starts emulators + QA app, seeds, stops them at the end
//   node scripts/visual-qa/run.mjs --role student --only /student/homework --width 375
//   node scripts/visual-qa/run.mjs --headful
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import net from 'node:net';
import { spawn, spawnSync } from 'node:child_process';

const root = process.cwd();
const PROJECT_ID = 'demo-classbase-security';
const BASE_URL = process.env.VISUAL_QA_BASE_URL || 'http://127.0.0.1:3100';
const CHROME = process.env.CHROME_PATH || '/Applications/Google Chrome.app/Contents/MacOS/Google Chrome';
const ACCOUNTS_PATH = path.join(root, '.security-diagnosis-accounts.json');
const VISUAL_ACCOUNTS_PATH = path.join(root, '.visual-qa', 'accounts.json');

const args = process.argv.slice(2);
const argValue = (name) => {
  const index = args.indexOf(name);
  return index >= 0 ? args[index + 1] : undefined;
};
const START = args.includes('--start');
const HEADFUL = args.includes('--headful');
const SEED = args.includes('--seed');
const ONLY_ROLE = argValue('--role');
const ONLY_PAGE = argValue('--only');
const ONLY_WIDTH = argValue('--width') ? Number(argValue('--width')) : null;
const WIDTHS = ONLY_WIDTH ? [ONLY_WIDTH] : [375, 1280];

// ---- safety: never point at anything but the local app ---------------------------------------
const baseHost = new URL(BASE_URL).hostname;
if (!['127.0.0.1', 'localhost'].includes(baseHost)) {
  console.error(`Safety stop: VISUAL_QA_BASE_URL must be a local URL (got ${BASE_URL}).`);
  process.exit(1);
}

// ---- page lists ------------------------------------------------------------------------------
const ROLES = [
  {
    role: 'student', uid: 'security-student', loginPath: '/',
    pages: ['/student', '/student/homework', '/student/recordings', '/student/absence', '/student/timetable', '/student/records', '/student/settings', '/student/chat'],
  },
  {
    role: 'parent', uid: 'security-parent', loginPath: '/',
    pages: ['/parent', '/parent/pf', '/parent/pf/homework', '/parent/contact', '/parent/courses', '/parent/timetable', '/parent/report', '/parent/settings'],
  },
  {
    // Semi-dedicated teacher sees the regular /teacher portal (dedicated teachers are redirected to
    // /teacher/school-students for everything except attendance).
    role: 'teacher', uid: 'security-teacher-semi-dedicated', loginPath: '/',
    pages: ['/teacher', '/teacher/attendance', '/teacher/shifts', '/teacher/substitutions', '/teacher/contacts'],
  },
  {
    // 専任 (dedicated) attendance approver: school roster + attendance.
    role: 'teacher-dedicated', uid: 'security-teacher-dedicated', loginPath: '/',
    pages: ['/teacher/school-students', '/teacher/attendance/dedicated', '/teacher/attendance-approvals', '/teacher/attendance-approvals?date=yesterday'],
  },
  {
    role: 'master', uid: 'security-master', loginPath: '/admin/login',
    pages: [
      '/master',
      '/master/school-students?tab=students', '/master/school-students?tab=attendance', '/master/school-students?tab=courses',
      '/master/requests', '/master/parent-inquiries', '/master/attendance', '/master/attendance-approvals', '/master/shifts',
      '/master/settings', '/master/accounts/sso', '/master/students', '/master/inbox', '/master/audit-logs', '/master/ui-guide',
    ],
  },
];

// ---- helpers ---------------------------------------------------------------------------------
const sleep = (ms) => new Promise(resolve => setTimeout(resolve, ms));
const slug = (value) => value.replace(/^\//, '').replace(/[?&=/]+/g, '_').replace(/[^A-Za-z0-9_-]/g, '') || 'root';
const portOpen = (port, host = '127.0.0.1') => new Promise(resolve => {
  const socket = net.connect({ port, host });
  socket.once('connect', () => { socket.destroy(); resolve(true); });
  socket.once('error', () => resolve(false));
});
async function waitFor(check, timeoutMs, label) {
  const deadline = Date.now() + timeoutMs;
  while (Date.now() < deadline) {
    if (await check()) return true;
    await sleep(500);
  }
  throw new Error(`Timed out waiting for ${label}`);
}

const children = [];
function startBackground(label, command, commandArgs, logFile) {
  const out = fs.openSync(logFile, 'a');
  const child = spawn(command, commandArgs, { cwd: root, stdio: ['ignore', out, out], detached: true, env: process.env });
  children.push({ label, child });
  console.log(`[visual-qa] started ${label} (pid ${child.pid}, log ${path.relative(root, logFile)})`);
  return child;
}
function stopBackground() {
  for (const { label, child } of children.reverse()) {
    try { process.kill(-child.pid, 'SIGINT'); console.log(`[visual-qa] stopped ${label}`); } catch {}
  }
}

async function ensureServices(runDir) {
  const emulatorsUp = (await portOpen(9099)) && (await portOpen(8085));
  if (!emulatorsUp) {
    if (!START) throw new Error('Firebase emulators are not running. Run `npm run security:start` (or pass --start).');
    startBackground('emulators', process.execPath, ['scripts/security/run-emulators.mjs', 'start'], path.join(runDir, 'emulators.log'));
    await waitFor(async () => (await portOpen(9099)) && (await portOpen(8085)), 120_000, 'emulators');
  }
  // Confirm the auth emulator answers for the demo project (and is an emulator).
  const cfg = await fetch(`http://127.0.0.1:9099/emulator/v1/projects/${PROJECT_ID}/config`).catch(() => null);
  if (!cfg || !cfg.ok) throw new Error('Safety stop: auth emulator did not answer for the demo project.');

  const appUp = await portOpen(Number(new URL(BASE_URL).port || 80), baseHost);
  if (!appUp) {
    if (!START) throw new Error(`App is not running at ${BASE_URL}. Run \`node scripts/visual-qa/run-qa-app.mjs\` (or pass --start).`);
    startBackground('qa app', process.execPath, ['scripts/visual-qa/run-qa-app.mjs'], path.join(runDir, 'app.log'));
    await waitFor(() => portOpen(Number(new URL(BASE_URL).port || 80), baseHost), 120_000, 'app');
  }
  // Warm up compilation of the login page.
  await fetch(`${BASE_URL}/`).catch(() => null);
}

function loadAccounts() {
  const accounts = new Map();
  for (const file of [ACCOUNTS_PATH, VISUAL_ACCOUNTS_PATH]) {
    if (!fs.existsSync(file)) continue;
    for (const account of JSON.parse(fs.readFileSync(file, 'utf8')).accounts || []) accounts.set(account.uid, account);
  }
  return accounts;
}

// ---- minimal CDP client ----------------------------------------------------------------------
class CDP {
  constructor(wsUrl) {
    this.ws = new WebSocket(wsUrl);
    this.nextId = 1;
    this.pending = new Map();
    this.listeners = new Map();
    this.ws.addEventListener('message', (event) => {
      const msg = JSON.parse(typeof event.data === 'string' ? event.data : Buffer.from(event.data).toString());
      if (msg.id && this.pending.has(msg.id)) {
        const { resolve, reject } = this.pending.get(msg.id);
        this.pending.delete(msg.id);
        if (msg.error) reject(new Error(`${msg.error.message} ${msg.error.data || ''}`));
        else resolve(msg.result);
      } else if (msg.method) {
        const key = `${msg.sessionId || ''}:${msg.method}`;
        for (const fn of this.listeners.get(key) || []) fn(msg.params);
      }
    });
  }
  open() {
    return new Promise((resolve, reject) => {
      this.ws.addEventListener('open', resolve, { once: true });
      this.ws.addEventListener('error', reject, { once: true });
    });
  }
  send(method, params = {}, sessionId) {
    const id = this.nextId++;
    const payload = { id, method, params };
    if (sessionId) payload.sessionId = sessionId;
    return new Promise((resolve, reject) => {
      this.pending.set(id, { resolve, reject });
      this.ws.send(JSON.stringify(payload));
    });
  }
  on(sessionId, method, fn) {
    const key = `${sessionId || ''}:${method}`;
    if (!this.listeners.has(key)) this.listeners.set(key, []);
    this.listeners.get(key).push(fn);
  }
  close() { try { this.ws.close(); } catch {} }
}

async function launchChrome(runDir) {
  const userDataDir = fs.mkdtempSync(path.join(os.tmpdir(), 'classbase-visual-qa-'));
  const chromeArgs = [
    `--user-data-dir=${userDataDir}`, '--remote-debugging-port=0', '--no-first-run', '--no-default-browser-check',
    '--disable-extensions', '--disable-background-networking', '--disable-sync', '--disable-component-update',
    '--hide-scrollbars', '--mute-audio', '--force-color-profile=srgb', '--lang=ja-JP',
    ...(HEADFUL ? [] : ['--headless=new']), 'about:blank',
  ];
  const chrome = spawn(CHROME, chromeArgs, { stdio: ['ignore', 'ignore', fs.openSync(path.join(runDir, 'chrome.log'), 'a')] });
  const portFile = path.join(userDataDir, 'DevToolsActivePort');
  await waitFor(() => fs.existsSync(portFile) && fs.readFileSync(portFile, 'utf8').includes('\n'), 30_000, 'Chrome DevTools port');
  const [port, wsPath] = fs.readFileSync(portFile, 'utf8').trim().split('\n');
  const cdp = new CDP(`ws://127.0.0.1:${port}${wsPath}`);
  await cdp.open();
  return {
    cdp,
    close: async () => {
      cdp.close();
      chrome.kill('SIGTERM');
      await sleep(500);
      fs.rmSync(userDataDir, { recursive: true, force: true });
    },
  };
}

// ---- per-role page session ---------------------------------------------------------------------
const IGNORED_INFLIGHT = /\/google\.firestore\.v1\.Firestore\/(Listen|Write)\/channel|webpack-hmr|__nextjs_original-stack-frame|\/_next\/static\/.*hot-update|\/emulator\/v1\/|\/api\/beta\/events/;

async function openRoleSession(cdp) {
  const { browserContextId } = await cdp.send('Target.createBrowserContext', { disposeOnDetach: true });
  const { targetId } = await cdp.send('Target.createTarget', { url: 'about:blank', browserContextId });
  const { sessionId } = await cdp.send('Target.attachToTarget', { targetId, flatten: true });
  const s = (method, params) => cdp.send(method, params, sessionId);
  await s('Page.enable');
  await s('Runtime.enable');
  await s('Network.enable');
  await s('Log.enable');
  // The app's CSP (next.config.mjs) only allows production Firebase hosts in connect-src, so the
  // browser would block the local emulators (127.0.0.1:9099/8085/9199). Bypass CSP in this QA
  // browser only; the app's headers are left untouched.
  await s('Page.setBypassCSP', { enabled: true });

  const state = { inflight: new Map(), lastActivity: Date.now(), events: [] };
  const record = (entry) => state.events.push({ ...entry, at: Date.now() });
  cdp.on(sessionId, 'Network.requestWillBeSent', (p) => {
    if (IGNORED_INFLIGHT.test(p.request.url) || p.type === 'EventSource' || p.type === 'WebSocket') return;
    state.inflight.set(p.requestId, { url: p.request.url, method: p.request.method, type: p.type });
    state.lastActivity = Date.now();
  });
  cdp.on(sessionId, 'Network.responseReceived', (p) => {
    const req = state.inflight.get(p.requestId);
    if (p.response.status >= 400) {
      record({ kind: 'http', status: p.response.status, url: p.response.url, method: req?.method || '', type: p.type });
    }
  });
  const finish = (p) => { state.inflight.delete(p.requestId); state.lastActivity = Date.now(); };
  cdp.on(sessionId, 'Network.loadingFinished', finish);
  cdp.on(sessionId, 'Network.loadingFailed', (p) => {
    const req = state.inflight.get(p.requestId);
    finish(p);
    if (p.canceled || /ERR_ABORTED/.test(p.errorText || '')) return;
    if (req) record({ kind: 'network-failed', url: req.url, method: req.method, error: p.errorText, type: p.type });
  });
  cdp.on(sessionId, 'Runtime.consoleAPICalled', (p) => {
    if (p.type !== 'error' && p.type !== 'assert') return;
    const text = (p.args || []).map(a => a.value ?? a.description ?? a.type).join(' ');
    record({ kind: 'console-error', text: String(text).slice(0, 400) });
  });
  cdp.on(sessionId, 'Runtime.exceptionThrown', (p) => {
    const d = p.exceptionDetails;
    record({ kind: 'exception', text: String(d.exception?.description || d.text).slice(0, 400) });
  });
  cdp.on(sessionId, 'Log.entryAdded', (p) => {
    if (p.entry.level !== 'error' || p.entry.source === 'network') return; // network errors come from Network.*
    record({ kind: 'console-error', text: String(p.entry.text).slice(0, 400) });
  });

  const evaluate = async (expression, awaitPromise = false) => {
    const result = await s('Runtime.evaluate', { expression, awaitPromise, returnByValue: true });
    if (result.exceptionDetails) throw new Error(result.exceptionDetails.exception?.description || result.exceptionDetails.text);
    return result.result.value;
  };

  const session = { s, state, evaluate, loadResolver: null, close: () => cdp.send('Target.disposeBrowserContext', { browserContextId }).catch(() => {}) };
  cdp.on(sessionId, 'Page.loadEventFired', () => session.loadResolver && session.loadResolver());
  return session;
}

async function setViewport(session, width, height) {
  const mobile = width < 768;
  await session.s('Emulation.setDeviceMetricsOverride', { width, height, deviceScaleFactor: mobile ? 2 : 1, mobile });
  await session.s('Emulation.setTouchEmulationEnabled', { enabled: mobile, maxTouchPoints: mobile ? 5 : 1 });
  await session.s('Network.setUserAgentOverride', {
    userAgent: mobile
      ? 'Mozilla/5.0 (iPhone; CPU iPhone OS 17_5 like Mac OS X) AppleWebKit/605.1.15 (KHTML, like Gecko) Version/17.5 Mobile/15E148 Safari/604.1 ClassBaseVisualQA'
      : 'Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/130.0.0.0 Safari/537.36 ClassBaseVisualQA',
    acceptLanguage: 'ja-JP,ja',
  });
}

async function waitForNetworkIdle(session, { idleMs = 800, timeoutMs = 30_000 } = {}) {
  const deadline = Date.now() + timeoutMs;
  while (Date.now() < deadline) {
    if (session.state.inflight.size === 0 && Date.now() - session.state.lastActivity >= idleMs) return true;
    await sleep(150);
  }
  return false;
}

const LOADING_PROBE = `(() => {
  const visible = (el) => {
    const r = el.getBoundingClientRect();
    if (r.width < 1 || r.height < 1) return false;
    const s = getComputedStyle(el);
    return s.display !== 'none' && s.visibility !== 'hidden' && Number(s.opacity) > 0;
  };
  const sel = '.animate-pulse, [aria-busy="true"], [role="status"][aria-label="読み込み中"], .animate-spin';
  const loaders = Array.from(document.querySelectorAll(sel)).filter(visible);
  // A lone spinner inside a button is usually a pending action, not a page load; still count it.
  return { loaders: loaders.length, ready: document.readyState };
})()`;

async function waitForSettled(session, timeoutMs = 45_000) {
  const deadline = Date.now() + timeoutMs;
  let stableSince = 0;
  let last = null;
  while (Date.now() < deadline) {
    await waitForNetworkIdle(session, { idleMs: 600, timeoutMs: Math.max(1000, deadline - Date.now()) });
    let probe;
    try { probe = await session.evaluate(LOADING_PROBE); } catch { probe = { loaders: 1, ready: 'loading' }; }
    last = probe;
    if (probe.ready === 'complete' && probe.loaders === 0) {
      if (!stableSince) stableSince = Date.now();
      if (Date.now() - stableSince >= 700) return { settled: true, probe, inflight: [] };
    } else {
      stableSince = 0;
    }
    await sleep(250);
  }
  const inflight = Array.from(session.state.inflight.values()).map(r => `${r.method} ${r.url.replace(BASE_URL, '').slice(0, 120)}`);
  return { settled: false, probe: last, inflight };
}

async function navigate(session, url) {
  session.state.lastActivity = Date.now();
  const loaded = new Promise(resolve => {
    const timer = setTimeout(resolve, 30_000);
    session.loadResolver = () => { clearTimeout(timer); resolve(); };
  });
  await session.s('Page.navigate', { url });
  await Promise.race([loaded, sleep(30_000)]);
}

async function login(session, roleDef, account) {
  await setViewport(session, 1280, 800);
  await navigate(session, `${BASE_URL}${roleDef.loginPath}`);
  await waitFor(async () => (await session.evaluate(`document.querySelectorAll('form input').length >= 2`)), 60_000, 'login form');
  await sleep(800); // hydration
  const fill = async (index, value) => {
    await session.evaluate(`(() => { const el = document.querySelectorAll('form input')[${index}]; el.focus(); el.select && el.select(); return true; })()`);
    await session.s('Input.insertText', { text: value });
  };
  await fill(0, account.login_id);
  await fill(1, account.password);
  await session.evaluate(`document.querySelector('form button[type="submit"]').click()`);
  const target = roleDef.loginPath;
  const ok = await waitFor(async () => {
    const href = await session.evaluate('location.pathname').catch(() => target);
    return href !== target && !href.startsWith('/admin/login');
  }, 60_000, `${roleDef.role} login redirect`).catch(async (error) => {
    const msg = await session.evaluate(`(document.querySelector('form')?.innerText || '').slice(0, 300)`).catch(() => '');
    throw new Error(`${error.message}. Form says: ${msg}`);
  });
  await waitForNetworkIdle(session, { timeoutMs: 15_000 });
  return ok;
}

const CHECKS_SOURCE = fs.readFileSync(new URL('./checks.js', import.meta.url), 'utf8');

async function capturePage(session, { url, width, shotPath }) {
  const viewportHeight = width < 768 ? 812 : 800;
  await setViewport(session, width, viewportHeight);
  const startEvents = session.state.events.length;
  await navigate(session, url);
  const settle = await waitForSettled(session);
  await sleep(400);
  const finalPath = await session.evaluate('location.pathname + location.search');

  // Grow the viewport so that pages with an inner scroll container (h-screen layouts) are fully
  // rendered, then run the layout checks with everything inside the viewport and screenshot.
  const measure = () => session.evaluate(`(() => {
    window.scrollTo(0, 0);
    let h = Math.max(document.documentElement.scrollHeight, document.body ? document.body.scrollHeight : 0);
    for (const el of document.querySelectorAll('main, [class*="overflow-y-auto"], [class*="overflow-auto"]')) {
      const s = getComputedStyle(el);
      if (!['auto', 'scroll'].includes(s.overflowY) || el.scrollHeight <= el.clientHeight + 4) continue;
      const r = el.getBoundingClientRect();
      if (r.width < innerWidth * 0.5) continue; // only main-content scrollers
      h = Math.max(h, el.scrollHeight + r.top + Math.max(0, innerHeight - r.bottom));
    }
    return Math.ceil(h);
  })()`);
  let captureHeight = viewportHeight;
  for (let attempt = 0; attempt < 4; attempt += 1) {
    const wanted = Math.min(Math.max(viewportHeight, await measure()), 14_000);
    if (wanted <= captureHeight + 2) break;
    captureHeight = wanted;
    await setViewport(session, width, captureHeight);
    await sleep(500);
    await waitForNetworkIdle(session, { idleMs: 400, timeoutMs: 5_000 });
  }
  await session.evaluate('window.scrollTo(0, 0)');
  // Hide the Next.js dev-mode indicator/overlay so it neither shows in screenshots nor trips checks.
  await session.evaluate(`(() => { for (const el of document.querySelectorAll('nextjs-portal')) el.style.setProperty('display', 'none', 'important'); return true; })()`);
  const checks = await session.evaluate(CHECKS_SOURCE);
  await session.evaluate('window.scrollTo(0, 0)');
  const geometry = await session.evaluate(`({ scrollY, innerHeight, docHeight: document.documentElement.scrollHeight, vvTop: visualViewport ? visualViewport.pageTop : 0 })`);
  if (process.env.VISUAL_QA_DEBUG) console.log('[visual-qa debug]', url, width, captureHeight, JSON.stringify(geometry));
  const shot = await session.s('Page.captureScreenshot', { format: 'png', captureBeyondViewport: false, clip: { x: 0, y: 0, width, height: captureHeight, scale: 1 } });
  fs.mkdirSync(path.dirname(shotPath), { recursive: true });
  fs.writeFileSync(shotPath, Buffer.from(shot.data, 'base64'));

  const events = session.state.events.slice(startEvents);
  return { settle, finalPath, checks, events, captureHeight };
}

function eventIssues(events, pagePath) {
  const issues = [];
  const seen = new Set();
  for (const e of events) {
    let issue = null;
    if (e.kind === 'http') {
      if (e.status === 401 && /logout|signout/i.test(e.url)) continue;
      if (/favicon|\.map$|__nextjs/.test(e.url)) continue;
      issue = {
        kind: e.status >= 500 ? 'http-5xx' : 'http-4xx', severity: e.status >= 500 ? 'error' : 'warn',
        message: `${e.method} ${e.status} ${e.url.replace(BASE_URL, '')}`, selector: '', text: '', rect: null,
      };
    } else if (e.kind === 'network-failed') {
      issue = { kind: 'network-failed', severity: 'error', message: `${e.method} ${e.url.replace(BASE_URL, '')} failed: ${e.error}`, selector: '', text: '', rect: null };
    } else if (e.kind === 'console-error' || e.kind === 'exception') {
      if (/Download the React DevTools|\[Fast Refresh\]/.test(e.text)) continue;
      issue = { kind: e.kind, severity: 'error', message: e.text.split('\n')[0].slice(0, 240), selector: '', text: '', rect: null };
    }
    if (!issue) continue;
    const key = `${issue.kind}|${issue.message}`;
    if (seen.has(key)) continue;
    seen.add(key);
    issues.push(issue);
  }
  void pagePath;
  return issues;
}

// ---- report ----------------------------------------------------------------------------------
function writeReport(runDir, results, meta) {
  fs.writeFileSync(path.join(runDir, 'report.json'), `${JSON.stringify({ ...meta, results }, null, 2)}\n`);
  const lines = [];
  const all = results.flatMap(r => r.issues.map(i => ({ ...i, page: r.page, role: r.role, width: r.width, screenshot: r.screenshot })));
  const errors = all.filter(i => i.severity === 'error');
  const warns = all.filter(i => i.severity === 'warn');
  lines.push(`# Visual QA report — ${meta.run}`, '');
  lines.push(`- Base URL: ${BASE_URL} (local emulators, project ${PROJECT_ID})`);
  lines.push(`- Captures: ${results.length} (${results.filter(r => r.ok).length} ok, ${results.filter(r => !r.ok).length} failed to load/redirected)`);
  lines.push(`- Issues: ${errors.length} errors, ${warns.length} warnings`, '');
  const byKind = {};
  for (const i of all) byKind[`${i.severity}:${i.kind}`] = (byKind[`${i.severity}:${i.kind}`] || 0) + 1;
  lines.push('| severity:kind | count |', '|---|---|', ...Object.entries(byKind).sort().map(([k, v]) => `| ${k} | ${v} |`), '');
  lines.push('## Pages', '');
  for (const r of results) {
    const e = r.issues.filter(i => i.severity === 'error').length;
    const w = r.issues.filter(i => i.severity === 'warn').length;
    const flag = !r.ok ? 'LOAD/REDIRECT' : e ? 'ERRORS' : w ? 'warnings' : 'clean';
    lines.push(`### ${r.role} ${r.page} @ ${r.width}px — ${flag}`);
    lines.push(`- final URL: \`${r.finalPath || '-'}\`, settled: ${r.settled}, screenshot: [${r.screenshot}](${r.screenshot})`);
    if (r.error) lines.push(`- capture error: ${r.error}`);
    for (const i of r.issues) {
      lines.push(`- **${i.severity} ${i.kind}**: ${i.message}${i.text ? ` — text: \`${i.text.replace(/`/g, "'")}\`` : ''}${i.selector ? ` — \`${i.selector.replace(/`/g, "'")}\`` : ''}${i.rect ? ` @ (${i.rect.x},${i.rect.y} ${i.rect.w}×${i.rect.h})` : ''}`);
    }
    lines.push('');
  }
  fs.writeFileSync(path.join(runDir, 'report.md'), `${lines.join('\n')}\n`);
}

// ---- main ------------------------------------------------------------------------------------
async function main() {
  const run = new Date().toISOString().replace(/[:.]/g, '-').slice(0, 19);
  const runDir = path.join(root, '.visual-qa', run);
  fs.mkdirSync(runDir, { recursive: true });
  await ensureServices(runDir);
  if (SEED) {
    for (const script of ['scripts/security/create-diagnosis-accounts.mjs', 'scripts/visual-qa/seed.mjs']) {
      const result = spawnSync(process.execPath, [script], { cwd: root, stdio: 'inherit', env: { ...process.env, FIREBASE_AUTH_EMULATOR_HOST: '127.0.0.1:9099', FIRESTORE_EMULATOR_HOST: '127.0.0.1:8085', GCLOUD_PROJECT: PROJECT_ID } });
      if (result.status !== 0) throw new Error(`${script} failed`);
    }
  }

  const accounts = loadAccounts();
  const browser = await launchChrome(runDir);
  const results = [];
  try {
    for (const roleDef of ROLES) {
      if (ONLY_ROLE && roleDef.role !== ONLY_ROLE) continue;
      const account = accounts.get(roleDef.uid);
      if (!account) { console.error(`[visual-qa] no account for ${roleDef.uid}; run npm run security:accounts && npm run qa:visual:seed`); continue; }
      const session = await openRoleSession(browser.cdp);
      try {
        console.log(`[visual-qa] logging in as ${roleDef.role} (${account.login_id})`);
        await login(session, roleDef, account);
        for (const page of roleDef.pages) {
          if (ONLY_PAGE && page !== ONLY_PAGE && !page.startsWith(`${ONLY_PAGE}?`)) continue;
          for (const width of WIDTHS) {
            const rel = path.join(roleDef.role, `${slug(page)}-${width}.png`);
            const shotPath = path.join(runDir, rel);
            const entry = { role: roleDef.role, page, width, screenshot: rel, ok: false, settled: false, issues: [] };
            try {
              const res = await capturePage(session, { url: `${BASE_URL}${page}`, width, shotPath });
              entry.finalPath = res.finalPath;
              entry.settled = res.settle.settled;
              entry.captureHeight = res.captureHeight;
              entry.ok = res.finalPath.split('?')[0] === page.split('?')[0];
              entry.issues = [...res.checks.issues, ...eventIssues(res.events, page)];
              if (!entry.ok) entry.issues.unshift({ kind: 'redirected', severity: 'error', message: `Expected ${page} but ended on ${res.finalPath}`, selector: '', text: '', rect: null });
              if (!res.settle.settled) entry.issues.push({ kind: 'not-settled', severity: 'warn', message: `Page did not settle within 45s (${res.settle.probe?.loaders ?? '?'} loading indicators visible, ${res.settle.inflight.length} requests in flight${res.settle.inflight.length ? `: ${res.settle.inflight.slice(0, 3).join(', ')}` : ''})`, selector: '', text: '', rect: null });
            } catch (error) {
              entry.error = String(error.message || error);
              entry.issues.push({ kind: 'capture-failed', severity: 'error', message: entry.error, selector: '', text: '', rect: null });
            }
            const e = entry.issues.filter(i => i.severity === 'error').length;
            console.log(`[visual-qa] ${roleDef.role} ${page} @${width}: ${entry.ok ? 'ok' : 'NOT OK'} ${e} errors, ${entry.issues.length - e} warnings`);
            results.push(entry);
          }
        }
      } catch (error) {
        console.error(`[visual-qa] ${roleDef.role} failed: ${error.message}`);
        results.push({ role: roleDef.role, page: roleDef.loginPath, width: 1280, screenshot: '', ok: false, settled: false, error: error.message, issues: [{ kind: 'login-failed', severity: 'error', message: error.message, selector: '', text: '', rect: null }] });
      } finally {
        await session.close();
      }
    }
  } finally {
    await browser.close();
    writeReport(runDir, results, { run, base: BASE_URL, widths: WIDTHS, generated_at: new Date().toISOString() });
    console.log(`[visual-qa] report: ${path.relative(root, path.join(runDir, 'report.md'))}`);
    if (START) stopBackground();
  }
}

main().catch((error) => {
  console.error(`[visual-qa] ${error.stack || error}`);
  stopBackground();
  process.exit(1);
});
