import { addDateDays, shiftPlanToAttendanceSegment, type AttendanceShiftPlan } from '@/lib/attendance-shift-plan';
import { normalizeAttendanceSegment, type AttendanceWorkSegment } from '@/lib/attendance-work-detail';
import { resolveAttendanceSchoolCode } from '@/lib/attendance-schools';

// 勤務詳細の「下書き」づくりと、未入力の勤務の洗い出し。
// 変換は管理画面（/api/attendance-detail-approvals の use_shift_base）と同じ shiftPlanToAttendanceSegment を使う。
// ここで作るのは画面上の下書きだけで、保存は講師が「保存して完了」を押したときに限る。

export type DraftWorkSegment = AttendanceWorkSegment & { from_shift_plan?: boolean };

const minutesOf = (value: unknown) => {
  const match = String(value || '').match(/^(\d{2}):(\d{2})$/);
  return match ? Number(match[1]) * 60 + Number(match[2]) : -1;
};
const labelOf = (minutes: number) => `${String(Math.floor(minutes / 60)).padStart(2, '0')}:${String(minutes % 60).padStart(2, '0')}`;

export function draftSegmentsFromShiftPlans(
  plans: Array<Partial<AttendanceShiftPlan>>,
  options: { teacherId: string; date?: string; schoolId?: string | null; rangeStart?: string; rangeEnd?: string },
): DraftWorkSegment[] {
  const schoolId = resolveAttendanceSchoolCode(options.schoolId || '');
  const rangeStart = minutesOf(options.rangeStart);
  const rangeEnd = minutesOf(options.rangeEnd);
  const drafts = plans
    .filter(plan => String(plan.teacher_id || '') === options.teacherId)
    .filter(plan => plan.reflect_to_attendance !== false)
    .filter(plan => !options.date || String(plan.date || '') === options.date)
    .filter(plan => !schoolId || resolveAttendanceSchoolCode(plan.school_id || '') === schoolId)
    .map(plan => {
      // 管理側の承認状態・シフトIDは勤務実績の行には持ち込まない（保存時にサーバーが付け直す）。
      const { id: _id, approval_status: _approval, ...segment } = shiftPlanToAttendanceSegment(plan);
      return segment;
    })
    .map(segment => {
      let start = minutesOf(segment.start);
      let end = minutesOf(segment.end);
      // 打刻（5分丸め後）の範囲に収める。範囲外のままだと保存時に必ずエラーになるため。
      if (rangeStart >= 0) start = Math.max(start, rangeStart);
      if (rangeEnd >= 0) end = Math.min(end, rangeEnd);
      return { segment, start, end };
    })
    .filter(item => item.start >= 0 && item.end > item.start)
    .sort((a, b) => a.start - b.start);

  const result: DraftWorkSegment[] = [];
  let cursor = -1;
  for (const item of drafts) {
    const start = Math.max(item.start, cursor);
    if (item.end <= start) continue; // 重なった予定は先の予定を優先する
    result.push({
      ...normalizeAttendanceSegment({ ...item.segment, start: labelOf(start), end: labelOf(item.end) }),
      from_shift_plan: true,
    });
    cursor = item.end;
  }
  return result;
}

export const WORK_DETAIL_REMINDER_DAYS = 14;

export function workDetailReminderRange(today: string, days = WORK_DETAIL_REMINDER_DAYS) {
  return { start: addDateDays(today, -(days - 1)), end: today };
}

type ReminderRecord = { id: string; date?: string; end_time?: string | null; status?: string; work_segments?: unknown };

/** 直近 days 日のうち、退勤済み・未承認で勤務詳細が1件もない勤務記録（新しい日付順）。 */
export function recordsMissingWorkDetails<T extends ReminderRecord>(records: T[], today: string, days = WORK_DETAIL_REMINDER_DAYS): T[] {
  const { start, end } = workDetailReminderRange(today, days);
  return records
    .filter(record => {
      const date = String(record.date || '');
      if (date < start || date > end) return false;
      if (!record.end_time || record.status === 'approved') return false;
      return !Array.isArray(record.work_segments) || record.work_segments.length === 0;
    })
    .sort((a, b) => String(b.date || '').localeCompare(String(a.date || '')));
}
