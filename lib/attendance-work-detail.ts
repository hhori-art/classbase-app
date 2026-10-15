export const ATTENDANCE_PROGRAMS = ['normal', 'science_social', 'breakthrough'] as const;
export type AttendanceProgram = typeof ATTENDANCE_PROGRAMS[number];

export const ATTENDANCE_PROGRAM_LABELS: Record<AttendanceProgram, string> = {
  normal: '通常',
  science_social: '理社講座',
  breakthrough: '突破ゼミ',
};

export const ATTENDANCE_GRADES = [
  '小1', '小2', '小3', '小4', '小5', '小6',
  '中1', '中2', '中3', '高1', '高2', '高3', 'その他',
] as const;

export const OFFICE_TASK_OPTIONS = [
  { value: 'lesson_preparation', label: '授業準備' },
  { value: 'instruction_report', label: '指導報告書' },
  { value: 'grading', label: '採点・成績処理' },
  { value: 'student_support', label: '生徒対応・質問対応' },
  { value: 'parent_contact', label: '保護者連絡・面談' },
  { value: 'meeting', label: '会議・打合せ' },
  { value: 'material_creation', label: '教材・掲示物作成' },
  { value: 'classroom_operation', label: '教室運営・清掃・受付' },
  { value: 'training', label: '研修' },
  { value: 'transport', label: '送迎・移動対応' },
  { value: 'other', label: 'その他の事務' },
] as const;

export type AttendanceWorkSegment = {
  id?: string;
  start: string;
  end: string;
  type: string;
  note?: string;
  isAuto?: boolean;
  program?: AttendanceProgram;
  grade?: string;
  lesson_format?: 'group' | 'individual';
  individual_level?: 'standard' | 'advanced';
  individual_ratio?: '1:1' | '1:2' | '1:3';
  office_task?: string;
  payroll_tier?: string;
  school_id?: string;
  approval_status?: 'pending' | 'approved' | 'rejected';
  review_note?: string;
  reviewed_by?: string;
  reviewed_at?: string;
};

export function attendanceSegmentNeedsSchool(segment: Partial<AttendanceWorkSegment>) {
  return segment.type !== 'break' && segmentProgram(segment) !== 'science_social';
}

export function segmentProgram(segment: Partial<AttendanceWorkSegment>): AttendanceProgram {
  if (ATTENDANCE_PROGRAMS.includes(segment.program as AttendanceProgram)) return segment.program as AttendanceProgram;
  return String(segment.type || '').startsWith('breakthrough') ? 'breakthrough' : 'normal';
}

export function payrollTierForSegment(segment: Partial<AttendanceWorkSegment>) {
  if (segment.type === 'break') return null;
  if (segment.type === 'support' || segment.type === 'interview') return 'sub_staff';
  if (segment.type === 'individual' || segment.lesson_format === 'individual') {
    const ratioIndex = segment.individual_ratio === '1:2' ? 2 : segment.individual_ratio === '1:3' ? 3 : 1;
    return `individual_${segment.individual_level === 'advanced' ? ratioIndex + 3 : ratioIndex}`;
  }
  if (segment.type === 'lesson' || segment.type === 'breakthrough' || segment.type === 'breakthrough_lesson') return 'group_lesson';
  if (segment.office_task === 'training') return 'training_1';
  return 'office';
}

export function normalizeAttendanceSegment<T extends Partial<AttendanceWorkSegment>>(segment: T): T & AttendanceWorkSegment {
  const type = segment.type === 'interview' ? 'support' : segment.type === 'breakthrough' ? 'breakthrough_lesson' : String(segment.type || 'office');
  const normalized = {
    ...segment,
    start: String(segment.start || ''),
    end: String(segment.end || ''),
    type,
    note: String(segment.note || ''),
    program: segmentProgram({ ...segment, type }),
  } as T & AttendanceWorkSegment;
  const payrollTier = payrollTierForSegment(normalized);
  const withPayrollTier = payrollTier
    ? { ...normalized, payroll_tier: payrollTier }
    : normalized;

  // Firestore Web SDK は配列内オブジェクトに undefined が1項目でもあると更新全体を拒否する。
  // UI上の任意項目は未設定時にキー自体を除外して、常に保存可能な形へ正規化する。
  return Object.fromEntries(
    Object.entries(withPayrollTier).filter(([, value]) => value !== undefined)
  ) as T & AttendanceWorkSegment;
}

