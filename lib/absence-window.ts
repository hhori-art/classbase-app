/**
 * 欠席・遅刻・振替の連絡をさかのぼって出せる範囲（今日から3か月前の同じ日まで）。
 * 何か月も前の日に欠席や振替を作れないようにする（画面とサーバーで同じ決まりを使う）。
 */
export const ABSENCE_LOOKBACK_MONTHS = 3;

export function earliestAbsenceDate(today: string) {
  const [year, month, day] = today.split('-').map(Number);
  const base = new Date(Date.UTC(year, month - 1 - ABSENCE_LOOKBACK_MONTHS, 1));
  const lastDay = new Date(Date.UTC(base.getUTCFullYear(), base.getUTCMonth() + 1, 0)).getUTCDate();
  base.setUTCDate(Math.min(day, lastDay));
  return base.toISOString().slice(0, 10);
}

export const isWithinAbsenceWindow = (date: string, today: string) => date >= earliestAbsenceDate(today);

export const ABSENCE_WINDOW_MESSAGE = `${ABSENCE_LOOKBACK_MONTHS}か月より前の日は連絡できません。教室へ直接ご連絡ください。`;
