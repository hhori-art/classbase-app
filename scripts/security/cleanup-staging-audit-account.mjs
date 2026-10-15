import fs from 'node:fs';
import path from 'node:path';
import { cert, initializeApp } from 'firebase-admin/app';
import { getAuth } from 'firebase-admin/auth';
import { getFirestore } from 'firebase-admin/firestore';

const PROJECT_ID = 'classbase-security-diagnosis';
const loginId = String(process.argv.find(value => value.startsWith('--login-id=')) || '').slice(11);
if (!/^AUDIT[A-Z0-9-]{6,40}$/.test(loginId)) throw new Error('Safety stop: only AUDIT-prefixed accounts can be removed.');

const keyPath = path.join(process.cwd(), '.security-staging-service-account.json');
const serviceAccount = JSON.parse(fs.readFileSync(keyPath, 'utf8'));
if (serviceAccount.project_id !== PROJECT_ID) throw new Error('Safety stop: wrong Firebase project.');

const app = initializeApp({ credential: cert(serviceAccount), projectId: PROJECT_ID }, `cleanup-audit-${Date.now()}`);
const db = getFirestore(app);
const auth = getAuth(app);
const matches = await db.collection('users').where('lifetime_id', '==', loginId).limit(3).get();
if (matches.size !== 1) throw new Error(`Expected one audit account, found ${matches.size}.`);

const account = matches.docs[0];
const data = account.data() || {};
if (
  !String(data.name || data.student_name || '').startsWith('監査用') ||
  String(data.school_id || '') !== '112' ||
  !['teacher', 'student'].includes(String(data.role || ''))
) {
  throw new Error('Safety stop: account attributes do not match an audit fixture.');
}

await auth.deleteUser(account.id).catch(error => {
  if (error?.code !== 'auth/user-not-found') throw error;
});
await account.ref.delete();
console.log(JSON.stringify({ ok: true, project: PROJECT_ID, login_id: loginId, uid: account.id }));
