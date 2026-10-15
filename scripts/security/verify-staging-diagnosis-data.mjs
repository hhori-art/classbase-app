import fs from 'node:fs';
import path from 'node:path';
import { cert, getApps, initializeApp } from 'firebase-admin/app';
import { getFirestore } from 'firebase-admin/firestore';

const PROJECT_ID = 'classbase-security-diagnosis';
const keyPath = path.join(process.cwd(), '.security-staging-service-account.json');
if (!fs.existsSync(keyPath)) throw new Error('Missing diagnosis service-account key.');
const serviceAccount = JSON.parse(fs.readFileSync(keyPath, 'utf8'));
if (serviceAccount.project_id !== PROJECT_ID) throw new Error('Safety stop: wrong Firebase project.');
if (!getApps().length) initializeApp({ credential: cert(serviceAccount), projectId: PROJECT_ID });
const db = getFirestore();

const requiredDocs = [
  ['settings','portal_visibility'], ['users','security-student'], ['users','security-parent'],
  ['registration_requests','security-demo-registration-request'], ['homework_assignments','security-demo-homework-upcoming'],
  ['class_recordings','security-demo-recording-1'], ['community_topics','security-demo-community-thread'],
  ['teacher_substitution_posts','security-demo-substitution-open'],
  ['attendance_correction_requests','security-demo-correction-pending'], ['learning_units','security-demo-learning-unit-science'],
  ['learning_units','security-demo-learning-unit-ai'],
  ['quizzes','security-demo-quiz-1'], ['lesson_slides','security-demo-slide-science'],
  ['pf_records','security-demo-legacy-pf-0-0'], ['pf_resolutions','security-demo-pf-resolution'],
  ['chat_logs','security-demo-chat-alert'], ['teacher_inquiries','security-demo-teacher-inquiry'],
  ['course_registrations','security-demo-prior-course-registration'],
];
const missing = [];
for (const [collection, id] of requiredDocs) {
  if (!(await db.collection(collection).doc(id).get()).exists) missing.push(`${collection}/${id}`);
}
const visibility = (await db.collection('settings').doc('portal_visibility').get()).data() || {};
const disabled = Object.entries(visibility)
  .filter(([role, value]) => ['student', 'parent', 'teacher', 'admin'].includes(role) && value && typeof value === 'object')
  .flatMap(([role, value]) => Object.entries(value).filter(([, enabled]) => enabled !== true).map(([key]) => `${role}.${key}`));
const checks = {
  diagnosis_users: (await db.collection('users').where('diagnosis_test_account', '==', true).get()).size,
  current_shifts: (await db.collection('shift_assignments').where('diagnosis_test_data', '==', true).get()).size,
  homework: (await db.collection('homework_assignments').where('diagnosis_test_data', '==', true).get()).size,
  notifications: (await db.collection('user_notifications').where('diagnosis_test_data', '==', true).get()).size,
  pf_records: (await db.collection('pf_learning_records').where('diagnosis_test_data', '==', true).get()).size,
};
if (missing.length || disabled.length || Object.values(checks).some(count => count === 0)) {
  throw new Error(`Diagnosis data verification failed: ${JSON.stringify({ missing, disabled, checks })}`);
}
console.log(`Diagnosis data verified in ${PROJECT_ID}: ${JSON.stringify(checks)}`);
