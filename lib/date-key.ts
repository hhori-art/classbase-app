const WEEKDAYS = ['日', '月', '火', '水', '木', '金', '土'] as const;

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
