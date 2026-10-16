import { auth } from '@/lib/firebase';

// ID書面の印刷前パスワード同期を、サーバーの上限（1回100件）と実行時間に収まるよう分割して送る。
const CHUNK_SIZE = 40;

export type PrintedPasswordResult = {
  old_user_id: string;
  user_id: string;
  login_id: string;
  email: string;
  initial_password: string;
  generated_password: boolean;
  role: string;
  display_name: string;
};

export type PrintedPasswordSkip = { user_id: string; login_id: string; role: string; display_name: string; reason: string };
export type PrintedPasswordError = { user_id: string; login_id?: string; error: string };

export type PrintedPasswordSyncSummary = {
  results: PrintedPasswordResult[];
  skipped: PrintedPasswordSkip[];
  errors: PrintedPasswordError[];
  /** 旧ID → 新ID（Auth の uid に移行したアカウント）と、そのままのIDの対応。 */
  resultByUserId: Map<string, PrintedPasswordResult>;
};

export async function syncPrintedPasswords(
  userIds: string[],
  options: { mode?: 'issue' | 'reissue'; onProgress?: (done: number, total: number) => void } = {},
): Promise<PrintedPasswordSyncSummary> {
  const ids = Array.from(new Set(userIds.filter(Boolean)));
  const summary: PrintedPasswordSyncSummary = { results: [], skipped: [], errors: [], resultByUserId: new Map() };
  options.onProgress?.(0, ids.length);
  for (let index = 0; index < ids.length; index += CHUNK_SIZE) {
    const chunk = ids.slice(index, index + CHUNK_SIZE);
    const token = await auth.currentUser?.getIdToken();
    if (!token) throw new Error('ログイン情報を確認できませんでした。再ログインしてください。');
    const response = await fetch('/api/admin/accounts/sync-printed-password', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${token}` },
      body: JSON.stringify({ user_ids: chunk, mode: options.mode || 'issue' }),
    });
    const data = await response.json().catch(() => ({}));
    if (!response.ok || !data.ok) throw new Error(data.error || 'パスワード同期に失敗しました');
    summary.results.push(...(data.results || []));
    summary.skipped.push(...(data.skipped || []));
    summary.errors.push(...(data.errors || []));
    options.onProgress?.(Math.min(index + chunk.length, ids.length), ids.length);
  }
  summary.results.forEach(result => {
    summary.resultByUserId.set(String(result.old_user_id), result);
    summary.resultByUserId.set(String(result.user_id), result);
  });
  return summary;
}

export const describeSyncErrors = (errors: PrintedPasswordError[], limit = 5) =>
  errors.slice(0, limit).map(item => `${item.login_id || item.user_id}: ${item.error}`).join('\n') +
  (errors.length > limit ? `\nほか${errors.length - limit}件` : '');
