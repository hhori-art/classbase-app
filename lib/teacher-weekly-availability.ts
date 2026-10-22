export const WEEKDAY_KEYS = ['sun', 'mon', 'tue', 'wed', 'thu', 'fri', 'sat'] as const;

export type WeekdayKey = (typeof WEEKDAY_KEYS)[number];
export type WeeklyAvailabilityStatus = 'available' | 'after_commitment' | 'unavailable';

export type WeeklyAvailabilityDay = {
  status: WeeklyAvailabilityStatus;
  start_time: string;
  end_time: string;
  workplace: string;
  roles: string[];
  commitment_type: '' | 'university' | 'club' | 'other';
  commitment_end_time: string;
  note: string;
};

export type TeacherAvailabilityProfile = {
  id: string;
  teacher_id?: string;
  user_id?: string;
  teacher_name?: string;
  weekdays?: Partial<Record<WeekdayKey, WeeklyAvailabilityDay>>;
};

export const DEFAULT_WEEKLY_DAY: WeeklyAvailabilityDay = {
  status: 'unavailable',
  start_time: '19:00',
  end_time: '22:00',
  workplace: '元町',
  roles: ['main'],
  commitment_type: '',
  commitment_end_time: '',
  note: '',
};

export const weekdayKeyForDate = (dateKey: string): WeekdayKey => {
  const [year, month, day] = dateKey.split('-').map(Number);
  const weekday = new Date(Date.UTC(year, month - 1, day, 12)).getUTCDay();
  return WEEKDAY_KEYS[weekday];
};

export const commitmentLabel = (type?: WeeklyAvailabilityDay['commitment_type']) => ({
  university: '大学',
  club: 'サークル',
  other: 'その他の予定',
  '': '予定',
}[type || '']);

export const weeklyDaySummary = (day?: WeeklyAvailabilityDay) => {
  if (!day) return '';
  if (day.status === 'available') return `${day.start_time || '時間未設定'} - ${day.end_time || '時間未設定'}`;
  const commitment = commitmentLabel(day.commitment_type);
  const ending = day.commitment_end_time ? `${day.commitment_end_time}まで` : '終了時刻未設定';
  if (day.status === 'after_commitment') return `${commitment} ${ending}・終了後なら勤務可能`;
  return `${commitment} ${ending}・勤務不可`;
};

export const availabilityStatusForWeeklyDay = (day?: WeeklyAvailabilityDay) => {
  if (!day) return 'unsubmitted';
  if (day.status === 'available') return 'possible';
  if (day.status === 'after_commitment') return 'maybe';
  return 'impossible';
};

// ---- 基本勤務設定の保存前チェック（/api/teacher/availability-profile で使う） ----

const WEEKLY_STATUSES: readonly WeeklyAvailabilityStatus[] = ['available', 'after_commitment', 'unavailable'];
const COMMITMENT_TYPES: readonly WeeklyAvailabilityDay['commitment_type'][] = ['', 'university', 'club', 'other'];
export const WEEKLY_ROLE_IDS = ['main', 'sub', 'general', 'office'] as const;
const TIME_PATTERN = /^([01]\d|2[0-3]):[0-5]\d$/;
const MAX_WEEKLY_NOTE = 200;
const MAX_WORKPLACE = 80;

export type WeeklyAvailabilityValidation =
  | { ok: true; weekdays: Record<WeekdayKey, WeeklyAvailabilityDay> }
  | { ok: false; error: string; weekday?: WeekdayKey };

/**
 * 画面から届いた1週間分の設定を検査し、保存する形（項目・型をそろえたもの）に直す。
 * 勤務地は共通の校舎一覧（isWorkplaceAllowed）にあるものだけ。ただし、すでに保存されている
 * 旧データの値と、勤務不可の日に残っている初期値はそのまま保存できる（画面で選び直していないため）。
 */
export function validateWeeklyAvailability(
  input: unknown,
  options: {
    isWorkplaceAllowed: (value: string) => boolean;
    existing?: Partial<Record<WeekdayKey, Partial<WeeklyAvailabilityDay>>>;
  },
): WeeklyAvailabilityValidation {
  if (!input || typeof input !== 'object' || Array.isArray(input)) return { ok: false, error: 'invalid-weekdays' };
  const source = input as Record<string, unknown>;
  if (Object.keys(source).some(key => !(WEEKDAY_KEYS as readonly string[]).includes(key))) return { ok: false, error: 'invalid-weekday' };
  const weekdays = {} as Record<WeekdayKey, WeeklyAvailabilityDay>;
  for (const key of WEEKDAY_KEYS) {
    const raw = source[key];
    if (!raw || typeof raw !== 'object' || Array.isArray(raw)) return { ok: false, error: 'missing-weekday', weekday: key };
    const day = raw as Record<string, unknown>;
    const status = String(day.status || '') as WeeklyAvailabilityStatus;
    if (!WEEKLY_STATUSES.includes(status)) return { ok: false, error: 'invalid-status', weekday: key };
    const startTime = String(day.start_time ?? '').trim();
    const endTime = String(day.end_time ?? '').trim();
    const commitmentType = String(day.commitment_type ?? '') as WeeklyAvailabilityDay['commitment_type'];
    const commitmentEnd = String(day.commitment_end_time ?? '').trim();
    const workplace = String(day.workplace ?? '').trim();
    const note = String(day.note ?? '').trim();
    const roles = Array.isArray(day.roles) ? Array.from(new Set(day.roles.map(role => String(role || '')))) : [];

    if (!COMMITMENT_TYPES.includes(commitmentType)) return { ok: false, error: 'invalid-commitment', weekday: key };
    if (roles.some(role => !(WEEKLY_ROLE_IDS as readonly string[]).includes(role))) return { ok: false, error: 'invalid-role', weekday: key };
    if (note.length > MAX_WEEKLY_NOTE) return { ok: false, error: 'note-too-long', weekday: key };
    if (workplace.length > MAX_WORKPLACE) return { ok: false, error: 'invalid-workplace', weekday: key };
    if ((startTime && !TIME_PATTERN.test(startTime)) || (endTime && !TIME_PATTERN.test(endTime))) return { ok: false, error: 'invalid-time', weekday: key };
    if (commitmentEnd && !TIME_PATTERN.test(commitmentEnd)) return { ok: false, error: 'invalid-time', weekday: key };

    const keptWorkplace = workplace === String(options.existing?.[key]?.workplace ?? '').trim();
    if (status === 'available') {
      if (!startTime || !endTime || startTime >= endTime) return { ok: false, error: 'invalid-time-range', weekday: key };
      if (!workplace || !(options.isWorkplaceAllowed(workplace) || keptWorkplace)) return { ok: false, error: 'invalid-workplace', weekday: key };
    } else {
      if (!commitmentType || !commitmentEnd) return { ok: false, error: 'commitment-required', weekday: key };
      if (workplace && !(options.isWorkplaceAllowed(workplace) || keptWorkplace || workplace === DEFAULT_WEEKLY_DAY.workplace)) {
        return { ok: false, error: 'invalid-workplace', weekday: key };
      }
    }

    weekdays[key] = {
      status,
      start_time: startTime,
      end_time: endTime,
      workplace,
      roles: roles.length ? roles : [...DEFAULT_WEEKLY_DAY.roles],
      commitment_type: commitmentType,
      commitment_end_time: commitmentEnd,
      note,
    };
  }
  return { ok: true, weekdays };
}
