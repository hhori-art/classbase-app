import fs from 'node:fs';
import path from 'node:path';
import { cert, initializeApp } from 'firebase-admin/app';
import { getFirestore } from 'firebase-admin/firestore';

const PROJECT_ID = 'classbase-security-diagnosis';
const BASE_URL = process.env.SECURITY_STAGING_BASE_URL || 'https://classbase-security-diagnosis.vercel.app';
const API_KEY = 'AIzaSyC_hssQ63wvHD8GJ2A8zsEUo8-rKuuz4Yg';
const root = process.cwd();
const readJson = file => JSON.parse(fs.readFileSync(path.join(root, file), 'utf8'));
const serviceAccount = readJson('.security-staging-service-account.json');
const accounts = readJson('.security-diagnosis-accounts.json').accounts || [];
if (serviceAccount.project_id !== PROJECT_ID) throw new Error('Safety stop: wrong Firebase project.');
process.loadEnvFile(path.join(root, '.env.local'));

const zoomEnv = ['ZOOM_ACCOUNT_ID', 'ZOOM_CLIENT_ID', 'ZOOM_CLIENT_SECRET'];
if (zoomEnv.some(name => !process.env[name])) throw new Error('Missing local Zoom Server-to-Server OAuth credentials.');
const app = initializeApp({ credential: cert(serviceAccount), projectId: PROJECT_ID }, `class-flow-${Date.now()}`);
const db = getFirestore(app);
const accountByUid = new Map(accounts.map(account => [account.uid, account]));
const ids = {
  shift: `audit-class-main-${Date.now()}`,
  sub: `audit-class-sub-${Date.now()}`,
  registration: `audit-class-registration-${Date.now()}`,
};
const today = new Intl.DateTimeFormat('sv-SE', { timeZone: 'Asia/Tokyo' }).format(new Date());

async function zoomAccessToken() {
  const response = await fetch('https://zoom.us/oauth/token', {
    method: 'POST',
    headers: { Authorization: `Basic ${Buffer.from(`${process.env.ZOOM_CLIENT_ID}:${process.env.ZOOM_CLIENT_SECRET}`).toString('base64')}` },
    body: new URLSearchParams({ grant_type: 'account_credentials', account_id: process.env.ZOOM_ACCOUNT_ID }),
  });
  const body = await response.json().catch(() => ({}));
  if (!response.ok || !body.access_token) throw new Error(`Zoom authentication failed: ${body.message || response.status}`);
  return body.access_token;
}

function zoomTokenUserId(accessToken) {
  const parts = String(accessToken || '').split('.');
  if (parts.length !== 3) throw new Error('Zoom access token does not contain a diagnosable user reference.');
  const payload = JSON.parse(Buffer.from(parts[1], 'base64url').toString('utf8'));
  const uid = String(payload.uid || '').trim();
  if (!/^[A-Za-z0-9_-]{8,80}$/.test(uid)) throw new Error('Zoom access token user reference is unavailable.');
  return uid;
}

async function signIn(uid) {
  const account = accountByUid.get(uid);
  if (!account?.email || !account?.password) throw new Error(`Missing diagnosis credentials for ${uid}.`);
  const response = await fetch(`https://identitytoolkit.googleapis.com/v1/accounts:signInWithPassword?key=${API_KEY}`, {
    method: 'POST', headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ email: account.email, password: account.password, returnSecureToken: true }),
  });
  const body = await response.json().catch(() => ({}));
  if (!response.ok || !body.idToken) throw new Error(`Sign-in failed for ${uid}: ${body?.error?.message || response.status}`);
  return body.idToken;
}

async function api(pathname, token, body, method = 'POST') {
  const response = await fetch(`${BASE_URL}${pathname}`, {
    method,
    headers: { Authorization: `Bearer ${token}`, ...(body === undefined ? {} : { 'Content-Type': 'application/json' }) },
    ...(body === undefined ? {} : { body: JSON.stringify(body) }),
  });
  const data = await response.json().catch(() => ({}));
  return { response, data };
}

