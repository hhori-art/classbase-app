import fs from 'node:fs';
import path from 'node:path';
import { spawnSync } from 'node:child_process';
import { cert, getApps, initializeApp } from 'firebase-admin/app';
import { FieldValue, getFirestore } from 'firebase-admin/firestore';

const projectId = 'classbase-security-diagnosis';
const baseUrl = 'https://classbase-security-diagnosis.vercel.app';
const root = process.cwd();
const serviceAccount = JSON.parse(fs.readFileSync(path.join(root, '.security-staging-service-account.json'), 'utf8'));
const accounts = JSON.parse(fs.readFileSync(path.join(root, '.security-diagnosis-accounts.json'), 'utf8')).accounts;
if (serviceAccount.project_id !== projectId) throw new Error('Safety stop: wrong Firebase project.');
if (!getApps().length) initializeApp({ credential: cert(serviceAccount), projectId });
const db = getFirestore();
const apiKey = 'AIzaSyC_hssQ63wvHD8GJ2A8zsEUo8-rKuuz4Yg';
const teacherId = 'security-teacher-semi-dedicated';
const approverId = 'security-teacher-dedicated';
const prefix = 'security-correction-e2e-';
const recordId = `${prefix}record`;
const today = new Date().toLocaleDateString('sv-SE', { timeZone: 'Asia/Tokyo' });
const month = today.slice(0, 7);
const browserSession = 'verify-attendance-corrections';

const browser = args => {
  const result = spawnSync('npx', ['agent-browser', '--session', browserSession, ...args], {
    cwd: root, encoding: 'utf8', stdio: ['ignore', 'pipe', 'pipe'],
  });
  if (result.status !== 0) throw new Error(`agent-browser ${args[0]} failed: ${String(result.stderr || result.stdout).trim()}`);
  return String(result.stdout || '').trim();
};

const runNode = args => {
  const result = spawnSync('node', args, { cwd: root, encoding: 'utf8', stdio: ['ignore', 'pipe', 'pipe'] });
  if (result.status !== 0) throw new Error(String(result.stderr || result.stdout).trim());
  return String(result.stdout || '').trim();
};

async function tokenFor(uid) {
  const account = accounts.find(item => item.uid === uid);
  const response = await fetch(`https://identitytoolkit.googleapis.com/v1/accounts:signInWithPassword?key=${apiKey}`, {
    method: 'POST', headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ email: account.email, password: account.password, returnSecureToken: true }),
  });
  const body = await response.json();
  if (!response.ok || !body.idToken) throw new Error(`Authentication failed for ${uid}.`);
  return body.idToken;
}

async function api(uid, method, route, payload) {
  const response = await fetch(`${baseUrl}${route}`, {
    method,
    headers: { Authorization: `Bearer ${await tokenFor(uid)}`, ...(payload ? { 'Content-Type': 'application/json' } : {}) },
    body: payload ? JSON.stringify(payload) : undefined,
  });
  const body = await response.json().catch(() => ({}));
  if (!response.ok || body.ok === false) throw new Error(`${method} ${route} failed: ${response.status} ${body.error || ''}`);
  return body;
}

const createdCorrectionIds = [];
try {
  await db.collection('work_records').doc(recordId).set({
    teacher_id: teacherId, teacher_name: '診断用講師', school_id: '112', school_name: '創造学園 オンライン校',
    date: today, status: 'pending', start_time: new Date(`${today}T16:40:00+09:00`).toISOString(),
    end_time: new Date(`${today}T18:00:00+09:00`).toISOString(), work_segments: [], transportation: [], diagnosis_test_data: true,
  });

  const requested = await api(teacherId, 'POST', '/api/attendance-corrections', {
    action: 'request', work_record_id: recordId,
    requested_start_time: new Date(`${today}T16:45:00+09:00`).toISOString(),
    requested_end_time: new Date(`${today}T18:05:00+09:00`).toISOString(), reason: '診断用修正依頼',
  });
  createdCorrectionIds.push(requested.request_id);

  // Create more than the old client-side limit *after* the pending request.
  // A screen that still reads the newest 100 Firestore documents directly will hide it.
  const historyBatch = db.batch();
  for (let i = 0; i < 350; i += 1) historyBatch.set(db.collection('attendance_correction_requests').doc(`${prefix}history-${String(i).padStart(3, '0')}`), {
    teacher_id: teacherId, school_id: '112', target_date: today, status: 'approved', diagnosis_test_data: true,
    created_at: FieldValue.serverTimestamp(),
  });
  await historyBatch.commit();

  const listing = await api(approverId, 'GET', `/api/attendance-corrections?scope=admin&status=pending&month=${month}&limit=100`);
  if (!(listing.requests || []).some(item => item.id === requested.request_id)) throw new Error('Pending correction was hidden after 350 processed rows.');

  browser(['open', `${baseUrl}/`]);
  runNode(['scripts/security/login-staging-agent-browser.mjs', '--uid=security-admin', `--session=${browserSession}`]);
  browser(['open', `${baseUrl}/master/attendance-corrections`]);
  browser(['wait', '2500']);
  const screenText = JSON.parse(browser(['eval', 'JSON.stringify(document.body.innerText)']));
  if (!screenText.includes(requested.request_id.slice(0, 8)) || !screenText.includes('勤務校舎:')) {
    throw new Error('Pending correction or workplace was not visible in the administrator screen.');
  }

  await api(approverId, 'POST', '/api/attendance-corrections', { action: 'review', request_id: requested.request_id, status: 'approved' });
  const [record, correction] = await Promise.all([
    db.collection('work_records').doc(recordId).get(),
    db.collection('attendance_correction_requests').doc(requested.request_id).get(),
  ]);
  if (correction.data()?.status !== 'approved' || !String(record.data()?.start_time).includes('07:45:00.000Z')) throw new Error('Correction approval was not persisted.');
  console.log(JSON.stringify({ ok: true, request_created: true, visible_after_350_processed_rows: true, workplace_visible_in_browser: true, approved: true }));
} finally {
  try { browser(['close']); } catch {}
  const snap = await db.collection('attendance_correction_requests').get();
  const docs = snap.docs.filter(doc => doc.id.startsWith(prefix) || createdCorrectionIds.includes(doc.id));
  for (let offset = 0; offset < docs.length; offset += 400) {
    const batch = db.batch();
    docs.slice(offset, offset + 400).forEach(doc => batch.delete(doc.ref));
    await batch.commit();
  }
  await db.collection('work_records').doc(recordId).delete().catch(() => undefined);
}
