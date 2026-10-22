/**
 * 日付・時刻の表示（すべて日本時間）。画面ごとに toLocaleString や toISOString().slice を書かず、ここを使う。
 * 日付だけの値（YYYY-MM-DD）はその日として扱い、時刻は付けない。
 */
export { jstDateKey, jstSchoolYear, weekdayFromDateKey } from '@/lib/date-key';
import { weekdayFromDateKey } from '@/lib/date-key';

type DateInput = string | number | Date | { toDate: () => Date } | { toMillis: () => number } | null | undefined;

const DATE_KEY = /^\d{4}-\d{2}-\d{2}$/;

/** いろいろな形の日時を Date にする（Firestore の Timestamp も可）。読めなければ null。 */
export function toDate(value: DateInput): Date | null {
  if (!value) return null;
  if (value instanceof Date) return Number.isNaN(value.getTime()) ? null : value;
  if (typeof value === 'object' && 'toDate' in value) return value.toDate();
  if (typeof value === 'object' && 'toMillis' in value) return new Date(value.toMillis());
  if (typeof value === 'string' && DATE_KEY.test(value)) return new Date(`${value}T00:00:00+09:00`);
  const date = new Date(value as string | number);
  return Number.isNaN(date.getTime()) ? null : date;
}

const parts = (date: Date) => {
  const values = Object.fromEntries(new Intl.DateTimeFormat('ja-JP', {
    timeZone: 'Asia/Tokyo', year: 'numeric', month: 'numeric', day: 'numeric', hour: '2-digit', minute: '2-digit', hour12: false,
  }).formatToParts(date).map(part => [part.type, part.value]));
  return {
    year: Number(values.year), month: Number(values.month), day: Number(values.day),
    time: `${String(Number(values.hour) % 24).padStart(2, '0')}:${values.minute}`,
  };
};

const dateKeyOf = (date: Date) => {
  const { year, month, day } = parts(date);
  return `${year}-${String(month).padStart(2, '0')}-${String(day).padStart(2, '0')}`;
};

/** 「10月17日(土)」。withYear で「2026年10月17日(土)」。 */
export function formatDate(value: DateInput, options: { withYear?: boolean; withWeekday?: boolean } = {}) {
  const date = toDate(value);
  if (!date) return '';
  const { year, month, day } = parts(date);
  const weekday = options.withWeekday === false ? '' : `(${weekdayFromDateKey(dateKeyOf(date))})`;
  return `${options.withYear ? `${year}年` : ''}${month}月${day}日${weekday}`;
}

/** 「19:20」。日付だけの値には空文字を返す。 */
export function formatTime(value: DateInput) {
  if (typeof value === 'string' && DATE_KEY.test(value)) return '';
  const date = toDate(value);
  return date ? parts(date).time : '';
}

/** 「10月17日(土) 19:20」。日付だけの値なら時刻なし。 */
export function formatDateTime(value: DateInput, options: { withYear?: boolean } = {}) {
  const day = formatDate(value, options);
  const time = formatTime(value);
  return time ? `${day} ${time}` : day;
}

/** 「10/17」。表の中など狭い場所用。 */
export function formatShortDate(value: DateInput) {
  const date = toDate(value);
  if (!date) return '';
  const { month, day } = parts(date);
  return `${month}/${day}`;
}
