export const EMPLOYMENT_CATEGORIES = ['dedicated', 'semi_dedicated'] as const;
export type EmploymentCategory = typeof EMPLOYMENT_CATEGORIES[number];

export const EMPLOYMENT_CATEGORY_LABELS: Record<EmploymentCategory, string> = {
  dedicated: '専任',
  semi_dedicated: '準専任',
};

export function isAttendanceUserRole(role: unknown) {
  return ['teacher', 'attendance_admin', 'attendance_only', 'attendance_manager'].includes(String(role || '').toLowerCase());
}

export function normalizeEmploymentCategory(value: unknown, role?: unknown): EmploymentCategory | null {
  const normalized = String(value || '').normalize('NFKC').trim().toLowerCase();
  if (['dedicated', 'employee', 'full_time', 'regular_employee', '専任', '社員', '正社員'].includes(normalized)) return 'dedicated';
  if (['semi_dedicated', 'part_time', 'part-time', '準専任', 'アルバイト', '非常勤'].includes(normalized)) return 'semi_dedicated';
  // 既存の講師・勤怠利用者はすべて準専任として運用されていたため、未設定時も準専任扱いにする。
  return isAttendanceUserRole(role) ? 'semi_dedicated' : null;
}

export const isDedicatedProfile = (profile: Record<string, unknown>) =>
  normalizeEmploymentCategory(profile.employment_category || profile.employment_type || profile.worker_type, profile.role) === 'dedicated';

export const isSemiDedicatedProfile = (profile: Record<string, unknown>) =>
  normalizeEmploymentCategory(profile.employment_category || profile.employment_type || profile.worker_type, profile.role) === 'semi_dedicated';
