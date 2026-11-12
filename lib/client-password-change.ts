import { signInWithCustomToken, type User } from 'firebase/auth';
import { auth } from '@/lib/firebase';

/**
 * 自分のパスワードを変える（生徒・講師・保護者・管理者の設定画面と、初回ログインの画面で共通）。
 * 今のパスワードはサーバーで確かめる（KDL診断 E.2.2。初回ログインの直後はいらない）。
 * 変えるとほかの端末のログインは切れるので、この端末はサーバーが返したトークンで入り直す。
 */
export class PasswordChangeError extends Error {
  constructor(message: string, public code = '') {
    super(message);
  }
}

export async function changeOwnPassword(user: User, input: { password: string; currentPassword?: string }) {
  const token = await user.getIdToken();
  const response = await fetch('/api/auth/change-password', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${token}` },
    body: JSON.stringify({ password: input.password, current_password: input.currentPassword || undefined }),
    cache: 'no-store',
  });
  const data = await response.json().catch(() => ({}));
  if (!response.ok || !data?.ok) {
    // サーバーが返す理由は、こちらで用意した日本語だけ。
    throw new PasswordChangeError(String(data?.error || 'パスワードを変更できませんでした。'), String(data?.code || ''));
  }
  try { sessionStorage.removeItem(`classbase_profile_cache:${user.uid}`); } catch { /* 保存できない環境 */ }
  // ここで失敗しても、パスワードはもう変わっている（auth/ で始まるエラーとして見分ける）。
  const credential = await signInWithCustomToken(auth, String(data.token || ''));
  await credential.user.getIdToken(true);
  return credential.user;
}
