import fs from 'node:fs';
import path from 'node:path';
import { cert, initializeApp } from 'firebase-admin/app';
import { getAuth } from 'firebase-admin/auth';
import { getFirestore } from 'firebase-admin/firestore';

const PROJECT_ID = 'classbase-security-diagnosis';
const BASE_URL = 'https://classbase-security-diagnosis.vercel.app';
const API_KEY = 'AIzaSyC_hssQ63wvHD8GJ2A8zsEUo8-rKuuz4Yg';
const PREFIX = `AUDITBULK${new Date().toISOString().replace(/\D/g, '').slice(0, 12)}`;
const root = process.cwd();

const readJson = file => JSON.parse(fs.readFileSync(path.join(root, file), 'utf8'));
const serviceAccount = readJson('.security-staging-service-account.json');
const accounts = readJson('.security-diagnosis-accounts.json').accounts || [];
if (serviceAccount.project_id !== PROJECT_ID) throw new Error('Safety stop: wrong Firebase project.');
const master = accounts.find(account => account.uid === 'security-master');
if (!master?.email || !master?.password) throw new Error('Missing diagnosis master credentials.');

const app = initializeApp({ credential: cert(serviceAccount), projectId: PROJECT_ID }, `bulk-import-${Date.now()}`);
const auth = getAuth(app);
const db = getFirestore(app);
const createdUids = new Set();
const eventIds = new Set();

async function signIn() {
  const response = await fetch(`https://identitytoolkit.googleapis.com/v1/accounts:signInWithPassword?key=${API_KEY}`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ email: master.email, password: master.password, returnSecureToken: true }),
  });
  const body = await response.json().catch(() => ({}));
  if (!response.ok || !body.idToken) throw new Error(`Master authentication failed: ${body?.error?.message || response.status}`);
  return body.idToken;
}

async function createAccount(token, payload) {
  const response = await fetch(`${BASE_URL}/api/admin/accounts/create`, {
    method: 'POST',
    headers: { Authorization: `Bearer ${token}`, 'Content-Type': 'application/json' },
    body: JSON.stringify(payload),
  });
  const body = await response.json().catch(() => ({}));
  if (response.ok && body.uid) {
    createdUids.add(body.uid);
    if (body.event_id) eventIds.add(body.event_id);
  }
  return { status: response.status, body };
}

async function importRole(token, role) {
  const startedAt = performance.now();
  const results = [];
  for (let index = 1; index <= 50; index += 1) {
    const suffix = String(index).padStart(3, '0');
    const loginId = `${PREFIX}${role === 'student' ? 'S' : 'T'}${suffix}`;
    const sameName = index <= 2;
    const payload = {
      role,
      display_name: sameName ? '監査用 同姓同名' : `監査用 ${role === 'student' ? '生徒' : '講師'}${suffix}`,
      login_id: loginId,
      password: `Audit${suffix}!`,
      school_id: '112',
      auto_create_parent: false,
      ...(role === 'student'
        ? { grade: '中3', classroom: 'オンライン', day_of_week: '月', subject_science: '物理', subject_social: '地理' }
        : { employment_category: 'semi_dedicated' }),
    };
    const result = await createAccount(token, payload);
    if (!result.body?.ok || result.status !== 200) {
      throw new Error(`${role} ${suffix} failed: ${result.status} ${result.body?.error || ''}`);
    }
    if (result.body.updated !== false) throw new Error(`${role} ${suffix} unexpectedly updated an existing account.`);
    results.push({ ...result.body, login_id: loginId });
  }
  return { results, elapsed_ms: Math.round(performance.now() - startedAt) };
}

async function countProfiles(uids, role) {
  const snapshots = await Promise.all(uids.map(uid => db.collection('users').doc(uid).get()));
  return snapshots.filter(snapshot => snapshot.exists && snapshot.data()?.role === role).length;
}

