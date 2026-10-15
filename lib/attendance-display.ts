const CLOCK_PATTERN = /^(?:[01]\d|2[0-3]):[0-5]\d$/;

export function attendanceTimeLabel(value?: string) {
  const source = String(value || '').trim();
  if (!source) return '-';
  if (CLOCK_PATTERN.test(source)) return source;
  const date = new Date(source);
  if (Number.isNaN(date.getTime())) return '-';
  return date.toLocaleTimeString('ja-JP', {
    timeZone: 'Asia/Tokyo',
    hour: '2-digit',
    minute: '2-digit',
  });
}

const clockMinutes = (value?: string) => {
  const source = String(value || '').trim();
  if (CLOCK_PATTERN.test(source)) {
    const [hour, minute] = source.split(':').map(Number);
    return hour * 60 + minute;
  }
  const date = new Date(source);
  return Number.isNaN(date.getTime()) ? null : Math.floor(date.getTime() / 60000);
};

export function attendanceDurationLabel(start?: string, end?: string) {
  const startMinutes = clockMinutes(start);
  const endMinutes = clockMinutes(end);
  if (startMinutes === null || endMinutes === null || endMinutes < startMinutes) return '-';
  const minutes = endMinutes - startMinutes;
  return `${Math.floor(minutes / 60)}時間${String(minutes % 60).padStart(2, '0')}分`;
}
