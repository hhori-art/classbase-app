import { weekdayFromDateKey } from '@/lib/date-key';
import {
  courseLabel,
  shortDateWithWeekday,
  type StudentTimetable,
  type TimetableLesson,
  type TimetablePeriod,
} from '@/lib/timetable';

/**
 * 時間割の14日間の授業に、確定した振替を重ねる（サーバーで Firestore から読んだ申請を渡す）。
 * - 振替先の授業：「振替」として追加（同じ日・時限の行があれば置き換える）
 * - 振替のもとになった欠席の日：その日の授業を「欠席（振替あり）」にする
 * 取り消し・却下された申請は使わない。
 */

type RequestRow = Record<string, any> & { id: string };

const clean = (value: unknown) => String(value || '').trim();
const dateOf = (value: unknown) => clean(value).slice(0, 10);
const INACTIVE = new Set(['cancelled', 'rejected']);

export const isActiveTransferRequest = (row: RequestRow) =>
  clean(row.type || 'transfer') === 'transfer' && !INACTIVE.has(clean(row.status));

/** 振替がついた欠席連絡（振替が取り消されたもの・遅刻は除く）。 */
export const isAbsenceWithTransfer = (row: RequestRow) =>
  clean(row.type || 'absence') === 'absence'
  && !INACTIVE.has(clean(row.status))
  && clean(row.absence_type) !== 'late'
  && Boolean(clean(row.transfer_request_id))
  && clean(row.transfer_status) !== 'cancelled';

const toPeriod = (value: unknown): TimetablePeriod | 0 => {
  const match = clean(value).normalize('NFKC').match(/[12]/);
  return match ? Number(match[0]) as TimetablePeriod : 0;
};

export function applyTransfersToLessons(lessons: TimetableLesson[], input: {
  range: StudentTimetable['range'];
  periods: StudentTimetable['periods'];
  transfers: RequestRow[];
  absences: RequestRow[];
  /** 申請に時限が無いとき、振替先の講師配置から時限を引く。 */
  periodForShiftId?: (shiftId: string) => number | null | undefined;
}): TimetableLesson[] {
  const inRange = (date: string) => Boolean(date) && date >= input.range.start && date <= input.range.end;
  const byKey = new Map(lessons.map(lesson => [`${lesson.date}_${lesson.period}`, lesson]));
  const activeTransfers = input.transfers.filter(isActiveTransferRequest);

  activeTransfers.forEach(transfer => {
    const date = dateOf(transfer.target_date);
    if (!inRange(date)) return;
    const shiftId = clean(transfer.transfer_shift_id || transfer.target_shift_id);
    const period = toPeriod(transfer.transfer_period) || toPeriod(shiftId ? input.periodForShiftId?.(shiftId) : '');
    if (!period) return;
    const absenceDate = dateOf(transfer.absence_date);
    byKey.set(`${date}_${period}`, {
      id: `transfer_${transfer.id}`,
      date,
      weekday: weekdayFromDateKey(date),
      period,
      start: input.periods[period].start,
      end: input.periods[period].end,
      label: courseLabel(transfer.transfer_subject, transfer.transfer_course_name),
      unit: clean(transfer.transfer_unit),
      status: 'scheduled',
      note: absenceDate ? `${shortDateWithWeekday(absenceDate, weekdayFromDateKey(absenceDate))}の振替` : '振替',
      kind: 'transfer',
    });
  });

  // 欠席連絡は1日1件なので、その日の授業（休講を除く）をすべて「欠席（振替あり）」にする。
  const absentDates = new Set<string>([
    ...activeTransfers.map(transfer => dateOf(transfer.absence_date)),
    ...input.absences.filter(isAbsenceWithTransfer).map(absence => dateOf(absence.target_date)),
  ].filter(inRange));

  return Array.from(byKey.values())
    .map(lesson => (
      absentDates.has(lesson.date) && lesson.kind !== 'transfer' && lesson.status !== 'cancelled'
        ? { ...lesson, status: 'absent' as const, note: '振替あり' }
        : lesson
    ))
    .sort((a, b) => `${a.date}_${a.period}`.localeCompare(`${b.date}_${b.period}`));
}
