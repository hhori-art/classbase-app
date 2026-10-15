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
