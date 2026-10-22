/**
 * 生徒の「自分の記録」ページの集計（画面・API・テストで共通に使う、読み取りを伴わない関数）。
 * 週は日本時間の月曜はじまり（lib/student-weekly-participation.ts と同じ区切り）。
 */
import { jstDateKey } from '@/lib/date-key';
import { BADGES, type BadgeStats } from '@/lib/gamification';
import { buildRecentParticipationWeeks, type ParticipationWeek } from '@/lib/student-weekly-participation';

/** グラフに出す週の数（今週をふくむ）。 */
export const RECORD_WEEK_COUNT = 8;

const DATE_KEY = /^\d{4}-\d{2}-\d{2}$/;

/** 今週をふくむ直近 count 週（古い順）。 */
export function buildRecordWeeks(todayKey: string, count = RECORD_WEEK_COUNT): ParticipationWeek[] {
  return buildRecentParticipationWeeks(todayKey, Math.max(1, count) - 1);
}

/** 今月1日（日本時間）の日付キー。 */
export const monthStartKey = (todayKey: string) => `${todayKey.slice(0, 7)}-01`;

/** ミリ秒の時刻を日本時間の日付キーにする。読めなければ空文字。 */
export function jstDateKeyFromMillis(ms: number) {
  return Number.isFinite(ms) && ms > 0 ? jstDateKey(new Date(ms)) : '';
}

/** 日付キーごとの値を週ごとに合計する。週の外の日付は数えない。 */
export function bucketByWeek(entries: { date: string; value: number }[], weeks: ParticipationWeek[]) {
  const totals = weeks.map(() => 0);
  entries.forEach(entry => {
    if (!DATE_KEY.test(entry.date)) return;
    const index = weeks.findIndex(week => entry.date >= week.start_date && entry.date <= week.end_date);
    if (index >= 0) totals[index] += Number(entry.value) || 0;
  });
  return totals;
}

const PARTICIPATION_WORDS = ['joined', 'present', '出席', '遅刻'];

/** 出席の記録が「授業に参加した」ものか（欠席の記録は除く）。 */
export function isParticipationRecord(record: Record<string, unknown>) {
  const status = String(record.type || record.attendance_status || record.status || '').normalize('NFKC').toLowerCase();
  return PARTICIPATION_WORDS.some(word => status.includes(word));
}

/** 出席の記録から、参加した日（日付キー）を重複なしで返す。 */
export function participationDates(records: Record<string, unknown>[]) {
  const dates = new Set<string>();
  records.forEach(record => {
    if (!isParticipationRecord(record)) return;
    const date = String(record.target_date || record.date || '').slice(0, 10);
    if (DATE_KEY.test(date)) dates.add(date);
  });
  return Array.from(dates).sort();
}

/**
 * 何週つづけて参加しているか。今週まだ参加していなくても、先週までの連続は切らさない。
 * capped=true のときは、表示している週すべてで参加している（それ以上前は数えていない）。
 */
export function weeklyStreak(counts: number[], weeks: ParticipationWeek[]) {
  let streak = 0;
  let index = counts.length - 1;
  if (index >= 0 && weeks[index]?.is_current && !(counts[index] > 0)) index -= 1;
  const checked = index + 1;
  for (; index >= 0; index -= 1) {
    if (!(counts[index] > 0)) break;
    streak += 1;
  }
  return { weeks: streak, capped: streak > 0 && streak === checked };
}

export type NextBadgeTarget = {
  metric: 'recording_complete_count' | 'login_count' | 'quest_clear_count';
  label: string;
  unit: string;
  badge_id: string;
  name: string;
  icon: string;
  current: number;
  target: number;
  remaining: number;
};

const NEXT_BADGE_METRICS: { metric: NextBadgeTarget['metric']; label: string; unit: string }[] = [
  { metric: 'recording_complete_count', label: '録画バッジ', unit: '本' },
  { metric: 'login_count', label: 'ログインバッジ', unit: '回' },
  { metric: 'quest_clear_count', label: 'クエストバッジ', unit: '回' },
];

/** 次にもらえるバッジ（バッジの必要回数までの残り）。全部そろっていれば出さない。 */
export function nextBadgeTargets(stats: BadgeStats): NextBadgeTarget[] {
  return NEXT_BADGE_METRICS.flatMap(({ metric, label, unit }) => {
    const current = Number(stats[metric]) || 0;
    const next = BADGES
      .filter(item => item.metric === metric && item.threshold > current && !item.secret)
      .sort((a, b) => a.threshold - b.threshold)[0];
    if (!next) return [];
    return [{ metric, label, unit, badge_id: next.id, name: next.name, icon: next.icon, current, target: next.threshold, remaining: next.threshold - current }];
  });
}

/** バッジの説明は古い呼び方（授業アーカイブ）が残っているので、生徒向けの言葉にそろえる。 */
export const studentBadgeText = (value: string) => String(value || '').replace(/授業アーカイブ/g, '授業の録画');
