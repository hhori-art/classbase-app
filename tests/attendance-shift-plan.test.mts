import assert from 'node:assert/strict';
import test from 'node:test';
import {
  addDateDays,
  dateDiffDays,
  shiftPlanToAttendanceSegment,
  validateAttendanceShiftPlan,
  type AttendanceShiftPlan,
} from '../lib/attendance-shift-plan';
import { overlappingShiftIds, weeklyShiftExportRows } from '../lib/attendance-shift-weekly';
import { attendanceTimelineBounds, layoutAttendanceTimeline, movedShiftTimes } from '../lib/attendance-shift-timeline';

const plan: AttendanceShiftPlan = {
  id: 'shift-1',
  date: '2026-10-09',
  start: '16:50',
  end: '18:00',
  category: 'individual',
  teacher_id: 'teacher-1',
  teacher_name: '山田先生',
  employment_category: 'semi_dedicated',
  school_id: '112',
  school_name: '元町校',
  individual_ratio: '1:2',
  individual_level: 'standard',
  reflect_to_attendance: true,
};

test('勤怠シフトは5分単位と終了時刻を検証する', () => {
  assert.equal(validateAttendanceShiftPlan(plan), '');
  assert.match(validateAttendanceShiftPlan({ ...plan, start: '16:52' }), /5分単位/);
  assert.match(validateAttendanceShiftPlan({ ...plan, start: '18:00' }), /開始・終了時刻/);
});

test('日付コピー計算は月跨ぎでも正しい', () => {
  assert.equal(addDateDays('2026-10-31', 1), '2026-11-01');
  assert.equal(dateDiffDays('2026-10-26', '2026-11-02'), 7);
});

test('個別シフトを勤怠詳細へ変換できる', () => {
  assert.deepEqual(shiftPlanToAttendanceSegment(plan), {
    id: 'shift-1', start: '16:50', end: '18:00', type: 'individual', program: 'normal',
    lesson_format: 'individual', individual_level: 'standard', individual_ratio: '1:2', note: '',
    school_id: '112', approval_status: 'pending',
  });
});

test('同じ日・同じブースの時間重複を検出できる', () => {
  const conflicts = overlappingShiftIds([
    { ...plan, id: 'shift-1', room: 'ブース1', start: '16:00', end: '17:00' },
    { ...plan, id: 'shift-2', room: 'ブース1', start: '16:50', end: '18:00' },
    { ...plan, id: 'shift-3', room: 'ブース2', start: '16:50', end: '18:00' },
  ], 'individual');
  assert.deepEqual([...conflicts].sort(), ['shift-1', 'shift-2']);
});

test('週次表の出力に教室・講師・生徒を含める', () => {
  const rows = weeklyShiftExportRows([{ ...plan, room: 'ブース3', student_ids: ['s1'], student_names: ['佐藤花子'] }]);
  assert.equal(rows[0][2], 'ブース3');
  assert.equal(rows[0][7], '山田先生');
  assert.equal(rows[0][9], '佐藤花子');
});

test('個別シフトは指導人数を超えて生徒を割り当てられない', () => {
  assert.match(validateAttendanceShiftPlan({ ...plan, individual_ratio: '1:1', student_ids: ['s1', 's2'] }), /1名以内/);
});

test('週間タイムラインは表示時間をシフト前後に絞る', () => {
  assert.deepEqual(attendanceTimelineBounds([
    { ...plan, start: '13:10', end: '14:05' },
    { ...plan, start: '20:25', end: '21:30' },
  ]), { startHour: 12, endHour: 23 });
});

test('同時刻のシフトを別レーンに配置する', () => {
  const layout = layoutAttendanceTimeline([
    { ...plan, id: 'a', start: '16:00', end: '17:00' },
    { ...plan, id: 'b', start: '16:30', end: '17:30' },
    { ...plan, id: 'c', start: '17:30', end: '18:30' },
  ]);
  assert.deepEqual(layout.map(item => [item.shift.id, item.lane, item.laneCount]), [
    ['a', 0, 2],
    ['b', 1, 2],
    ['c', 0, 2],
  ]);
});

test('ドラッグ移動後も授業時間を維持して5分単位に揃える', () => {
  assert.deepEqual(movedShiftTimes('16:40', '17:45', 19 * 60 + 12), {
    start: '19:10',
    end: '20:15',
  });
});
