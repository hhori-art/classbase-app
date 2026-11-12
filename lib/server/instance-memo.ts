import 'server-only';

/**
 * 同じ関数インスタンスの中で、同じ引数の結果を短い間だけ使い回す。
 * unstable_cache は読むたびに共有キャッシュから取り出して JSON を組み立て直すため、
 * 生徒ごとに時間割を組み立てる処理（未参加の通知・日次レポートなど）で CPU を大きく使う。
 * ここで数十秒だけ手元に持ち、Vercel の CPU 使用量を抑える（失敗した結果は持たない）。
 */
export function memoizeForInstance<Args extends unknown[], Result>(
  fn: (...args: Args) => Promise<Result>,
  ttlMs: number,
  maxEntries = 20,
) {
  const entries = new Map<string, { expiresAt: number; value: Promise<Result> }>();
  return (...args: Args): Promise<Result> => {
    const key = JSON.stringify(args);
    const now = Date.now();
    const hit = entries.get(key);
    if (hit && hit.expiresAt > now) return hit.value;
    const value = fn(...args);
    entries.set(key, { expiresAt: now + ttlMs, value });
    value.catch(() => { if (entries.get(key)?.value === value) entries.delete(key); });
    if (entries.size > maxEntries) {
      for (const [entryKey, entry] of entries) {
        if (entry.expiresAt <= now || entries.size > maxEntries) entries.delete(entryKey);
        if (entries.size <= maxEntries) break;
      }
    }
    return value;
  };
}
