import { readFileSync } from 'node:fs';
import { cert, getApps, initializeApp } from 'firebase-admin/app';
import { getAuth } from 'firebase-admin/auth';
import { FieldPath, getFirestore } from 'firebase-admin/firestore';

const envText = readFileSync('.env.local', 'utf8');
envText.split(/\r?\n/).forEach(line => {
  const trimmed = line.trim();
  if (!trimmed || trimmed.startsWith('#')) return;
  const separator = trimmed.indexOf('=');
  if (separator < 1) return;
  const key = trimmed.slice(0, separator).trim();
  let value = trimmed.slice(separator + 1).trim();
  if ((value.startsWith('"') && value.endsWith('"')) || (value.startsWith("'") && value.endsWith("'"))) {
    value = value.slice(1, -1);
  }
  if (process.env[key] === undefined) process.env[key] = value;
});

const projectId = process.env.NEXT_PUBLIC_FIREBASE_PROJECT_ID;
const clientEmail = process.env.FIREBASE_CLIENT_EMAIL;
const privateKey = String(process.env.FIREBASE_PRIVATE_KEY || '').replace(/^"|"$/g, '').replace(/\\n/g, '\n');
if (!projectId || !clientEmail || !privateKey) throw new Error('Firebase admin credentials are missing');

if (!getApps().length) initializeApp({ credential: cert({ projectId, clientEmail, privateKey }) });
const db = getFirestore();
const auth = getAuth();

const fetchAll = async query => {
  const rows = [];
  let cursor = null;
  while (true) {
    let pageQuery = query.orderBy(FieldPath.documentId()).limit(1000);
    if (cursor) pageQuery = pageQuery.startAfter(cursor);
    const snap = await pageQuery.get();
    rows.push(...snap.docs.map(doc => ({ id: doc.id, ...doc.data() })));
    if (snap.size < 1000) break;
    cursor = snap.docs.at(-1);
  }
  return rows;
};

const fetchAllAuthUsers = async () => {
  const users = [];
  let pageToken;
  do {
    const page = await auth.listUsers(1000, pageToken);
    users.push(...page.users);
    pageToken = page.pageToken;
  } while (pageToken);
  return users;
};

const toDate = value => {
  if (!value) return null;
  if (typeof value.toDate === 'function') return value.toDate();
  const date = new Date(value);
  return Number.isNaN(date.getTime()) ? null : date;
};

const normalizeName = value => String(value || '').normalize('NFKC').replace(/[\s　]/g, '');
const displayName = user => user.student_name || user.name || user.display_name || '';
const normalizeGrade = value => {
  const text = String(value || '').normalize('NFKC');
  if (/中(?:学)?\s*1|1\s*年/.test(text)) return '中1';
  if (/中(?:学)?\s*2|2\s*年/.test(text)) return '中2';
  if (/中(?:学)?\s*3|3\s*年/.test(text)) return '中3';
  return text.trim() || '未設定';
};

const [users, metrics, participations, attendance, authUsers] = await Promise.all([
  fetchAll(db.collection('users').where('role', '==', 'student')),
  fetchAll(db.collection('beta_user_metrics')),
  fetchAll(db.collection('learning_events').where('type', '==', 'class_join_clicked')),
  fetchAll(db.collection('attendance').where('contacted_by', '==', 'student')),
  fetchAllAuthUsers(),
]);

const students = users.filter(user => /^\d{8}$/.test(normalizeName(displayName(user))));
const studentIds = new Set(students.map(user => user.id));
const metricsByUid = new Map(metrics.map(row => [String(row.uid || row.id), row]));
const authByUid = new Map(authUsers.map(user => [user.uid, user]));

const directParticipantIds = new Set([
  ...participations.map(row => String(row.actor_id || '')).filter(id => studentIds.has(id)),
  ...attendance
    .filter(row => ['joined', 'present'].includes(String(row.type || '').toLowerCase()))
    .filter(row => row.participation_event_id || String(row.reason || '').includes('Zoom参加'))
    .map(row => String(row.user_id || ''))
    .filter(id => studentIds.has(id)),
]);

const participationEventCount = new Map();
participations.forEach(row => {
  const id = String(row.actor_id || '');
  if (!studentIds.has(id)) return;
  participationEventCount.set(id, (participationEventCount.get(id) || 0) + 1);
});

const details = students.map(user => {
  const metric = metricsByUid.get(user.id);
  const authUser = authByUid.get(user.id);
  const loginDates = [
    toDate(user.last_login),
    toDate(metric?.last_seen_at),
    toDate(metric?.first_seen_at),
    toDate(authUser?.metadata?.lastSignInTime),
  ].filter(Boolean);
  return {
    uid: user.id,
    grade: normalizeGrade(user.grade),
    school: String(user.school || user.school_name || (Array.isArray(user.schools) ? user.schools[0] : '') || '未設定'),
    logged_in: loginDates.length > 0,
    last_login: loginDates.sort((a, b) => b.getTime() - a.getTime())[0] || null,
    participated: directParticipantIds.has(user.id),
    participation_events: participationEventCount.get(user.id) || 0,
  };
});

const summarize = rows => {
  const total = rows.length;
  const loggedIn = rows.filter(row => row.logged_in).length;
  const participated = rows.filter(row => row.participated).length;
  return {
    target_accounts: total,
    logged_in_accounts: loggedIn,
    login_rate: total ? Math.round(loggedIn / total * 1000) / 10 : 0,
    participating_accounts: participated,
    participation_rate_all: total ? Math.round(participated / total * 1000) / 10 : 0,
    participation_rate_logged_in: loggedIn ? Math.round(participated / loggedIn * 1000) / 10 : 0,
    participation_events: rows.reduce((sum, row) => sum + row.participation_events, 0),
  };
};

const groupSummary = key => Object.fromEntries(
  [...new Set(details.map(row => row[key]))]
    .sort((a, b) => String(a).localeCompare(String(b), 'ja', { numeric: true }))
    .map(value => [value, summarize(details.filter(row => row[key] === value))])
);

const evidenceDates = details.flatMap(row => row.last_login ? [row.last_login] : []);
const eventDates = participations
  .filter(row => studentIds.has(String(row.actor_id || '')))
  .map(row => toDate(row.created_at))
  .filter(Boolean);
const allDates = [...evidenceDates, ...eventDates].sort((a, b) => a.getTime() - b.getTime());

console.log(JSON.stringify({
  generated_at: new Date().toISOString(),
  project_id: projectId,
  evidence_window: {
    earliest_observed: allDates[0]?.toISOString() || null,
    latest_observed: allDates.at(-1)?.toISOString() || null,
  },
  definitions: {
    target: 'role=student and normalized display name matches exactly 8 digits',
    login: 'users.last_login OR beta_user_metrics activity OR Firebase Auth lastSignInTime',
    participation: 'direct app Zoom participation record; twin-auto records excluded',
  },
  overall: summarize(details),
  by_grade: groupSummary('grade'),
  by_school: groupSummary('school'),
  data_quality: {
    user_docs: users.length,
    auth_users: authUsers.length,
    target_students: students.length,
    target_without_auth_user: details.filter(row => !authByUid.has(row.uid)).length,
    beta_metrics_docs: metrics.length,
    participation_docs: participations.length,
    attendance_student_docs: attendance.length,
  },
}, null, 2));
