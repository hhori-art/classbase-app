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
const recordId = 'security-attendance-details-ui';
const browserSession = 'verify-attendance-details';
const jstYesterday = new Date(Date.now() + (9 * 60 * 60 * 1000) - (24 * 60 * 60 * 1000)).toISOString().slice(0, 10);
const notes = ['診断事務前半', '診断個別授業1', '診断事務後半', '診断個別授業2'];

const run = (command, args, allowFailure = false) => {
  const result = spawnSync(command, args, { cwd: root, encoding: 'utf8', stdio: ['ignore', 'pipe', 'pipe'] });
  if (!allowFailure && result.status !== 0) throw new Error(`${command} ${args.join(' ')} failed: ${String(result.stderr || result.stdout).trim()}`);
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
    end_time: new Date(`${jstYesterday}T19:20:00+09:00`).toISOString(),
    status: 'pending',
    attendance_kind: 'normal',
    default_program: 'normal',
    workplace_type: 'school',
    work_segments: [
      { id: 's1', start: '16:40', end: '16:50', type: 'office', program: 'normal', school_id: '178', office_task: 'other', note: notes[0], approval_status: 'pending' },
      { id: 's2', start: '16:50', end: '18:00', type: 'individual', program: 'normal', school_id: '178', individual_level: 'standard', individual_ratio: '1:2', note: notes[1], approval_status: 'pending' },
      { id: 's3', start: '18:00', end: '18:10', type: 'office', program: 'normal', school_id: '178', office_task: 'other', note: notes[2], approval_status: 'pending' },
      { id: 's4', start: '18:10', end: '19:20', type: 'individual', program: 'normal', school_id: '178', individual_level: 'standard', individual_ratio: '1:3', note: notes[3], approval_status: 'pending' },
    ],
    transportation: [],
    transportation_status: 'none',
    created_at: new Date().toISOString(),
    diagnosis_test_data: true,
  });

  browser(['open', `${baseUrl}/`]);
  const login = run('node', ['scripts/security/login-staging-agent-browser.mjs', `--uid=${teacherId}`, `--session=${browserSession}`], true);
  if (login.status !== 0 && browser(['get', 'url']).endsWith('/')) throw new Error(login.error || login.output || 'Diagnosis browser login failed.');
  browser(['open', `${baseUrl}/teacher/attendance`]);
  browser(['wait', '3000']);

  const listText = JSON.parse(browser(['eval', 'JSON.stringify(document.body.innerText)']));
  for (const note of notes) if (!listText.includes(note)) throw new Error(`Attendance detail is missing from history: ${note}`);
  if (!listText.includes('創造学園 元町校')) throw new Error('Workplace is missing from attendance history.');

  const snapshot = browser(['snapshot', '-i']);
  const editRef = snapshot.match(/button "詳細を修正" \[ref=([^\]]+)\]/)?.[1];
  if (!editRef) throw new Error('Attendance detail edit button was not found.');
  browser(['click', `@${editRef}`]);
  browser(['wait', '500']);

  const modalResult = JSON.parse(JSON.parse(browser(['eval', `JSON.stringify((() => {
    const text = document.body.innerText;
    const timeSelects = [...document.querySelectorAll('select')].filter(select => {
      const values = [...select.options].map(option => option.value).filter(Boolean);
      return values.length === 288 && values.every(value => {
        const parts = value.split(':').map(Number);
        return parts.length === 2 && Number.isInteger(parts[0]) && Number.isInteger(parts[1]) && parts[1] % 5 === 0;
      });
    });
    return {
      hasTotal: text.includes('2時間40分'),
      individualGradeSelectCount: [...document.querySelectorAll('select')].filter(select => [...select.options].some(option => option.value === '中1')).length,
      hasTransportationNone: text.includes('交通費なし（入力漏れではありません）'),
      timeSelectCount: timeSelects.length,
      hasHeadOffice: text.includes('創造学園本部'),
      hasMotomachiName: text.includes('創造学園 元町校'),
    };
  })())` ])));
  if (!modalResult.hasTotal || modalResult.individualGradeSelectCount !== 0 || !modalResult.hasTransportationNone || modalResult.timeSelectCount < 8 || !modalResult.hasHeadOffice || !modalResult.hasMotomachiName) {
    throw new Error(`Attendance detail modal verification failed: ${JSON.stringify(modalResult)}`);
  }

  console.log(JSON.stringify({ ok: true, four_segments_visible: true, total_minutes: 160, five_minute_selects: true, individual_grade_removed: true, transportation_none: true, workplace_names: true }));
} finally {
  try { browser(['close']); } catch {}
  await db.collection('work_records').doc(recordId).delete().catch(() => undefined);
}
