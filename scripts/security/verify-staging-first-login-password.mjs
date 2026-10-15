import crypto from 'node:crypto';
import fs from 'node:fs';
import path from 'node:path';
import { spawnSync } from 'node:child_process';
import { cert, initializeApp } from 'firebase-admin/app';
import { getAuth } from 'firebase-admin/auth';
import { FieldValue, getFirestore } from 'firebase-admin/firestore';

const PROJECT_ID = 'classbase-security-diagnosis';
const BASE_URL = 'https://classbase-security-diagnosis.vercel.app/';
const TEST_UID = 'security-teacher-semi-dedicated';
const SESSION = 'audit-first-password';
const root = process.cwd();

const readJson = file => JSON.parse(fs.readFileSync(path.join(root, file), 'utf8'));
const serviceAccount = readJson('.security-staging-service-account.json');
const credentials = readJson('.security-diagnosis-accounts.json');
if (serviceAccount.project_id !== PROJECT_ID) throw new Error('Safety stop: wrong Firebase project.');
const account = credentials.accounts?.find(item => item.uid === TEST_UID);
if (!account?.login_id || !account?.password) throw new Error('Missing diagnosis account credentials.');

const app = initializeApp({ credential: cert(serviceAccount), projectId: PROJECT_ID }, `first-login-${Date.now()}`);
const auth = getAuth(app);
const db = getFirestore(app);
const profileRef = db.collection('users').doc(TEST_UID);
const originalProfile = (await profileRef.get()).data();
if (!originalProfile?.diagnosis_test_account) throw new Error('Safety stop: target is not a diagnosis account.');

const temporaryPassword = `T7!${crypto.randomBytes(8).toString('base64url')}`;
const sixCharacterPassword = 'A7!b2C';

const browser = args => {
  const result = spawnSync('npx', ['agent-browser', '--session', SESSION, ...args], {
    cwd: root,
    encoding: 'utf8',
    stdio: ['ignore', 'pipe', 'pipe'],
  });
  if (result.status !== 0) throw new Error(`agent-browser ${args[0]} failed: ${String(result.stderr || result.stdout).trim()}`);
  return String(result.stdout || '').trim();
};

const restoreValue = key => Object.hasOwn(originalProfile, key) ? originalProfile[key] : FieldValue.delete();

try {
  await auth.updateUser(TEST_UID, { password: temporaryPassword, disabled: false });
  await auth.revokeRefreshTokens(TEST_UID);
  await profileRef.update({
    isFirstLogin: true,
    initial_password: temporaryPassword,
    password_changed_at: FieldValue.delete(),
    updated_at: FieldValue.serverTimestamp(),
  });

  browser(['open', BASE_URL]);
  let snapshot = browser(['snapshot', '-i']);
  let textboxes = [...snapshot.matchAll(/textbox .*\[.*ref=(e\d+)\]/g)].map(match => `@${match[1]}`);
  const loginButton = snapshot.match(/button "ログイン" \[ref=(e\d+)\]/)?.[1];
  if (textboxes.length < 2 || !loginButton) throw new Error('Could not resolve login controls.');
  browser(['fill', textboxes[0], account.login_id]);
  browser(['fill', textboxes[1], temporaryPassword]);
  browser(['click', `@${loginButton}`]);
  browser(['wait', '3000']);

  const firstUrl = browser(['get', 'url']);
  if (!firstUrl.includes('/account/password-change')) throw new Error(`First-login redirect failed: ${firstUrl}`);

  snapshot = browser(['snapshot', '-i']);
  textboxes = [...snapshot.matchAll(/textbox .*\[.*ref=(e\d+)\]/g)].map(match => `@${match[1]}`);
  const changeButton = snapshot.match(/button "パスワードを変更して開始" \[ref=(e\d+)\]/)?.[1];
  if (textboxes.length < 2 || !changeButton) throw new Error('Could not resolve password-change controls.');

  browser(['fill', textboxes[0], 'A1!bc']);
  browser(['fill', textboxes[1], 'A1!bc']);
  browser(['click', `@${changeButton}`]);
  browser(['wait', '500']);
  const shortPasswordState = browser(['snapshot']);
  if (!shortPasswordState.includes('パスワードは6文字以上で入力してください')) {
    throw new Error('Five-character password was not rejected.');
  }

  browser(['fill', textboxes[0], sixCharacterPassword]);
  browser(['fill', textboxes[1], sixCharacterPassword]);
  browser(['click', `@${changeButton}`]);
  browser(['wait', '4000']);
  const finalUrl = browser(['get', 'url']);
  if (!finalUrl.endsWith('/apps')) throw new Error(`Six-character password change did not reach /apps: ${finalUrl}`);

  const changedProfile = (await profileRef.get()).data() || {};
  if (changedProfile.isFirstLogin !== false || Object.hasOwn(changedProfile, 'initial_password')) {
    throw new Error('Password-change profile cleanup was not persisted.');
  }

  console.log(JSON.stringify({
    ok: true,
    uid: TEST_UID,
    first_login_redirect: '/account/password-change',
    five_characters_rejected: true,
    six_characters_accepted: true,
    destination: '/apps',
    profile_cleanup: true,
  }));
} finally {
  try { browser(['close']); } catch {}
  await auth.updateUser(TEST_UID, { password: account.password, disabled: false });
  await auth.revokeRefreshTokens(TEST_UID);
  await profileRef.update({
    isFirstLogin: restoreValue('isFirstLogin'),
    initial_password: restoreValue('initial_password'),
    password_changed_at: restoreValue('password_changed_at'),
    updated_at: restoreValue('updated_at'),
  });
}
