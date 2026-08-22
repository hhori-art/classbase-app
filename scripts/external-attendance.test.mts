import test from 'node:test';
import assert from 'node:assert/strict';
import {
  extractExternalAttendancePage,
  normalizeExternalAttendanceRecord,
} from '../lib/external-attendance.ts';

test('external attendance aliases normalize into the payroll interval format', () => {
  const result = normalizeExternalAttendanceRecord({
    attendance_id: 'attendance-1',
    employee_code: '00123',
    employee_name: '山田　太郎',
    work_date: '2026/08/21',
    clock_in: '09:00:00',
    clock_out: '18:00:00',
    category: '通常勤務',
    updated_at: '2026-08-21T18:05:00+09:00',
  });

  assert.equal(result.error, undefined);
  assert.deepEqual(result.data, {
    external_record_id: 'attendance-1',
    person_code: '00123',
    person_name: '山田　太郎',
    normalized_name: '山田太郎',
    date: '2026-08-21',
    start_time: '09:00',
    end_time: '18:00',
    work_type: '通常勤務',
    source_name: '',
    status: 'active',
    updated_at: '2026-08-21T18:05:00+09:00',
    deleted: false,
  });
});

test('custom nested field map supports vendor-specific response fields', () => {
  const result = normalizeExternalAttendanceRecord({
    attendance: { key: 'vendor-1', employee: { number: 'A-9', label: '佐藤 花子' } },
    interval: { started: '2026-08-20T23:30:00Z', ended: '2026-08-21T01:00:00Z' },
  }, {
    id: 'attendance.key', person_code: 'attendance.employee.number', person_name: 'attendance.employee.label',
    start_time: 'interval.started', end_time: 'interval.ended',
  });

  assert.equal(result.data?.date, '2026-08-21');
  assert.equal(result.data?.start_time, '08:30');
  assert.equal(result.data?.end_time, '10:00');
});

test('deleted records need no clock-out time and paged responses are extracted', () => {
  const deleted = normalizeExternalAttendanceRecord({ id: 'gone-1', status: 'deleted' });
  assert.equal(deleted.data?.deleted, true);

  const page = extractExternalAttendancePage({ result: { rows: [{ id: 1 }], cursor: 'next-2' } }, 'result.rows', 'result.cursor');
  assert.deepEqual(page, { records: [{ id: 1 }], nextCursor: 'next-2' });
});

test('invalid records return a clear validation error', () => {
  const result = normalizeExternalAttendanceRecord({ id: 'invalid-1', staff_code: '9', work_date: '2026-08-01', clock_in: '09:00' });
  assert.match(result.error || '', /開始・終了時刻/);
});
