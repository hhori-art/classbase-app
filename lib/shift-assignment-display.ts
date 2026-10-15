import { canonicalPeriodForGradeSubject, fixedPeriodForGradeCourse } from '@/lib/course-registration-match';
import { normalizeShiftCourseIdentity, normalizeShiftGrade, normalizeShiftIdentityText, normalizeShiftSubject, redirectedShiftDetailFromTeacher, shiftTeacherNameAfterChange } from '@/lib/shift-sync-normalization';

type ShiftLike = Record<string, any> & { id?: string };

const periodOf = (shift: ShiftLike): 1 | 2 => {
  const isLegacyCorrectionDate = String(shift.target_date || '') === '2026-09-11';
  // 同期元が明示した時限を優先し、固定時間割は時限欠損時だけ補完に使う。
  const explicit = Number(shift.period) === 2 || String(shift.note || '').normalize('NFKC').includes('2限')
    ? 2
    : Number(shift.period) === 1 || String(shift.note || '').normalize('NFKC').includes('1限')
      ? 1
      : null;
  if (explicit && !isLegacyCorrectionDate) return explicit;
  const fixed = fixedPeriodForGradeCourse(
    shift.target_grade || shift.grade,
    shift.target_detail_subject || shift.detail_subject,
  );
  if (fixed) return fixed;
  if (isLegacyCorrectionDate) {
    const canonical = canonicalPeriodForGradeSubject(
      shift.target_grade || shift.grade,
      shift.target_subject || shift.subject,
      shift.target_detail_subject || shift.detail_subject,
    );
    if (canonical) return canonical;
  }
  if (explicit) return explicit;
  return 1;
};

const withCorrectedPeriod = <T extends ShiftLike>(shift: T): T => {
  const period = periodOf(shift);
  const note = String(shift.note || '');
  return {
    ...shift,
    period,
    note: note ? note.replace(/^【[１２12]限】/, `【${period}限】`) : `【${period}限】`,
  };
};

const isSheetShift = (shift: ShiftLike) => Boolean(
  String(shift.source_spreadsheet_id || '').trim()
  || ['google_sheet', 'google_sheets', 'gas'].includes(String(shift.sync_source || '').trim().toLowerCase())
);

const classKey = (shift: ShiftLike) => {
  const meetingId = String(shift.target_meeting_id || shift.meeting_id || '').replace(/\D/g, '');
  const courseIdentity = (shift.role_type || 'main') === 'main' && meetingId
    ? `meeting:${meetingId}`
    : normalizeShiftCourseIdentity(shift.target_detail_subject || shift.detail_subject);
  return [
    String(shift.target_date || ''),
    periodOf(shift),
    normalizeShiftGrade(shift.target_grade || shift.grade),
    normalizeShiftSubject(shift.target_subject || shift.subject),
    courseIdentity,
  ].join('|');
};

const redirectedMainKey = (shift: ShiftLike, detail: unknown) => [
  String(shift.target_date || ''),
  periodOf(shift),
  normalizeShiftGrade(shift.target_grade || shift.grade),
  normalizeShiftSubject(shift.target_subject || shift.subject),
  normalizeShiftCourseIdentity(detail),
].join('|');

const normalizedTeacher = (value: unknown) => {
  const raw = String(value || '');
  const finalName = raw.includes('⇒') ? raw.split('⇒').pop() : raw;
  return normalizeShiftIdentityText(String(finalName || '').replace(/^【遠】/, '').replace(/先生$/, ''));
};

const preferSheet = <T extends ShiftLike>(current: T | undefined, next: T) => {
  if (!current) return next;
  return isSheetShift(next) && !isSheetShift(current) ? next : current;
};

/** 同期配置を正として旧取込との二重表示を除き、手動追加は維持する。 */
export const selectDisplayShiftAssignments = <T extends ShiftLike>(input: T[]): T[] => {
  const corrected = input.map(withCorrectedPeriod).map(shift => (
    (shift.role_type || 'main') === 'main' && !redirectedShiftDetailFromTeacher(shift.teacher_name, shift.target_detail_subject || shift.detail_subject)
      ? { ...shift, teacher_name: shiftTeacherNameAfterChange(shift.teacher_name) } as T
      : shift
  ));
  const mainByDateDetail = new Map<string, T>();
  corrected.forEach(shift => {
    if ((shift.role_type || 'main') !== 'main' || redirectedShiftDetailFromTeacher(shift.teacher_name, shift.target_detail_subject || shift.detail_subject)) return;
    mainByDateDetail.set(redirectedMainKey(shift, shift.target_detail_subject || shift.detail_subject), shift);
  });
  const shifts = corrected
    .map(shift => {
      const redirectedDetail = (shift.role_type || 'main') === 'main'
        ? redirectedShiftDetailFromTeacher(shift.teacher_name, shift.target_detail_subject || shift.detail_subject)
        : '';
      if (!redirectedDetail) return shift;
      const destination = mainByDateDetail.get(redirectedMainKey(shift, redirectedDetail));
      return destination ? { ...shift, teacher_name: destination.teacher_name, user_id: destination.user_id || '' } as T : shift;
    })
    // 講師アカウントに一致しない同期サポートと、旧GASが講師欄として
    // 読み込んだ「202A 最難関」等の教室情報を除外する。
    .filter(shift => !(isSheetShift(shift) && shift.role_type !== 'main' && !String(shift.user_id || '').trim()))
    .filter(shift => !(shift.role_type === 'general' && /^\d{3}[a-z](?:\s|$)/i.test(String(shift.teacher_name || '').normalize('NFKC').trim())));

  const mains = new Map<string, T>();
  const replacedMainIds = new Map<string, string>();
  shifts.filter(shift => (shift.role_type || 'main') === 'main').forEach(shift => {
    const key = classKey(shift);
    const current = mains.get(key);
    const preferred = preferSheet(current, shift);
    mains.set(key, preferred);
    const discarded = preferred === shift ? current : shift;
    if (discarded?.id && preferred.id) replacedMainIds.set(String(discarded.id), String(preferred.id));
  });

  const others = new Map<string, T>();
  shifts.filter(shift => (shift.role_type || 'main') !== 'main').forEach(original => {
    const replacementParent = replacedMainIds.get(String(original.parent_id || ''));
    const shift = replacementParent ? { ...original, parent_id: replacementParent } as T : original;
    const key = [shift.role_type, classKey(shift), periodOf(shift), normalizedTeacher(shift.teacher_name)].join('|');
    others.set(key, preferSheet(others.get(key), shift));
  });

  const otherValues = [...others.values()];
  const todaySubs = new Map<string, T>();
  otherValues.filter(shift => shift.role_type === 'sub' && shift.target_date === '2026-09-11').forEach(shift => {
    const key = `${classKey(shift)}|${periodOf(shift)}`;
    todaySubs.set(key, preferSheet(todaySubs.get(key), shift));
  });

  return [
    ...mains.values(),
    ...otherValues.filter(shift => shift.role_type !== 'sub' || shift.target_date !== '2026-09-11'),
    ...todaySubs.values(),
  ];
};
