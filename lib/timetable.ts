import { jstDateKey } from '@/lib/date-key';

/**
 * 受講講座の時間割（生徒・保護者共通）の型と表示用の計算。
 * サーバー（lib/server/student-timetable.ts）が作り、画面（app/components/timetable）が表示する。
 */

export const TIMETABLE_WEEKDAYS = ['月', '火', '水', '木', '金', '土', '日'] as const;
export type TimetableWeekday = typeof TIMETABLE_WEEKDAYS[number];
export type TimetablePeriod = 1 | 2;

export type TimetableCourse = {
  key: string;
  /** 画面に出す名前。例「理科（物理）」 */
  label: string;
  subject: string;
  course_name: string;
};

export type TimetableSlot = {
  day: TimetableWeekday;
  period: TimetablePeriod;
  courses: TimetableCourse[];
};

/**
 * scheduled＝授業あり、cancelled＝休講・お休み、tentative＝講師の配置がまだ決まっていない日、
 * absent＝欠席連絡済みで別の日に振替がある日（もとの授業）。
 */
export type TimetableLessonStatus = 'scheduled' | 'cancelled' | 'tentative' | 'absent';

export type TimetableLesson = {
  id: string;
  date: string;
  weekday: string;
  period: TimetablePeriod;
  start: string;
  end: string;
  label: string;
  unit: string;
  status: TimetableLessonStatus;
  /** 休講の理由など（年間予定の「お休み」の名前）。振替の授業は「10/20(火)の振替」。 */
  note: string;
  /** transfer＝欠席した授業の振替として受ける授業。 */
  kind: 'regular' | 'test_prep' | 'transfer';
};

export type StudentTimetable = {
  today: string;
  range: { start: string; end: string };
  periods: Record<TimetablePeriod, { start: string; end: string }>;
  weekly: TimetableSlot[];
  lessons: TimetableLesson[];
  has_registration: boolean;
};

const DATE_KEY = /^\d{4}-\d{2}-\d{2}$/;

const cleanText = (value: unknown) => String(value || '').normalize('NFKC').trim();

/** 「理科」「物理」→「理科（物理）」。講座名に教科が入っていればそのまま。 */
export function courseLabel(subject: unknown, course: unknown) {
  const s = cleanText(subject);
  const c = cleanText(course);
  if (!c || c === s) return s || '授業';
  if (!s || c.includes(s)) return c;
  return `${s}（${c}）`;
}

/** 「2026-10-20」と「19:20」を日本時間の時刻（ミリ秒）にする。 */
export function lessonTimeMs(date: string, time: string) {
  if (!DATE_KEY.test(date) || !/^\d{2}:\d{2}$/.test(time)) return Number.NaN;
  return Date.parse(`${date}T${time}:00+09:00`);
}

/** 次の授業（いま受けている授業があればそれ）。休講・未定は飛ばす。 */
export function findNextLesson(lessons: TimetableLesson[], now: Date = new Date()) {
  const nowMs = now.getTime();
  return lessons
    .filter(lesson => lesson.status === 'scheduled')
    .map(lesson => ({ lesson, startMs: lessonTimeMs(lesson.date, lesson.start), endMs: lessonTimeMs(lesson.date, lesson.end) }))
    .filter(item => Number.isFinite(item.startMs) && (Number.isFinite(item.endMs) ? item.endMs > nowMs : item.startMs > nowMs))
    .sort((a, b) => a.startMs - b.startMs)[0] || null;
}

const dayNumber = (dateKey: string) => Math.round(Date.parse(`${dateKey}T00:00:00Z`) / 86400000);

/** 「今日」「あした」「あと3日」。始まるまで1時間を切ったら「あと25分」。 */
export function lessonCountdownLabel(lesson: Pick<TimetableLesson, 'date' | 'start' | 'end'>, now: Date = new Date(), today?: string) {
  const startMs = lessonTimeMs(lesson.date, lesson.start);
  const endMs = lessonTimeMs(lesson.date, lesson.end);
  const nowMs = now.getTime();
  if (Number.isFinite(startMs) && startMs <= nowMs && (!Number.isFinite(endMs) || nowMs < endMs)) return '授業中';
  if (Number.isFinite(startMs) && startMs > nowMs && startMs - nowMs < 60 * 60 * 1000) {
    return `あと${Math.max(1, Math.ceil((startMs - nowMs) / 60000))}分`;
  }
  const todayKey = today || jstDateKey(now);
  const diff = dayNumber(lesson.date) - dayNumber(todayKey);
  if (diff <= 0) return '今日';
  if (diff === 1) return 'あした';
  return `あと${diff}日`;
}

/** 開始の何分前か（始まっていれば 0 以下）。 */
export function minutesUntilLesson(lesson: Pick<TimetableLesson, 'date' | 'start'>, now: Date = new Date()) {
  const startMs = lessonTimeMs(lesson.date, lesson.start);
  return Number.isFinite(startMs) ? (startMs - now.getTime()) / 60000 : Number.POSITIVE_INFINITY;
}

/** 「10/20(月)」。 */
export function shortDateWithWeekday(date: string, weekday: string) {
  if (!DATE_KEY.test(date)) return date;
  return `${Number(date.slice(5, 7))}/${Number(date.slice(8, 10))}${weekday ? `(${weekday})` : ''}`;
}