let meetingId = '';
let participationEventId = '';
let result;
let assignedTeacherToken = '';
const attendanceRef = db.collection('attendance').doc(`security-student_${today}`);
const originalAttendance = await attendanceRef.get();
const studentRef = db.collection('users').doc('security-student');
const originalStudent = await studentRef.get();
if (!originalStudent.exists) throw new Error('Diagnosis student profile is missing.');
const zoomToken = await zoomAccessToken();
const hostEmail = zoomTokenUserId(zoomToken);
const startHour = Math.min(23, Number(new Intl.DateTimeFormat('en-GB', { timeZone: 'Asia/Tokyo', hour: '2-digit', hour12: false }).format(new Date())) + 1);
const startTime = `${today}T${String(startHour).padStart(2, '0')}:30:00`;

try {
  const courseOption = await db.collection('course_registration_options').doc('security-demo-course-science').get();
  const courseOptionData = courseOption.data() || {};
  if (!courseOption.exists || !courseOptionData.year || !courseOptionData.term) {
    throw new Error('Diagnosis current course term fixture is missing.');
  }
  await db.collection('shift_assignments').doc(ids.shift).set({
    diagnosis_test_data: true, target_date: today, role_type: 'main', user_id: 'security-teacher-dedicated', teacher_id: 'security-teacher-dedicated',
    teacher_name: '診断用 専任講師', target_grade: '中3', grade: '中3', target_subject: '理科', subject: '理科',
    target_detail_subject: '中3理科', unit: '監査用授業', period: '1限', note: '【1限】監査用授業', school_id: '112', school: '112',
    target_signin_address: hostEmail, sync_source: 'diagnosis_audit', source_spreadsheet_id: 'diagnosis-audit', sync_key: ids.shift,
  });
  await db.collection('shift_assignments').doc(ids.sub).set({
    diagnosis_test_data: true, target_date: today, role_type: 'sub', parent_id: ids.shift, user_id: 'security-teacher-semi-dedicated', teacher_id: 'security-teacher-semi-dedicated',
    teacher_name: '診断用 準専任講師', target_grade: '中3', target_subject: '理科', target_detail_subject: '中3理科', period: '1限', note: '【1限】監査用サポート', school_id: '112', school: '112',
  });
  await db.collection('course_registrations').doc(ids.registration).set({
    diagnosis_test_data: true, student_id: 'security-student', student_name: '診断用 生徒', selected_course_ids: [ids.shift],
    status: 'active', is_current: true, registration_type: 'regular', year: courseOptionData.year, term: courseOptionData.term, updated_at: new Date(),
  });
  await studentRef.set({
    active_course_registration_id: ids.registration,
    selected_course_ids: [ids.shift],
  }, { merge: true });

  const masterToken = await signIn('security-master');
  const create = await api('/api/create-zoom-meeting', masterToken, {
    shift_id: ids.shift, topic: '診断用 中3理科', startTime, duration: 75,
  });
  if (!create.response.ok || !create.data.success || !create.data.meeting_id) {
    throw new Error(`Meeting creation failed: ${create.response.status} ${create.data.error || ''}`);
  }
  meetingId = String(create.data.meeting_id);
  const savedShift = (await db.collection('shift_assignments').doc(ids.shift).get()).data() || {};
  if (String(savedShift.target_meeting_id) !== meetingId || !savedShift.target_join_url || !savedShift.start_url || savedShift.target_recording_url) {
    throw new Error('Meeting fields were not saved to the correct shift fields.');
  }

  const teacherResults = [];
  for (const uid of ['security-teacher-dedicated', 'security-teacher-semi-dedicated']) {
    const token = await signIn(uid);
    if (uid === 'security-teacher-dedicated') assignedTeacherToken = token;
    const host = await api('/api/get-zoom-zak', token, { email: hostEmail, meetingId, shiftId: ids.shift, name: '診断用講師' });
    if (!host.response.ok || !host.data.success || !String(host.data.start_url || '').includes(meetingId) || !host.data.app_start_url) {
      throw new Error(`Host authorization failed for ${uid}: ${host.response.status} ${host.data.error || ''}`);
    }
    const tampered = await api('/api/get-zoom-zak', token, { email: hostEmail, meetingId: `${meetingId}9`, shiftId: ids.shift });
    if (tampered.response.status !== 403) throw new Error(`Tampered meeting ID was not rejected for ${uid}.`);
    teacherResults.push(uid);
  }

  const studentToken = await signIn('security-student');
  const classes = await api('/api/student/today-classes', studentToken, undefined, 'GET');
  const targetClass = (classes.data.classes || []).find(item => String(item.id || '').split('__').includes(ids.shift));
  if (!classes.response.ok || !targetClass?.participation_token || !String(targetClass.url || '').includes(meetingId)) {
    const [profileDebug, registrationsDebug, shiftDebug] = await Promise.all([
      studentRef.get(),
      db.collection('course_registrations').where('student_id', '==', 'security-student').limit(50).get(),
      db.collection('shift_assignments').doc(ids.shift).get(),
    ]);
    const previewDebug = assignedTeacherToken
      ? await api('/api/student/today-classes?preview=teacher', assignedTeacherToken, undefined, 'GET')
      : { data: {} };
    throw new Error(`Student class was not joinable: ${classes.response.status} ${JSON.stringify({
      count: (classes.data.classes || []).length,
      ids: (classes.data.classes || []).map(item => item.id),
      schedule_missing: classes.data.schedule_missing,
      matching_mode: classes.data.matching_mode,
      profile_points_to_audit: profileDebug.data()?.active_course_registration_id === ids.registration,
      audit_registration_visible: registrationsDebug.docs.some(doc => doc.id === ids.registration),
      audit_registration_selected_shift: registrationsDebug.docs.find(doc => doc.id === ids.registration)?.data()?.selected_course_ids?.includes(ids.shift) === true,
      audit_shift_has_join_url: Boolean(shiftDebug.data()?.target_join_url),
      audit_shift_is_synced: Boolean(shiftDebug.data()?.sync_source),
      teacher_preview_count: (previewDebug.data.classes || []).length,
      teacher_preview_has_audit: (previewDebug.data.classes || []).some(item => String(item.id || '').split('__').includes(ids.shift)),
    })}`);
  }
  const firstJoin = await api('/api/class-participation', studentToken, { class_id: targetClass.id, participation_token: targetClass.participation_token });
  const secondJoin = await api('/api/class-participation', studentToken, { class_id: targetClass.id, participation_token: targetClass.participation_token });
  if (!firstJoin.response.ok || firstJoin.data.duplicate !== false || !secondJoin.response.ok || secondJoin.data.duplicate !== true) {
    throw new Error('Student re-entry did not converge to a single participation event.');
  }
  participationEventId = String(firstJoin.data.event_id || '');
  const [attendance, event] = await Promise.all([
    attendanceRef.get(),
    db.collection('learning_events').doc(participationEventId).get(),
  ]);
  const participations = attendance.data()?.participations || [];
  if (!attendance.exists || participations.filter(item => item.class_id === targetClass.id).length !== 1 || !event.exists) {
    throw new Error('Attendance, participation details, and learning event did not converge to one record.');
  }

  result = {
    ok: true,
    project: PROJECT_ID,
    meeting_created_and_saved: true,
    assigned_teacher_host_grant: true,
    substitute_teacher_host_grant: true,
    tampered_meeting_rejected: true,
    student_class_visible: true,
    student_join_url_has_passcode: /[?&]pwd=/.test(String(targetClass.url || '')),
    student_reentry_deduplicated: true,
    attendance_records: 1,
    participation_details: 1,
    learning_events: 1,
  };
} finally {
  if (meetingId) {
    await fetch(`https://api.zoom.us/v2/meetings/${encodeURIComponent(meetingId)}`, {
      method: 'DELETE', headers: { Authorization: `Bearer ${zoomToken}` },
    }).catch(() => undefined);
  }
  const refs = [
    db.collection('shift_assignments').doc(ids.shift),
    db.collection('shift_assignments').doc(ids.sub),
    db.collection('course_registrations').doc(ids.registration),
    ...(participationEventId ? [db.collection('learning_events').doc(participationEventId)] : []),
  ];
  await Promise.all(refs.map(ref => ref.delete().catch(() => undefined)));
  if (originalAttendance.exists) await attendanceRef.set(originalAttendance.data());
  else await attendanceRef.delete().catch(() => undefined);
  await studentRef.set(originalStudent.data());
}

console.log(JSON.stringify(result));
