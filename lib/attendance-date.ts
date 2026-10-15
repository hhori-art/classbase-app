const DATE_KEY_PATTERN = /^\d{4}-\d{2}-\d{2}$/;

export function attendanceDateKey(value: string | Date | null | undefined) {
  if (!value) return '';
  if (typeof value === 'string' && DATE_KEY_PATTERN.test(value.trim())) return value.trim();
  const date = value instanceof Date ? value : new Date(value);
  if (Number.isNaN(date.getTime())) return '';
  return new Intl.DateTimeFormat('sv-SE', {
    timeZone: 'Asia/Tokyo', year: 'numeric', month: '2-digit', day: '2-digit',
  }).format(date);
}

export function ensureAttendanceTimeOnDate(value: string, targetDate: string) {
  if (!DATE_KEY_PATTERN.test(targetDate)) throw new Error('invalid target date');
  const valueDate = attendanceDateKey(value);
  if (!valueDate) throw new Error('invalid requested time');
  if (valueDate !== targetDate) throw new Error('requested time must be on target date');
}

export function normalizeAttendanceTimeToDate(value: string | null | undefined, targetDate: string) {
  if (!value) return null;
  if (!DATE_KEY_PATTERN.test(targetDate)) throw new Error('invalid target date');

  const parsed = new Date(value);
  if (Number.isNaN(parsed.getTime())) throw new Error('invalid requested time');

  const parts = new Intl.DateTimeFormat('en-GB', {
    timeZone: 'Asia/Tokyo',
    hour: '2-digit',
    minute: '2-digit',
    second: '2-digit',
    hourCycle: 'h23',
  }).formatToParts(parsed);
  const part = (type: Intl.DateTimeFormatPartTypes) => parts.find(item => item.type === type)?.value || '00';
  const normalized = new Date(`${targetDate}T${part('hour')}:${part('minute')}:${part('second')}+09:00`);
  if (Number.isNaN(normalized.getTime())) throw new Error('invalid requested time');
  return normalized.toISOString();
}

export function ensureAttendanceRangeWithinDate(startValue: string, endValue: string, targetDate: string) {
  if (!DATE_KEY_PATTERN.test(targetDate)) throw new Error('invalid target date');
  const start = new Date(startValue);
  const end = new Date(endValue);
  if (Number.isNaN(start.getTime()) || Number.isNaN(end.getTime())) throw new Error('invalid requested time');
  const duration = end.getTime() - start.getTime();
  if (attendanceDateKey(start) !== targetDate || attendanceDateKey(end) !== targetDate) throw new Error('requested time must be on target date');
  if (duration <= 0) throw new Error('requested end time must be after start time');
  if (duration > 24 * 60 * 60 * 1000) throw new Error('requested range must be within 24 hours');
}

export function attendanceRangeIssue(
  startValue: string | null | undefined,
  endValue: string | null | undefined,
  targetDate: string,
) {
  if (!startValue || !endValue || !DATE_KEY_PATTERN.test(targetDate)) return null;
  const start = new Date(startValue);
  const end = new Date(endValue);
  if (Number.isNaN(start.getTime()) || Number.isNaN(end.getTime())) return 'invalid_time' as const;
  if (attendanceDateKey(start) !== targetDate || attendanceDateKey(end) !== targetDate) return 'date_mismatch' as const;
  if (end.getTime() <= start.getTime()) return 'invalid_range' as const;
  return null;
}

export function canClockOutAttendanceRecord(recordDate: unknown, currentJstDate: string) {
  return DATE_KEY_PATTERN.test(currentJstDate) && String(recordDate || '') === currentJstDate;
}
