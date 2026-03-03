import 'server-only';
import { initializeApp, getApps, cert } from 'firebase-admin/app';
import { getAuth } from 'firebase-admin/auth';
import { getFirestore } from 'firebase-admin/firestore';

function normalizePrivateKey(raw: string) {
  return raw.replace(/^"|"$/g, '').replace(/\\n/g, '\n');
}

function ensureAdminInitialized() {
  if (getApps().length) return;

  // ★ 修正: 先ほどの .env の変更に合わせて NEXT_PUBLIC_ 付きで読み込みます
  const projectId = process.env.NEXT_PUBLIC_FIREBASE_PROJECT_ID; 
  const clientEmail = process.env.FIREBASE_CLIENT_EMAIL;
  const privateKeyRaw = process.env.FIREBASE_PRIVATE_KEY;

  const missing: string[] = [];
  if (!projectId) missing.push('NEXT_PUBLIC_FIREBASE_PROJECT_ID'); // ★ 修正
  if (!clientEmail) missing.push('FIREBASE_CLIENT_EMAIL');
  if (!privateKeyRaw) missing.push('FIREBASE_PRIVATE_KEY');
  if (missing.length) throw new Error(`Missing env: ${missing.join(', ')}`);

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