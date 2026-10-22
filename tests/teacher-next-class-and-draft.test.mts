import assert from 'node:assert/strict';
import test from 'node:test';
import { isUpcomingClass, nextClassDateKeys, pickNextClasses } from '../lib/next-class';
import { draftSegmentsFromShiftPlans, recordsMissingWorkDetails, workDetailReminderRange } from '../lib/attendance-work-draft';
import type { AttendanceShiftPlan } from '../lib/attendance-shift-plan';

test('next class lookahead keys are bounded for a Firestore in-query and start today', () => {
  const keys = nextClassDateKeys('2026-10-30');
  assert.equal(keys.length, 14);
  assert.equal(keys[0], '2026-10-30');
  assert.equal(keys[2], '2026-11-01');
  assert.equal(nextClassDateKeys('2026-10-30', 99).length, 30);
});

test('next class picks only the signed-in teacher and the nearest upcoming date', () => {
  const shifts = [
    { id: 'other', user_id: 'someone-else', target_date: '2026-10-17', note: '【19:00-20:00】' },
    { id: 'ended', user_id: 'me', target_date: '2026-10-17', note: '【10:00-11:00】' },
    { id: 'later-today', user_id: 'me', target_date: '2026-10-17', note: '【19:20-20:40】' },
    { id: 'tomorrow', user_id: 'me', target_date: '2026-10-18', note: '【19:20-20:40】' },
    { id: 'name-only', teacher_name: 'me', target_date: '2026-10-17' },
  ];
  assert.deepEqual(pickNextClasses(shifts, 'me', '2026-10-17', '12:00').map(item => item.id), ['later-today']);
  assert.deepEqual(pickNextClasses(shifts, 'me', '2026-10-17', '21:00').map(item => item.id), ['tomorrow']);
  assert.deepEqual(pickNextClasses(shifts, '', '2026-10-17', '12:00'), []);
  assert.equal(isUpcomingClass('2026-10-16', '', '2026-10-17', '00:00'), false);
});

const plan = (overrides: Partial<AttendanceShiftPlan>): Partial<AttendanceShiftPlan> => ({
  id: 'p', date: '2026-10-15', start: '19:00', end: '20:00', category: 'group', teacher_id: 'me',
  school_id: '112', grade: '中2', reflect_to_attendance: true, ...overrides,
});

test('work detail draft uses the shared shift conversion, own plans only, clipped to the clock range', () => {
  const drafts = draftSegmentsFromShiftPlans([
    plan({ id: 'a', start: '18:30', end: '20:00', title: '数学' }),
    plan({ id: 'b', start: '20:00', end: '21:30', category: 'office', office_task: 'grading' }),
    plan({ id: 'other', teacher_id: 'someone-else' }),
    plan({ id: 'hidden', reflect_to_attendance: false, start: '17:00', end: '18:00' }),
    plan({ id: 'other-day', date: '2026-10-16' }),
  ], { teacherId: 'me', date: '2026-10-15', schoolId: '112', rangeStart: '18:50', rangeEnd: '21:00' });
  assert.equal(drafts.length, 2);
  assert.deepEqual(drafts.map(item => [item.start, item.end, item.type]), [['18:50', '20:00', 'lesson'], ['20:00', '21:00', 'office']]);
  assert.ok(drafts.every(item => item.from_shift_plan === true));
  assert.ok(drafts.every(item => !('approval_status' in item) && !('id' in item)));
  assert.equal(drafts[0].grade, '中2');
  assert.equal(drafts[1].office_task, 'grading');
  // 別校舎の勤務記録には他校舎の予定を入れない
  assert.equal(draftSegmentsFromShiftPlans([plan({})], { teacherId: 'me', schoolId: '161' }).length, 0);
});

test('work detail reminder lists finished, unapproved records without details in the last 14 days', () => {
  assert.deepEqual(workDetailReminderRange('2026-10-17'), { start: '2026-10-04', end: '2026-10-17' });
  const records = [
    { id: 'missing', date: '2026-10-10', end_time: 'x', status: 'pending', work_segments: [] },
    { id: 'filled', date: '2026-10-11', end_time: 'x', status: 'pending', work_segments: [{}] },
    { id: 'approved', date: '2026-10-12', end_time: 'x', status: 'approved' },
    { id: 'working', date: '2026-10-17', end_time: null },
    { id: 'old', date: '2026-10-01', end_time: 'x' },
    { id: 'newest', date: '2026-10-16', end_time: 'x' },
  ];
  assert.deepEqual(recordsMissingWorkDetails(records, '2026-10-17').map(item => item.id), ['newest', 'missing']);
});
