import { normalizeEmploymentCategory, type EmploymentCategory } from '@/lib/employment-category';
import type { AttendanceWorkSegment, IndividualLevel } from '@/lib/attendance-work-detail';

export const ATTENDANCE_SHIFT_CATEGORIES = ['group', 'individual', 'office'] as const;
export type AttendanceShiftCategory = typeof ATTENDANCE_SHIFT_CATEGORIES[number];
export type AttendanceShiftView = 'month' | 'week' | 'day';

export type AttendanceShiftPlan = {
  id: string;
  date: string;
  start: string;
  end: string;
  category: AttendanceShiftCategory;
  teacher_id: string;
  teacher_name: string;
  student_ids?: string[];
  student_names?: string[];
  employment_category: EmploymentCategory | null;
  school_id: string;
  school_name: string;
  title?: string;
  grade?: string;
  subject?: string;
  individual_ratio?: '1:1' | '1:2' | '1:3';
  individual_level?: IndividualLevel;
  office_task?: string;
  room?: string;
  note?: string;
  reflect_to_attendance: boolean;
  created_by?: string;
  created_at?: string;
  updated_at?: string;
};

export const SHIFT_CATEGORY_LABELS: Record<AttendanceShiftCategory, string> = {
  group: '集団',
  individual: '個別',
  office: '事務',
};

export const DATE_KEY_PATTERN = /^\d{4}-\d{2}-\d{2}$/;
export const TIME_LABEL_PATTERN = /^(?:[01]\d|2[0-3]):[0-5]\d$/;

export function isFiveMinuteTime(value: unknown) {
  const label = String(value || '');
  return TIME_LABEL_PATTERN.test(label) && Number(label.slice(3, 5)) % 5 === 0;
}

export function validateAttendanceShiftPlan(input: Partial<AttendanceShiftPlan>) {
  if (!DATE_KEY_PATTERN.test(String(input.date || ''))) return '日付を正しく入力してください。';
  if (!isFiveMinuteTime(input.start) || !isFiveMinuteTime(input.end) || String(input.start) >= String(input.end)) {
    return '開始・終了時刻を5分単位で正しく入力してください。';
  }
  if (!ATTENDANCE_SHIFT_CATEGORIES.includes(input.category as AttendanceShiftCategory)) return '勤務区分を選択してください。';
  if (!String(input.teacher_id || '').trim()) return '職員を選択してください。';
  if (!String(input.school_id || '').trim()) return '勤務校舎を確認してください。';
  if (input.category === 'individual' && !['1:1', '1:2', '1:3'].includes(String(input.individual_ratio || ''))) {
    return '個別指導の人数を選択してください。';
  }
  if (input.category === 'individual') {
    const maximum = Number(String(input.individual_ratio || '1:1').split(':')[1] || 1);
    if ((input.student_ids || []).length > maximum) return `担当生徒は${maximum}名以内で選択してください。`;
  }
  if (input.category === 'office' && !String(input.office_task || '').trim()) return '事務内容を選択してください。';
  return '';
}

export function dateKeyInJapan(value = new Date()) {
  return new Intl.DateTimeFormat('sv-SE', { timeZone: 'Asia/Tokyo' }).format(value);
}

export function addDateDays(date: string, days: number) {
  const value = new Date(`${date}T00:00:00+09:00`);
  value.setUTCDate(value.getUTCDate() + days);
  return new Intl.DateTimeFormat('sv-SE', { timeZone: 'Asia/Tokyo' }).format(value);
}

export function dateDiffDays(from: string, to: string) {
  const left = new Date(`${from}T00:00:00+09:00`).getTime();
  const right = new Date(`${to}T00:00:00+09:00`).getTime();
  return Math.round((right - left) / 86_400_000);
}

export function normalizeShiftEmploymentCategory(profile: Record<string, unknown>) {
  return normalizeEmploymentCategory(profile.employment_category || profile.employment_type || profile.worker_type, profile.role);
}

export function shiftPlanToAttendanceSegment(plan: Partial<AttendanceShiftPlan>): Partial<AttendanceWorkSegment> {
  if (plan.category === 'individual') {
    return {
      id: plan.id,
      start: plan.start,
      end: plan.end,
      type: 'individual',
      program: 'normal',
      lesson_format: 'individual',
      individual_level: plan.individual_level || 'standard',
      individual_ratio: plan.individual_ratio || '1:2',
      note: [plan.title, plan.subject, plan.room, ...(plan.student_names || []), plan.note].filter(Boolean).join(' / '),
      school_id: plan.school_id,
      approval_status: 'pending',
    };
  }
  if (plan.category === 'group') {
    return {
      id: plan.id,
      start: plan.start,
      end: plan.end,
      type: 'lesson',
      program: 'normal',
      lesson_format: 'group',
      grade: plan.grade || 'その他',
      note: [plan.title, plan.subject, plan.room, plan.note].filter(Boolean).join(' / '),
      school_id: plan.school_id,
      approval_status: 'pending',
    };
  }
  return {
    id: plan.id,
    start: plan.start,
    end: plan.end,
    type: 'office',
    program: 'normal',
    office_task: plan.office_task || 'lesson_preparation',
    note: [plan.title, plan.room, plan.note].filter(Boolean).join(' / '),
    school_id: plan.school_id,
    approval_status: 'pending',
  };
}
