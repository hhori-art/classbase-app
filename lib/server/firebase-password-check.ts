import 'server-only';
import { adminAuth } from '@/lib/firebase-admin';

/**
 * App Check を Authentication に適用したあと（KDL診断 A.1.2）も、サーバーからの確認は通るよう、
 * Admin SDK で App Check のトークンを作って付ける。FIREBASE_APP_CHECK_APP_ID がないときは付けない。
 */
let cachedAppCheck: { token: string; expiresAt: number } | null = null;
async function appCheckHeader(): Promise<Record<string, string>> {
  const appId = String(process.env.FIREBASE_APP_CHECK_APP_ID || '').trim();
  if (!appId) return {};
  if (!cachedAppCheck || cachedAppCheck.expiresAt < Date.now() + 60_000) {
    const { getAppCheck } = await import('firebase-admin/app-check');
    adminAuth();
    const created = await getAppCheck().createToken(appId, { ttlMillis: 30 * 60 * 1000 });
    cachedAppCheck = { token: created.token, expiresAt: Date.now() + created.ttlMillis };
  }
  return { 'X-Firebase-AppCheck': cachedAppCheck.token };
}

/**
 * Firebase Auth の現在のパスワードが正しいかを、サーバーから確かめる。
 * ログイン（lib/server/login-service.ts）と、パスワード変更の前の本人確認で使う。
 */
export async function verifyExistingFirebasePassword(email: string, password: string) {
  const apiKey = String(process.env.NEXT_PUBLIC_FIREBASE_API_KEY || '').trim();
  if (!apiKey) throw new Error('firebase-api-key-missing');
  const response = await fetch(`https://identitytoolkit.googleapis.com/v1/accounts:signInWithPassword?key=${encodeURIComponent(apiKey)}`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json', ...(await appCheckHeader()) },
    body: JSON.stringify({ email, password, returnSecureToken: true }),
    signal: AbortSignal.timeout(10_000),
  });
  const result = await response.json().catch(() => ({}));
  if (response.ok && result?.localId) return true;
  const reason = String(result?.error?.message || '');
  if (['INVALID_LOGIN_CREDENTIALS', 'INVALID_PASSWORD', 'EMAIL_NOT_FOUND'].some(code => reason.includes(code))) return false;
  if (reason.includes('USER_DISABLED')) throw new Error('account-inactive');
  if (reason.includes('TOO_MANY_ATTEMPTS')) throw new Error('too-many-attempts');
  throw new Error(`firebase-password-check-failed:${reason || response.status}`);
}
