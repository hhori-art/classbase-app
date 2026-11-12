import 'server-only';
import { adminAuth } from '@/lib/firebase-admin';
import type { ServerUser } from '@/lib/server-auth';
import { verifyExistingFirebasePassword } from '@/lib/server/firebase-password-check';
import { checkLoginLock, clearLoginFailures, normalizeLoginAccount, recordLoginFailure } from '@/lib/server/login-lock';
import { getClientIp } from '@/lib/server/password-recovery';
import { retryAfterText } from '@/lib/server/retry-after-text';

/**
 * パスワードや再設定用メールを変える前に、今のパスワードを確かめる（KDL診断 E.2.2）。
 * 失敗した回数は、ログインのロック（A.1.2）と同じ回数に数える。
 */
export async function verifyCurrentPassword(request: Request, user: ServerUser, currentPassword: unknown) {
  const password = String(currentPassword ?? '');
  if (!password) return { ok: false as const, status: 400, code: 'current-password-required', message: '今のパスワードを入力してください。' };
  // ログインに使うID（生徒番号・職員番号）で数える。なければメール。
  const account = normalizeLoginAccount(user.profile.lifetime_id || user.profile.initial_login_id || user.email || user.uid);
  const ip = getClientIp(request);
  const lock = await checkLoginLock(account, ip);
  if (lock.locked) {
    return { ok: false as const, status: 429, code: 'too-many-attempts', retryAfterSeconds: lock.retryAfterSeconds, message: `続けて失敗したため、しばらく確かめられません。${retryAfterText(lock.retryAfterSeconds)}ほど待ってから、もう一度お試しください。` };
  }
  const email = String((await adminAuth().getUser(user.uid)).email || user.email || '').trim().toLowerCase();
  if (email && await verifyExistingFirebasePassword(email, password)) {
    if (lock.hasFailures) await clearLoginFailures(account, ip).catch(() => undefined);
    return { ok: true as const };
  }
  const after = await recordLoginFailure(account, ip);
  if (after.locked) {
    return { ok: false as const, status: 429, code: 'too-many-attempts', retryAfterSeconds: after.retryAfterSeconds, message: `続けて失敗したため、しばらく確かめられません。${retryAfterText(after.retryAfterSeconds)}ほど待ってから、もう一度お試しください。` };
  }
  return { ok: false as const, status: 401, code: 'current-password-wrong', message: '今のパスワードが違います。' };
}
