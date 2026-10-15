import fs from 'node:fs';
import path from 'node:path';
import { spawnSync } from 'node:child_process';
import { cert, getApps, initializeApp } from 'firebase-admin/app';
import { getFirestore } from 'firebase-admin/firestore';

const projectId = 'classbase-security-diagnosis';
const baseUrl = 'https://classbase-security-diagnosis.vercel.app';
const root = process.cwd();
const serviceAccount = JSON.parse(fs.readFileSync(path.join(root, '.security-staging-service-account.json'), 'utf8'));
if (serviceAccount.project_id !== projectId) throw new Error('Safety stop: wrong Firebase project.');
if (!getApps().length) initializeApp({ credential: cert(serviceAccount), projectId });

const db = getFirestore();
const teacherId = 'security-teacher-semi-dedicated';
const recordId = 'security-attendance-history-fallback';
const marker = '診断履歴フォールバック確認';
const browserSession = 'verify-attendance-history';
const jstYesterday = new Date(Date.now() + (9 * 60 * 60 * 1000) - (24 * 60 * 60 * 1000)).toISOString().slice(0, 10);

const run = (command, args, allowFailure = false) => {
  const result = spawnSync(command, args, { cwd: root, encoding: 'utf8', stdio: ['ignore', 'pipe', 'pipe'] });
  if (!allowFailure && result.status !== 0) {
    throw new Error(`${command} ${args.join(' ')} failed: ${String(result.stderr || result.stdout).trim()}`);
  }
  return { status: result.status, output: String(result.stdout || '').trim(), error: String(result.stderr || '').trim() };
};

const browser = args => run('npx', ['agent-browser', '--session', browserSession, ...args]).output;

try {
  await db.collection('work_records').doc(recordId).set({
    teacher_id: teacherId,
    teacher_name: '診断用 準専任講師',
    school_id: '178',
    school_name: '創造学園 元町校',
    date: jstYesterday,
    start_time: new Date(`${jstYesterday}T16:40:00+09:00`).toISOString(),
    end_time: new Date(`${jstYesterday}T16:50:00+09:00`).toISOString(),
    status: 'pending',
    attendance_kind: 'normal',
    default_program: 'normal',
    workplace_type: 'school',
    work_segments: [{
      id: 'history-segment', start: '16:40', end: '16:50', type: 'office', program: 'normal',
      school_id: '178', office_task: 'other', note: marker, approval_status: 'pending',
    }],
    transportation: [],
    transportation_status: 'none',
    created_at: new Date().toISOString(),
    diagnosis_test_data: true,
  });

  browser(['open', `${baseUrl}/`]);
  const login = run('node', ['scripts/security/login-staging-agent-browser.mjs', `--uid=${teacherId}`, `--session=${browserSession}`], true);
  if (login.status !== 0) {
    const currentUrl = browser(['get', 'url']);
    if (currentUrl.endsWith('/')) throw new Error(login.error || login.output || 'Diagnosis browser login failed.');
  }
  browser(['open', `${baseUrl}/teacher/attendance`]);
  browser(['wait', '3000']);
  const screenText = JSON.parse(browser(['eval', 'JSON.stringify(document.body.innerText)']));
  if (!screenText.includes(marker) || !screenText.includes('創造学園 元町校')) {
    throw new Error('The completed attendance record was hidden from monthly history.');
  }

  console.log(JSON.stringify({
    ok: true,
    history_visible_without_index: true,
    workplace_visible: true,
    date: jstYesterday,
  }));
} finally {
  try { browser(['close']); } catch {}
  await db.collection('work_records').doc(recordId).delete().catch(() => undefined);
}
