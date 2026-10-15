import 'server-only';
import { initializeApp, getApps, cert } from 'firebase-admin/app';
import { getAuth } from 'firebase-admin/auth';
import { getFirestore } from 'firebase-admin/firestore';
import { getStorage } from 'firebase-admin/storage';

function normalizePrivateKey(raw: string) {
  return raw.replace(/^"|"$/g, '').replace(/\\n/g, '\n');
}

function normalizeBucketName(raw?: string) {
  const value = String(raw || '').trim();
  if (!value) return '';
  return value
    .replace(/^gs:\/\//, '')
    .replace(/^https:\/\/firebasestorage\.googleapis\.com\/v0\/b\//, '')
    .replace(/\/o\/?.*$/, '')
    .replace(/\/$/, '');
}

function storageBucketName() {
  const explicit = normalizeBucketName(
    process.env.FIREBASE_STORAGE_BUCKET ||
    process.env.NEXT_PUBLIC_FIREBASE_STORAGE_BUCKET
  );
  if (explicit) return explicit;

  const projectId = process.env.NEXT_PUBLIC_FIREBASE_PROJECT_ID;
  return projectId ? `${projectId}.appspot.com` : '';
}

function ensureAdminInitialized() {
  if (getApps().length) return;

  const projectId = process.env.NEXT_PUBLIC_FIREBASE_PROJECT_ID;
  const storageBucket = storageBucketName();
  const emulatorMode = Boolean(
    process.env.FIREBASE_AUTH_EMULATOR_HOST ||
    process.env.FIRESTORE_EMULATOR_HOST ||
    process.env.FIREBASE_STORAGE_EMULATOR_HOST
  );

  // Emulator SDKs route by host environment variables and do not need production credentials.
  // This branch prevents security tests from reading or requiring any production secret.
  if (emulatorMode) {
    if (!projectId) throw new Error('Missing env: NEXT_PUBLIC_FIREBASE_PROJECT_ID');
    initializeApp({ projectId, storageBucket });
    return;
  }

  const clientEmail = process.env.FIREBASE_CLIENT_EMAIL;
  const privateKeyRaw = process.env.FIREBASE_PRIVATE_KEY;

  const missing: string[] = [];
  if (!projectId) missing.push('NEXT_PUBLIC_FIREBASE_PROJECT_ID');
  if (!clientEmail) missing.push('FIREBASE_CLIENT_EMAIL');
  if (!privateKeyRaw) missing.push('FIREBASE_PRIVATE_KEY');
  if (missing.length) throw new Error(`Missing env: ${missing.join(', ')}`);

  initializeApp({
    credential: cert({
      projectId,
      clientEmail,
      privateKey: normalizePrivateKey(privateKeyRaw!),
    }),
    storageBucket,
  });
}

export function adminAuth() {
  ensureAdminInitialized();
  return getAuth();
}

export function adminDb() {
  ensureAdminInitialized();
  return getFirestore();
}

export function adminBucket() {
  ensureAdminInitialized();
  const bucketName = storageBucketName();
  if (!bucketName) throw new Error('Missing env: FIREBASE_STORAGE_BUCKET or NEXT_PUBLIC_FIREBASE_STORAGE_BUCKET');
  return getStorage().bucket(bucketName);
}
