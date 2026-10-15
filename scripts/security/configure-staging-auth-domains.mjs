import fs from 'node:fs';
import path from 'node:path';
import { GoogleAuth } from 'google-auth-library';

const projectId = process.env.SECURITY_STAGING_FIREBASE_PROJECT_ID || 'classbase-security-diagnosis';
const keyPath = path.resolve(
  process.env.SECURITY_STAGING_SERVICE_ACCOUNT_PATH || '.security-staging-service-account.json',
);
const diagnosisDomain = process.env.SECURITY_STAGING_AUTH_DOMAIN || 'classbase-security-diagnosis.vercel.app';

if (!fs.existsSync(keyPath)) {
  throw new Error(`Service account key not found: ${keyPath}`);
}

const credentials = JSON.parse(fs.readFileSync(keyPath, 'utf8'));
if (credentials.project_id !== projectId) {
  throw new Error(`Service account project mismatch: expected ${projectId}`);
}

const auth = new GoogleAuth({
  credentials,
  scopes: ['https://www.googleapis.com/auth/cloud-platform'],
});
const client = await auth.getClient();
const configUrl = `https://identitytoolkit.googleapis.com/admin/v2/projects/${projectId}/config`;
const current = await client.request({ url: configUrl, method: 'GET' });
const currentDomains = Array.isArray(current.data?.authorizedDomains)
  ? current.data.authorizedDomains
  : [];
const authorizedDomains = [...new Set([...currentDomains, diagnosisDomain])].sort();

if (!currentDomains.includes(diagnosisDomain)) {
  await client.request({
    url: `${configUrl}?updateMask=authorizedDomains`,
    method: 'PATCH',
    data: { authorizedDomains },
  });
}

console.log(JSON.stringify({ projectId, authorizedDomains }, null, 2));
