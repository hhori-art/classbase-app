import fs from 'node:fs';
import path from 'node:path';
import { GoogleAuth } from 'google-auth-library';

const root = process.cwd();
const parseEnv = text => Object.fromEntries(text.split(/\r?\n/).flatMap(line => {
  const match = line.match(/^([A-Z0-9_]+)=(.*)$/);
  if (!match) return [];
  let value = match[2].trim();
  if ((value.startsWith('"') && value.endsWith('"')) || (value.startsWith("'") && value.endsWith("'"))) value = value.slice(1, -1);
  return [[match[1], value.replace(/\\n/g, '\n')]];
}));

const args = Object.fromEntries(process.argv.slice(2).map(argument => {
  const [key, ...value] = argument.replace(/^--/, '').split('=');
  return [key, value.join('=')];
}));
const target = args.target;
const confirmedProject = args['confirm-project'];
if (!['diagnosis', 'production'].includes(target)) throw new Error('Use --target=diagnosis or --target=production.');

const env = parseEnv(fs.readFileSync(path.join(root, '.env.local'), 'utf8'));
const diagnosisProject = 'classbase-security-diagnosis';
const productionProject = env.NEXT_PUBLIC_FIREBASE_PROJECT_ID;
const projectId = target === 'diagnosis' ? diagnosisProject : productionProject;
if (!projectId || confirmedProject !== projectId) throw new Error(`Safety stop: pass --confirm-project=${projectId}.`);

const credentials = target === 'diagnosis'
  ? JSON.parse(fs.readFileSync(path.join(root, '.security-staging-service-account.json'), 'utf8'))
  : { project_id: projectId, client_email: env.FIREBASE_CLIENT_EMAIL, private_key: env.FIREBASE_PRIVATE_KEY };
if (credentials.project_id !== projectId || !credentials.client_email || !credentials.private_key) {
  throw new Error(`Safety stop: credentials do not match ${projectId}.`);
}

const bucket = target === 'diagnosis'
  ? `${diagnosisProject}.firebasestorage.app`
  : env.NEXT_PUBLIC_FIREBASE_STORAGE_BUCKET;
if (!bucket) throw new Error('Storage bucket is missing.');

const auth = new GoogleAuth({ credentials, scopes: ['https://www.googleapis.com/auth/firebase'] });
const client = await auth.getClient();
const releaseNames = ['cloud.firestore', `firebase.storage/${bucket}`];
const sources = [
  { name: 'firestore.rules', content: fs.readFileSync(path.join(root, 'firestore.rules'), 'utf8') },
  { name: 'storage.rules', content: fs.readFileSync(path.join(root, 'storage.rules'), 'utf8') },
];

const previous = new Map();
for (const releaseName of releaseNames) {
  const response = await client.request({ url: `https://firebaserules.googleapis.com/v1/projects/${projectId}/releases/${releaseName}` });
  if (!response.data?.rulesetName) throw new Error(`Existing release is missing: ${releaseName}`);
  previous.set(releaseName, response.data.rulesetName);
}

const next = [];
for (const source of sources) {
  const response = await client.request({
    url: `https://firebaserules.googleapis.com/v1/projects/${projectId}/rulesets`,
    method: 'POST',
    data: { source: { files: [source] } },
  });
  if (!response.data?.name) throw new Error(`Ruleset creation failed: ${source.name}`);
  next.push(response.data.name);
}

const updateRelease = async (releaseName, rulesetName) => client.request({
  url: `https://firebaserules.googleapis.com/v1/projects/${projectId}/releases/${releaseName}`,
  method: 'PATCH',
  data: {
    release: { name: `projects/${projectId}/releases/${releaseName}`, rulesetName },
    updateMask: 'rulesetName',
  },
});

const updated = [];
try {
  for (let index = 0; index < releaseNames.length; index += 1) {
    await updateRelease(releaseNames[index], next[index]);
    updated.push(releaseNames[index]);
  }
} catch (error) {
  for (const releaseName of updated.reverse()) {
    await updateRelease(releaseName, previous.get(releaseName)).catch(() => undefined);
  }
  throw error;
}

console.log(JSON.stringify({
  status: 'deployed',
  target,
  project_id: projectId,
  releases: releaseNames,
  rollback_rulesets: Object.fromEntries(previous),
}, null, 2));