async function cleanup(cleanupPrefix = PREFIX) {
  const prefixQuery = await db.collection('users')
    .where('lifetime_id', '>=', cleanupPrefix)
    .where('lifetime_id', '<=', `${cleanupPrefix}\uf8ff`)
    .get();
  const safeDocs = prefixQuery.docs.filter(doc => {
    const data = doc.data() || {};
    return String(data.lifetime_id || '').startsWith(cleanupPrefix)
      && String(data.name || data.student_name || '').startsWith('監査用')
      && String(data.school_id || '') === '112'
      && ['student', 'teacher'].includes(String(data.role || ''));
  });
  if (safeDocs.length !== prefixQuery.size) throw new Error('Safety stop: cleanup query included a non-audit profile.');

  const uids = [...new Set([...createdUids, ...safeDocs.map(doc => doc.id)])];
  if (uids.length) {
    const authResult = await auth.deleteUsers(uids);
    if (authResult.failureCount) throw new Error(`Failed to delete ${authResult.failureCount} audit Auth users.`);
  }

  for (let offset = 0; offset < safeDocs.length; offset += 450) {
    const batch = db.batch();
    safeDocs.slice(offset, offset + 450).forEach(doc => batch.delete(doc.ref));
    await batch.commit();
  }
  let deletedEvents = 0;
  for (let offset = 0; offset < uids.length; offset += 30) {
    const eventQuery = await db.collection('learning_events').where('target_id', 'in', uids.slice(offset, offset + 30)).get();
    for (let eventOffset = 0; eventOffset < eventQuery.docs.length; eventOffset += 450) {
      const batch = db.batch();
      eventQuery.docs.slice(eventOffset, eventOffset + 450).forEach(doc => batch.delete(doc.ref));
      await batch.commit();
    }
    deletedEvents += eventQuery.size;
  }
  for (const id of eventIds) await db.collection('learning_events').doc(id).delete().catch(() => {});
  return { profiles: safeDocs.length, auth_users: uids.length, events: Math.max(deletedEvents, eventIds.size) };
}

let summary;
try {
  const staleCleanup = await cleanup('AUDITBULK');
  createdUids.clear();
  eventIds.clear();
  const token = await signIn();
  const students = await importRole(token, 'student');
  const teachers = await importRole(token, 'teacher');
  const studentUids = students.results.map(result => result.uid);
  const teacherUids = teachers.results.map(result => result.uid);

  const [studentProfiles, teacherProfiles, authUsers] = await Promise.all([
    countProfiles(studentUids, 'student'),
    countProfiles(teacherUids, 'teacher'),
    auth.getUsers([...studentUids, ...teacherUids].map(uid => ({ uid }))),
  ]);
  if (studentProfiles !== 50 || teacherProfiles !== 50 || authUsers.users.length !== 100 || authUsers.notFound.length) {
    throw new Error(`Count mismatch: students=${studentProfiles}, teachers=${teacherProfiles}, auth=${authUsers.users.length}, missing=${authUsers.notFound.length}`);
  }

  const invalidSchool = await createAccount(token, {
    role: 'student', display_name: '監査用 不正校舎', login_id: `${PREFIX}INVALIDSCHOOL`, password: 'Audit999!', school_id: '999', auto_create_parent: false,
  });
  if (invalidSchool.status !== 400 || invalidSchool.body?.ok !== false) {
    throw new Error(`Invalid school was not rejected: ${invalidSchool.status}`);
  }
  const invalidPassword = await createAccount(token, {
    role: 'teacher', display_name: '監査用 短いPW', login_id: `${PREFIX}SHORTPW`, password: '12345', school_id: '112', employment_category: 'semi_dedicated',
  });
  if (invalidPassword.status !== 400 || invalidPassword.body?.ok !== false) {
    throw new Error(`Short password was not rejected: ${invalidPassword.status}`);
  }

  const retry = await createAccount(token, {
    role: 'student', display_name: '監査用 同姓同名', login_id: students.results[0].login_id,
    password: 'Audit001!', school_id: '112', grade: '中3', auto_create_parent: false,
  });
  if (retry.status !== 200 || retry.body?.updated !== true || retry.body?.uid !== students.results[0].uid) {
    throw new Error(`Idempotent retry failed: ${retry.status} ${retry.body?.error || ''}`);
  }

  summary = {
    ok: true,
    project: PROJECT_ID,
    student: { created: 50, firestore: studentProfiles, elapsed_ms: students.elapsed_ms },
    teacher: { created: 50, firestore: teacherProfiles, elapsed_ms: teachers.elapsed_ms },
    auth_users: authUsers.users.length,
    invalid_school_rejected: true,
    short_password_rejected: true,
    same_login_retry_updated_original: true,
    stale_cleanup_before_run: staleCleanup,
  };
} finally {
  const removed = await cleanup();
  if (summary) summary.cleanup = removed;
}

console.log(JSON.stringify(summary));