export function validateAttendanceSegment(segment: AttendanceWorkSegment) {
  if (attendanceSegmentNeedsSchool(segment) && !String(segment.school_id || '').trim()) {
    return '通常・突破ゼミの勤務は、勤務した校舎を選択してください。';
  }
  if (segment.type === 'lesson') {
    if (!segment.grade) return '授業をした学年を選択してください。';
  }
  if (segment.type === 'individual') {
    if (!segment.individual_level) return '個別指導の単価区分を選択してください。';
    if (!segment.individual_ratio) return '個別指導の人数（1対1〜1対3）を選択してください。';
  }
  if (segment.type === 'office' && !segment.office_task) return '事務の内容を選択してください。';
  if ((segment.type === 'other' || segment.office_task === 'other') && !String(segment.note || '').trim()) return '「その他」の具体的な内容を入力してください。';
  return '';
}

const timeMinutes = (value: string) => {
  const match = String(value || '').match(/^(\d{2}):(\d{2})$/);
  return match ? Number(match[1]) * 60 + Number(match[2]) : -1;
};

const jstClockMinutes = (value: unknown) => {
  const date = new Date(String(value || ''));
  if (Number.isNaN(date.getTime())) return -1;
  const parts = new Intl.DateTimeFormat('en-GB', {
    timeZone: 'Asia/Tokyo', hour: '2-digit', minute: '2-digit', hourCycle: 'h23',
  }).formatToParts(date);
  const hour = Number(parts.find(part => part.type === 'hour')?.value ?? -1);
  const minute = Number(parts.find(part => part.type === 'minute')?.value ?? -1);
  return hour >= 0 && minute >= 0 ? hour * 60 + minute : -1;
};

export function validateAttendanceSegmentCoverage(
  segments: AttendanceWorkSegment[],
  startTime: unknown,
  endTime: unknown,
) {
  const rawStart = jstClockMinutes(startTime);
  const rawEnd = jstClockMinutes(endTime);
  if (rawStart < 0 || rawEnd < 0) return '出退勤時刻を確認できません。';
  const roundedStart = Math.ceil(rawStart / 5) * 5;
  const roundedEnd = Math.floor(rawEnd / 5) * 5;
  if (roundedEnd <= roundedStart) return '勤務時間が5分未満のため、業務詳細を登録できません。';

  let cursor = roundedStart;
  let workMinutes = 0;
  let breakMinutes = 0;
  for (const segment of segments) {
    const start = timeMinutes(segment.start);
    const end = timeMinutes(segment.end);
    if (start % 5 !== 0 || end % 5 !== 0) return '業務内訳は5分単位で入力してください。';
    if (start < roundedStart || end > roundedEnd) return '業務内訳は打刻時間の範囲内で入力してください。';
    if (start !== cursor) return '業務内訳の間に空白または重複があります。';
    const minutes = end - start;
    if (segment.type === 'break') breakMinutes += minutes;
    else workMinutes += minutes;
    cursor = end;
  }
  if (cursor !== roundedEnd) return '業務内訳の終了時刻を退勤時刻に合わせてください。';
  if (segments[0]?.type === 'break' || segments.at(-1)?.type === 'break') return '勤務の最初または最後を休憩にはできません。';
  const requiredBreak = workMinutes > 8 * 60 ? 60 : workMinutes > 6 * 60 ? 45 : 0;
  if (breakMinutes < requiredBreak) return `実働時間に応じて${requiredBreak}分以上の休憩を入力してください。`;
  return '';
}

export function attendanceProgramMatches(segment: Partial<AttendanceWorkSegment>, program: string) {
  return program === 'all' || segmentProgram(segment) === program;
}

export function isSchoolAttendanceManager(profile: Record<string, unknown> | null | undefined) {
  return profile?.employment_category === 'dedicated' && profile?.attendance_school_manager === true;
}
