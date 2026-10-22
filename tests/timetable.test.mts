import assert from 'node:assert/strict';
import test from 'node:test';
import { findNextLesson, lessonCountdownLabel, minutesUntilLesson, shortDateWithWeekday, type TimetableLesson } from '../lib/timetable.ts';

const lesson = (date: string, period: 1 | 2, status: TimetableLesson['status'] = 'scheduled'): TimetableLesson => ({
  id: `${date}_${period}`, date, weekday: '月', period, start: period === 1 ? '19:20' : '20:35', end: period === 1 ? '20:25' : '21:40',
  label: '理科（物理）', unit: '', status, note: '', kind: 'regular',
});

test('next lesson skips cancelled and finished lessons', () => {
  const now = new Date('2026-10-17T20:30:00+09:00');
  const lessons = [lesson('2026-10-17', 1), lesson('2026-10-19', 1, 'cancelled'), lesson('2026-10-19', 2), lesson('2026-10-17', 2)];
  assert.equal(findNextLesson(lessons, now)?.lesson.id, '2026-10-17_2');
  assert.equal(findNextLesson(lessons, new Date('2026-10-17T22:00:00+09:00'))?.lesson.id, '2026-10-19_2');
  assert.equal(findNextLesson([lesson('2026-10-19', 1, 'tentative')], now), null);
});

test('countdown labels use Japan dates and minutes within an hour', () => {
  const now = new Date('2026-10-17T19:10:00+09:00');
  assert.equal(lessonCountdownLabel(lesson('2026-10-17', 1), now), 'あと10分');
  assert.equal(lessonCountdownLabel(lesson('2026-10-17', 1), new Date('2026-10-17T19:30:00+09:00')), '授業中');
  assert.equal(lessonCountdownLabel(lesson('2026-10-18', 1), now), 'あした');
  assert.equal(lessonCountdownLabel(lesson('2026-10-20', 1), now), 'あと3日');
  // 日本時間の深夜0時台でも日付を取り違えない
  assert.equal(lessonCountdownLabel(lesson('2026-10-20', 1), new Date('2026-10-18T00:30:00+09:00')), 'あと2日');
  assert.equal(minutesUntilLesson(lesson('2026-10-17', 1), now), 10);
  assert.equal(shortDateWithWeekday('2026-10-20', '火'), '10/20(火)');
});

test('timetable adds confirmed transfers and marks the absence day, ignoring cancelled transfers', async () => {
  const { applyTransfersToLessons } = await import('../lib/timetable-transfers.ts');
  const periods = { 1: { start: '19:20', end: '20:25' }, 2: { start: '20:35', end: '21:40' } } as const;
  const base = [lesson('2026-10-19', 1), lesson('2026-10-22', 2, 'cancelled')];
  const result = applyTransfersToLessons(base, {
    range: { start: '2026-10-17', end: '2026-10-30' },
    periods,
    transfers: [
      { id: 'abs1_transfer', type: 'transfer', status: 'confirmed', target_date: '2026-10-21', transfer_period: 2,
        transfer_subject: '理科', transfer_course_name: '物理', transfer_unit: '電流', absence_date: '2026-10-19' },
      { id: 'abs2_transfer', type: 'transfer', status: 'cancelled', target_date: '2026-10-23', transfer_period: 1,
        transfer_subject: '社会', transfer_course_name: '歴史', absence_date: '2026-10-22' },
      // 時限が申請に無いときは講師配置から引く
      { id: 'abs3_transfer', type: 'transfer', status: 'confirmed', target_date: '2026-10-24', transfer_shift_id: 'shift-x',
        transfer_subject: '理科', transfer_course_name: '化学', absence_date: '2026-10-10' },
      // 期間外は出さない
      { id: 'abs4_transfer', type: 'transfer', status: 'confirmed', target_date: '2026-11-05', transfer_period: 1, absence_date: '2026-10-28' },
    ],
    absences: [],
    periodForShiftId: id => (id === 'shift-x' ? 1 : null),
  });
  const ids = result.map(item => item.id);
  assert.deepEqual(ids, ['2026-10-19_1', 'transfer_abs1_transfer', '2026-10-22_2', 'transfer_abs3_transfer']);
  const transfer = result.find(item => item.id === 'transfer_abs1_transfer')!;
  assert.equal(transfer.kind, 'transfer');
  assert.equal(transfer.status, 'scheduled');
  assert.equal(transfer.label, '理科（物理）');
  assert.equal(transfer.start, '20:35');
  assert.equal(transfer.note, '10/19(月)の振替');
  assert.equal(result.find(item => item.id === '2026-10-19_1')!.status, 'absent');
  // 取り消された振替の欠席日（休講）はそのまま
  assert.equal(result.find(item => item.id === '2026-10-22_2')!.status, 'cancelled');
  assert.equal(result.find(item => item.id === 'transfer_abs3_transfer')!.period, 1);
  // 欠席の授業は「次の授業」に出さない
  assert.equal(findNextLesson(result, new Date('2026-10-19T08:00:00+09:00'))?.lesson.id, 'transfer_abs1_transfer');
});

test('absence with a registered transfer marks its day even when the transfer is outside the window', async () => {
  const { applyTransfersToLessons } = await import('../lib/timetable-transfers.ts');
  const periods = { 1: { start: '19:20', end: '20:25' }, 2: { start: '20:35', end: '21:40' } } as const;
  const result = applyTransfersToLessons([lesson('2026-10-20', 1), lesson('2026-10-27', 1)], {
    range: { start: '2026-10-17', end: '2026-10-30' },
    periods,
    transfers: [],
    absences: [
      { id: 'a1', type: 'absence', status: 'completed', target_date: '2026-10-20', transfer_request_id: 'a1_transfer', transfer_status: 'registered' },
      { id: 'a2', type: 'absence', status: 'completed', target_date: '2026-10-27', transfer_request_id: 'a2_transfer', transfer_status: 'cancelled' },
    ],
  });
  assert.equal(result[0].status, 'absent');
  assert.equal(result[1].status, 'scheduled');
});
