import fs from 'node:fs';
import path from 'node:path';
import { spawn } from 'node:child_process';

const PROJECT_ID = 'classbase-security-diagnosis';
const root = process.cwd();
process.loadEnvFile(path.join(root, '.env.local'));
const serviceAccount = JSON.parse(fs.readFileSync(path.join(root, '.security-staging-service-account.json'), 'utf8'));
if (serviceAccount.project_id !== PROJECT_ID || !serviceAccount.private_key) {
  throw new Error('Safety stop: service-account key is not for the diagnosis project.');
}
for (const name of ['FIREBASE_AUTH_EMULATOR_HOST', 'FIRESTORE_EMULATOR_HOST', 'FIREBASE_STORAGE_EMULATOR_HOST']) delete process.env[name];

const env = {
  ...process.env,
  SECURITY_DIAGNOSIS_MODE: 'true',
  NEXT_PUBLIC_SECURITY_DIAGNOSIS_MODE: 'true',
  NEXT_PUBLIC_USE_FIREBASE_EMULATORS: 'false',
  NEXT_PUBLIC_FIREBASE_PROJECT_ID: PROJECT_ID,
  NEXT_PUBLIC_FIREBASE_API_KEY: 'AIzaSyC_hssQ63wvHD8GJ2A8zsEUo8-rKuuz4Yg',
  NEXT_PUBLIC_FIREBASE_AUTH_DOMAIN: `${PROJECT_ID}.firebaseapp.com`,
  NEXT_PUBLIC_FIREBASE_STORAGE_BUCKET: `${PROJECT_ID}.firebasestorage.app`,
  NEXT_PUBLIC_FIREBASE_MESSAGING_SENDER_ID: '36077111985',
  NEXT_PUBLIC_FIREBASE_APP_ID: '1:36077111985:web:51e81a74189ef74408f090',
  FIREBASE_CLIENT_EMAIL: serviceAccount.client_email,
  FIREBASE_PRIVATE_KEY: serviceAccount.private_key,
  FIREBASE_STORAGE_BUCKET: `${PROJECT_ID}.firebasestorage.app`,
};

const nextBin = path.join(root, 'node_modules', '.bin', 'next');
const child = spawn(nextBin, ['dev', '--hostname', '127.0.0.1', '--port', '3200'], { cwd: root, env, stdio: 'inherit' });
for (const signal of ['SIGINT', 'SIGTERM']) process.on(signal, () => child.kill(signal));
child.on('exit', code => process.exit(code ?? 1));
