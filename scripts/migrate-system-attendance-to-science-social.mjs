import { readFileSync } from 'node:fs';
import { cert, getApps, initializeApp } from 'firebase-admin/app';
import { FieldPath, FieldValue, getFirestore } from 'firebase-admin/firestore';

const envText = readFileSync('.env.local', 'utf8');
envText.split(/\r?\n/).forEach(line => {
  const trimmed = line.trim();
  if (!trimmed || trimmed.startsWith('#')) return;
  const separator = trimmed.indexOf('=');
  if (separator < 1) return;
  const key = trimmed.slice(0, separator).trim();
  let value = trimmed.slice(separator + 1).trim();
  if ((value.startsWith('"') && value.endsWith('"')) || (value.startsWith("'") && value.endsWith("'"))) value = value.slice(1, -1);
  if (process.env[key] === undefined) process.env[key] = value;
});

const projectId = process.env.NEXT_PUBLIC_FIREBASE_PROJECT_ID;
const clientEmail = process.env.FIREBASE_CLIENT_EMAIL;
const privateKey = String(process.env.FIREBASE_PRIVATE_KEY || '').replace(/^"|"$/g, '').replace(/\\n/g, '\n');
if (!projectId || !clientEmail || !privateKey) throw new Error('Firebase admin credentials are missing');
if (!getApps().length) initializeApp({ credential: cert({ projectId, clientEmail, privateKey }) });
const db = getFirestore();
const apply = process.argv.includes('--apply');

const payrollTier = segment => {
  if (segment.type === 'break') return null;
  if (segment.type === 'support' || segment.type === 'interview') return 'sub_staff';
  if (segment.type === 'individual' || segment.lesson_format === 'individual') {
    const ratio = segment.individual_ratio === '1:2' ? 2 : segment.individual_ratio === '1:3' ? 3 : 1;
    return `individual_${segment.individual_level === 'advanced' ? ratio + 3 : ratio}`;
  }
  if (segment.type === 'lesson') return 'group_lesson';
  if (segment.office_task === 'training') return 'training_1';
  return 'office';
};

const normalize = segment => {
  const oldType = String(segment?.type || 'office');
  const type = oldType === 'breakthrough' || oldType === 'breakthrough_lesson'
    ? 'lesson'
    : oldType === 'breakthrough_office'
      ? 'office'
      : oldType === 'interview' ? 'support' : oldType;
  const next = {
    ...segment,
    type,
    program: 'science_social',
    ...(type === 'lesson' ? { lesson_format: 'group' } : {}),
  };
  const tier = payrollTier(next);
  if (tier) next.payroll_tier = tier;
  else delete next.payroll_tier;
  if (/突破ゼミ/.test(String(next.note || ''))) next.note = type === 'lesson' ? '理社講座の授業' : type === 'office' ? '理社講座の事務' : next.note;
  return next;
};

const docs = [];
let cursor = null;
while (true) {
  let query = db.collection('work_records').orderBy(FieldPath.documentId()).limit(500);
  if (cursor) query = query.startAfter(cursor);
  const snap = await query.get();
  docs.push(...snap.docs);
  if (snap.size < 500) break;
  cursor = snap.docs.at(-1);
}

const targets = docs.filter(doc => Array.isArray(doc.data().work_segments) && doc.data().work_segments.length > 0);
const summary = {
  project_id: projectId,
  mode: apply ? 'apply' : 'dry-run',
  scanned_records: docs.length,
  target_records: targets.length,
  target_segments: targets.reduce((sum, doc) => sum + doc.data().work_segments.length, 0),
  previous_programs: {},
  previous_types: {},
};
targets.forEach(doc => doc.data().work_segments.forEach(segment => {
  const program = String(segment.program || (String(segment.type || '').startsWith('breakthrough') ? 'breakthrough' : 'unset'));
  const type = String(segment.type || 'unset');
  summary.previous_programs[program] = (summary.previous_programs[program] || 0) + 1;
  summary.previous_types[type] = (summary.previous_types[type] || 0) + 1;
}));

if (apply) {
  const writer = db.bulkWriter();
  writer.onWriteError(error => error.failedAttempts < 3);
  targets.forEach(doc => writer.set(doc.ref, {
    attendance_kind: 'normal',
    work_segments: doc.data().work_segments.map(normalize),
    attendance_program_migrated_to: 'science_social',
    attendance_program_migrated_at: FieldValue.serverTimestamp(),
  }, { merge: true }));
  await writer.close();
}

console.log(JSON.stringify(summary, null, 2));
