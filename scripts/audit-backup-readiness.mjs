import { cert, getApps, initializeApp } from 'firebase-admin/app';
import { getStorage } from 'firebase-admin/storage';

const projectId = String(process.env.NEXT_PUBLIC_FIREBASE_PROJECT_ID || '').trim();
const clientEmail = String(process.env.FIREBASE_CLIENT_EMAIL || '').trim();
const privateKey = String(process.env.FIREBASE_PRIVATE_KEY || '').replace(/^"|"$/g, '').replace(/\\n/g, '\n');
const bucketName = String(process.env.FIREBASE_STORAGE_BUCKET || process.env.NEXT_PUBLIC_FIREBASE_STORAGE_BUCKET || '')
  .replace(/^gs:\/\//, '').replace(/\/$/, '').trim();

const missing = [
  ['NEXT_PUBLIC_FIREBASE_PROJECT_ID', projectId],
  ['FIREBASE_CLIENT_EMAIL', clientEmail],
  ['FIREBASE_PRIVATE_KEY', privateKey],
  ['FIREBASE_STORAGE_BUCKET or NEXT_PUBLIC_FIREBASE_STORAGE_BUCKET', bucketName],
].filter(([, value]) => !value).map(([name]) => name);
if (missing.length) {
  console.error(`Missing environment values: ${missing.join(', ')}`);
  process.exit(2);
}

const credential = cert({ projectId, clientEmail, privateKey });
const app = getApps()[0] || initializeApp({ credential, projectId, storageBucket: bucketName });
const accessToken = (await credential.getAccessToken()).access_token;
const headers = { Authorization: `Bearer ${accessToken}` };
const encodeDatabase = encodeURIComponent('(default)');

const googleJson = async url => {
  const response = await fetch(url, { headers });
  const body = await response.json().catch(() => ({}));
  if (!response.ok) {
    const message = body?.error?.message || `HTTP ${response.status}`;
    throw new Error(`${message} (${url})`);
  }
  return body;
};

const problems = [];
const warnings = [];
let schedules = [];
let scheduleInspection = 'UNKNOWN';
let pitr = 'UNKNOWN';
let storage = {};

try {
  const result = await googleJson(`https://firestore.googleapis.com/v1/projects/${encodeURIComponent(projectId)}/databases/${encodeDatabase}/backupSchedules`);
  schedules = Array.isArray(result.backupSchedules) ? result.backupSchedules : [];
  scheduleInspection = 'OK';
  if (!schedules.length) problems.push('Firestore scheduled backup is not configured.');
  if (!schedules.some(item => item.dailyRecurrence)) warnings.push('A daily Firestore backup schedule is not configured.');
} catch (error) {
  problems.push(`Firestore backup schedule could not be inspected: ${error.message}`);
}

try {
  const database = await googleJson(`https://firestore.googleapis.com/v1/projects/${encodeURIComponent(projectId)}/databases/${encodeDatabase}`);
  pitr = String(database.pointInTimeRecoveryEnablement || 'POINT_IN_TIME_RECOVERY_DISABLED');
  if (!pitr.endsWith('_ENABLED')) warnings.push('Firestore point-in-time recovery is disabled.');
} catch (error) {
  warnings.push(`Firestore PITR could not be inspected: ${error.message}`);
}

try {
  const [metadata] = await getStorage(app).bucket(bucketName).getMetadata();
  const retentionSeconds = Number(metadata.softDeletePolicy?.retentionDurationSeconds || 0);
  storage = {
    bucket: bucketName,
    soft_delete_retention_seconds: retentionSeconds,
    versioning_enabled: metadata.versioning?.enabled === true,
    retention_period_seconds: Number(metadata.retentionPolicy?.retentionPeriod || 0),
  };
  if (retentionSeconds < 604800) problems.push('Storage soft delete retention is shorter than 7 days or disabled.');
} catch (error) {
  problems.push(`Storage protection could not be inspected: ${error.message}`);
}

console.log(JSON.stringify({
  project_id: projectId,
  database: '(default)',
  firestore: {
    schedule_inspection: scheduleInspection,
    schedule_count: scheduleInspection === 'OK' ? schedules.length : null,
    schedules: schedules.map(item => ({
      name: item.name,
      retention: item.retention,
      recurrence: item.dailyRecurrence ? 'DAILY' : item.weeklyRecurrence ? `WEEKLY:${item.weeklyRecurrence.day}` : 'UNKNOWN',
    })),
    pitr,
  },
  storage,
  problems,
  warnings,
  checked_at: new Date().toISOString(),
}, null, 2));

if (problems.length) process.exitCode = 1;
