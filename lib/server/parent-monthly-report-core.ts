/**
 * 保護者向け「月ごとの学習レポート」の計算部分（Firestore を使わない純粋な関数）。
 * 月はすべて日本時間で区切る（10月31日 23:30 の記録は10月に入る）。
 */

const MONTH_KEY = /^(\d{4})-(\d{2})$/;
const JST_OFFSET_MS = 9 * 60 * 60 * 1000;

/** さかのぼって見られる月数（今月を含めない）。 */
export const REPORT_PAST_MONTHS = 24;

export type JstMonthRange = {
  month: string;
  /** 月初の日付キー（YYYY-MM-01） */
  startDate: string;
  /** 月末の日付キー */
  endDate: string;
  /** 月初 0:00（日本時間）のミリ秒 */
  startMs: number;
  /** 翌月 1日 0:00（日本時間）のミリ秒。この時刻はその月に含めない */
  endMs: number;
};

/** 日本時間の「YYYY-MM」。 */
export function jstMonthKey(ms: number) {
  const date = new Date(ms + JST_OFFSET_MS);
  return `${date.getUTCFullYear()}-${String(date.getUTCMonth() + 1).padStart(2, '0')}`;
}

/** 月を diff か月ずらす。 */
export function shiftMonthKey(month: string, diff: number) {
  const match = MONTH_KEY.exec(month);
  if (!match) return month;
  const index = Number(match[1]) * 12 + (Number(match[2]) - 1) + diff;
  return `${Math.floor(index / 12)}-${String((index % 12) + 1).padStart(2, '0')}`;
}

export function jstMonthRange(month: string): JstMonthRange {
  const match = MONTH_KEY.exec(month);
  if (!match) throw new Error('invalid-month');
  const year = Number(match[1]);
  const monthIndex = Number(match[2]) - 1;
  const startMs = Date.UTC(year, monthIndex, 1) - JST_OFFSET_MS;
  const endMs = Date.UTC(year, monthIndex + 1, 1) - JST_OFFSET_MS;
  const lastDay = new Date(Date.UTC(year, monthIndex + 1, 0)).getUTCDate();
  return { month, startDate: `${month}-01`, endDate: `${month}-${String(lastDay).padStart(2, '0')}`, startMs, endMs };
}

/** ミリ秒の時刻がその月（日本時間）に入るか。 */
export function isInJstMonth(ms: number, range: Pick<JstMonthRange, 'startMs' | 'endMs'>) {
  return Number.isFinite(ms) && ms > 0 && ms >= range.startMs && ms < range.endMs;
}

/** 日付キー（YYYY-MM-DD）がその月に入るか。 */
export function isDateInMonth(date: string, range: Pick<JstMonthRange, 'startDate' | 'endDate'>) {
  return /^\d{4}-\d{2}-\d{2}$/.test(date) && date >= range.startDate && date <= range.endDate;
}

/**
 * 画面から来た month を確かめる。空なら今月。未来の月や、さかのぼれる範囲より古い月・形式違いは null。
 */
export function parseReportMonth(value: unknown, nowMs: number) {
  const current = jstMonthKey(nowMs);
  const raw = String(value ?? '').trim();
  if (!raw) return current;
  const match = MONTH_KEY.exec(raw);
  if (!match || Number(match[2]) < 1 || Number(match[2]) > 12) return null;
  if (raw > current || raw < shiftMonthKey(current, -REPORT_PAST_MONTHS)) return null;
  return raw;
}

export const monthLabel = (month: string) => `${Number(month.slice(0, 4))}年${Number(month.slice(5, 7))}月`;

export type AttendanceDayLike = {
  date: string;
  classes: { live: boolean }[];
  absence: { kind: 'absent' | 'late' } | null;
  transfer: { status: string } | null;
};

/** 授業日ごとの記録から、その月の出席の数をまとめる。 */
export function summarizeAttendanceMonth(days: AttendanceDayLike[], range: Pick<JstMonthRange, 'startDate' | 'endDate'>) {
  const inMonth = days.filter(day => isDateInMonth(day.date, range));
  return {
    live_days: inMonth.filter(day => day.classes.some(entry => entry.live)).length,
    live_classes: inMonth.reduce((sum, day) => sum + day.classes.filter(entry => entry.live).length, 0),
    absent_days: inMonth.filter(day => day.absence?.kind === 'absent').length,
    late_days: inMonth.filter(day => day.absence?.kind === 'late').length,
    transfer_days: inMonth.filter(day => day.transfer && !['cancelled', 'canceled', 'rejected'].includes(String(day.transfer.status || '').toLowerCase())).length,
  };
}

export type ReportSummaryInput = {
  /** 選んだ月が今月か */
  isCurrentMonth: boolean;
  month: string;
  /** null は「読み込めなかった／表示しない」 */
  liveDays: number | null;
  recordingCount: number | null;
  homeworkCount: number | null;
  previousHomeworkCount: number | null;
  aiQuestions: number | null;
};

/**
 * レポートのいちばん上に出す、ひとことのまとめ。
 * 例：「今月はZoomで8回参加し、録画を3本見ました。宿題の学習回数は先月より12回増えました。」
 */
export function buildReportSummary(input: ReportSummaryInput) {
  const monthNumber = Number(input.month.slice(5, 7));
  const subject = input.isCurrentMonth ? '今月' : `${monthNumber}月`;
  const previous = input.isCurrentMonth ? '先月' : `${Number(shiftMonthKey(input.month, -1).slice(5, 7))}月`;
  const sentences: string[] = [];

  const live = input.liveDays ?? 0;
  const recordings = input.recordingCount ?? 0;
  if (live > 0 && recordings > 0) sentences.push(`${subject}はZoomで${live}回参加し、録画を${recordings}本見ました。`);
  else if (live > 0) sentences.push(`${subject}はZoomで${live}回参加しました。`);
  else if (recordings > 0) sentences.push(`${subject}は録画を${recordings}本見ました。`);

  const homework = () => (sentences.length ? '宿題の学習回数は' : `${subject}の宿題の学習回数は`);
  if (input.homeworkCount !== null) {
    if (input.previousHomeworkCount !== null) {
      const diff = input.homeworkCount - input.previousHomeworkCount;
      if (diff > 0) sentences.push(`${homework()}${previous}より${diff}回増えました。`);
      else if (diff < 0) sentences.push(`${homework()}${previous}より${-diff}回少なくなりました。`);
      else sentences.push(`${homework()}${previous}と同じ${input.homeworkCount}回でした。`);
    } else if (input.homeworkCount > 0) {
      sentences.push(`${homework()}${input.homeworkCount}回でした。`);
    }
  }

  if (input.aiQuestions !== null && input.aiQuestions > 0) {
    sentences.push(`${sentences.length ? '' : `${subject}は`}AI学習で${input.aiQuestions}回質問しました。`);
  }

  if (!sentences.length) return `${subject}の学習の記録はまだありません。`;
  return sentences.join('');
}
