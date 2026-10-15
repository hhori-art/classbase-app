import fs from 'node:fs';
import path from 'node:path';
import { spawnSync } from 'node:child_process';

const allowedAccounts = new Set([
  'security-master',
  'security-admin',
  'security-teacher-dedicated',
  'security-teacher-semi-dedicated',
  'security-student',
  'security-parent',
]);
const uid = String(process.argv.find(value => value.startsWith('--uid=')) || '').slice(6);
const session = String(process.argv.find(value => value.startsWith('--session=')) || '').slice(10);
if (!allowedAccounts.has(uid) || !/^[a-z0-9-]{1,40}$/.test(session)) {
  throw new Error('Use an allowed diagnosis account and a safe agent-browser session name.');
}

const credentialsPath = path.join(process.cwd(), '.security-diagnosis-accounts.json');
if (!fs.existsSync(credentialsPath)) throw new Error('Missing diagnosis account credential file.');
const accounts = JSON.parse(fs.readFileSync(credentialsPath, 'utf8')).accounts;
const account = accounts.find(item => item.uid === uid);
if (!account?.login_id || !account?.password) throw new Error(`Missing credentials for ${uid}.`);

const run = args => {
  const result = spawnSync('npx', ['agent-browser', '--session', session, ...args], {
    cwd: process.cwd(),
    encoding: 'utf8',
    stdio: ['ignore', 'pipe', 'pipe'],
  });
  if (result.status !== 0) {
    throw new Error(`agent-browser ${args[0]} failed: ${String(result.stderr || result.stdout).trim()}`);
  }
  return String(result.stdout || '').trim();
};

const snapshot = run(['snapshot', '-i']);
const textboxes = [...snapshot.matchAll(/textbox .*\[.*ref=(e\d+)\]/g)].map(match => `@${match[1]}`);
const loginButton = snapshot.match(/button "ログイン" \[ref=(e\d+)\]/)?.[1];
if (textboxes.length < 2 || !loginButton) throw new Error('Could not resolve diagnosis login form controls.');
run(['fill', textboxes[0], account.login_id]);
run(['fill', textboxes[1], account.password]);
run(['click', `@${loginButton}`]);
run(['wait', '3000']);
const url = run(['get', 'url']);
if (url.endsWith('/')) throw new Error('Diagnosis browser login did not navigate away from the login page.');
console.log(JSON.stringify({ ok: true, uid, session, url }));
