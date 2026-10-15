import fs from 'node:fs';
import { initializeApp, cert, getApps } from 'firebase-admin/app';
import { getFirestore } from 'firebase-admin/firestore';

const env = Object.fromEntries(fs.readFileSync('.env.local', 'utf8').split(/\r?\n/).filter(Boolean).filter(line => !line.startsWith('#')).map(line => {
  const index = line.indexOf('=');
  return [line.slice(0, index), line.slice(index + 1).replace(/^"|"$/g, '')];
}));
const privateKey = String(env.FIREBASE_PRIVATE_KEY || '').replace(/\\n/g, '\n');
if (!env.NEXT_PUBLIC_FIREBASE_PROJECT_ID || !env.FIREBASE_CLIENT_EMAIL || !privateKey) throw new Error('Firebase credentials are missing');
if (!getApps().length) initializeApp({ credential: cert({ projectId: env.NEXT_PUBLIC_FIREBASE_PROJECT_ID, clientEmail: env.FIREBASE_CLIENT_EMAIL, privateKey }) });

const db = getFirestore();
const snap = await db.collection('attendance_correction_requests').limit(1000).get();
const pending = snap.docs.filter(doc => String(doc.data().status || 'pending') === 'pending');
let missingSchool = 0;
let brokenWorkRecordLink = 0;
let recoverableFromWorkRecord = 0;
let missingTargetDate = 0;
let offGridRequestedTime = 0;
const pendingBySchool = new Map();
const pendingByMonth = new Map();
const pendingByType = new Map();

for (const doc of pending) {
  const item = doc.data();
  const school = String(item.school_id || '(missing)');
  const month = String(item.target_date || '').slice(0, 7) || '(missing)';
  const type = String(item.request_type || (item.work_record_id ? 'legacy_time_correction' : 'legacy_missing_clock'));
  pendingBySchool.set(school, (pendingBySchool.get(school) || 0) + 1);
  pendingByMonth.set(month, (pendingByMonth.get(month) || 0) + 1);
  pendingByType.set(type, (pendingByType.get(type) || 0) + 1);
  if (!item.target_date) missingTargetDate += 1;
  if (!item.school_id) missingSchool += 1;
  for (const value of [item.requested_start_time, item.requested_end_time].filter(Boolean)) {
    const date = new Date(value);
    if (!Number.isNaN(date.getTime()) && (date.getMinutes() % 5 !== 0 || date.getSeconds() !== 0 || date.getMilliseconds() !== 0)) offGridRequestedTime += 1;
  }
  const recordId = String(item.work_record_id || item.workRecordId || item.record_id || '').trim();
  if (recordId) {
    const record = await db.collection('work_records').doc(recordId).get();
    if (!record.exists) brokenWorkRecordLink += 1;
    else if (!item.school_id && (record.data()?.school_id || record.data()?.school_code || record.data()?.school_name)) recoverableFromWorkRecord += 1;
  }
}

const users = await db.collection('users').get();
const managerCountBySchool = new Map();
const eligibleManagerCountBySchool = new Map();
for (const user of users.docs) {
  const profile = user.data();
  if (profile.attendance_school_manager !== true) continue;
  const schools = new Set([profile.school_id, profile.school_code, ...(Array.isArray(profile.school_ids) ? profile.school_ids : []), ...(Array.isArray(profile.attendance_school_ids) ? profile.attendance_school_ids : [])].filter(Boolean).map(String));
  const employment = String(profile.employment_category || profile.employment_type || profile.worker_type || '').normalize('NFKC').trim().toLowerCase();
  const eligible = ['dedicated', 'employee', 'full_time', 'regular_employee', '専任', '社員', '正社員'].includes(employment);
  for (const school of schools) {
    managerCountBySchool.set(school, (managerCountBySchool.get(school) || 0) + 1);
    if (eligible) eligibleManagerCountBySchool.set(school, (eligibleManagerCountBySchool.get(school) || 0) + 1);
  }
}

console.log(JSON.stringify({
  project: env.NEXT_PUBLIC_FIREBASE_PROJECT_ID,
  sampled: snap.size,
  pending: pending.length,
  pending_missing_school: missingSchool,
  pending_broken_work_record_link: brokenWorkRecordLink,
  pending_school_recoverable_from_work_record: recoverableFromWorkRecord,
  pending_missing_target_date: missingTargetDate,
  pending_off_grid_requested_values: offGridRequestedTime,
  pending_by_month: Object.fromEntries([...pendingByMonth].sort()),
  pending_by_type: Object.fromEntries([...pendingByType].sort()),
  pending_school_coverage: Object.fromEntries([...pendingBySchool].sort().map(([school, count]) => [school, { pending: count, configured_managers: managerCountBySchool.get(school) || 0, eligible_dedicated_managers: eligibleManagerCountBySchool.get(school) || 0 }])),
}, null, 2));
