import { jstDateKey } from './date-key.ts';

/**
 * 宿題の期限を日本時間で扱うための補助関数。
 * 期限は通常 "YYYY-MM-DD"（日付だけ）で保存される。new Date('YYYY-MM-DD') は UTC の0時
 * （日本時間の9時）になり、期限日の9時から「期限切れ」になってしまうため、日付キーどうしで比べる。
 */
export type HomeworkDeadline = {
  /** 日本時間の期限日（YYYY-MM-DD）。読めない値は空文字。 */
  dateKey: string;
  /** 日本時間の期限時刻（HH:mm）。日付だけの期限は空文字。 */
  time: string;
  /** 時刻つき期限の瞬間。日付だけの期限は null。 */
  instant: Date | null;
};

const DATE_ONLY_RE = /^(\d{4})-(\d{2})-(\d{2})$/;
const LOCAL_DATETIME_RE = /^(\d{4}-\d{2}-\d{2})[T ](\d{2}):(\d{2})(?::\d{2}(?:\.\d+)?)?$/;

const jstTime = (date: Date) => new Intl.DateTimeFormat('en-GB', {
  timeZone: 'Asia/Tokyo', hour: '2-digit', minute: '2-digit', hourCycle: 'h23',
}).format(date);

const validDate = (date: Date) => !Number.isNaN(date.getTime());

export function parseHomeworkDeadline(value: unknown): HomeworkDeadline {
  const empty: HomeworkDeadline = { dateKey: '', time: '', instant: null };
  if (value == null || value === '') return empty;
  // Firestore Timestamp など toDate() を持つ値
  if (typeof (value as any)?.toDate === 'function') {
    const date = (value as any).toDate();
    return date instanceof Date && validDate(date) ? { dateKey: jstDateKey(date), time: jstTime(date), instant: date } : empty;
  }
  if (value instanceof Date) {
    return validDate(value) ? { dateKey: jstDateKey(value), time: jstTime(value), instant: value } : empty;
  }
  const text = String(value).trim();
  if (DATE_ONLY_RE.test(text)) return { dateKey: text, time: '', instant: null };
  // タイムゾーンのない日時は日本時間の壁時計として扱う。
  const local = LOCAL_DATETIME_RE.exec(text);
  if (local) {
    const instant = new Date(`${local[1]}T${local[2]}:${local[3]}:00+09:00`);
    return validDate(instant) ? { dateKey: local[1], time: `${local[2]}:${local[3]}`, instant } : empty;
  }
  const date = new Date(text);
  return validDate(date) ? { dateKey: jstDateKey(date), time: jstTime(date), instant: date } : empty;
}

/** 期限切れか。日付だけの期限は、期限日の終わり（日本時間）まで期限内とする。 */
export function isHomeworkOverdue(value: unknown, now = new Date()) {
  const deadline = parseHomeworkDeadline(value);
  if (!deadline.dateKey) return false;
  if (deadline.instant) return now.getTime() > deadline.instant.getTime();
  return jstDateKey(now) > deadline.dateKey;
}

/** 日付キー（YYYY-MM-DD）を "2026/10/17" の形にする。 */
export function formatDateKeySlash(dateKey: string) {
  const match = DATE_ONLY_RE.exec(dateKey);
  return match ? `${Number(match[1])}/${Number(match[2])}/${Number(match[3])}` : '';
}

/** 日付キー（YYYY-MM-DD）を "10/17" の形にする。 */
export function formatDateKeyMonthDay(dateKey: string) {
  const match = DATE_ONLY_RE.exec(dateKey);
  return match ? `${Number(match[2])}/${Number(match[3])}` : '';
}

/** 任意の日付値を日本時間の日付キーにする（"YYYY-MM-DD" はそのまま）。 */
export function jstDateKeyOf(value: unknown) {
  return parseHomeworkDeadline(value).dateKey;
}
