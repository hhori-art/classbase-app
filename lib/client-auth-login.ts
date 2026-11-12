import { signInWithCustomToken } from 'firebase/auth';
import { auth } from '@/lib/firebase';
import { markAdminBrowserSession } from '@/lib/admin-browser-session';

/**
 * ログイン（KDL診断 A.1.2）。パスワードはサーバーで確かめ、返ってきたトークンでログインする。
 * 画面から Firebase へ直接パスワードを送らないので、失敗の回数をサーバーで数えてロックできる。
 */

const wait = (milliseconds: number) => new Promise(resolve => window.setTimeout(resolve, milliseconds));

export class LoginError extends Error {
  constructor(public code: string, public retryAfterSeconds = 0) {
    super(code);
  }
}

async function postLogin(path: string, login: string, password: string) {
  let lastError: unknown = null;
  for (let attempt = 0; attempt < 2; attempt += 1) {
    try {
      return await fetch(path, {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({ login, password }),
        cache: 'no-store',
      });
    } catch (error) {
      lastError = error;
      if (navigator.onLine === false) break;
      await wait(700);
    }
  }
  throw lastError instanceof Error ? Object.assign(lastError, { code: 'auth/network-request-failed' }) : new LoginError('auth/network-request-failed');
}

export async function loginWithServer(login: string, password: string, options: { admin?: boolean } = {}) {
  const response = await postLogin(options.admin ? '/api/admin/login' : '/api/auth/login', login, password);
  const data = await response.json().catch(() => ({}));
  if (!response.ok || !data?.ok || !data?.token) {
    throw new LoginError(String(data?.error || (response.status >= 500 ? 'server-error' : 'login-failed')), Number(data?.retry_after_seconds || 0));
  }
  // ログインの知らせ（onAuthStateChanged）より先に置く。管理系は、これがないとログアウトになる。
  markAdminBrowserSession(String(data.role || ''));
  const credential = await signInWithCustomToken(auth, String(data.token));
  return { user: credential.user, role: String(data.role || '') };
}

/** ロックの残り時間を、画面に出す言葉にする。 */
export function retryAfterLabel(seconds: number) {
  if (!seconds || seconds <= 0) return 'しばらく';
  if (seconds < 60) return `${seconds}秒`;
  const minutes = Math.ceil(seconds / 60);
  if (minutes < 60) return `${minutes}分`;
  return `${Math.ceil(minutes / 60)}時間`;
}
