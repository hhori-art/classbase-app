import { addDateDays } from '@/lib/attendance-shift-plan';

// 講師ホームの「次回担当授業」。自分の配置（shift_assignments.user_id）だけを、今日から一定期間に限って読む。
// user_id の等価条件と target_date の in 条件だけで組むので、複合インデックスなしで実行できる。

export const NEXT_CLASS_LOOKAHEAD_DAYS = 14;

export type NextClassShift = {
  id: string;
  user_id?: string;
  target_date: string;
  note?: string;
  target_grade?: string;
  target_subject?: string;
  target_meeting_id?: string;
  target_password?: string;
  target_signin_address?: string;
  unit?: string;
  teacher_name?: string;
};

/** Firestore の in 条件（最大30件）に渡す、今日（JST）からの日付キー。 */
export function nextClassDateKeys(today: string, days = NEXT_CLASS_LOOKAHEAD_DAYS) {
  const count = Math.max(1, Math.min(30, days));
  return Array.from({ length: count }, (_, index) => addDateDays(today, index));
}

/** 授業メモの最後の時刻（例: 【19:20-20:40】）を終了時刻とみなし、今日の授業がまだ終わっていないかを判定する。 */
export function isUpcomingClass(targetDate: string, note: string | undefined, today: string, nowHHMM: string) {
  if (targetDate > today) return true;
  if (targetDate < today) return false;
  const times = String(note || '').match(/([0-9]{1,2})[:：]([0-9]{2})/g);
  if (!times?.length) return true;
  const last = times[times.length - 1].replace('：', ':').padStart(5, '0');
  return last >= nowHHMM;
}

/** 自分の授業だけに絞り、いちばん近い日の授業をまとめて返す。 */
export function pickNextClasses<T extends NextClassShift>(shifts: T[], userId: string, today: string, nowHHMM: string): T[] {
  if (!userId) return [];
  const upcoming = shifts
    .filter(shift => String(shift.user_id || '') === userId)
    .filter(shift => isUpcomingClass(String(shift.target_date || ''), shift.note, today, nowHHMM))
    .sort((a, b) => a.target_date.localeCompare(b.target_date) || String(a.note || '').localeCompare(String(b.note || '')));
  if (!upcoming.length) return [];
  const nearest = upcoming[0].target_date;
  return upcoming.filter(shift => shift.target_date === nearest);
}

export const isValidZoomSigninAddress = (value: unknown) => /^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(String(value || '').trim());
