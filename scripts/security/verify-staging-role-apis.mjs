import fs from 'node:fs';
import path from 'node:path';

const root = process.cwd();
const credentialsPath = path.join(root, '.security-diagnosis-accounts.json');
if (!fs.existsSync(credentialsPath)) throw new Error('Missing diagnosis account credential file.');
const accounts = JSON.parse(fs.readFileSync(credentialsPath, 'utf8')).accounts;
const accountByUid = new Map(accounts.map(account => [account.uid, account]));
const apiKey = 'AIzaSyC_hssQ63wvHD8GJ2A8zsEUo8-rKuuz4Yg';
const baseUrl = 'https://classbase-security-diagnosis.vercel.app';

async function tokenFor(uid) {
  const account = accountByUid.get(uid);
  if (!account?.email || !account?.password) throw new Error(`Missing credentials for ${uid}.`);
  const response = await fetch(`https://identitytoolkit.googleapis.com/v1/accounts:signInWithPassword?key=${apiKey}`, {
    method: 'POST', headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ email: account.email, password: account.password, returnSecureToken: true }),
  });
  const body = await response.json();
  if (!response.ok || !body.idToken) throw new Error(`Authentication failed for ${uid}.`);
  return body.idToken;
}

async function getJson(uid, route) {
  const token = await tokenFor(uid);
  const response = await fetch(`${baseUrl}${route}`, { headers: { Authorization: `Bearer ${token}` } });
  const body = await response.json().catch(() => ({}));
  if (!response.ok || body.ok === false) throw new Error(`${uid} ${route} failed with ${response.status}.`);
  return body;
}

async function postJson(uid, route, payload) {
  const token = await tokenFor(uid);
  const response = await fetch(`${baseUrl}${route}`, {
    method: 'POST',
    headers: { Authorization: `Bearer ${token}`, 'Content-Type': 'application/json' },
    body: JSON.stringify(payload),
  });
  const body = await response.json().catch(() => ({}));
  if (!response.ok || body.ok === false) throw new Error(`${uid} POST ${route} failed with ${response.status}.`);
  return body;
}

async function expectUnavailable(uid, route) {
  const token = await tokenFor(uid);
  const response = await fetch(`${baseUrl}${route}`, { headers: { Authorization: `Bearer ${token}` } });
  const body = await response.json().catch(() => ({}));
  if (response.status !== 503 || body.error !== 'line-integration-unavailable') {
    throw new Error(`${uid} ${route} did not safely report unavailable.`);
  }
  return body;
}

const studentNotifications = await getJson('security-student', '/api/notifications?limit=20');
const studentCourses = await getJson('security-student', '/api/course-registration-options?grade=%E4%B8%AD3');
const masterApps = await getJson('security-master', '/api/apps');
const adminApps = await getJson('security-admin', '/api/apps');
const parentApps = await getJson('security-parent', '/api/apps');
const parentPf = await getJson('security-parent', '/api/pf/dashboard?period=week');
const teacherPf = await getJson('security-teacher-dedicated', '/api/pf/dashboard?period=week');
const adminPf = await getJson('security-admin', '/api/pf/dashboard?period=month');
const teacherSlide = await getJson('security-teacher-dedicated', '/api/slides/security-demo-slide-science/download');
const transferOptions = await getJson('security-student', '/api/student/transfer-options?absence_id=security-demo-absence-request');
const adaptive = await postJson('security-student', '/api/homework/adaptive', {
  learningUnitId: 'security-demo-learning-unit-ai', questionCount: 5,
});
const ocr = await postJson('security-student', '/api/ocr-quiz', {
  imageDataUrl: 'data:image/png;base64,iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mNk+A8AAQUBAScY42YAAAAASUVORK5CYII=',
  legalConsent: true, privateUseOnly: true, questionCount: 5, grade: '中3', subject: '理科',
});
await expectUnavailable('security-student', '/api/line/auth?mode=json&role=student&redirect=https%3A%2F%2Fclassbase-security-diagnosis.vercel.app%2Fstudent%2Fsettings');

const summary = {
  student_notifications: studentNotifications.notifications?.length || 0,
  student_course_options: studentCourses.options?.length || 0,
  active_registration_requests: studentCourses.registration_requests?.length || 0,
  master_login_apps: Object.values(masterApps.apps || {}).filter(Boolean).length,
  school_admin_login_apps: Object.values(adminApps.apps || {}).filter(Boolean).length,
  parent_science_social_app: parentApps.apps?.science_social ? 1 : 0,
  parent_pf_students: parentPf.students?.length || 0,
  teacher_pf_students: teacherPf.students?.length || 0,
  admin_pf_students: adminPf.students?.length || 0,
  teacher_slide_download: teacherSlide.url ? 1 : 0,
  student_transfer_options: transferOptions.options?.length || 0,
  adaptive_diagnosis_questions: adaptive.questions?.length || 0,
  ocr_diagnosis_questions: ocr.diagnosis_mock && ocr.questions?.length || 0,
};
if (Object.values(summary).some(value => value === 0)) throw new Error(`Role API verification failed: ${JSON.stringify(summary)}`);
console.log(`Role APIs verified on diagnosis URL: ${JSON.stringify(summary)}`);
