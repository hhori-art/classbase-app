import fs from 'node:fs';
import path from 'node:path';
import { cert, getApps, initializeApp } from 'firebase-admin/app';
import { getAuth } from 'firebase-admin/auth';
import { FieldValue, getFirestore } from 'firebase-admin/firestore';

const projectId = 'classbase-security-diagnosis';
const baseUrl = 'https://classbase-security-diagnosis.vercel.app';
const root = process.cwd();
const keyPath = path.join(root, '.security-staging-service-account.json');
const credentialsPath = path.join(root, '.security-diagnosis-accounts.json');
if (!fs.existsSync(keyPath) || !fs.existsSync(credentialsPath)) {
  throw new Error('Missing diagnosis service-account key or account credential file.');
}

const serviceAccount = JSON.parse(fs.readFileSync(keyPath, 'utf8'));
if (serviceAccount.project_id !== projectId || !serviceAccount.private_key) {
  throw new Error('Safety stop: service-account key is not for the diagnosis project.');
}
if (!getApps().length) initializeApp({ credential: cert(serviceAccount), projectId });

const db = getFirestore();
const credentials = JSON.parse(fs.readFileSync(credentialsPath, 'utf8')).accounts;
const accountByUid = new Map(credentials.map(account => [account.uid, account]));
const apiKey = 'AIzaSyC_hssQ63wvHD8GJ2A8zsEUo8-rKuuz4Yg';
const localTeacherId = 'security-teacher-semi-dedicated';
const approverId = 'security-teacher-dedicated';
const foreignTeacherId = 'security-attendance-foreign-teacher';
const prefix = 'security-attendance-e2e-';
const recordIds = {
  approve: `${prefix}approve`,
  edit: `${prefix}edit`,
  delete: `${prefix}delete`,
  science: `${prefix}science`,
  foreign: `${prefix}foreign`,
};
const today = new Date().toLocaleDateString('sv-SE', { timeZone: 'Asia/Tokyo' });
const month = today.slice(0, 7);

async function tokenFor(uid) {
  const account = accountByUid.get(uid);
  if (!account?.email || !account?.password) throw new Error(`Missing credentials for ${uid}.`);
  const response = await fetch(`https://identitytoolkit.googleapis.com/v1/accounts:signInWithPassword?key=${apiKey}`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ email: account.email, password: account.password, returnSecureToken: true }),
  });
  const body = await response.json();
  if (!response.ok || !body.idToken) throw new Error(`Authentication failed for ${uid}.`);
  return body.idToken;
}

async function request(uid, method, route, payload, expectedStatus = 200) {
  const token = await tokenFor(uid);
  const response = await fetch(`${baseUrl}${route}`, {
    method,
    headers: { Authorization: `Bearer ${token}`, ...(payload ? { 'Content-Type': 'application/json' } : {}) },
    body: payload ? JSON.stringify(payload) : undefined,
  });
  const body = await response.json().catch(() => ({}));
  if (response.status !== expectedStatus) {
    throw new Error(`${uid} ${method} ${route}: expected ${expectedStatus}, received ${response.status} (${body.error || 'no error message'}).`);
  }
  return body;
}

const segment = (id, program = 'normal') => ({
  id,
  start: '16:50',
  end: '18:00',
  type: 'lesson',
  program,
  grade: '中3',
  lesson_format: 'group',
  school_id: '112',
  approval_status: 'pending',
});

const record = (teacherId, schoolId, segments) => ({
  teacher_id: teacherId,
  teacher_name: `診断用 ${teacherId}`,
  school_id: schoolId,
  school_name: schoolId,
  date: today,
  start_time: new Date(`${today}T16:40:00+09:00`).toISOString(),
  end_time: new Date(`${today}T19:20:00+09:00`).toISOString(),
  status: 'pending',
  detail_approval_status: 'pending',
  attendance_kind: 'normal',
  work_segments: segments,
  transportation: [],
  transportation_status: 'none',
  diagnosis_test_data: true,
  created_at: new Date().toISOString(),
  updated_at: new Date().toISOString(),
});

async function deleteAuditRows(collection) {
  const snapshots = await Promise.all(Object.values(recordIds).map(id =>
    db.collection(collection).where('work_record_id', '==', id).get()
  ));
  const docs = snapshots.flatMap(snapshot => snapshot.docs);
  for (let offset = 0; offset < docs.length; offset += 400) {
    const batch = db.batch();
    docs.slice(offset, offset + 400).forEach(doc => batch.delete(doc.ref));
    await batch.commit();
  }
}

const approverRef = db.collection('users').doc(approverId);
const approverBefore = await approverRef.get();
if (!approverBefore.exists) throw new Error('Diagnosis attendance approver does not exist.');
const previousManagerValue = approverBefore.data()?.attendance_school_manager;

