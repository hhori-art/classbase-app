import fs from 'node:fs';
import path from 'node:path';
import { GoogleAuth } from 'google-auth-library';

const root = process.cwd();
const parseEnv = (text) => Object.fromEntries(text.split(/\r?\n/).flatMap(line => {
  const match = line.match(/^([A-Z0-9_]+)=(.*)$/);
  if (!match) return [];
  let value = match[2].trim();
  if ((value.startsWith('"') && value.endsWith('"')) || (value.startsWith("'") && value.endsWith("'"))) value = value.slice(1, -1);
  return [[match[1], value.replace(/\\n/g, '\n')]];
}));

const env = parseEnv(fs.readFileSync(path.join(root, '.env.local'), 'utf8'));
const diagnosisCredentials = JSON.parse(fs.readFileSync(path.join(root, '.security-staging-service-account.json'), 'utf8'));
const productionProject = env.NEXT_PUBLIC_FIREBASE_PROJECT_ID;
const diagnosisProject = 'classbase-security-diagnosis';
if (!productionProject || productionProject === diagnosisProject) throw new Error('Safety stop: production project is invalid.');
if (diagnosisCredentials.project_id !== diagnosisProject) throw new Error('Safety stop: diagnosis key is invalid.');

const productionCredentials = {
  project_id: productionProject,
  client_email: env.FIREBASE_CLIENT_EMAIL,
  private_key: env.FIREBASE_PRIVATE_KEY,
};
const authClient = async credentials => {
  const auth = new GoogleAuth({ credentials, scopes: ['https://www.googleapis.com/auth/firebase'] });
  return auth.getClient();
};
const productionClient = await authClient(productionCredentials);
const diagnosisClient = await authClient(diagnosisCredentials);

async function getRulesSource(projectId, client, releaseName) {
  const release = await client.request({
    url: `https://firebaserules.googleapis.com/v1/projects/${projectId}/releases/${releaseName}`,
  });
  const rulesetName = release.data?.rulesetName;
  if (!rulesetName) throw new Error(`Ruleset is missing for ${projectId}/${releaseName}.`);
  const ruleset = await client.request({ url: `https://firebaserules.googleapis.com/v1/${rulesetName}` });
  const files = ruleset.data?.source?.files;
  if (!Array.isArray(files) || files.length === 0) throw new Error(`Rule source is empty for ${releaseName}.`);
  return files.map(file => ({ name: file.name, content: file.content }));
}

async function replaceDiagnosisRelease(productionRelease, diagnosisRelease) {
  const files = await getRulesSource(productionProject, productionClient, productionRelease);
  const created = await diagnosisClient.request({
    url: `https://firebaserules.googleapis.com/v1/projects/${diagnosisProject}/rulesets`,
    method: 'POST',
    data: { source: { files } },
  });
  const rulesetName = created.data?.name;
  if (!rulesetName) throw new Error(`Failed to create diagnosis ruleset for ${diagnosisRelease}.`);
  await diagnosisClient.request({
    url: `https://firebaserules.googleapis.com/v1/projects/${diagnosisProject}/releases/${diagnosisRelease}`,
    method: 'PATCH',
    data: {
      release: {
        name: `projects/${diagnosisProject}/releases/${diagnosisRelease}`,
        rulesetName,
      },
      updateMask: 'rulesetName',
    },
  });
}

await replaceDiagnosisRelease('cloud.firestore', 'cloud.firestore');
await replaceDiagnosisRelease(
  `firebase.storage/${env.NEXT_PUBLIC_FIREBASE_STORAGE_BUCKET}`,
  `firebase.storage/${diagnosisProject}.firebasestorage.app`,
);
console.log(`Synchronized production Firestore and Storage rules to ${diagnosisProject}.`);
