import test from 'node:test';
import assert from 'node:assert/strict';
import { analyticsRange, analyticsRate, attendanceMatchesCourse, homeworkEligibleStudent } from '../lib/course-analytics.ts';

test('weekly and monthly analytics ranges use calendar dates independent of server timezone', () => {
  assert.deepEqual(analyticsRange('week', '2026-10-01'), {
    start: '2026-09-28', end: '2026-10-04', label: '2026/9/28〜2026/10/4',
  });
  assert.deepEqual(analyticsRange('month', '2026-02-15'), {
    start: '2026-02-01', end: '2026-02-28', label: '2026年2月',
  });
  assert.throws(() => analyticsRange('week', '2026-02-30'));
});

test('analytics rates cannot be inflated by unrelated attendance when caller scopes the numerator', () => {
  assert.equal(analyticsRate(2, 4), 50);
  assert.equal(analyticsRate(0, 0), null);
});

test('homework eligibility follows the same grade and subject rules as submission', () => {
  const assignment = { target_grade: '中2', subject: '理科' };
  assert.equal(homeworkEligibleStudent({ grade: '中2', subjects: ['理科'] }, assignment), true);
  assert.equal(homeworkEligibleStudent({ grade: '中2', subjects: ['社会'] }, assignment), false);
  assert.equal(homeworkEligibleStudent({ grade: '中1', subjects: ['理科'] }, assignment), false);
  assert.equal(homeworkEligibleStudent({ grade: '中2' }, assignment), true);
});

test('course attendance is credited only to the matching course', () => {
  const canonicalize = (value: unknown) => String(value || '').trim();
  const attendance = { participations: [{ course_name: '中2 理科・木曜1限' }] };
  assert.equal(attendanceMatchesCourse(attendance, '中2 理科・木曜1限', canonicalize), true);
  assert.equal(attendanceMatchesCourse(attendance, '中2 社会・金曜1限', canonicalize), false);
  assert.equal(attendanceMatchesCourse({ subject: '理科' }, '中2 理科・木曜1限', canonicalize), true);
});
