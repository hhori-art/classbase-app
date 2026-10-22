import assert from 'node:assert/strict';
import test from 'node:test';
import {
  bucketByWeek,
  buildRecordWeeks,
  jstDateKeyFromMillis,
  monthStartKey,
  nextBadgeTargets,
  participationDates,
  studentBadgeText,
  weeklyStreak,
} from '../lib/student-records.ts';
import { badgeStatsFromProfile } from '../lib/gamification.ts';

test('record weeks are 8 JST Monday-start weeks ending with the current week', () => {
  // 2026-10-19 は月曜日
  const weeks = buildRecordWeeks('2026-10-19');
  assert.equal(weeks.length, 8);
  assert.equal(weeks[7].start_date, '2026-10-19');
  assert.equal(weeks[7].end_date, '2026-10-25');
  assert.equal(weeks[7].is_current, true);
  assert.equal(weeks[0].start_date, '2026-08-31');
  assert.ok(weeks.slice(0, 7).every(week => !week.is_current));
  // 日曜日はその週の最後の日
  const sunday = buildRecordWeeks('2026-10-25');
  assert.equal(sunday[7].start_date, '2026-10-19');
});

test('weekly buckets use JST date keys and ignore dates outside the window', () => {
  const weeks = buildRecordWeeks('2026-10-21');
  // 2026-10-18 23:30 JST（日曜）= 2026-10-18T14:30Z → 先週。10-19 00:30 JST = 10-18T15:30Z → 今週。
  const sundayNight = jstDateKeyFromMillis(Date.parse('2026-10-18T14:30:00Z'));
  const mondayEarly = jstDateKeyFromMillis(Date.parse('2026-10-18T15:30:00Z'));
  assert.equal(sundayNight, '2026-10-18');
  assert.equal(mondayEarly, '2026-10-19');
  const totals = bucketByWeek([
    { date: sundayNight, value: 2 },
    { date: mondayEarly, value: 3 },
    { date: '2026-10-21', value: 1 },
    { date: '2026-01-01', value: 99 },
    { date: 'bad', value: 50 },
  ], weeks);
  assert.deepEqual(totals, [0, 0, 0, 0, 0, 0, 2, 4]);
  assert.equal(jstDateKeyFromMillis(0), '');
  assert.equal(monthStartKey('2026-10-21'), '2026-10-01');
});

test('participation dates skip absences and duplicate days', () => {
  const dates = participationDates([
    { target_date: '2026-10-05', type: 'joined' },
    { target_date: '2026-10-05', type: 'joined', subject: '理科' },
    { target_date: '2026-10-06', type: 'absent' },
    { date: '2026-10-07', attendance_status: '出席' },
  ]);
  assert.deepEqual(dates, ['2026-10-05', '2026-10-07']);
});

test('weekly streak does not break on an empty current week', () => {
  const weeks = buildRecordWeeks('2026-10-21');
  assert.deepEqual(weeklyStreak([0, 0, 0, 0, 1, 1, 2, 0], weeks), { weeks: 3, capped: false });
  assert.deepEqual(weeklyStreak([0, 0, 0, 0, 1, 1, 2, 1], weeks), { weeks: 4, capped: false });
  assert.deepEqual(weeklyStreak([1, 1, 1, 1, 1, 1, 1, 1], weeks), { weeks: 8, capped: true });
  assert.deepEqual(weeklyStreak([0, 0, 0, 0, 0, 0, 0, 0], weeks), { weeks: 0, capped: false });
});

test('next badge targets count badges, not per-recording viewing time', () => {
  const targets = nextBadgeTargets(badgeStatsFromProfile({ recording_complete_count: 7, login_count: 30, quest_clear_count: 0 }));
  const recording = targets.find(item => item.metric === 'recording_complete_count')!;
  assert.equal(recording.target, 10);
  assert.equal(recording.remaining, 3);
  assert.equal(recording.unit, '本');
  assert.equal(targets.find(item => item.metric === 'login_count')!.target, 50);
  assert.equal(targets.find(item => item.metric === 'quest_clear_count')!.remaining, 1);
  // すべて集め終えた種類は出さない
  assert.equal(nextBadgeTargets(badgeStatsFromProfile({ recording_complete_count: 500 })).some(item => item.metric === 'recording_complete_count'), false);
  assert.equal(studentBadgeText('授業アーカイブを10本見終える'), '授業の録画を10本見終える');
});
