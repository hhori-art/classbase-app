// src/lib/firebaseAdmin.ts
import 'server-only';
import { initializeApp, getApps, cert } from 'firebase-admin/app';
import { getAuth } from 'firebase-admin/auth';
import { getFirestore } from 'firebase-admin/firestore';

function env(name: string): string | undefined {
  return process.env[name];
}

function normalizePrivateKey(raw: string) {
  // Vercel で \n になって入る・余計な " が付くケースを吸収
  return raw.replace(/^"|"$/g, '').replace(/\\n/g, '\n');
}

/**
 * ★重要：import時にthrowしない
 * adminDb()/adminAuth() が呼ばれた時点で初めて env を検証して初期化する
 */
function ensureAdminInitialized() {
  if (getApps().length) return;

  const projectId = env('FIREBASE_PROJECT_ID');
  const clientEmail = env('FIREBASE_CLIENT_EMAIL');
  const privateKeyRaw = env('FIREBASE_PRIVATE_KEY');

  const missing: string[] = [];
  if (!projectId) missing.push('FIREBASE_PROJECT_ID');
  if (!clientEmail) missing.push('FIREBASE_CLIENT_EMAIL');
  if (!privateKeyRaw) missing.push('FIREBASE_PRIVATE_KEY');

  if (missing.length) {
    throw new Error(`Missing env: ${missing.join(', ')}`);
  }

  initializeApp({
    credential: cert({
      projectId,
      clientEmail,
      privateKey: normalizePrivateKey(privateKeyRaw!),
    }),
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