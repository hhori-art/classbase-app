import path from 'node:path';
import { spawn } from 'node:child_process';

const projectId = 'demo-classbase-security';
const env = {
  ...process.env,
  NEXT_PUBLIC_USE_FIREBASE_EMULATORS: 'true',
  NEXT_PUBLIC_FIREBASE_PROJECT_ID: projectId,
  NEXT_PUBLIC_FIREBASE_API_KEY: 'demo-security-api-key',
  NEXT_PUBLIC_FIREBASE_AUTH_DOMAIN: `${projectId}.firebaseapp.com`,
  NEXT_PUBLIC_FIREBASE_STORAGE_BUCKET: `${projectId}.appspot.com`,
  NEXT_PUBLIC_FIREBASE_MESSAGING_SENDER_ID: '000000000000',
  NEXT_PUBLIC_FIREBASE_APP_ID: '1:000000000000:web:security-test',
  NEXT_PUBLIC_FIREBASE_AUTH_EMULATOR_HOST: '127.0.0.1',
  NEXT_PUBLIC_FIREBASE_AUTH_EMULATOR_PORT: '9099',
  NEXT_PUBLIC_FIRESTORE_EMULATOR_HOST: '127.0.0.1',
  NEXT_PUBLIC_FIRESTORE_EMULATOR_PORT: '8085',
  NEXT_PUBLIC_FIREBASE_STORAGE_EMULATOR_HOST: '127.0.0.1',
  NEXT_PUBLIC_FIREBASE_STORAGE_EMULATOR_PORT: '9199',
  GCLOUD_PROJECT: projectId,
  FIREBASE_AUTH_EMULATOR_HOST: '127.0.0.1:9099',
  FIRESTORE_EMULATOR_HOST: '127.0.0.1:8085',
  FIREBASE_STORAGE_EMULATOR_HOST: '127.0.0.1:9199',
  SECURITY_DIAGNOSIS_MODE: 'true',
  ALLOWED_IPS: '113.37.16.194,124.33.127.18',
};

const nextBin = path.join(process.cwd(), 'node_modules', '.bin', 'next');
const child = spawn(nextBin, ['dev', '--hostname', '127.0.0.1', '--port', '3100'], {
  cwd: process.cwd(), env, stdio: 'inherit',
});
for (const signal of ['SIGINT', 'SIGTERM']) process.on(signal, () => child.kill(signal));
child.on('exit', code => process.exit(code ?? 1));