try {
  await approverRef.set({ attendance_school_manager: true }, { merge: true });
  await db.collection('users').doc(foreignTeacherId).set({
    uid: foreignTeacherId,
    role: 'teacher',
    name: '診断用 他校舎講師',
    school: '166',
    school_id: '166',
    school_ids: ['166'],
    employment_category: 'semi_dedicated',
    status: 'active',
    diagnosis_test_account: true,
  });
  await Promise.all([
    db.collection('work_records').doc(recordIds.approve).set(record(localTeacherId, '112', [segment('approve-a'), { ...segment('approve-b'), start: '18:10', end: '19:20' }])),
    db.collection('work_records').doc(recordIds.edit).set(record(localTeacherId, '112', [segment('edit-a')])),
    db.collection('work_records').doc(recordIds.delete).set(record(localTeacherId, '112', [segment('delete-a')])),
    db.collection('work_records').doc(recordIds.science).set(record(localTeacherId, '112', [segment('science-a', 'science_social')])),
    db.collection('work_records').doc(recordIds.foreign).set({ ...record(foreignTeacherId, '166', [{ ...segment('foreign-a'), school_id: '166' }]), school_name: '166' }),
  ]);

  const listing = await request(approverId, 'GET', `/api/attendance-detail-approvals?month=${month}`);
  const visibleIds = new Set((listing.records || []).map(item => item.id));
  if (!visibleIds.has(recordIds.approve) || visibleIds.has(recordIds.foreign)) {
    throw new Error('School boundary listing verification failed.');
  }
  const scienceRecord = (listing.records || []).find(item => item.id === recordIds.science);
  if (!scienceRecord || scienceRecord.work_segments?.[0]?.can_review !== false || scienceRecord.can_edit_clock !== false) {
    throw new Error(`Science/social restriction was not represented in the approver response: ${JSON.stringify(scienceRecord || null)}.`);
  }

  const approved = await request(approverId, 'POST', '/api/attendance-detail-approvals', {
    action: 'approve_selected',
    items: [
      { work_record_id: recordIds.approve, segment_id: 'approve-a' },
      { work_record_id: recordIds.approve, segment_id: 'approve-b' },
    ],
  });
  if (approved.updated !== 2) throw new Error('Bulk approval did not update both selected segments.');

  await request(approverId, 'POST', '/api/attendance-detail-approvals', {
    action: 'edit_clock',
    work_record_id: recordIds.edit,
    start_time: new Date(`${today}T16:45:00+09:00`).toISOString(),
    end_time: new Date(`${today}T18:00:00+09:00`).toISOString(),
  });
  await request(approverId, 'POST', '/api/attendance-detail-approvals', {
    action: 'save_segments',
    work_record_id: recordIds.edit,
    segments: [
      { ...segment('edit-office'), start: '16:45', end: '16:50', type: 'office', office_task: 'classroom_operation', grade: undefined, lesson_format: undefined },
      { ...segment('edit-lesson'), start: '16:50', end: '18:00' },
    ],
  });
  await request(approverId, 'POST', '/api/attendance-detail-approvals', { action: 'delete_record', work_record_id: recordIds.delete });

  await request(approverId, 'POST', '/api/attendance-detail-approvals', {
    action: 'approve_selected', items: [{ work_record_id: recordIds.science, segment_id: 'science-a' }],
  }, 403);
  await request(approverId, 'POST', '/api/attendance-detail-approvals', {
    action: 'edit_clock',
    work_record_id: recordIds.science,
    start_time: new Date(`${today}T16:45:00+09:00`).toISOString(),
    end_time: new Date(`${today}T19:25:00+09:00`).toISOString(),
  }, 403);
  await request(approverId, 'POST', '/api/attendance-detail-approvals', {
    action: 'approve_selected', items: [{ work_record_id: recordIds.foreign, segment_id: 'foreign-a' }],
  }, 403);
  await request(approverId, 'POST', '/api/attendance-detail-approvals', {
    action: 'delete_record', work_record_id: recordIds.foreign,
  }, 403);

  const masterApproval = await request('security-master', 'POST', '/api/attendance-detail-approvals', {
    action: 'approve_selected', items: [{ work_record_id: recordIds.science, segment_id: 'science-a' }],
  });
  if (masterApproval.updated !== 1) throw new Error('Master could not approve the science/social segment.');

  const [approvedSnap, editedSnap, deletedSnap, foreignSnap] = await Promise.all([
    db.collection('work_records').doc(recordIds.approve).get(),
    db.collection('work_records').doc(recordIds.edit).get(),
    db.collection('work_records').doc(recordIds.delete).get(),
    db.collection('work_records').doc(recordIds.foreign).get(),
  ]);
  if (!approvedSnap.data()?.work_segments?.every(item => item.approval_status === 'approved')) throw new Error('Bulk approval was not persisted.');
  if (editedSnap.data()?.work_segments?.length !== 2) throw new Error('Batch segment edit was not persisted.');
  if (deletedSnap.exists) throw new Error('Record deletion was not persisted.');
  if (!foreignSnap.exists) throw new Error('Foreign-school denial did not preserve the record.');

  console.log(JSON.stringify({
    ok: true,
    visible_local_record: true,
    hidden_foreign_record: true,
    bulk_approved_segments: 2,
    clock_edit: true,
    batch_segment_edit: true,
    record_delete: true,
    school_manager_science_social_denied: true,
    school_manager_science_social_edit_denied: true,
    school_manager_foreign_school_denied: true,
    master_science_social_approved: true,
  }));
} finally {
  await Promise.all(Object.values(recordIds).map(id => db.collection('work_records').doc(id).delete().catch(() => undefined)));
  await Promise.all([
    deleteAuditRows('attendance_record_edits'),
    deleteAuditRows('attendance_detail_edits'),
  ]).catch(() => undefined);
  await db.collection('users').doc(foreignTeacherId).delete().catch(() => undefined);
  await approverRef.set({
    attendance_school_manager: previousManagerValue === undefined ? FieldValue.delete() : previousManagerValue,
  }, { merge: true });
}
