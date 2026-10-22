// Starts the local security app (next dev on 127.0.0.1:3100 against the Firebase emulators)
// for visual QA, while guaranteeing that no production secret from .env* files is loaded.
//
// Next.js only loads a value from .env.local when the key is *undefined* in the initial
// process env. We therefore read only the KEY NAMES from .env* files (values are never
// read into variables or printed) and define each one as an empty string, except the
// emulator/demo values that run-security-app.mjs sets explicitly afterwards.
import fs from 'node:fs';
import path from 'node:path';
import crypto from 'node:crypto';
import { spawn } from 'node:child_process';

const root = process.cwd();
const envFiles = ['.env', '.env.local', '.env.development', '.env.development.local'];
const blanked = new Set([
  // Known server secrets / production credentials (blanked even if not present in .env files).
  'FIREBASE_CLIENT_EMAIL', 'FIREBASE_PRIVATE_KEY', 'FIREBASE_STORAGE_BUCKET', 'GOOGLE_APPLICATION_CREDENTIALS',
  'OPENAI_API_KEY', 'SECRET_KEY', 'VERCEL_OIDC_TOKEN',
  'LINE_CHANNEL_ACCESS_TOKEN', 'LINE_LOGIN_CHANNEL_ID', 'LINE_LOGIN_CHANNEL_SECRET',
  'ZOOM_ACCOUNT_ID', 'ZOOM_CLIENT_ID', 'ZOOM_CLIENT_SECRET',
]);
for (const file of envFiles) {
  const full = path.join(root, file);
  if (!fs.existsSync(full)) continue;
  for (const line of fs.readFileSync(full, 'utf8').split(/\r?\n/)) {
    const match = /^\s*(?:export\s+)?([A-Za-z_][A-Za-z0-9_]*)\s*=/.exec(line);
    if (match) blanked.add(match[1]);
  }
}

const env = { ...process.env };
for (const key of blanked) env[key] = '';
// run-security-app.mjs re-sets NEXT_PUBLIC_* demo values, emulator hosts, SECURITY_DIAGNOSIS_MODE and ALLOWED_IPS.
env.VISUAL_QA = 'true';
// Signed-token features fall back to FIREBASE_PRIVATE_KEY (blanked above). Give them throwaway
// per-process secrets so class join / course registration / transfer flows work locally.
for (const key of ['CLASS_PARTICIPATION_TOKEN_SECRET', 'COURSE_REGISTRATION_TOKEN_SECRET', 'TRANSFER_OPTION_TOKEN_SECRET']) {
  env[key] = `visual-qa-local-${crypto.randomBytes(24).toString('hex')}`;
}

if (env.FIREBASE_PRIVATE_KEY || env.OPENAI_API_KEY) {
  console.error('Safety stop: production credentials are still present in the QA app environment.');
  process.exit(1);
}

console.log(`[visual-qa] blanked ${blanked.size} env keys from .env* files for the QA dev server`);
const child = spawn(process.execPath, [path.join(root, 'scripts', 'security', 'run-security-app.mjs')], {
  cwd: root, env, stdio: 'inherit',
});
for (const signal of ['SIGINT', 'SIGTERM']) process.on(signal, () => child.kill(signal));
child.on('exit', code => process.exit(code ?? 1));
