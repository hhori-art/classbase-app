import fs from 'node:fs';
import path from 'node:path';
import { spawn } from 'node:child_process';

const mode = process.argv[2] === 'start' ? 'start' : 'exec';
const root = process.cwd();
const localJavaHome = path.join(root, '.security-tools', 'jdk-21', 'Contents', 'Home');
const localJava = path.join(localJavaHome, 'bin', 'java');

if (!fs.existsSync(localJava)) {
  console.error('Local Java runtime is missing. Run: npm run security:setup');
  process.exit(1);
}

const firebaseBin = path.join(root, 'node_modules', '.bin', 'firebase');
const commonArgs = [
  'emulators:' + mode,
  '--config', 'firebase.security.json',
  '--project', 'demo-classbase-security',
  '--only', mode === 'start' ? 'auth,firestore,storage' : 'firestore,storage',
];
const emulatorDataDir = path.join(root, '.security-emulator-data');
if (mode === 'start') {
  if (fs.existsSync(emulatorDataDir)) commonArgs.push('--import', emulatorDataDir);
  commonArgs.push('--export-on-exit', emulatorDataDir);
}
if (mode === 'exec') {
  commonArgs.push('node --test --test-concurrency=1 tests/security/firestore.rules.test.mjs tests/security/storage.rules.test.mjs');
}

const child = spawn(firebaseBin, commonArgs, {
  cwd: root,
  stdio: 'inherit',
  env: {
    ...process.env,
    JAVA_HOME: localJavaHome,
    PATH: `${path.join(localJavaHome, 'bin')}${path.delimiter}${process.env.PATH || ''}`,
    GCLOUD_PROJECT: 'demo-classbase-security',
  },
});

for (const signal of ['SIGINT', 'SIGTERM']) {
  process.on(signal, () => child.kill(signal));
}
child.on('exit', code => process.exit(code ?? 1));
