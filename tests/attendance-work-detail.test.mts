import assert from 'node:assert/strict';
import test from 'node:test';
import { validateAttendanceSegmentCoverage, type AttendanceWorkSegment } from '../lib/attendance-work-detail.ts';

const segment = (start: string, end: string, type = 'office'): AttendanceWorkSegment => ({ start, end, type });

test('打刻の5分丸め範囲を連続して覆う明細を許可する', () => {
  assert.equal(validateAttendanceSegmentCoverage([
    segment('16:45', '16:50'), segment('16:50', '18:00', 'lesson'), segment('18:00', '18:10', 'break'), segment('18:10', '19:20', 'lesson'),
  ], '2026-10-02T07:42:00.000Z', '2026-10-02T10:23:00.000Z'), '');
});

test('打刻範囲外、空白、5分単位外を拒否する', () => {
  const start = '2026-10-02T07:40:00.000Z';
  const end = '2026-10-02T10:20:00.000Z';
  assert.match(validateAttendanceSegmentCoverage([segment('16:35', '19:20')], start, end), /範囲内/);
  assert.match(validateAttendanceSegmentCoverage([segment('16:40', '17:00'), segment('17:05', '19:20')], start, end), /空白/);
  assert.match(validateAttendanceSegmentCoverage([segment('16:40', '19:19')], start, end), /5分単位/);
});

test('長時間勤務の休憩不足と最後の休憩を拒否する', () => {
  const start = '2026-10-02T00:00:00.000Z'; // 09:00 JST
  const end = '2026-10-02T09:00:00.000Z'; // 18:00 JST
  assert.match(validateAttendanceSegmentCoverage([segment('09:00', '18:00')], start, end), /60分/);
  assert.match(validateAttendanceSegmentCoverage([segment('09:00', '17:00'), segment('17:00', '18:00', 'break')], start, end), /最初または最後/);
});
