import assert from 'node:assert/strict';
import test from 'node:test';
import { buildScienceSocialWorkSummary } from '../lib/science-social-work-summary.ts';

test('理社講座勤務は旧勤怠と同じ職員・日付を除外して日数と時間を集計する', () => {
  const result = buildScienceSocialWorkSummary([
    { id: 'a', person_code: '0001', person_name: '山田 太郎', date: '2026-10-01', start_time: '19:20', end_time: '22:10' },
    { id: 'b', person_code: '0001', person_name: '山田 太郎', date: '2026-10-03', start_time: '21:40', end_time: '22:30' },
    { id: 'c', person_code: '0001', person_name: '山田 太郎', date: '2026-10-03', start_time: '22:30', end_time: '23:00' },
  ], [
    { person_code: '0001', person_name: '山田 太郎', date: '2026-10-01', start_time: '09:00', end_time: '17:00' },
  ]);

  assert.equal(result.length, 1);
  assert.deepEqual(result[0].work_dates, ['2026-10-03']);
  assert.deepEqual(result[0].excluded_duplicate_dates, ['2026-10-01']);
  assert.equal(result[0].work_days, 1);
  assert.equal(result[0].before_exclusion_work_days, 2);
  assert.equal(result[0].total_minutes, 80);
  assert.equal(result[0].late_night_minutes, 60);
});

test('勤務日数合計は勤務時間合計と同じ旧勤怠重複除外後の実績だけを数える', () => {
  const result = buildScienceSocialWorkSummary([
    { person_code: '0003', person_name: '鈴木 一郎', date: '2026-10-10', start_time: '18:00', end_time: '19:00' },
    { person_code: '0003', person_name: '鈴木 一郎', date: '2026-10-10', start_time: '19:00', end_time: '20:00' },
    { person_code: '0003', person_name: '鈴木 一郎', date: '2026-10-12', start_time: '18:00', end_time: '19:30' },
  ], [
    { person_code: '0003', person_name: '鈴木 一郎', date: '2026-10-10', start_time: '09:00', end_time: '17:00' },
  ]);

  assert.deepEqual(result[0].work_dates, ['2026-10-12']);
  assert.equal(result[0].work_days, 1);
  assert.equal(result[0].total_minutes, 90);
  assert.equal(result[0].before_exclusion_work_days, 2);
});

test('旧勤怠に個人コードがなくても氏名表記が一致すれば重複日として除外する', () => {
  const result = buildScienceSocialWorkSummary([
    { person_code: '0002', person_name: '佐藤　花子', date: '2026-10-05', start_time: '20:00', end_time: '21:00' },
  ], [
    { person_code: '', person_name: '佐藤 花子', date: '2026-10-05', start_time: '10:00', end_time: '11:00' },
  ]);
  assert.equal(result[0].work_days, 0);
  assert.deepEqual(result[0].excluded_duplicate_dates, ['2026-10-05']);
});
