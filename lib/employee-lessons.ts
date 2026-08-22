export type EmployeeLessonInput = {
  school_code?: string;
  school_name: string;
  lesson_date: string;
  employee_id?: string;
  person_code?: string;
  employee_name: string;
  start_time: string;
  end_time: string;
  course_name?: string;
  role?: 'main' | 'sub' | 'other';
  note?: string;
};

const clockMinutes = (value: unknown) => {
  const match = String(value || '').trim().match(/^(\d{1,2}):(\d{2})$/);
  if (!match) return null;
  const hour = Number(match[1]);
  const minute = Number(match[2]);
  if (hour < 0 || hour > 23 || minute < 0 || minute > 59) return null;
  return hour * 60 + minute;
};

export function employeeLessonMinutes(start: unknown, end: unknown) {
  const startMinutes = clockMinutes(start);
  let endMinutes = clockMinutes(end);
  if (startMinutes === null || endMinutes === null) return null;
  if (endMinutes <= startMinutes) endMinutes += 24 * 60;
  const duration = endMinutes - startMinutes;
  return duration > 0 && duration <= 12 * 60 ? duration : null;
}

export function validateEmployeeLesson(input: EmployeeLessonInput) {
  const errors: string[] = [];
  if (!/^\d{4}-\d{2}-\d{2}$/.test(input.lesson_date)) errors.push('授業日を入力してください。');
  if (!input.school_name.trim()) errors.push('校舎を入力してください。');
  if (!input.employee_name.trim() && !String(input.person_code || '').trim()) errors.push('職員名または職員コードを入力してください。');
  if (employeeLessonMinutes(input.start_time, input.end_time) === null) errors.push('授業開始・終了時刻を正しく入力してください（最大12時間）。');
  return errors;
}
