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

export const isThirdCourseTerm = (option: any) => {
  const term = String(option?.term || option?.term_id || '').normalize('NFKC').replace(/[\s　]/g, '');
  const label = String(option?.term_label || option?.term_name || '').normalize('NFKC').replace(/[\s　]/g, '').toUpperCase();
  return /^term0?3(?:$|[_-])/.test(term.toLowerCase()) || /^(?:第)?(?:3|III)期$/.test(label);
};

export const canStudentRegisterCourseOption = (studentGradeValue: unknown, option: any) => {
  const studentGrade = normalizeCourseGrade(studentGradeValue);
  const optionGrade = normalizeCourseGrade(option?.grade || option?.target_grade);
  if (!studentGrade || !optionGrade || studentGrade === optionGrade) return true;

  // 第III期の中3登録は、管理画面で公開講座を個別指定するまで
  // 安全側として中3講座だけを表示する。
  if (studentGrade === '中3' && isThirdCourseTerm(option)) return false;

  // 原則は当該学年のみ。例外として中1社会・中2社会は、全学年から
  // 相互に選択できる共通講座として扱う（講座登録・振替で共通利用）。
  const subject = getCourseLikeSubjectGroup(option);
  return subject === '社会' && (optionGrade === '中1' || optionGrade === '中2');
};

/** 振替候補の学年範囲。中3は中3のみ、中1・中2は両学年の社会だけ相互利用できる。 */
export const canStudentUseTransferOption = (studentGradeValue: unknown, option: any) => {
  const studentGrade = normalizeCourseGrade(studentGradeValue);
  const optionGrade = normalizeCourseGrade(option?.grade || option?.target_grade);
  if (!studentGrade || !optionGrade || studentGrade === optionGrade) return true;
  if (studentGrade === '中3') return false;
  const subject = getCourseLikeSubjectGroup(option);
  return subject === '社会' && (optionGrade === '中1' || optionGrade === '中2');
};
