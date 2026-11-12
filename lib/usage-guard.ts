/**
 * Vercel の使用額の見張り（Pro プラン）。
 *   Pro は月20ドル分の使用量が含まれ、超えた分は従量課金。従量の上限（Spend Management）は20ドルで、
 *   達するとチーム全体が止まる。そこまで行かないよう、使用額から月末の見込みを出し、増えてきたら
 *   重要でない定期処理・計測を自動で減らす（節約モード）。
 * ここは計算だけ（テストしやすいように Firestore・Vercel API には触れない）。
 */

export type UsageLevel = 'normal' | 'saving' | 'critical';

export const USAGE_LEVEL_LABELS: Record<UsageLevel, string> = {
  normal: '通常',
  saving: '節約モード',
  critical: '節約モード（従量課金が増えています）',
};

/** Pro に含まれる月の使用額（ドル）。 */
export const INCLUDED_CREDIT_USD = 20;
/** Spend Management の従量の上限（ドル）。達するとチーム全体が止まる。 */
export const ON_DEMAND_BUDGET_USD = 20;

export type UsageSnapshot = {
  /** 含まれる使用額のうち使った額。 */
  creditUsed: number;
  /** 含まれる使用額を超えた従量の額。 */
  onDemand: number;
  periodStart: string;
  periodEnd: string;
};

export function evaluateUsage(snapshot: UsageSnapshot, now: Date, previous: UsageLevel = 'normal') {
  const start = Date.parse(snapshot.periodStart);
  const end = Date.parse(snapshot.periodEnd);
  const length = end - start;
  const progress = Number.isFinite(length) && length > 0 ? Math.min(1, Math.max(0, (now.getTime() - start) / length)) : 1;
  const used = Math.max(0, snapshot.creditUsed) + Math.max(0, snapshot.onDemand);
  // 月のはじめは少しの利用で見込みが跳ねるので、経過は最低10%として数える。
  const projected = used / Math.max(progress, 0.1);

  let level: UsageLevel = 'normal';
  if (snapshot.onDemand >= ON_DEMAND_BUDGET_USD * 0.5 || projected >= INCLUDED_CREDIT_USD + ON_DEMAND_BUDGET_USD * 0.5) level = 'critical';
  else if (snapshot.onDemand > 0 || projected >= INCLUDED_CREDIT_USD) level = 'saving';
  // 節約中は、見込みが含まれる額の80%を下回るまで戻さない（境目で行ったり来たりしないため）。
  else if (previous !== 'normal' && projected >= INCLUDED_CREDIT_USD * 0.8) level = 'saving';

  return { level, used, projected, progress };
}

/** 節約モードで減らすもの。定期処理の呼び出し時刻（分）で間引く。 */
export function shouldSkipInSavingMode(job: 'security_monitor_frequent' | 'missed_class' | 'recordings_evening' | 'beta_events', level: UsageLevel, now: Date) {
  if (level === 'normal') return false;
  const minute = now.getUTCMinutes();
  switch (job) {
    // 5分ごと → 1時間ごと（毎朝の1日分の確認は続ける）。
    case 'security_monitor_frequent': return minute >= 5;
    // 5分ごと → 15分ごと（未参加の通知は止めない）。
    case 'missed_class': return minute % 15 >= 5;
    // 授業後の録画の取り込みは止める（毎朝の取り込みは続ける）。
    case 'recordings_evening': return true;
    // βテストの利用ログは受け取らない。
    case 'beta_events': return true;
  }
}
