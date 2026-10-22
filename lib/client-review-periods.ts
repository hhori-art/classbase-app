import { jstDateKey } from './date-key.ts';

export type ReviewPeriodSummary = {
  id: string;
  name: string;
  start_date: string;
  end_date: string;
  status?: string;
  items?: unknown[];
};

/**
 * 今日（日本時間）が受付期間中の復習期間だけを返す。
 * /api/review-periods の生徒向けGETは学年に合う行がある期間だけを返すが、開始前の期間も含むため、ここで開始日も確かめる。
 */
export function activeReviewPeriods<T extends ReviewPeriodSummary>(periods: T[], today = jstDateKey()) {
  return periods.filter(period =>
    (period.status ?? 'active') === 'active'
    && Boolean(period.start_date) && Boolean(period.end_date)
    && period.start_date <= today && today <= period.end_date
    && (!Array.isArray(period.items) || period.items.length > 0),
  );
}

// ホームとテスト期間一覧で同じ結果を使い回し、画面を開くたびにAPI（Firestore読み取り）を走らせない。
const CACHE_TTL_MS = 10 * 60 * 1000;
let cached: { uid: string; expiresAt: number; periods: ReviewPeriodSummary[] } | null = null;
let pending: { uid: string; promise: Promise<ReviewPeriodSummary[]> } | null = null;

/** 受付中の復習期間（学年に合うもの）を読み込む。入口カードの表示判定用。 */
export async function loadActiveReviewPeriods(uid: string, getToken: () => Promise<string>) {
  if (cached?.uid === uid && cached.expiresAt > Date.now()) return activeReviewPeriods(cached.periods);
  if (pending?.uid === uid) return activeReviewPeriods(await pending.promise);

  const promise = (async () => {
    const token = await getToken();
    const response = await fetch('/api/review-periods', { headers: { Authorization: `Bearer ${token}` } });
    const payload = await response.json().catch(() => ({}));
    if (!response.ok || payload.ok === false) throw new Error(payload.error || 'review-periods-fetch-failed');
    const periods: ReviewPeriodSummary[] = Array.isArray(payload.periods) ? payload.periods : [];
    // 入口の判定に必要な項目だけを保持する。
    const summaries = periods.map(period => ({
      id: String(period.id || ''),
      name: String(period.name || ''),
      start_date: String(period.start_date || ''),
      end_date: String(period.end_date || ''),
      status: String(period.status || 'active'),
      items: Array.isArray(period.items) ? period.items.slice(0, 1) : [],
    }));
    cached = { uid, expiresAt: Date.now() + CACHE_TTL_MS, periods: summaries };
    return summaries;
  })();
  pending = { uid, promise };
  try {
    return activeReviewPeriods(await promise);
  } finally {
    if (pending?.promise === promise) pending = null;
  }
}

