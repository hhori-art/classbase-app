import type { AttendanceShiftPlan } from '@/lib/attendance-shift-plan';

export type TimelineShift = {
  shift: AttendanceShiftPlan;
  lane: number;
  laneCount: number;
};

export const shiftTimeMinutes = (value: string) => {
  const [hour, minute] = String(value || '').split(':').map(Number);
  return Number.isFinite(hour) && Number.isFinite(minute) ? hour * 60 + minute : 0;
};

export const minutesToShiftTime = (value: number) => {
  const bounded = Math.max(0, Math.min(23 * 60 + 55, Math.round(value / 5) * 5));
  return `${String(Math.floor(bounded / 60)).padStart(2, '0')}:${String(bounded % 60).padStart(2, '0')}`;
};

export function movedShiftTimes(start: string, end: string, targetMinutes: number) {
  const duration = Math.max(5, shiftTimeMinutes(end) - shiftTimeMinutes(start));
  const nextStart = Math.max(0, Math.min(24 * 60 - duration, Math.round(targetMinutes / 5) * 5));
  return {
    start: minutesToShiftTime(nextStart),
    end: minutesToShiftTime(nextStart + duration),
  };
}

export function attendanceTimelineBounds(shifts: AttendanceShiftPlan[]) {
  if (!shifts.length) return { startHour: 9, endHour: 22 };
  const starts = shifts.map(shift => shiftTimeMinutes(shift.start)).filter(Boolean);
  const ends = shifts.map(shift => shiftTimeMinutes(shift.end)).filter(Boolean);
  if (!starts.length || !ends.length) return { startHour: 9, endHour: 22 };
  const startHour = Math.max(0, Math.floor(Math.min(...starts) / 60) - 1);
  const endHour = Math.min(24, Math.ceil(Math.max(...ends) / 60) + 1);
  return { startHour, endHour: Math.max(startHour + 4, endHour) };
}

export function layoutAttendanceTimeline(shifts: AttendanceShiftPlan[]): TimelineShift[] {
  const sorted = [...shifts].sort((left, right) => {
    const start = shiftTimeMinutes(left.start) - shiftTimeMinutes(right.start);
    if (start) return start;
    return shiftTimeMinutes(left.end) - shiftTimeMinutes(right.end);
  });
  const laneEnds: number[] = [];
  const positioned = sorted.map(shift => {
    const start = shiftTimeMinutes(shift.start);
    let lane = laneEnds.findIndex(end => end <= start);
    if (lane < 0) lane = laneEnds.length;
    laneEnds[lane] = shiftTimeMinutes(shift.end);
    return { shift, lane, laneCount: 1 };
  });
  const laneCount = Math.max(1, laneEnds.length);
  return positioned.map(item => ({ ...item, laneCount }));
}
