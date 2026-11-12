// Google Cloud (Firebase) 接続設定
import { initializeApp, getApps } from 'firebase/app';
import { initializeAppCheck, ReCaptchaEnterpriseProvider } from 'firebase/app-check';
import { connectFirestoreEmulator, getFirestore } from 'firebase/firestore';
import { connectAuthEmulator, getAuth } from 'firebase/auth';
import { connectStorageEmulator, getStorage } from 'firebase/storage';

const firebaseConfig = {
  apiKey: process.env.NEXT_PUBLIC_FIREBASE_API_KEY,
  authDomain: process.env.NEXT_PUBLIC_FIREBASE_AUTH_DOMAIN,
  // ★ 修正: NEXT_PUBLIC_ を追加しました
  projectId: process.env.NEXT_PUBLIC_FIREBASE_PROJECT_ID, 
  storageBucket: process.env.NEXT_PUBLIC_FIREBASE_STORAGE_BUCKET,
  messagingSenderId: process.env.NEXT_PUBLIC_FIREBASE_MESSAGING_SENDER_ID,
  appId: process.env.NEXT_PUBLIC_FIREBASE_APP_ID,
};

// アプリの初期化（二重初期化を防ぐ）
const app = !getApps().length ? initializeApp(firebaseConfig) : getApps()[0];

// アプリを通さない直接のログインをふさぐ App Check（KDL診断 A.1.2）。サイトキーを入れた環境だけで動く。
// 有効にするのは、診断環境で動作を確かめてから（Firebase コンソールで Authentication・Firestore の適用もそのとき入れる）。
const appCheckSiteKey = process.env.NEXT_PUBLIC_RECAPTCHA_ENTERPRISE_SITE_KEY;
if (typeof window !== 'undefined' && appCheckSiteKey && process.env.NEXT_PUBLIC_USE_FIREBASE_EMULATORS !== 'true') {
  const appCheckGlobal = globalThis as typeof globalThis & { __classbaseAppCheck?: boolean };
  if (!appCheckGlobal.__classbaseAppCheck) {
    appCheckGlobal.__classbaseAppCheck = true;
    initializeAppCheck(app, { provider: new ReCaptchaEnterpriseProvider(appCheckSiteKey), isTokenAutoRefreshEnabled: true });
  }
}

// 各機能のエクスポート
export const db = getFirestore(app); // データベース (Firestore)
export const auth = getAuth(app);    // 認証 (Identity Platform)
export const storage = getStorage(app); // ファイル保存 (Cloud Storage)

type EmulatorGlobal = typeof globalThis & { __classbaseFirebaseEmulatorsConnected?: boolean };
const emulatorGlobal = globalThis as EmulatorGlobal;
const useEmulators = process.env.NEXT_PUBLIC_USE_FIREBASE_EMULATORS === 'true';

if (useEmulators && typeof window !== 'undefined' && !emulatorGlobal.__classbaseFirebaseEmulatorsConnected) {
  const authHost = process.env.NEXT_PUBLIC_FIREBASE_AUTH_EMULATOR_HOST || '127.0.0.1';
  const authPort = Number(process.env.NEXT_PUBLIC_FIREBASE_AUTH_EMULATOR_PORT || 9099);
  const firestoreHost = process.env.NEXT_PUBLIC_FIRESTORE_EMULATOR_HOST || '127.0.0.1';
  const firestorePort = Number(process.env.NEXT_PUBLIC_FIRESTORE_EMULATOR_PORT || 8085);
  const storageHost = process.env.NEXT_PUBLIC_FIREBASE_STORAGE_EMULATOR_HOST || '127.0.0.1';
  const storagePort = Number(process.env.NEXT_PUBLIC_FIREBASE_STORAGE_EMULATOR_PORT || 9199);

  connectAuthEmulator(auth, `http://${authHost}:${authPort}`, { disableWarnings: true });
  connectFirestoreEmulator(db, firestoreHost, firestorePort);
  connectStorageEmulator(storage, storageHost, storagePort);
  emulatorGlobal.__classbaseFirebaseEmulatorsConnected = true;
}

export default app;
