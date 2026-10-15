import { spawn } from 'node:child_process';

const npmCommand = process.platform === 'win32' ? 'npm.cmd' : 'npm';
const suites = ['security:static', 'security:rules'];
let hasFailure = false;

for (const suite of suites) {
  const exitCode = await new Promise((resolve, reject) => {
    const child = spawn(npmCommand, ['run', suite], {
      stdio: 'inherit',
      env: process.env,
    });

    child.once('error', reject);
    child.once('exit', (code) => resolve(code ?? 1));
  });

  if (exitCode !== 0) {
    hasFailure = true;
  }
}

process.exitCode = hasFailure ? 1 : 0;
