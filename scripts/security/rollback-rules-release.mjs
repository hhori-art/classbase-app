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
const env = parseEnv(fs.readFileSync(path.join(root, '.env.local'), 'utf8'));
const projectId = env.NEXT_PUBLIC_FIREBASE_PROJECT_ID;
const bucket = env.NEXT_PUBLIC_FIREBASE_STORAGE_BUCKET;
if (!projectId || args['confirm-project'] !== projectId || !bucket) {
  throw new Error(`Safety stop: pass --confirm-project=${projectId || '<production-project>'}.`);
}
const firestoreRuleset = args.firestore;
const storageRuleset = args.storage;
const expectedPrefix = `projects/${projectId}/rulesets/`;
if (!firestoreRuleset?.startsWith(expectedPrefix) || !storageRuleset?.startsWith(expectedPrefix)) {
  throw new Error('Both --firestore and --storage must be rulesets from the confirmed production project.');
}
const credentials = { project_id: projectId, client_email: env.FIREBASE_CLIENT_EMAIL, private_key: env.FIREBASE_PRIVATE_KEY };
if (!credentials.client_email || !credentials.private_key) throw new Error('Production credentials are missing.');
const auth = new GoogleAuth({ credentials, scopes: ['https://www.googleapis.com/auth/firebase'] });
const client = await auth.getClient();
const releases = [
  ['cloud.firestore', firestoreRuleset],
  [`firebase.storage/${bucket}`, storageRuleset],
];
for (const [releaseName, rulesetName] of releases) {
  await client.request({
    url: `https://firebaserules.googleapis.com/v1/projects/${projectId}/releases/${releaseName}`,
    method: 'PATCH',
    data: { release: { name: `projects/${projectId}/releases/${releaseName}`, rulesetName }, updateMask: 'rulesetName' },
  });
}
console.log(JSON.stringify({ status: 'rolled_back', project_id: projectId, releases: Object.fromEntries(releases) }, null, 2));
