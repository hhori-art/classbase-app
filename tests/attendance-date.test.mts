import assert from 'node:assert/strict';
import test from 'node:test';
import { attendanceDateKey, attendanceRangeIssue, canClockOutAttendanceRecord, ensureAttendanceRangeWithinDate, ensureAttendanceTimeOnDate, normalizeAttendanceTimeToDate } from '../lib/attendance-date.ts';

test('UTCの日付文字列ではなく日本時間の勤務日を取得する', () => {
  assert.equal(attendanceDateKey('2026-07-31T15:30:00.000Z'), '2026-08-01');
  assert.equal(attendanceDateKey('2026-07-31'), '2026-07-31');
});

test('申請時刻が対象日の翌日に入る場合は保存前に拒否する', () => {
  assert.throws(
    () => ensureAttendanceTimeOnDate('2026-07-31T15:30:00.000Z', '2026-07-31'),
    /target date/,
  );
});

test('申請時刻の日付を対象日の日本時間に揃える', () => {
  assert.equal(
    normalizeAttendanceTimeToDate('2026-09-25T09:50:00.000Z', '2026-09-28'),
    '2026-09-28T09:50:00.000Z',
  );
});

test('対象日を越える勤務時間を拒否する', () => {
  assert.throws(
    () => ensureAttendanceRangeWithinDate('2026-09-28T09:00:00.000Z', '2026-09-29T09:00:00.000Z', '2026-09-28'),
    /target date/,
  );
});

test('対象日内の勤務時間を許可する', () => {
  assert.doesNotThrow(() => ensureAttendanceRangeWithinDate(
    '2026-09-28T09:00:00.000Z',
    '2026-09-28T12:00:00.000Z',
    '2026-09-28',
  ));
});

test('対象日と一致している時刻は変更しない', () => {
  assert.equal(
    normalizeAttendanceTimeToDate('2026-07-17T10:10:00.000Z', '2026-07-17'),
    '2026-07-17T10:10:00.000Z',
  );
});

test('既存実績の日付ずれを検出できる', () => {
  assert.equal(
    attendanceRangeIssue('2026-07-17T10:00:00.000Z', '2026-07-18T09:00:00.000Z', '2026-07-17'),
    'date_mismatch',
  );
});

test('同時刻の出退勤を不整合として検出する', () => {
  assert.equal(
    attendanceRangeIssue('2026-07-17T10:00:00.000Z', '2026-07-17T10:00:00.000Z', '2026-07-17'),
    'invalid_range',
  );
});

test('退勤打刻は出勤日の日本日付だけ許可する', () => {
  assert.equal(canClockOutAttendanceRecord('2026-10-02', '2026-10-02'), true);
  assert.equal(canClockOutAttendanceRecord('2026-10-02', '2026-10-03'), false);
  assert.equal(canClockOutAttendanceRecord('', '2026-10-02'), false);
});
