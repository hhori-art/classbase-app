// Google Cloud (Firebase) 接続設定
import { initializeApp, getApps } from 'firebase/app';
import { getFirestore } from 'firebase/firestore';
import { getAuth } from 'firebase/auth';
import { getStorage } from 'firebase/storage';

// 環境変数から設定値を読み込み
// ※後ほどGoogle Cloudの管理画面から取得するキーが入ります
const firebaseConfig = {
  apiKey: process.env.NEXT_PUBLIC_FIREBASE_API_KEY,
  authDomain: process.env.NEXT_PUBLIC_FIREBASE_AUTH_DOMAIN,
  projectId: process.env.NEXT_PUBLIC_FIREBASE_PROJECT_ID,
  storageBucket: process.env.NEXT_PUBLIC_FIREBASE_STORAGE_BUCKET,
  messagingSenderId: process.env.NEXT_PUBLIC_FIREBASE_MESSAGING_SENDER_ID,
  appId: process.env.NEXT_PUBLIC_FIREBASE_APP_ID,
};

// アプリの初期化（二重初期化を防ぐ）
const app = !getApps().length ? initializeApp(firebaseConfig) : getApps()[0];

// 各機能のエクスポート
export const db = getFirestore(app); // データベース (Firestore)
export const auth = getAuth(app);    // 認証 (Identity Platform)
export const storage = getStorage(app); // ファイル保存 (Cloud Storage)

export default app;