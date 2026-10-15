import fs from 'node:fs';
import path from 'node:path';
import { cert, getApp, getApps, initializeApp } from 'firebase-admin/app';
import { getFirestore } from 'firebase-admin/firestore';
import { GoogleAuth } from 'google-auth-library';

const root = process.cwd();
const parseEnv = (text) => Object.fromEntries(text.split(/\r?\n/).flatMap(line => {
  const match = line.match(/^([A-Z0-9_]+)=(.*)$/);
  if (!match) return [];
  let value = match[2].trim();
  if ((value.startsWith('"') && value.endsWith('"')) || (value.startsWith("'") && value.endsWith("'"))) value = value.slice(1, -1);
  return [[match[1], value.replace(/\\n/g, '\n')]];
}));

const productionEnv = parseEnv(fs.readFileSync(path.join(root, '.env.local'), 'utf8'));
const diagnosisKey = JSON.parse(fs.readFileSync(path.join(root, '.security-staging-service-account.json'), 'utf8'));
const productionProject = productionEnv.NEXT_PUBLIC_FIREBASE_PROJECT_ID;
const diagnosisProject = 'classbase-security-diagnosis';
if (!productionProject || productionProject === diagnosisProject) throw new Error('Safety stop: production Firebase project is invalid.');
if (diagnosisKey.project_id !== diagnosisProject) throw new Error('Safety stop: diagnosis Firebase project is invalid.');

const productionCredential = {
  projectId: productionProject,
  clientEmail: productionEnv.FIREBASE_CLIENT_EMAIL,
  privateKey: productionEnv.FIREBASE_PRIVATE_KEY,
};
if (!productionCredential.clientEmail || !productionCredential.privateKey) throw new Error('Missing production read credentials.');

const appFor = (name, credential, projectId) => getApps().some(app => app.name === name)
  ? getApp(name)
  : initializeApp({ credential: cert(credential), projectId }, name);
const productionDb = getFirestore(appFor('production-comparison', productionCredential, productionProject));
const diagnosisDb = getFirestore(appFor('diagnosis-comparison', diagnosisKey, diagnosisProject));

const collections = [
  'users','shift_assignments','homework_assignments','submissions','announcements','monthly_schedules',
  'class_recordings','attendance','requests','recording_views','pf_learning_records','user_notifications',
  'quest_results','coin_transactions','community_topics','teacher_community_topics','rewards',
  'teacher_availability','teacher_substitution_posts','work_records','attendance_correction_requests',
  'learning_units','quizzes','lesson_slides','pf_records','pf_resolutions','chat_logs','teacher_inquiries',
  'registration_requests','course_registration_options','course_registrations','annual_curriculum_schedules',
  'annual_lesson_schedules','commuter_passes','transport_expense_claims','employee_lesson_claims',
];
const exists = async (db, collection) => !(await db.collection(collection).limit(1).get()).empty;
const rows = [];
for (const collection of collections) {
  const [production, diagnosis] = await Promise.all([exists(productionDb, collection), exists(diagnosisDb, collection)]);
  rows.push({ collection, production, diagnosis });
}

const portalKeys = (data) => Object.fromEntries(['student','parent','teacher','admin'].map(role => [
  role, Object.keys(data?.[role] || {}).sort(),
]));
const [productionVisibilitySnap, diagnosisVisibilitySnap, productionSettings, diagnosisSettings] = await Promise.all([
  productionDb.collection('settings').doc('portal_visibility').get(),
  diagnosisDb.collection('settings').doc('portal_visibility').get(),
  productionDb.collection('settings').listDocuments(),
  diagnosisDb.collection('settings').listDocuments(),
]);
const productionVisibility = portalKeys(productionVisibilitySnap.data());
const diagnosisVisibility = portalKeys(diagnosisVisibilitySnap.data());
const missingVisibilityKeys = Object.fromEntries(Object.keys(productionVisibility).map(role => [
  role, productionVisibility[role].filter(key => !diagnosisVisibility[role].includes(key)),
]));

const deployedRulesSource = async (projectId, credentials, releaseName) => {
  const googleCredentials = credentials.client_email ? credentials : {
    project_id: credentials.projectId,
    client_email: credentials.clientEmail,
    private_key: credentials.privateKey,
  };
  const auth = new GoogleAuth({ credentials: googleCredentials, scopes: ['https://www.googleapis.com/auth/firebase'] });
  const client = await auth.getClient();
  const release = await client.request({
    url: `https://firebaserules.googleapis.com/v1/projects/${projectId}/releases/${releaseName}`,
  });
  const rulesetName = release.data?.rulesetName;
  if (!rulesetName) throw new Error(`Firestore rules release is missing for ${projectId}.`);
  const ruleset = await client.request({ url: `https://firebaserules.googleapis.com/v1/${rulesetName}` });
  return (ruleset.data?.source?.files || [])
    .map(file => `${file.name || ''}\n${file.content || ''}`)
    .sort()
    .join('\n---\n');
};
const [productionRules, diagnosisRules] = await Promise.all([
  deployedRulesSource(productionProject, productionCredential, 'cloud.firestore'),
  deployedRulesSource(diagnosisProject, diagnosisKey, 'cloud.firestore'),
]);
const productionBucket = productionEnv.NEXT_PUBLIC_FIREBASE_STORAGE_BUCKET;
const diagnosisBucket = `${diagnosisProject}.firebasestorage.app`;
const [productionStorageRules, diagnosisStorageRules] = await Promise.all([
  deployedRulesSource(productionProject, productionCredential, `firebase.storage/${productionBucket}`),
  deployedRulesSource(diagnosisProject, diagnosisKey, `firebase.storage/${diagnosisBucket}`),
]);
const localFirestoreRules = fs.readFileSync(path.join(root, 'firestore.rules'), 'utf8');
const localStorageRules = fs.readFileSync(path.join(root, 'storage.rules'), 'utf8');

const result = {
  production_project: productionProject,
  diagnosis_project: diagnosisProject,
  production_collections_missing_in_diagnosis: rows.filter(row => row.production && !row.diagnosis).map(row => row.collection),
  diagnosis_only_demo_collections: rows.filter(row => !row.production && row.diagnosis).map(row => row.collection),
  missing_visibility_keys: missingVisibilityKeys,
  production_settings_missing_in_diagnosis: productionSettings.map(ref => ref.id).filter(id => !diagnosisSettings.some(ref => ref.id === id)).sort(),
  firestore_rules_equal: productionRules === diagnosisRules,
  production_firestore_rules_equal_local: productionRules.includes(localFirestoreRules),
  diagnosis_firestore_rules_equal_local: diagnosisRules.includes(localFirestoreRules),
  storage_rules_equal: productionStorageRules === diagnosisStorageRules,
  production_storage_rules_equal_local: productionStorageRules.includes(localStorageRules),
  diagnosis_storage_rules_equal_local: diagnosisStorageRules.includes(localStorageRules),
  checked_collections: rows.length,
};
console.log(JSON.stringify(result, null, 2));
