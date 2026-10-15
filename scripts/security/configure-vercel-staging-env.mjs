import fs from 'node:fs';
import path from 'node:path';
import { spawn } from 'node:child_process';

const project = 'classbase-security-diagnosis';
const keyPath = path.join(process.cwd(), '.security-staging-service-account.json');
if (!fs.existsSync(keyPath)) throw new Error('Missing diagnosis service-account key.');
const serviceAccount = JSON.parse(fs.readFileSync(keyPath, 'utf8'));
if (serviceAccount.project_id !== project || !serviceAccount.private_key) {
  throw new Error('Safety stop: service-account key is not for the diagnosis project.');
}

const values = {
  SECURITY_DIAGNOSIS_MODE: 'true',
  NEXT_PUBLIC_SECURITY_DIAGNOSIS_MODE: 'true',
  ALLOWED_IPS: '113.37.16.194,124.33.127.18,42.125.227.70',
  NEXT_PUBLIC_USE_FIREBASE_EMULATORS: 'false',
  NEXT_PUBLIC_FIREBASE_PROJECT_ID: project,
  NEXT_PUBLIC_FIREBASE_API_KEY: 'AIzaSyC_hssQ63wvHD8GJ2A8zsEUo8-rKuuz4Yg',
  NEXT_PUBLIC_FIREBASE_AUTH_DOMAIN: `${project}.firebaseapp.com`,
  NEXT_PUBLIC_FIREBASE_STORAGE_BUCKET: `${project}.firebasestorage.app`,
  NEXT_PUBLIC_FIREBASE_MESSAGING_SENDER_ID: '36077111985',
  NEXT_PUBLIC_FIREBASE_APP_ID: '1:36077111985:web:51e81a74189ef74408f090',
  FIREBASE_CLIENT_EMAIL: serviceAccount.client_email,
  FIREBASE_PRIVATE_KEY: serviceAccount.private_key,
  FIREBASE_STORAGE_BUCKET: `${project}.firebasestorage.app`,
  PASSWORD_RECOVERY_BASE_URL: 'https://classbase-security-diagnosis.vercel.app',
};
const sensitive = new Set(['FIREBASE_CLIENT_EMAIL', 'FIREBASE_PRIVATE_KEY']);
const npxBin = process.platform === 'win32' ? 'npx.cmd' : 'npx';

function addEnv(name, value) {
  return new Promise((resolve, reject) => {
    const args = ['--yes', 'vercel@59.7.0', 'env', 'add', name, 'production', '--project', project, '--force', '--yes', sensitive.has(name) ? '--sensitive' : '--no-sensitive'];
    const child = spawn(npxBin, args, { cwd: process.cwd(), stdio: ['pipe', 'inherit', 'inherit'] });
    child.stdin.end(`${value}\n`);
    child.once('error', reject);
    child.once('exit', code => code === 0 ? resolve() : reject(new Error(`vercel env add failed for ${name}`)));
  });
}

for (const [name, value] of Object.entries(values)) await addEnv(name, value);
console.log(`Configured ${Object.keys(values).length} production environment variables on ${project}.`);
