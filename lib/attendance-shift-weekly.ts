import {
  SHIFT_CATEGORY_LABELS,
  type AttendanceShiftCategory,
  type AttendanceShiftPlan,
} from '@/lib/attendance-shift-plan';

export const WEEKLY_SHIFT_EXPORT_HEADERS = [
  '日付', '曜日', '教室・ブース', '開始', '終了', '区分', '講師ID', '講師名',
  '生徒ID', '生徒名', '学年', '科目', '授業・業務名', '個別人数', '個別単価',
  '事務内容', 'メモ', '勤怠反映',
] as const;

const weekday = (date: string) => new Intl.DateTimeFormat('ja-JP', {
  timeZone: 'Asia/Tokyo',
  weekday: 'short',
}).format(new Date(`${date}T00:00:00+09:00`));

export function weeklyShiftExportRows(shifts: AttendanceShiftPlan[]) {
  return [...shifts]
    .sort((left, right) => `${left.date} ${left.room || ''} ${left.start} ${left.teacher_name}`.localeCompare(`${right.date} ${right.room || ''} ${right.start} ${right.teacher_name}`, 'ja'))
    .map(shift => [
      shift.date,
      weekday(shift.date),
      shift.room || '未割当',
      shift.start,
      shift.end,
      SHIFT_CATEGORY_LABELS[shift.category],
      shift.teacher_id,
      shift.teacher_name,
      (shift.student_ids || []).join('|'),
      (shift.student_names || []).join('|'),
      shift.grade || '',
      shift.subject || '',
      shift.title || '',
      shift.individual_ratio || '',
      shift.individual_level || '',
      shift.office_task || '',
      shift.note || '',
      shift.reflect_to_attendance ? 'する' : 'しない',
    ]);
}

export function shiftResourceLabel(shift: Pick<AttendanceShiftPlan, 'room'>) {
  return String(shift.room || '').trim() || '未割当';
}

export function overlappingShiftIds(shifts: AttendanceShiftPlan[], category: AttendanceShiftCategory) {
  const conflicts = new Set<string>();
  const grouped = new Map<string, AttendanceShiftPlan[]>();
  shifts.filter(shift => shift.category === category).forEach(shift => {
    const key = `${shift.date}::${shiftResourceLabel(shift)}`;
    grouped.set(key, [...(grouped.get(key) || []), shift]);
  });
  grouped.forEach(items => {
    const sorted = [...items].sort((left, right) => left.start.localeCompare(right.start));
    sorted.forEach((current, index) => {
      sorted.slice(index + 1).forEach(next => {
        if (next.start < current.end && current.start < next.end) {
          conflicts.add(current.id);
          conflicts.add(next.id);
        }
      });
    });
  });
  return conflicts;
}
