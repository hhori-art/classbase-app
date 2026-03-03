import 'server-only';
import { initializeApp, getApps, cert } from 'firebase-admin/app';
import { getAuth } from 'firebase-admin/auth';
import { getFirestore } from 'firebase-admin/firestore';

function mustEnv(name: string) {
  const v = process.env[name];
  if (!v) throw new Error(`Missing env: ${name}`);
  return v;
}

function getPrivateKey() {
  // Vercel環境変数は改行が \n になっていることがあるので復元
  // ついでに余計なダブルクォートが付いているケースも除去
  return mustEnv('FIREBASE_PRIVATE_KEY')
    .replace(/^"|"$/g, '')
    .replace(/\\n/g, '\n');
}

if (!getApps().length) {
  // 本番は必須。足りなければエラーで原因を明確化
  initializeApp({
    credential: cert({
      projectId: mustEnv('FIREBASE_PROJECT_ID'),
      clientEmail: mustEnv('FIREBASE_CLIENT_EMAIL'),
      privateKey: getPrivateKey(),
    }),
  });
}

// ✅ 初期化されていない状態で export しない（上で必ず初期化される）
export const adminAuth = getAuth();
export const adminDb = getFirestore();