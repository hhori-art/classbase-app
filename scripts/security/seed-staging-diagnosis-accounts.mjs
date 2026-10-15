import fs from 'node:fs';
import path from 'node:path';
import crypto from 'node:crypto';
import { cert, getApps, initializeApp } from 'firebase-admin/app';
import { getAuth } from 'firebase-admin/auth';
import { FieldValue, getFirestore } from 'firebase-admin/firestore';

const projectId = 'classbase-security-diagnosis';
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

const definitions = [
  { uid: 'security-master', login_id: 'security_master', role: 'master', name: '診断用 全体管理者', profile: { admin_permissions: { science_social: true, eiken: true, attendance: true } } },
  { uid: 'security-master-2', login_id: 'security_master_2', role: 'master', name: '診断用 全体管理者2', profile: { admin_permissions: { science_social: true, eiken: true, attendance: true } } },
  { uid: 'security-admin', login_id: 'security_admin', role: 'admin', name: '診断用 校舎管理者', profile: { school: '112', school_id: '112', school_ids: ['112'], admin_permissions: { science_social: true, eiken: true, attendance: true } } },
  { uid: 'security-teacher-dedicated', login_id: 'security_teacher_dedicated', role: 'teacher', name: '診断用 校舎承認者', profile: { school: '112', school_id: '112', school_ids: ['112'], employment_category: 'dedicated', attendance_school_manager: true, enabled_programs: ['science_social'], prescribed_work_start: '09:00', prescribed_work_end: '18:00', prescribed_break_minutes: 60, prescribed_work_days: [1, 2, 3, 4, 5] } },
  { uid: 'security-teacher-semi-dedicated', login_id: 'security_teacher_semi', role: 'teacher', name: '診断用 準専任講師', profile: { school: '112', school_id: '112', school_ids: ['112'], employment_category: 'semi_dedicated', enabled_programs: ['science_social'] } },
  { uid: 'security-student', login_id: '90000001', role: 'student', name: '診断用 生徒', profile: { student_name: '診断用 生徒', school: '112', school_id: '112', grade: '中3', parent_uid: 'security-parent' } },
  { uid: 'security-student-2', login_id: '90000002', role: 'student', name: '診断用 生徒2', profile: { student_name: '診断用 生徒2', school: '112', school_id: '112', grade: '中3' } },
  { uid: 'security-parent', login_id: 'security_parent', role: 'parent', name: '診断用 保護者', profile: { parent_name: '診断用 保護者', student_ids: ['security-student'], school: '112', school_id: '112' } },
];

const createPassword = () => {
  const alphabet = 'ABCDEFGHJKLMNPQRSTUVWXYZabcdefghijkmnopqrstuvwxyz23456789!@#$%';
  const bytes = crypto.randomBytes(24);
  return `Z9!${Array.from(bytes, byte => alphabet[byte % alphabet.length]).join('')}`;
};

const stored = JSON.parse(fs.readFileSync(credentialsPath, 'utf8'));
const credentials = definitions.map(definition => {
  const existing = stored.accounts?.find(account => account.uid === definition.uid);
  return {
    uid: definition.uid,
    login_id: definition.login_id,
    email: existing?.email || `${definition.login_id}@classbase.local`,
    password: existing?.password || createPassword(),
    role: definition.role,
  };
});
fs.writeFileSync(credentialsPath, `${JSON.stringify({ ...stored, accounts: credentials }, null, 2)}\n`, { mode: 0o600 });
fs.chmodSync(credentialsPath, 0o600);
const credentialMap = new Map(credentials.map(item => [item.uid, item]));

const authClient = getAuth();
const db = getFirestore();
for (const definition of definitions) {
  const credential = credentialMap.get(definition.uid);
  if (!credential?.email || !credential?.password || !credential?.login_id) {
    throw new Error(`Missing local credential for ${definition.uid}.`);
  }
  try {
    await authClient.getUser(definition.uid);
    await authClient.updateUser(definition.uid, { email: credential.email, password: credential.password, displayName: definition.name, disabled: false });
  } catch (error) {
    if (error?.code !== 'auth/user-not-found') throw error;
    await authClient.createUser({ uid: definition.uid, email: credential.email, password: credential.password, displayName: definition.name, disabled: false });
  }
  await db.collection('users').doc(definition.uid).set({
    uid: definition.uid,
    role: definition.role,
    name: definition.name,
    displayName: definition.name,
    lifetime_id: credential.login_id,
    initial_login_id: credential.login_id,
    email: credential.email,
    status: 'active',
    diagnosis_test_account: true,
    ...definition.profile,
    updated_at: FieldValue.serverTimestamp(),
  }, { merge: true });
}

console.log(`Created or updated ${definitions.length} accounts in ${projectId}.`);
