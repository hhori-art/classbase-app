const WEEKDAYS = ['日', '月', '火', '水', '木', '金', '土'] as const;

export const jstDateKey = (date = new Date()) =>
  new Date(date.getTime() + 9 * 60 * 60 * 1000).toISOString().slice(0, 10);

export const weekdayFromDateKey = (value: unknown) => {
  const dateKey = String(value || '').slice(0, 10);
  if (!/^\d{4}-\d{2}-\d{2}$/.test(dateKey)) return '';

  const [year, month, day] = dateKey.split('-').map(Number);
  const date = new Date(Date.UTC(year, month - 1, day));
  if (
    date.getUTCFullYear() !== year ||
    date.getUTCMonth() !== month - 1 ||
    date.getUTCDate() !== day
  ) return '';

  return WEEKDAYS[date.getUTCDay()];
};

/** 日本時間の年度（4月はじまり）。例: 2027-03-31 → 2026、2027-04-01 → 2027。 */
export const jstSchoolYear = (date = new Date()) => {
  const key = jstDateKey(date);
  const year = Number(key.slice(0, 4));
  return Number(key.slice(5, 7)) >= 4 ? year : year - 1;
};
