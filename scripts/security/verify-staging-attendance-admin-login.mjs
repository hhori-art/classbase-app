import fs from 'node:fs';
import path from 'node:path';
import { spawnSync } from 'node:child_process';
import { cert, getApps, initializeApp } from 'firebase-admin/app';
import { getFirestore } from 'firebase-admin/firestore';

const root = process.cwd();
const serviceAccount = JSON.parse(fs.readFileSync(path.join(root, '.security-staging-service-account.json'), 'utf8'));
if (serviceAccount.project_id !== 'classbase-security-diagnosis') {
  throw new Error('Safety stop: diagnosis service account required.');
}
if (!getApps().length) initializeApp({ credential: cert(serviceAccount), projectId: serviceAccount.project_id });

const db = getFirestore();
const ref = db.collection('users').doc('security-admin');
const before = await ref.get();
if (!before.exists || before.data()?.diagnosis_test_account !== true) {
  throw new Error('Safety stop: diagnosis test account was not found.');
}

const run = args => {
  const result = spawnSync(args[0], args.slice(1), { cwd: root, encoding: 'utf8' });
  if (result.status !== 0) throw new Error(String(result.stderr || result.stdout).trim());
  return String(result.stdout || '').trim();
};

const session = 'verify-attendance-admin';
try {
  await ref.update({ role: 'attendance_admin' });
  run(['npx', 'agent-browser', '--session', session, 'open', 'https://classbase-security-diagnosis.vercel.app/']);
  run(['node', 'scripts/security/login-staging-agent-browser.mjs', '--uid=security-admin', `--session=${session}`]);
  run(['npx', 'agent-browser', '--session', session, 'wait', '5000']);
  const state = JSON.parse(run(['npx', 'agent-browser', '--session', session, 'eval',
    'JSON.stringify({url:location.href,readyState:document.readyState,busy:document.querySelectorAll("[aria-busy=true]").length})',
  ]));
  const parsed = JSON.parse(state);
  if (!parsed.url.endsWith('/master/attendance') || parsed.readyState !== 'complete' || parsed.busy !== 0) {
    throw new Error(`Attendance admin login was not stable: ${JSON.stringify(parsed)}`);
  }
  console.log(JSON.stringify({ ok: true, role: 'attendance_admin', ...parsed }));
} finally {
  await ref.update({ role: before.data().role });
  try { run(['npx', 'agent-browser', '--session', session, 'close']); } catch {}
}
