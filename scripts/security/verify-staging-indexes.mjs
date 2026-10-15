import fs from 'node:fs';
import path from 'node:path';
import { GoogleAuth } from 'google-auth-library';

const projectId = 'classbase-security-diagnosis';
const keyPath = path.join(process.cwd(), '.security-staging-service-account.json');
const credentials = JSON.parse(fs.readFileSync(keyPath, 'utf8'));
if (credentials.project_id !== projectId) throw new Error('Safety stop: wrong Firebase project.');
const auth = new GoogleAuth({ credentials, scopes: ['https://www.googleapis.com/auth/datastore'] });
const client = await auth.getClient();
const response = await client.request({
  url: `https://firestore.googleapis.com/v1/projects/${projectId}/databases/(default)/collectionGroups/-/indexes`,
});
const indexes = Array.isArray(response.data?.indexes) ? response.data.indexes : [];
const required = new Set(['homework_assignments','community_topics','teacher_community_topics','quest_results','coin_transactions','teacher_availability','learning_units','chat_logs']);
const relevant = indexes.filter(index => required.has(String(index.name || '').split('/collectionGroups/')[1]?.split('/')[0]));
const states = relevant.reduce((summary, index) => {
  summary[index.state || 'UNKNOWN'] = (summary[index.state || 'UNKNOWN'] || 0) + 1;
  return summary;
}, {});
if (relevant.length < 10 || relevant.some(index => index.state !== 'READY')) {
  throw new Error(`Diagnosis indexes are not ready: ${JSON.stringify(states)}`);
}
console.log(`Diagnosis indexes verified: ${JSON.stringify(states)}`);
