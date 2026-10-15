import assert from 'node:assert/strict';
import test from 'node:test';
import {
  availabilityStatusForWeeklyDay,
  weekdayKeyForDate,
  weeklyDaySummary,
  type WeeklyAvailabilityDay,
} from '../lib/teacher-weekly-availability';

const available: WeeklyAvailabilityDay = {
  status: 'available',
  start_time: '18:30',
  end_time: '22:00',
  workplace: '元町',
  roles: ['main'],
  commitment_type: '',
  commitment_end_time: '',
  note: '',
};

test('日付から曜日キーをタイムゾーンに依存せず取得する', () => {
  assert.equal(weekdayKeyForDate('2026-09-25'), 'fri');
  assert.equal(weekdayKeyForDate('2026-09-27'), 'sun');
});

test('勤務可能時間を表示用に整形する', () => {
  assert.equal(weeklyDaySummary(available), '18:30 - 22:00');
  assert.equal(availabilityStatusForWeeklyDay(available), 'possible');
});

test('大学・サークル終了後の条件を配置担当向けに表示する', () => {
  const conditional: WeeklyAvailabilityDay = {
    ...available,
    status: 'after_commitment',
    commitment_type: 'university',
    commitment_end_time: '18:00',
  };
  assert.equal(weeklyDaySummary(conditional), '大学 18:00まで・終了後なら勤務可能');
  assert.equal(availabilityStatusForWeeklyDay(conditional), 'maybe');
});
