import assert from 'node:assert/strict';
import test from 'node:test';
import { ATTENDANCE_SCHOOLS } from '../lib/attendance-schools.ts';
import { DEFAULT_WEEKLY_DAY, WEEKDAY_KEYS, validateWeeklyAvailability } from '../lib/teacher-weekly-availability.ts';

const isWorkplaceAllowed = (value: string) => ATTENDANCE_SCHOOLS.includes(value);
const week = (patch: Record<string, Record<string, unknown>> = {}) => Object.fromEntries(WEEKDAY_KEYS.map(key => [key, {
  ...DEFAULT_WEEKLY_DAY,
  commitment_type: 'club',
  commitment_end_time: '18:00',
  ...(patch[key] || {}),
}]));

test('基本勤務設定: 正しい1週間はそのままの形で保存できる', () => {
  const result = validateWeeklyAvailability(week({ fri: { status: 'available', workplace: '創造学園 元町校', roles: ['main', 'main', 'office'] } }), { isWorkplaceAllowed });
  assert.ok(result.ok);
  assert.deepEqual(Object.keys(result.weekdays), [...WEEKDAY_KEYS]);
  assert.deepEqual(result.weekdays.fri.roles, ['main', 'office']);
  assert.equal(result.weekdays.sun.workplace, DEFAULT_WEEKLY_DAY.workplace);
});

test('基本勤務設定: 勤務可能日の勤務地は校舎一覧から（保存済みの旧データの値は残せる）', () => {
  const legacy = week({ mon: { status: 'available', workplace: '旧校舎' } });
  assert.deepEqual(validateWeeklyAvailability(legacy, { isWorkplaceAllowed }), { ok: false, error: 'invalid-workplace', weekday: 'mon' });
  assert.ok(validateWeeklyAvailability(legacy, { isWorkplaceAllowed, existing: { mon: { workplace: '旧校舎' } } }).ok);
});

test('基本勤務設定: 曜日・状態・時刻・予定の不正値を拒否する', () => {
  const cases: Array<[unknown, string]> = [
    [null, 'invalid-weekdays'],
    [[], 'invalid-weekdays'],
    [{ ...week(), xyz: week().mon }, 'invalid-weekday'],
    [week({ mon: { status: 'maybe' } }), 'invalid-status'],
    [week({ mon: { status: 'available', workplace: '創造学園 元町校', start_time: '9:00' } }), 'invalid-time'],
    [week({ mon: { status: 'available', workplace: '創造学園 元町校', start_time: '22:00', end_time: '22:00' } }), 'invalid-time-range'],
    [week({ mon: { commitment_type: '' } }), 'commitment-required'],
    [week({ mon: { note: 'x'.repeat(201) } }), 'note-too-long'],
  ];
  for (const [input, error] of cases) {
    const result = validateWeeklyAvailability(input, { isWorkplaceAllowed });
    assert.equal(result.ok, false);
    if (!result.ok) assert.equal(result.error, error);
  }
});
