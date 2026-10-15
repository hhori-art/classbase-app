import fs from 'node:fs';
import path from 'node:path';
import { spawnSync } from 'node:child_process';
import { cert, initializeApp } from 'firebase-admin/app';
import { getAuth } from 'firebase-admin/auth';
import { FieldValue, getFirestore } from 'firebase-admin/firestore';

const PROJECT_ID = 'classbase-security-diagnosis';
const BASE_URL = 'https://classbase-security-diagnosis.vercel.app';
const API_KEY = 'AIzaSyC_hssQ63wvHD8GJ2A8zsEUo8-rKuuz4Yg';
const TARGET_UID = 'security-teacher-semi-dedicated';
const SESSION = 'audit-account-status';
const root = process.cwd();

const readJson = file => JSON.parse(fs.readFileSync(path.join(root, file), 'utf8'));
const serviceAccount = readJson('.security-staging-service-account.json');
const accounts = readJson('.security-diagnosis-accounts.json').accounts || [];
if (serviceAccount.project_id !== PROJECT_ID) throw new Error('Safety stop: wrong Firebase project.');
const accountByUid = new Map(accounts.map(account => [account.uid, account]));
const master = accountByUid.get('security-master');
const target = accountByUid.get(TARGET_UID);
if (!master?.email || !master?.password || !target?.email || !target?.password) throw new Error('Missing diagnosis credentials.');

const app = initializeApp({ credential: cert(serviceAccount), projectId: PROJECT_ID }, `account-status-${Date.now()}`);
const auth = getAuth(app);
const db = getFirestore(app);
const profileRef = db.collection('users').doc(TARGET_UID);
const originalProfile = (await profileRef.get()).data();
const originalAuth = await auth.getUser(TARGET_UID);
if (!originalProfile?.diagnosis_test_account) throw new Error('Safety stop: target is not a diagnosis account.');

const browser = args => {
  const result = spawnSync('npx', ['agent-browser', '--session', SESSION, ...args], {
    cwd: root,
    encoding: 'utf8',
    stdio: ['ignore', 'pipe', 'pipe'],
  });
  if (result.status !== 0) throw new Error(`agent-browser ${args[0]} failed: ${String(result.stderr || result.stdout).trim()}`);
  return String(result.stdout || '').trim();
};

async function signIn(account, expectDisabled = false) {
  const response = await fetch(`https://identitytoolkit.googleapis.com/v1/accounts:signInWithPassword?key=${API_KEY}`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ email: account.email, password: account.password, returnSecureToken: true }),
  });
  const body = await response.json().catch(() => ({}));
  if (expectDisabled) {
    if (response.ok || body?.error?.message !== 'USER_DISABLED') throw new Error('Suspended Auth account was not rejected as USER_DISABLED.');
    return '';
  }
  if (!response.ok || !body.idToken) throw new Error(`Authentication failed: ${body?.error?.message || response.status}`);
  return body.idToken;
}

async function setStatus(masterToken, status) {
  const response = await fetch(`${BASE_URL}/api/admin/accounts/status`, {
    method: 'POST',
    headers: { Authorization: `Bearer ${masterToken}`, 'Content-Type': 'application/json' },
    body: JSON.stringify({ user_id: TARGET_UID, status }),
  });
  const body = await response.json().catch(() => ({}));
  if (!response.ok || body.ok === false) throw new Error(`Status ${status} failed: ${response.status} ${body.error || ''}`);
}

const restoreValue = key => Object.hasOwn(originalProfile, key) ? originalProfile[key] : FieldValue.delete();

try {
  const masterToken = await signIn(master);
  const oldTargetToken = await signIn(target);
  await setStatus(masterToken, 'suspended');

  if (!(await auth.getUser(TARGET_UID)).disabled) throw new Error('Firebase Auth was not disabled.');
  const oldSessionResponse = await fetch(`${BASE_URL}/api/apps`, {
    headers: { Authorization: `Bearer ${oldTargetToken}` },
  });
  if (![401, 403].includes(oldSessionResponse.status)) {
    const oldSessionBody = await oldSessionResponse.json().catch(() => ({}));
    throw new Error(`Old session rejection used the wrong status: ${oldSessionResponse.status} ${oldSessionBody.error || ''}`);
  }
  await signIn(target, true);

  browser(['open', `${BASE_URL}/`]);
  const loginSnapshot = browser(['snapshot', '-i']);
  const inputs = [...loginSnapshot.matchAll(/textbox .*\[.*ref=(e\d+)\]/g)].map(match => `@${match[1]}`);
  const loginButton = loginSnapshot.match(/button "ログイン" \[ref=(e\d+)\]/)?.[1];
  if (inputs.length < 2 || !loginButton) throw new Error('Could not resolve login controls.');
  browser(['fill', inputs[0], target.login_id]);
  browser(['fill', inputs[1], target.password]);
  browser(['click', `@${loginButton}`]);
  browser(['wait', '1500']);
  const suspendedScreen = browser(['snapshot']);
  if (!suspendedScreen.includes('このアカウントは停止中です')) throw new Error('Suspended account message was not shown in Japanese.');
  if (browser(['get', 'url']) !== `${BASE_URL}/`) throw new Error('Suspended account left the login page.');

  await setStatus(masterToken, 'active');
  if ((await auth.getUser(TARGET_UID)).disabled) throw new Error('Firebase Auth was not re-enabled.');
  const restoredToken = await signIn(target);
  const restoredApps = await fetch(`${BASE_URL}/api/apps`, { headers: { Authorization: `Bearer ${restoredToken}` } });
  if (!restoredApps.ok) throw new Error(`Restored account API failed: ${restoredApps.status}`);

  browser(['reload']);
  browser(['wait', '500']);
  const restoredLoginSnapshot = browser(['snapshot', '-i']);
  const restoredInputs = [...restoredLoginSnapshot.matchAll(/textbox .*\[.*ref=(e\d+)\]/g)].map(match => `@${match[1]}`);
  const restoredButton = restoredLoginSnapshot.match(/button "ログイン" \[ref=(e\d+)\]/)?.[1];
  browser(['fill', restoredInputs[0], target.login_id]);
  browser(['fill', restoredInputs[1], target.password]);
  browser(['click', `@${restoredButton}`]);
  browser(['wait', '2500']);
  if (!browser(['get', 'url']).endsWith('/apps')) throw new Error('Restored account did not reach /apps.');

  console.log(JSON.stringify({
    ok: true,
    auth_disabled_on_suspend: true,
    old_session_rejected: true,
    japanese_message: true,
    auth_enabled_on_restore: true,
    restored_login: true,
  }));
} finally {
  try { browser(['close']); } catch {}
  await auth.updateUser(TARGET_UID, { disabled: originalAuth.disabled });
  await auth.revokeRefreshTokens(TARGET_UID);
  await profileRef.update({
    account_status: restoreValue('account_status'),
    status: restoreValue('status'),
    suspended_at: restoreValue('suspended_at'),
    withdrawn_at: restoreValue('withdrawn_at'),
    archived_at: restoreValue('archived_at'),
    restored_at: restoreValue('restored_at'),
    restored_by: restoreValue('restored_by'),
    updated_at: restoreValue('updated_at'),
    updated_by: restoreValue('updated_by'),
  });
}
