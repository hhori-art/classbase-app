import { isTestPrepShift } from '@/lib/class-button-settings';
import { getCourseOptionStableKey } from '@/lib/course-registration-selection';
import { getCourseSubjectGroup, normalizeCourseText, toAsciiDigits } from '@/lib/course-text';
import { jstSchoolYear, weekdayFromDateKey } from '@/lib/date-key';

export type TestPrepCourseDefinition = {
  id: string;
  year: number;
  title: string;
  grade: string;
  subject: string;
  course_name: string;
  units: string[];
  start_date: string;
  end_date: string;
  registration_open_date: string;
  registration_close_date: string;
  allowed_student_grades: string[];
  is_active: boolean;
};

export const normalizeGrade = (value: unknown) => {
  const raw = toAsciiDigits(String(value || '').normalize('NFKC'));
  if (raw.includes('3')) return '中3';
  if (raw.includes('2')) return '中2';
  if (raw.includes('1')) return '中1';
  return raw.trim();
};

const normalizeCourse = (value: unknown) => normalizeCourseText(value)
  .replace(/定期テスト対策|テスト対策|対策/g, '')
  // 同じ講座の枝番（公民(2)、歴史②、地理C など）は照合上区別しない。
  .replace(/(?:[1-9①-⑩Ⅰ-Ⅹ]+|[a-d])$/gi, '');

const shiftPeriod = (shift: any) => {
  const explicit = Number(shift.period || shift.target_period || 0);
  if (explicit === 1 || explicit === 2) return explicit;
  const raw = toAsciiDigits(`${shift.note || ''} ${shift.time_slot || ''}`);
  if (raw.includes('2限') || raw.includes('2時間目')) return 2;
  if (raw.includes('1限') || raw.includes('1時間目')) return 1;
  return 0;
};

export const testPrepDefinitionMatchesShift = (definition: TestPrepCourseDefinition, shift: any) => {
  const date = String(shift.target_date || '').slice(0, 10);
  if (!date || date < definition.start_date || date > definition.end_date) return false;
  if (normalizeGrade(shift.target_grade || shift.grade) !== normalizeGrade(definition.grade)) return false;
  const definitionSubject = getCourseSubjectGroup(definition.subject);
  const shiftSubject = getCourseSubjectGroup([shift.target_subject, shift.subject, shift.target_detail_subject].filter(Boolean).join(' '));
  if (definitionSubject && shiftSubject && definitionSubject !== shiftSubject) return false;
  const expectedCourse = normalizeCourse(definition.course_name);
  const actualCourse = normalizeCourse(shift.target_detail_subject || shift.detail_subject || shift.target_subject);
  return !expectedCourse || !actualCourse || expectedCourse === actualCourse || expectedCourse.includes(actualCourse) || actualCourse.includes(expectedCourse);
};

/**
 * 専用設定がまだ作られていない対策講座は、移行期間中の公開設定で表示する。
 * 科目ごとに判定するため、理科だけ設定済みでも社会が消えない。
 */
export const shouldUseTestPrepVisibilityFallback = (
  definitions: TestPrepCourseDefinition[],
  shift: any,
  studentGrade: unknown,
) => isTestPrepShift(shift) && !definitions.some(definition => (
  canStudentUseTestPrepDefinition(studentGrade, definition) &&
  testPrepDefinitionMatchesShift(definition, shift)
));

