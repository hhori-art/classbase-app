import assert from 'node:assert/strict';
import test from 'node:test';
import { attendanceDurationLabel, attendanceTimeLabel } from '../lib/attendance-display';

test('旧形式のHH:mm打刻をそのまま表示できる', () => {
  assert.equal(attendanceTimeLabel('08:45'), '08:45');
  assert.equal(attendanceTimeLabel('19:10'), '19:10');
  assert.equal(attendanceDurationLabel('08:45', '19:10'), '10時間25分');
});

test('ISO形式の打刻を日本時間で表示できる', () => {
  assert.equal(attendanceTimeLabel('2026-10-02T09:50:00.000Z'), '18:50');
  assert.equal(
    attendanceDurationLabel('2026-10-02T09:50:00.000Z', '2026-10-02T13:05:00.000Z'),
    '3時間15分',
  );
});

test('不正な打刻をInvalid DateやNaNで表示しない', () => {
  assert.equal(attendanceTimeLabel('invalid'), '-');
  assert.equal(attendanceDurationLabel('invalid', '19:10'), '-');
  assert.equal(attendanceDurationLabel('19:10', '08:45'), '-');
});
