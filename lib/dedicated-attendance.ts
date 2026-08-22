export type OvertimeInterval = {
  kind: 'before' | 'after' | 'day_off';
  start: string;
  end: string;
  minutes: number;
};

export type DedicatedSchedule = {
  start_time: string;
  end_time: string;
  break_minutes: number;
  work_days: number[];
};

const TIME_PATTERN = /^([01]\d|2[0-3]):([0-5]\d)$/;

export const normalizeDedicatedSchedule = (profile: Record<string, unknown> | null | undefined): DedicatedSchedule => {
  const start = String(profile?.prescribed_work_start || '09:00');
  const end = String(profile?.prescribed_work_end || '18:00');
  const breakMinutes = Math.max(0, Math.min(240, Math.floor(Number(profile?.prescribed_break_minutes ?? 60) || 0)));
  const workDays = Array.isArray(profile?.prescribed_work_days)
    ? profile.prescribed_work_days.map(Number).filter(value => Number.isInteger(value) && value >= 0 && value <= 6)
    : [1, 2, 3, 4, 5];
  return {
    start_time: TIME_PATTERN.test(start) ? start : '09:00',
    end_time: TIME_PATTERN.test(end) ? end : '18:00',
    break_minutes: breakMinutes,
    work_days: Array.from(new Set(workDays)),
  };
};

const scheduleDate = (date: string, time: string) => new Date(`${date}T${time}:00+09:00`);

export function extractOvertimeIntervals(
  workDate: string,
  actualStart: string,
  actualEnd: string,
  schedule: DedicatedSchedule,
): OvertimeInterval[] {
  const start = new Date(actualStart);
  const end = new Date(actualEnd);
  const prescribedStart = scheduleDate(workDate, schedule.start_time);
  const prescribedEnd = scheduleDate(workDate, schedule.end_time);
  if (prescribedEnd.getTime() <= prescribedStart.getTime()) prescribedEnd.setDate(prescribedEnd.getDate() + 1);
  if ([start, end, prescribedStart, prescribedEnd].some(value => Number.isNaN(value.getTime())) || end <= start) return [];

  const intervals: OvertimeInterval[] = [];
  const add = (kind: OvertimeInterval['kind'], intervalStart: Date, intervalEnd: Date) => {
    const minutes = Math.max(0, Math.floor((intervalEnd.getTime() - intervalStart.getTime()) / 60000));
    if (minutes > 0) intervals.push({ kind, start: intervalStart.toISOString(), end: intervalEnd.toISOString(), minutes });
  };
  const dayOfWeek = scheduleDate(workDate, '00:00').getDay();
  if (!schedule.work_days.includes(dayOfWeek)) {
    add('day_off', start, end);
    return intervals;
  }
  if (start < prescribedStart) add('before', start, new Date(Math.min(end.getTime(), prescribedStart.getTime())));
  if (end > prescribedEnd) add('after', new Date(Math.max(start.getTime(), prescribedEnd.getTime())), end);
  return intervals;
}

export const totalOvertimeMinutes = (intervals: OvertimeInterval[]) =>
  intervals.reduce((total, interval) => total + Math.max(0, Number(interval.minutes) || 0), 0);

export const lessonMinutes = (startTime: string, endTime: string) => {
  if (!TIME_PATTERN.test(startTime) || !TIME_PATTERN.test(endTime)) return 0;
  const [startHour, startMinute] = startTime.split(':').map(Number);
  const [endHour, endMinute] = endTime.split(':').map(Number);
  return Math.max(0, endHour * 60 + endMinute - startHour * 60 - startMinute);
};
