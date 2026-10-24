/**
 * パスワード変更のエラーの見分け方。サーバーで変更が済んだあと（新しいパスワードでの再ログイン）の失敗なら、
 * パスワードはもう変わっている。「変更できませんでした」と出すと古いパスワードで入り直そうとして入れなくなる。
 */
export const PASSWORD_CHANGED_RELOGIN_MESSAGE = 'パスワードは変更されました。新しいパスワードでログインし直してください。';

export function passwordChangedButReloginFailed(error: unknown) {
  const code = String((error as any)?.code || '');
  const message = String((error as any)?.message || '');
  return code.startsWith('auth/') || message === 'missing-auth-email';
}
