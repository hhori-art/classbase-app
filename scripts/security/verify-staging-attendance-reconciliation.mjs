import fs from 'node:fs';
import path from 'node:path';
import { cert, getApps, initializeApp } from 'firebase-admin/app';
import { getFirestore } from 'firebase-admin/firestore';

const projectId = 'classbase-security-diagnosis';
const baseUrl = 'https://classbase-security-diagnosis.vercel.app';
const root = process.cwd();
const keyPath = path.join(root, '.security-staging-service-account.json');
const credentialsPath = path.join(root, '.security-diagnosis-accounts.json');
if (!fs.existsSync(keyPath) || !fs.existsSync(credentialsPath)) throw new Error('Missing diagnosis credentials.');
const serviceAccount = JSON.parse(fs.readFileSync(keyPath, 'utf8'));
if (serviceAccount.project_id !== projectId || !serviceAccount.private_key) throw new Error('Safety stop: wrong Firebase project.');
if (!getApps().length) initializeApp({ credential: cert(serviceAccount), projectId });

const db = getFirestore();
const accounts = JSON.parse(fs.readFileSync(credentialsPath, 'utf8')).accounts;
const master = accounts.find(account => account.uid === 'security-master');
if (!master?.email || !master?.password) throw new Error('Missing diagnosis master credentials.');
const apiKey = 'AIzaSyC_hssQ63wvHD8GJ2A8zsEUo8-rKuuz4Yg';
const prefix = 'security-reconciliation-e2e-';
const today = new Date().toLocaleDateString('sv-SE', { timeZone: 'Asia/Tokyo' });
const month = today.slice(0, 7);
const pastDate = `${month}-01`;
if (pastDate >= today) throw new Error('Run this test after the first day of the month.');

const cases = {
  missing: { teacherId: `${prefix}missing`, code: 'missing_record' },
  detail: { teacherId: `${prefix}detail`, code: 'missing_detail', recordId: `${prefix}record-detail` },
  wrong: { teacherId: `${prefix}wrong`, code: 'wrong_program', recordId: `${prefix}record-wrong` },
  mismatch: { teacherId: `${prefix}mismatch`, code: 'science_social_time_mismatch', recordId: `${prefix}record-mismatch` },
  correct: { teacherId: `${prefix}correct`, recordId: `${prefix}record-correct` },
  today: { teacherId: `${prefix}today` },
};
const teacherIds = Object.values(cases).map(item => item.teacherId);
const recordIds = Object.values(cases).map(item => item.recordId).filter(Boolean);
const shiftIds = [];

const teacher = id => ({
  uid: id, role: 'teacher', name: `診断用 ${id}`, school: '112', school_id: '112', school_ids: ['112'],
  employment_category: 'semi_dedicated', status: 'active', diagnosis_test_account: true,
});
const segment = (id, program, start, end) => ({
  id, type: 'lesson', program, start, end, grade: '中3', lesson_format: 'group',
  ...(program === 'normal' ? { school_id: '112' } : {}), approval_status: 'pending',
});
const record = (teacherId, segments) => ({
  teacher_id: teacherId, teacher_name: `診断用 ${teacherId}`, school_id: '112', date: pastDate,
  start_time: `${pastDate}T18:00:00+09:00`, end_time: `${pastDate}T22:00:00+09:00`,
  status: 'pending', detail_approval_status: 'pending', work_segments: segments,
  transportation: [], transportation_status: 'none', diagnosis_test_data: true,
});
const shift = (id, teacherId, date = pastDate, period = '1限') => {
  shiftIds.push(id);
  return db.collection('shift_assignments').doc(id).set({
    user_id: teacherId, teacher_id: teacherId, teacher_name: `診断用 ${teacherId}`,
    target_date: date, target_subject: '理科', target_detail_subject: '理社講座', period,
    school: '112', school_id: '112', diagnosis_test_data: true,
  });
};

async function masterToken() {
  const response = await fetch(`https://identitytoolkit.googleapis.com/v1/accounts:signInWithPassword?key=${apiKey}`, {
    method: 'POST', headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ email: master.email, password: master.password, returnSecureToken: true }),
  });
  const body = await response.json();
  if (!response.ok || !body.idToken) throw new Error('Diagnosis master authentication failed.');
  return body.idToken;
}

try {
  await Promise.all(teacherIds.map(id => db.collection('users').doc(id).set(teacher(id))));
  await Promise.all([
    shift(`${prefix}shift-missing`, cases.missing.teacherId),
    shift(`${prefix}shift-detail`, cases.detail.teacherId),
    shift(`${prefix}shift-wrong-a`, cases.wrong.teacherId, pastDate, '1限'),
    shift(`${prefix}shift-wrong-b`, cases.wrong.teacherId, pastDate, '2限'),
    shift(`${prefix}shift-mismatch`, cases.mismatch.teacherId),
    shift(`${prefix}shift-correct`, cases.correct.teacherId),
    shift(`${prefix}shift-today`, cases.today.teacherId, today),
    db.collection('work_records').doc(cases.detail.recordId).set(record(cases.detail.teacherId, [])),
    db.collection('work_records').doc(cases.wrong.recordId).set(record(cases.wrong.teacherId, [segment('wrong', 'normal', '19:20', '21:40')])),
    db.collection('work_records').doc(cases.mismatch.recordId).set(record(cases.mismatch.teacherId, [segment('mismatch', 'science_social', '18:00', '19:00')])),
    db.collection('work_records').doc(cases.correct.recordId).set(record(cases.correct.teacherId, [segment('correct', 'science_social', '19:20', '20:25')])),
  ]);

  const token = await masterToken();
  const response = await fetch(`${baseUrl}/api/attendance-detail-approvals?month=${month}`, {
    headers: { Authorization: `Bearer ${token}` },
  });
  const body = await response.json().catch(() => ({}));
  if (!response.ok) throw new Error(`Reconciliation API failed with ${response.status}: ${body.error || ''}`);
  const relevant = (body.reconciliation_alerts || []).filter(item => String(item.teacher_id || '').startsWith(prefix));
  const byTeacher = new Map(relevant.map(item => [item.teacher_id, item]));
  for (const item of [cases.missing, cases.detail, cases.wrong, cases.mismatch]) {
    const alerts = relevant.filter(alert => alert.teacher_id === item.teacherId);
    if (alerts.length !== 1 || alerts[0].code !== item.code) {
      throw new Error(`${item.teacherId}: expected one ${item.code}, got ${JSON.stringify(alerts)}.`);
    }
    if (item.recordId && alerts[0].record_id !== item.recordId) throw new Error(`${item.teacherId}: missing record jump target.`);
  }
  if (byTeacher.has(cases.correct.teacherId)) throw new Error('Correct science/social detail produced an alert.');
  if (byTeacher.has(cases.today.teacherId)) throw new Error('Today or future assignment produced an alert.');
  console.log(JSON.stringify({
    ok: true,
    missing_record: 1,
    missing_detail: 1,
    wrong_program: 1,
    science_social_time_mismatch: 1,
    duplicate_same_day_collapsed: true,
    correct_record_suppressed: true,
    today_suppressed: true,
    jump_targets_verified: 3,
  }));
} finally {
  await Promise.all([
    ...teacherIds.map(id => db.collection('users').doc(id).delete().catch(() => undefined)),
    ...recordIds.map(id => db.collection('work_records').doc(id).delete().catch(() => undefined)),
    ...shiftIds.map(id => db.collection('shift_assignments').doc(id).delete().catch(() => undefined)),
  ]);
}
