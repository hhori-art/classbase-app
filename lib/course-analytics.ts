import { weekdayFromDateKey } from '@/lib/date-key';

const clean = (value: unknown) => String(value || '').normalize('NFKC').trim();

export const analyticsRate = (numerator: number, denominator: number) =>
  denominator > 0 ? Math.round(numerator / denominator * 1000) / 10 : null;

export const analyticsRange = (period: 'week' | 'month', anchor: string) => {
  if (!weekdayFromDateKey(anchor)) throw new Error('invalid analytics anchor');
  const [year, month, day] = anchor.split('-').map(Number);
  const date = new Date(Date.UTC(year, month - 1, day));
  const toKey = (value: Date) => value.toISOString().slice(0, 10);
  if (period === 'week') {
    const weekday = date.getUTCDay() || 7;
    const start = new Date(date); start.setUTCDate(date.getUTCDate() - weekday + 1);
    const end = new Date(start); end.setUTCDate(start.getUTCDate() + 6);
    return { start: toKey(start), end: toKey(end), label: `${start.toLocaleDateString('ja-JP', { timeZone: 'UTC' })}〜${end.toLocaleDateString('ja-JP', { timeZone: 'UTC' })}` };
  }
  const start = new Date(Date.UTC(year, month - 1, 1));
  const end = new Date(Date.UTC(year, month, 0));
  return { start: toKey(start), end: toKey(end), label: `${year}年${month}月` };
};

export const homeworkEligibleStudent = (student: Record<string, unknown>, assignment: Record<string, unknown>) => {
  const targetGrade = clean(assignment.target_grade || assignment.grade);
  if (targetGrade && clean(student.grade || student.target_grade || student.class_grade) !== targetGrade) return false;
  const subject = clean(assignment.subject);
  const subjects = Array.isArray(student.subjects) ? student.subjects.map(clean).filter(Boolean) : [];
  return !subject || subjects.length === 0 || subjects.includes(subject);
};

const attendanceCourseValues = (attendance: Record<string, unknown>) => {
  const participations = Array.isArray(attendance.participations) ? attendance.participations : [];
  const named = participations.flatMap(value => {
    if (!value || typeof value !== 'object') return [];
    const row = value as Record<string, unknown>;
    return [clean(row.course_name), clean(row.class_id)].filter(Boolean);
  });
  const legacyCourse = clean(attendance.course_name || attendance.class_id);
  return Array.from(new Set([...named, legacyCourse].filter(Boolean)));
};

export const attendanceMatchesCourse = (
  attendance: Record<string, unknown>,
  courseLabel: string,
  canonicalize: (value: unknown) => string,
) => {
  const target = canonicalize(courseLabel);
  const named = attendanceCourseValues(attendance).map(canonicalize);
  if (named.length > 0) return named.some(value => value === target);
  const subjects = Array.isArray(attendance.participation_subjects)
    ? attendance.participation_subjects.map(clean)
    : [clean(attendance.subject)].filter(Boolean);
  return subjects.some(subject => target.includes(subject));
};
