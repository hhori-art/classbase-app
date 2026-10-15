import assert from 'node:assert/strict';
import test from 'node:test';
import { aggregateStudentParticipation, buildParticipationWeeksSince, buildRecentParticipationWeeks } from '../lib/student-weekly-participation.ts';

test('月曜日から日曜日の週範囲を日付つきで作る', () => {
  const weeks = buildRecentParticipationWeeks('2026-09-10', 2);
  assert.deepEqual(weeks.map(week => [week.start_date, week.end_date, week.is_current]), [
    ['2026-08-24', '2026-08-30', false],
    ['2026-08-31', '2026-09-06', false],
    ['2026-09-07', '2026-09-13', true],
  ]);
});

test('全期間表示は最初の記録週から今週までを含む', () => {
  const weeks = buildParticipationWeeksSince('2026-09-10', '2026-01-23');
  assert.equal(weeks[0].start_date, '2026-01-19');
  assert.equal(weeks.at(-1)?.start_date, '2026-09-07');
  assert.equal(weeks.at(-1)?.is_current, true);
});

test('週に2回以上参加しても出席扱いで、科目と日付を残す', () => {
  const weeks = buildRecentParticipationWeeks('2026-09-10', 2);
  const result = aggregateStudentParticipation([
    { target_date: '2026-09-01', type: 'joined', participation_subjects: ['理科'] },
    { target_date: '2026-09-03', type: 'present', subject: '社会' },
  ], weeks, '理科');
  assert.equal(result.weeks[1].attended, true);
  assert.deepEqual(result.weeks[1].dates, ['2026-09-01', '2026-09-03']);
  assert.deepEqual(result.weeks[1].subjects.map(item => item.subject), ['社会', '理科']);
  assert.equal(result.warning, false);
});

test('完了済みの週が2週連続で未参加なら警告する', () => {
  const weeks = buildRecentParticipationWeeks('2026-09-10', 3);
  const result = aggregateStudentParticipation([
    { target_date: '2026-08-20', type: 'joined' },
  ], weeks, '理科');
  assert.equal(result.consecutive_missed_weeks, 2);
  assert.equal(result.warning, true);
});
