import assert from 'node:assert/strict';
import test from 'node:test';
import { extractOvertimeIntervals, lessonMinutes, normalizeDedicatedSchedule, totalOvertimeMinutes } from '../lib/dedicated-attendance.ts';

test('dedicated schedule uses safe defaults', () => {
  assert.deepEqual(normalizeDedicatedSchedule({}), { start_time: '09:00', end_time: '18:00', break_minutes: 60, work_days: [1, 2, 3, 4, 5] });
});

test('overtime before and after prescribed hours is extracted', () => {
  const intervals = extractOvertimeIntervals(
    '2026-08-19',
    '2026-08-18T23:30:00.000Z',
    '2026-08-19T10:30:00.000Z',
    { start_time: '09:00', end_time: '18:00', break_minutes: 60, work_days: [1, 2, 3, 4, 5] },
  );
  assert.deepEqual(intervals.map(item => [item.kind, item.minutes]), [['before', 30], ['after', 90]]);
  assert.equal(totalOvertimeMinutes(intervals), 120);
});

test('all worked time on a prescribed day off is overtime', () => {
  const intervals = extractOvertimeIntervals('2026-08-23', '2026-08-23T01:00:00.000Z', '2026-08-23T03:00:00.000Z', { start_time: '09:00', end_time: '18:00', break_minutes: 60, work_days: [1, 2, 3, 4, 5] });
  assert.deepEqual(intervals.map(item => [item.kind, item.minutes]), [['day_off', 120]]);
});

test('lesson duration requires a forward time range', () => {
  assert.equal(lessonMinutes('18:30', '20:00'), 90);
  assert.equal(lessonMinutes('20:00', '18:30'), 0);
});
