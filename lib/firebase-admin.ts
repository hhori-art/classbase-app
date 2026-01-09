import 'server-only';
import * as admin from 'firebase-admin';

// 初期化チェック
if (!admin.apps.length) {
  // 環境変数が揃っている場合のみ初期化する
  if (
    process.env.FIREBASE_PROJECT_ID && 
    process.env.FIREBASE_CLIENT_EMAIL && 
    process.env.FIREBASE_PRIVATE_KEY
  ) {
    admin.initializeApp({
      credential: admin.credential.cert({
        projectId: process.env.FIREBASE_PROJECT_ID,
        clientEmail: process.env.FIREBASE_CLIENT_EMAIL,
        // 改行コードの処理
        privateKey: process.env.FIREBASE_PRIVATE_KEY.replace(/\\n/g, '\n'),
      }),
    });
  } else {
    // ビルド時などで環境変数がない場合は、コンソールに警告だけ出してスキップ
    // (こうしないとビルドが "project_id missing" で落ちてしまいます)
    console.warn('⚠️ Firebase Adminの環境変数が設定されていません。ビルド中はスキップします。');
  }
}

// エクスポート (初期化されていない場合は undefined になる可能性があるため注意)
// ただし、APIルート実行時には環境変数があるはずなので問題なく動きます
export const adminAuth = admin.apps.length ? admin.auth() : ({} as admin.auth.Auth);
export const adminDb = admin.apps.length ? admin.firestore() : ({} as admin.firestore.Firestore);