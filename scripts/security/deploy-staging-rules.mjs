import fs from 'node:fs';
import path from 'node:path';
import { GoogleAuth } from 'google-auth-library';

const root = process.cwd();
const projectId = 'classbase-security-diagnosis';
const keyPath = path.join(root, '.security-staging-service-account.json');

if (!fs.existsSync(keyPath)) throw new Error('Missing diagnosis service-account key.');
const credentials = JSON.parse(fs.readFileSync(keyPath, 'utf8'));
if (credentials.project_id !== projectId) {
  throw new Error(`Safety stop: expected ${projectId}, received ${credentials.project_id || 'unknown'}.`);
}

const auth = new GoogleAuth({
  credentials,
  scopes: ['https://www.googleapis.com/auth/firebase'],
});
const client = await auth.getClient();

async function deployRule(localFile, releaseName) {
  const content = fs.readFileSync(path.join(root, localFile), 'utf8');
  const created = await client.request({
    url: `https://firebaserules.googleapis.com/v1/projects/${projectId}/rulesets`,
    method: 'POST',
    data: { source: { files: [{ name: localFile, content }] } },
  });
  const rulesetName = created.data?.name;
  if (!rulesetName) throw new Error(`Ruleset creation failed for ${localFile}.`);

  await client.request({
    url: `https://firebaserules.googleapis.com/v1/projects/${projectId}/releases/${releaseName}`,
    method: 'PATCH',
    data: {
      release: {
        name: `projects/${projectId}/releases/${releaseName}`,
        rulesetName,
      },
      updateMask: 'rulesetName',
    },
  });
}

await deployRule('firestore.rules', 'cloud.firestore');
await deployRule('storage.rules', `firebase.storage/${projectId}.firebasestorage.app`);
console.log(`Deployed local Firestore and Storage rules to ${projectId}.`);
