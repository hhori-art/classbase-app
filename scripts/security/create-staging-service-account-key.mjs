import fs from 'node:fs';
import path from 'node:path';
import auth from 'firebase-tools/lib/auth.js';
import requireAuthModule from 'firebase-tools/lib/requireAuth.js';
import apiv2 from 'firebase-tools/lib/apiv2.js';

const projectId = 'classbase-security-diagnosis';
const serviceAccountEmail = `firebase-adminsdk-fbsvc@${projectId}.iam.gserviceaccount.com`;
const outputPath = path.join(process.cwd(), '.security-staging-service-account.json');

if (fs.existsSync(outputPath)) {
  const existing = JSON.parse(fs.readFileSync(outputPath, 'utf8'));
  if (existing.project_id !== projectId || existing.client_email !== serviceAccountEmail || !existing.private_key) {
    throw new Error('Safety stop: existing staging key file does not match the diagnosis project.');
  }
  fs.chmodSync(outputPath, 0o600);
  console.log('Diagnosis service-account key already exists locally; no new key was created.');
  process.exit(0);
}

const account = auth.getGlobalDefaultAccount();
if (!account) throw new Error('Firebase CLI is not logged in.');
const options = { project: projectId, ...account };
await requireAuthModule.requireAuth(options);

const client = new apiv2.Client({ urlPrefix: 'https://iam.googleapis.com', apiVersion: 'v1' });
const encodedEmail = encodeURIComponent(serviceAccountEmail);
const response = await client.post(
  `/projects/${projectId}/serviceAccounts/${encodedEmail}/keys`,
  { privateKeyType: 'TYPE_GOOGLE_CREDENTIALS_FILE', keyAlgorithm: 'KEY_ALG_RSA_2048' },
);
const privateKeyData = response.body?.privateKeyData;
if (!privateKeyData) throw new Error('IAM did not return privateKeyData.');

const decoded = Buffer.from(privateKeyData, 'base64').toString('utf8');
const key = JSON.parse(decoded);
if (key.project_id !== projectId || key.client_email !== serviceAccountEmail || !key.private_key) {
  throw new Error('Safety stop: generated key does not match the diagnosis project.');
}

fs.writeFileSync(outputPath, `${JSON.stringify(key, null, 2)}\n`, { mode: 0o600 });
fs.chmodSync(outputPath, 0o600);
console.log('Created one diagnosis-only service-account key and stored it locally with mode 600.');
