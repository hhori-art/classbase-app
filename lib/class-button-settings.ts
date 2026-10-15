export const CLASS_BUTTON_GRADES = ['中1', '中2', '中3'] as const;
export type ClassButtonGrade = typeof CLASS_BUTTON_GRADES[number];
export type TestPrepGradeVisibility = Record<ClassButtonGrade, ClassButtonGrade[]>;

export type ClassButtonSettings = {
  period1_start: string;
  period1_end: string;
  period2_start: string;
  period2_end: string;
  show_before_minutes: number;
  show_after_minutes: number;
  test_prep_enabled: boolean;
  test_prep_grade_visibility: TestPrepGradeVisibility;
};

export const DEFAULT_TEST_PREP_GRADE_VISIBILITY: TestPrepGradeVisibility = {
  中1: ['中1', '中2'],
  中2: ['中1', '中2'],
  中3: ['中3'],
};

export const DEFAULT_CLASS_BUTTON_SETTINGS: ClassButtonSettings = {
  period1_start: '19:20',
  period1_end: '20:25',
  period2_start: '20:35',
  period2_end: '21:40',
  show_before_minutes: 45,
  show_after_minutes: 0,
  test_prep_enabled: true,
  test_prep_grade_visibility: DEFAULT_TEST_PREP_GRADE_VISIBILITY,
};

export function normalizeClassButtonSettings(data: Partial<ClassButtonSettings> = {}): ClassButtonSettings {
  const timePattern = /^\d{2}:\d{2}$/;
  const normalizeTime = (value: unknown, fallback: string) => {
    const text = String(value || '').trim();
    return timePattern.test(text) ? text : fallback;
  };
  const normalizeMinutes = (value: unknown, fallback: number) => {
    const num = Number(value);
    if (!Number.isFinite(num)) return fallback;
    return Math.max(0, Math.min(180, Math.round(num)));
  };
  const rawVisibility = data.test_prep_grade_visibility && typeof data.test_prep_grade_visibility === 'object'
    ? data.test_prep_grade_visibility as Partial<Record<ClassButtonGrade, unknown>>
    : {};
  const testPrepGradeVisibility = Object.fromEntries(CLASS_BUTTON_GRADES.map(grade => {
    const supplied = rawVisibility[grade];
    const normalized = Array.isArray(supplied)
      ? CLASS_BUTTON_GRADES.filter(candidate => supplied.map(String).includes(candidate))
      : [...DEFAULT_TEST_PREP_GRADE_VISIBILITY[grade]];
    return [grade, normalized];
  })) as TestPrepGradeVisibility;

  return {
    period1_start: normalizeTime(data.period1_start, DEFAULT_CLASS_BUTTON_SETTINGS.period1_start),
    period1_end: normalizeTime(data.period1_end, DEFAULT_CLASS_BUTTON_SETTINGS.period1_end),
    period2_start: normalizeTime(data.period2_start, DEFAULT_CLASS_BUTTON_SETTINGS.period2_start),
    period2_end: normalizeTime(data.period2_end, DEFAULT_CLASS_BUTTON_SETTINGS.period2_end),
    show_before_minutes: normalizeMinutes(data.show_before_minutes, DEFAULT_CLASS_BUTTON_SETTINGS.show_before_minutes),
    show_after_minutes: normalizeMinutes(data.show_after_minutes, DEFAULT_CLASS_BUTTON_SETTINGS.show_after_minutes),
    test_prep_enabled: data.test_prep_enabled !== false,
    test_prep_grade_visibility: testPrepGradeVisibility,
  };
}

export function isTestPrepShift(shift: Record<string, unknown>) {
  return /対策/.test([
    shift.target_subject,
    shift.subject,
    shift.target_detail_subject,
    shift.detail_subject,
    shift.course_name,
    shift.unit,
    shift.note,
  ].map(value => String(value || '')).join(' ').normalize('NFKC'));
}

export function canStudentSeeTestPrepGrade(
  studentGrade: unknown,
  shiftGrade: unknown,
  settings: ClassButtonSettings,
) {
  if (!settings.test_prep_enabled) return false;
  const student = CLASS_BUTTON_GRADES.find(grade => grade === String(studentGrade || '').normalize('NFKC'));
  const target = CLASS_BUTTON_GRADES.find(grade => grade === String(shiftGrade || '').normalize('NFKC'));
  if (!student || !target) return false;
  return settings.test_prep_grade_visibility[student].includes(target);
}

export function isClassButtonVisible(now: Date | null, start: string, end: string, settings: ClassButtonSettings) {
  if (!now) return false;
  const currentMinutes = now.getHours() * 60 + now.getMinutes();
  const [startH, startM] = start.split(':').map(Number);
  const [endH, endM] = end.split(':').map(Number);
  const showStartMinutes = (startH * 60 + startM) - settings.show_before_minutes;
  const showEndMinutes = (endH * 60 + endM) + settings.show_after_minutes;
  return currentMinutes >= showStartMinutes && currentMinutes <= showEndMinutes;
}
