import 'server-only';
import { initializeApp, getApps, cert } from 'firebase-admin/app';
import { getAuth, Auth } from 'firebase-admin/auth';
import { getFirestore, Firestore } from 'firebase-admin/firestore';

const projectId = process.env.FIREBASE_PROJECT_ID || process.env.NEXT_PUBLIC_FIREBASE_PROJECT_ID;
const clientEmail = process.env.FIREBASE_CLIENT_EMAIL;
const privateKeyRaw = process.env.FIREBASE_PRIVATE_KEY || "";

// ★ここが修正ポイント: 改行コードの自動修正
// 1. 文字列としての "\n" を、本当の改行コードに置換
// 2. もし前後にダブルクォーテーション " が残っていたら削除
const privateKey = privateKeyRaw
  .replace(/\\n/g, '\n') 
  .replace(/^"|"$/g, ''); 

if (!getApps().length) {
  if (projectId && clientEmail && privateKey) {
    try {
      initializeApp({
        credential: cert({
          projectId,
          clientEmail,
          privateKey,
        }),
      });
    } catch (error) {
      console.error('Firebase Admin Initialization Error:', error);
    }
  } else {
    // 開発環境でキーがない場合は警告のみ
    if (process.env.NODE_ENV !== 'production') {
      console.warn('⚠️ Firebase Adminの環境変数が設定されていません。');
    }
  }
}

// エクスポート
export const adminAuth = getApps().length ? getAuth() : ({} as Auth);
export const adminDb = getApps().length ? getFirestore() : ({} as Firestore);