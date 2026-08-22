import { getCourseSubjectGroup as getNormalizedCourseSubjectGroup } from '@/lib/course-text';

export type GradeStartDates = Record<string, string | null | undefined>;

export const canRegisterCourseByGrade = (
  grade: string,
  gradeStartDates: GradeStartDates,
  now: Date = new Date(),
) => {
  const startDate = gradeStartDates[grade];
  if (!startDate) return true;
  const start = new Date(`${startDate}T00:00:00+09:00`);
  if (Number.isNaN(start.getTime())) return false;
  return now.getTime() >= start.getTime();
};

export const getCourseRegistrationState = (
  grade: string,
  gradeStartDates: GradeStartDates,
  now: Date = new Date(),
) => {
  const startDate = gradeStartDates[grade] || null;
  return {
    grade,
    startDate,
    canRegister: canRegisterCourseByGrade(grade, gradeStartDates, now),
  };
};

export const normalizeCourseGrade = (value: unknown) => {
  const raw = String(value || '').normalize('NFKC');
  if (raw.includes('3')) return '中3';
  if (raw.includes('2')) return '中2';
  if (raw.includes('1')) return '中1';
  return raw.trim();
};

export const getCourseSubjectGroup = (value: unknown) => {
  return getNormalizedCourseSubjectGroup(value);
};

export const getCourseLikeSubjectGroup = (course: any) => getCourseSubjectGroup([
  course?.subject,
  course?.course_name,
  course?.title,
  course?.target_subject,
  course?.target_detail_subject,
  course?.resolved_unit,
  course?.unit,
].filter(Boolean).join(' '));

export const canStudentRegisterCourseOption = (studentGradeValue: unknown, option: any) => {
  const studentGrade = normalizeCourseGrade(studentGradeValue);
  const optionGrade = normalizeCourseGrade(option?.grade || option?.target_grade);
  if (!studentGrade || !optionGrade || studentGrade === optionGrade) return true;

  const subject = getCourseLikeSubjectGroup(option);
  return studentGrade === '中3' &&
    (optionGrade === '中1' || optionGrade === '中2') &&
    subject === '社会';
};
