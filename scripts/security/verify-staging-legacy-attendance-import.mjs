import fs from 'node:fs';
import path from 'node:path';
import { cert, getApps, initializeApp } from 'firebase-admin/app';
import { getFirestore } from 'firebase-admin/firestore';

const projectId = 'classbase-security-diagnosis';
const baseUrl = 'https://classbase-security-diagnosis.vercel.app';
const month = '2099-01';
const root = process.cwd();
const keyPath = path.join(root, '.security-staging-service-account.json');
const credentialsPath = path.join(root, '.security-diagnosis-accounts.json');
if (!fs.existsSync(keyPath) || !fs.existsSync(credentialsPath)) throw new Error('Missing diagnosis credentials.');
const serviceAccount = JSON.parse(fs.readFileSync(keyPath, 'utf8'));
if (serviceAccount.project_id !== projectId || !serviceAccount.private_key) throw new Error('Safety stop: wrong Firebase project.');
if (!getApps().length) initializeApp({ credential: cert(serviceAccount), projectId });
const db = getFirestore();
const master = JSON.parse(fs.readFileSync(credentialsPath, 'utf8')).accounts.find(account => account.uid === 'security-master');
if (!master?.email || !master?.password) throw new Error('Missing diagnosis master credentials.');
const apiKey = 'AIzaSyC_hssQ63wvHD8GJ2A8zsEUo8-rKuuz4Yg';

async function token() {
  const response = await fetch(`https://identitytoolkit.googleapis.com/v1/accounts:signInWithPassword?key=${apiKey}`, {
    method: 'POST', headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ email: master.email, password: master.password, returnSecureToken: true }),
  });
  const body = await response.json();
  if (!response.ok || !body.idToken) throw new Error('Diagnosis master authentication failed.');
  return body.idToken;
}

async function importCsv(idToken, csvText, sourceName, expectedStatus = 200) {
  const response = await fetch(`${baseUrl}/api/attendance-payroll`, {
    method: 'POST',
    headers: { Authorization: `Bearer ${idToken}`, 'Content-Type': 'application/json' },
    body: JSON.stringify({ action: 'import_regular_attendance', csv_text: csvText, source_name: sourceName, replace_month: true }),
  });
  const body = await response.json().catch(() => ({}));
  if (response.status !== expectedStatus) throw new Error(`${sourceName}: expected ${expectedStatus}, received ${response.status}: ${JSON.stringify(body)}.`);
  return body;
}

async function monthDocs() {
  return (await db.collection('attendance_regular_imports').where('month', '==', month).get()).docs;
}

async function importBatchDocs() {
  return (await db.collection('attendance_import_batches').where('month', '==', month).get()).docs;
}

async function deleteDocs(docs) {
  for (let offset = 0; offset < docs.length; offset += 400) {
    const batch = db.batch();
    docs.slice(offset, offset + 400).forEach(doc => batch.delete(doc.ref));
    await batch.commit();
  }
}

const firstCsv = [
  '職員番号,氏名,日付,開始,終了,勤務区分',
  'SEC-001,診断 太郎,2099/01/05,09:00,10:00,事務',
  'SEC-002,診断 花子,2099/01/06,18:00,19:00,授業',
].join('\n');
const replacementCsv = [
  '職員番号,氏名,日付,開始,終了,勤務区分',
  'SEC-001,診断 太郎,2099/01/05,09:15,10:15,事務',
].join('\n');
const invalidCsv = [
  '職員番号,氏名,日付,開始,終了,勤務区分',
  'SEC-003,診断 次郎,2099/01/07,09:00,,事務',
].join('\n');

try {
  await deleteDocs(await monthDocs());
  await deleteDocs(await importBatchDocs());
  const idToken = await token();
  const first = await importCsv(idToken, firstCsv, 'security-legacy-first.csv');
  if (first.imported !== 2 || first.month !== month) throw new Error(`Initial import response is invalid: ${JSON.stringify(first)}.`);
  let docs = await monthDocs();
  if (docs.length !== 2) throw new Error(`Initial import stored ${docs.length} documents instead of 2.`);

  const replacement = await importCsv(idToken, replacementCsv, 'security-legacy-replacement.csv');
  if (replacement.imported !== 1 || replacement.month !== month) throw new Error(`Replacement response is invalid: ${JSON.stringify(replacement)}.`);
  docs = await monthDocs();
  if (docs.length !== 1) throw new Error(`Replacement left ${docs.length} documents instead of 1.`);
  const savedBeforeFailure = JSON.stringify(docs[0].data());
  if (docs[0].data().intervals?.[0]?.start_time !== '09:15') throw new Error('Replacement interval was not persisted.');

  const rejected = await importCsv(idToken, invalidCsv, 'security-legacy-invalid.csv', 400);
  if (rejected.ok !== false || !Array.isArray(rejected.errors) || !rejected.errors.some(error => String(error).includes('開始、終了は必須'))) {
    throw new Error(`Invalid CSV did not return a useful validation error: ${JSON.stringify(rejected)}.`);
  }
  docs = await monthDocs();
  if (docs.length !== 1 || JSON.stringify(docs[0].data()) !== savedBeforeFailure) {
    throw new Error('Failed replacement changed the last successful month data.');
  }

  const batches = await importBatchDocs();
  if (batches.filter(doc => doc.data().type === 'regular_attendance').length !== 2) throw new Error('Successful import history count is invalid.');
  console.log(JSON.stringify({
    ok: true,
    initial_rows: 2,
    replacement_rows: 1,
    stale_rows_removed: true,
    invalid_csv_rejected: true,
    previous_data_preserved_after_failure: true,
    successful_import_history_rows: 2,
  }));
} finally {
  await deleteDocs(await monthDocs());
  await deleteDocs(await importBatchDocs());
}
