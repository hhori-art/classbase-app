import crypto from 'node:crypto';
import fs from 'node:fs';
import path from 'node:path';
import { spawnSync } from 'node:child_process';
import { cert, initializeApp } from 'firebase-admin/app';
import { getAuth } from 'firebase-admin/auth';
import { FieldValue, Timestamp, getFirestore } from 'firebase-admin/firestore';

const PROJECT_ID = 'classbase-security-diagnosis';
const BASE_URL = 'https://classbase-security-diagnosis.vercel.app';
const TEST_UID = 'security-teacher-semi-dedicated';
const SESSION = 'audit-password-reset';
const root = process.cwd();

const readJson = file => JSON.parse(fs.readFileSync(path.join(root, file), 'utf8'));
const serviceAccount = readJson('.security-staging-service-account.json');
const credentials = readJson('.security-diagnosis-accounts.json');
if (serviceAccount.project_id !== PROJECT_ID) throw new Error('Safety stop: wrong Firebase project.');
const account = credentials.accounts?.find(item => item.uid === TEST_UID);
if (!account?.login_id || !account?.password) throw new Error('Missing diagnosis account credentials.');

const app = initializeApp({ credential: cert(serviceAccount), projectId: PROJECT_ID }, `password-reset-${Date.now()}`);
const auth = getAuth(app);
const db = getFirestore(app);
const profileRef = db.collection('users').doc(TEST_UID);
const originalProfile = (await profileRef.get()).data();
if (!originalProfile?.diagnosis_test_account) throw new Error('Safety stop: target is not a diagnosis account.');

const token = crypto.randomBytes(32).toString('base64url');
const tokenHash = crypto.createHash('sha256').update(token).digest('hex');
const tokenRef = db.collection('password_reset_tokens').doc(`audit-${crypto.randomUUID()}`);
const sixCharacterPassword = 'R8!x3Q';

const browser = args => {
  const result = spawnSync('npx', ['agent-browser', '--session', SESSION, ...args], {
    cwd: root,
    encoding: 'utf8',
    stdio: ['ignore', 'pipe', 'pipe'],
  });
  if (result.status !== 0) throw new Error(`agent-browser ${args[0]} failed: ${String(result.stderr || result.stdout).trim()}`);
  return String(result.stdout || '').trim();
};

const passwordControls = () => {
  const snapshot = browser(['snapshot', '-i']);
  const textboxes = [...snapshot.matchAll(/textbox .*\[.*ref=(e\d+)\]/g)].map(match => `@${match[1]}`);
  const button = snapshot.match(/button "パスワードを変更する" \[ref=(e\d+)\]/)?.[1];
  if (textboxes.length < 2 || !button) throw new Error('Could not resolve password-reset controls.');
  return { textboxes, button: `@${button}` };
};

const restoreValue = key => Object.hasOwn(originalProfile, key) ? originalProfile[key] : FieldValue.delete();

try {
  await tokenRef.set({
    user_id: TEST_UID,
    token_hash: tokenHash,
    purpose: 'self_service',
    issued_role: 'teacher',
    requested_via: 'audit',
    recovery_owner_user_id: TEST_UID,
    expires_at: Timestamp.fromMillis(Date.now() + 30 * 60 * 1000),
    used_at: null,
    created_at: FieldValue.serverTimestamp(),
  });

  const confirmUrl = `${BASE_URL}/password-reset/confirm?token=${encodeURIComponent(token)}`;
  browser(['open', confirmUrl]);
  browser(['wait', '1500']);
  let controls = passwordControls();

  browser(['fill', controls.textboxes[0], 'R1!ab']);
  browser(['fill', controls.textboxes[1], 'R1!ab']);
  browser(['click', controls.button]);
  browser(['wait', '500']);
  if (!browser(['snapshot']).includes('パスワードは6文字以上で入力してください')) {
    throw new Error('Five-character reset password was not rejected.');
  }

  browser(['fill', controls.textboxes[0], sixCharacterPassword]);
  browser(['fill', controls.textboxes[1], sixCharacterPassword]);
  browser(['click', controls.button]);
  browser(['wait', '2500']);
  if (!browser(['snapshot']).includes('変更しました')) throw new Error('Password reset did not complete.');

  const usedToken = (await tokenRef.get()).data() || {};
  if (!usedToken.used_at || usedToken.processing_at) throw new Error('Reset token was not finalized as used.');

  browser(['open', confirmUrl]);
  browser(['wait', '1000']);
  controls = passwordControls();
  browser(['fill', controls.textboxes[0], sixCharacterPassword]);
  browser(['fill', controls.textboxes[1], sixCharacterPassword]);
  browser(['click', controls.button]);
  browser(['wait', '1000']);
  if (!browser(['snapshot']).includes('このリンクは無効または期限切れです')) {
    throw new Error('Used reset token was not rejected.');
  }

  browser(['open', `${BASE_URL}/`]);
  browser(['wait', '1000']);
  const loginSnapshot = browser(['snapshot', '-i']);
  const loginInputs = [...loginSnapshot.matchAll(/textbox .*\[.*ref=(e\d+)\]/g)].map(match => `@${match[1]}`);
  const loginButton = loginSnapshot.match(/button "ログイン" \[ref=(e\d+)\]/)?.[1];
  if (loginInputs.length < 2 || !loginButton) throw new Error('Could not resolve login controls after reset.');
  browser(['fill', loginInputs[0], account.login_id]);
  browser(['fill', loginInputs[1], sixCharacterPassword]);
  browser(['click', `@${loginButton}`]);
  browser(['wait', '3000']);
  const finalUrl = browser(['get', 'url']);
  if (!finalUrl.endsWith('/apps')) throw new Error(`Reset password login failed: ${finalUrl}`);

  console.log(JSON.stringify({
    ok: true,
    uid: TEST_UID,
    five_characters_rejected: true,
    six_characters_accepted: true,
    token_single_use: true,
    login_with_new_password: true,
  }));
} finally {
  try { browser(['close']); } catch {}
  await auth.updateUser(TEST_UID, { password: account.password, disabled: false });
  await auth.revokeRefreshTokens(TEST_UID);
  await profileRef.update({
    isFirstLogin: restoreValue('isFirstLogin'),
    initial_password: restoreValue('initial_password'),
    raw_password: restoreValue('raw_password'),
    password: restoreValue('password'),
    password_changed_at: restoreValue('password_changed_at'),
    updated_at: restoreValue('updated_at'),
  });
  await tokenRef.delete().catch(() => undefined);
}