export const normalizeTestPrepDefinition = (id: string, value: any): TestPrepCourseDefinition => {
  const units = Array.isArray(value?.units)
    ? value.units.map((unit: unknown) => String(unit || '').trim()).filter(Boolean)
    : String(value?.units || value?.unit || '').split(/\r?\n|、/).map(unit => unit.trim()).filter(Boolean);
  const grade = normalizeGrade(value?.grade);
  const allowed = Array.isArray(value?.allowed_student_grades)
    ? value.allowed_student_grades.map(normalizeGrade).filter(Boolean)
    : [grade].filter(Boolean);
  return {
    id,
    year: Number(value?.year || jstSchoolYear()),
    title: String(value?.title || 'テスト対策').trim(),
    grade,
    subject: String(value?.subject || '').trim(),
    course_name: String(value?.course_name || '').trim(),
    units: Array.from(new Set(units)),
    start_date: String(value?.start_date || '').slice(0, 10),
    end_date: String(value?.end_date || '').slice(0, 10),
    registration_open_date: String(value?.registration_open_date || value?.registration_opens_at || value?.start_date || '').slice(0, 10),
    registration_close_date: String(value?.registration_close_date || value?.registration_closes_at || value?.end_date || '').slice(0, 10),
    allowed_student_grades: Array.from(new Set(allowed)),
    is_active: value?.is_active !== false,
  };
};

export const canStudentUseTestPrepDefinition = (studentGrade: unknown, definition: TestPrepCourseDefinition) => {
  const grade = normalizeGrade(studentGrade);
  return definition.is_active && Boolean(grade) && definition.allowed_student_grades.includes(grade);
};

export const buildTestPrepRegistrationOptions = (
  definitions: TestPrepCourseDefinition[],
  shifts: any[],
  studentGrade?: unknown,
) => definitions
  .filter(definition => definition.is_active && definition.start_date && definition.end_date)
  .filter(definition => !studentGrade || canStudentUseTestPrepDefinition(studentGrade, definition))
  .flatMap(definition => {
    const matched = shifts
      .filter(shift => String(shift.role_type || 'main') === 'main')
      .filter(isTestPrepShift)
      .filter(shift => testPrepDefinitionMatchesShift(definition, shift));
    const groups = new Map<string, any[]>();
    matched.forEach(shift => {
      const day = weekdayFromDateKey(String(shift.target_date || ''));
      const period = shiftPeriod(shift);
      if (!day || !period) return;
      const key = `${day}_${period}`;
      if (!groups.has(key)) groups.set(key, []);
      groups.get(key)!.push(shift);
    });
    return Array.from(groups.entries()).map(([scheduleKey, group]) => {
      const [day, period] = scheduleKey.split('_');
      const dates = Array.from(new Set(group.map(shift => String(shift.target_date || '')).filter(Boolean))).sort();
      const result = {
        id: `test_prep_${definition.id}_${day}_${period}`,
        test_prep_definition_id: definition.id,
        registration_type: 'test_prep',
        source: 'test_prep_definition',
        year: definition.year,
        term: `test_prep_${definition.id}`,
        term_label: definition.title,
        grade: definition.grade,
        subject: definition.subject,
        course_name: definition.course_name,
        title: `${definition.title} ${definition.grade} ${definition.course_name}`.trim(),
        curriculum_units: definition.units,
        matched_units: definition.units,
        resolved_unit: definition.units[0] || '',
        resolved_day: day,
        resolved_slot: `${period}時間目`,
        matched_shift_ids: group.map(shift => String(shift.id || '')).filter(Boolean),
        matched_dates: dates,
        start_date: definition.start_date,
        end_date: definition.end_date,
        term_start_date: definition.start_date,
        registration_opens_at: definition.registration_open_date,
        registration_closes_at: definition.registration_close_date,
        shift_match_status: 'matched',
        representative_policy: 'test_prep_definition_day_slot',
      };
      return { ...result, stable_course_key: getCourseOptionStableKey(result) };
    });
  })
  .sort((a, b) => `${a.start_date}_${a.grade}_${a.subject}_${a.course_name}_${a.resolved_day}_${a.resolved_slot}`
    .localeCompare(`${b.start_date}_${b.grade}_${b.subject}_${b.course_name}_${b.resolved_day}_${b.resolved_slot}`, 'ja', { numeric: true }));

export const testPrepTermRanges = (definitions: TestPrepCourseDefinition[]) => Object.fromEntries(
  definitions
    .filter(definition => definition.is_active && definition.start_date && definition.end_date)
    .map(definition => [`${definition.year}__test_prep_${definition.id}`, { start: definition.start_date, end: definition.end_date }]),
);
