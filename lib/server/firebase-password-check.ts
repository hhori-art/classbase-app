import 'server-only';

/**
 * Firebase Auth の現在のパスワードが正しいかを、サーバーから確かめる。
 * ログインIDとAuthのメールが違うアカウント（実メールで登録した職員など）のログインで、
 * パスワードを確かめてからでないと実メールを返さないために使う。
 */
export async function verifyExistingFirebasePassword(email: string, password: string) {
  const apiKey = String(process.env.NEXT_PUBLIC_FIREBASE_API_KEY || '').trim();
  if (!apiKey) throw new Error('firebase-api-key-missing');
  const response = await fetch(`https://identitytoolkit.googleapis.com/v1/accounts:signInWithPassword?key=${encodeURIComponent(apiKey)}`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
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
