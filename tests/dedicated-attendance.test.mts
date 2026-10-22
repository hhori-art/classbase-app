import assert from 'node:assert/strict';
import test from 'node:test';
import { checkOvertimePlan, computeDayActual, reconcileDay, summarizeMonth, type DayActual } from '../lib/dedicated-overtime.ts';
import { SUMMER_2026_TEMPLATE, computeSeasonAllowance, normalizeSeason, seasonBaselineMinutes, seasonLessonDays } from '../lib/dedicated-season.ts';

const iso = (date: string, time: string) => new Date(`${date}T${time}:00+09:00`).toISOString();
const weekday = '2026-11-04'; // 水曜
const sunday = '2026-11-08';
const lateShift = { start_time: '13:50', end_time: '22:20', break_minutes: 60, work_days: [1, 2, 3, 4, 5, 6] };
const officeShift = { start_time: '11:30', end_time: '20:00', break_minutes: 60, work_days: [1, 2, 3, 4, 5] };

test('D05 rule: a 7h30 shift counts work before 13:20 as overtime', () => {
  const day = computeDayActual({ date: weekday, startIso: iso(weekday, '12:20'), endIso: iso(weekday, '22:20'), schedule: lateShift })!;
  assert.equal(day.worked_minutes, 540);
  assert.equal(day.overtime_minutes, 60);
  assert.deepEqual(day.spans.map(span => `${span.kind} ${span.start}-${span.end}`), ['before 12:20-13:20']);
  assert.equal(day.night_overtime_minutes, 0);
});

test('D05 rule: 9:30-21:00 on an 11:30-20:00 shift splits into 1.5h before and 1h after', () => {
  const day = computeDayActual({ date: weekday, startIso: iso(weekday, '09:30'), endIso: iso(weekday, '21:00'), schedule: officeShift })!;
  assert.equal(day.overtime_minutes, 150);
  assert.deepEqual(day.spans.map(span => `${span.kind} ${span.start}-${span.end} ${span.minutes}`), ['before 09:30-11:00 90', 'after 20:00-21:00 60']);
});

test('arriving late offsets staying late, and clock times round to 5 minutes', () => {
  const day = computeDayActual({ date: weekday, startIso: iso(weekday, '15:02'), endIso: iso(weekday, '22:44'), schedule: lateShift })!;
  assert.equal(day.start, '15:05');
  assert.equal(day.end, '22:40');
  assert.equal(day.overtime_minutes, 0);
  assert.equal(day.offset_minutes, 20);
  assert.ok(day.warnings.some(text => text.includes('休憩')) === false);
});

test('a day off counts every worked minute, and late nights are tracked separately', () => {
  const day = computeDayActual({ date: sunday, startIso: iso(sunday, '13:00'), endIso: iso(sunday, '17:00'), schedule: officeShift, breakMinutes: 0 })!;
  assert.equal(day.day_off, true);
  assert.equal(day.overtime_minutes, 240);
  const night = computeDayActual({ date: weekday, startIso: iso(weekday, '10:00'), endIso: iso(weekday, '22:50'), schedule: lateShift, endLimit: '22:00' })!;
  assert.equal(night.overtime_minutes, 230);
  assert.equal(night.night_overtime_minutes, 30);
  assert.ok(night.warnings.some(text => text.includes('22:00')));
});

test('break rules and the 23:00 / 5-minute plan checks', () => {
  const short = computeDayActual({ date: weekday, startIso: iso(weekday, '09:00'), endIso: iso(weekday, '18:30'), schedule: officeShift, breakMinutes: 30 })!;
  assert.ok(short.warnings.some(text => text.includes('60分')));
  const plan = checkOvertimePlan({ date: '2026-11-05', start: '22:00', end: '23:10', reason: '面談' }, { today: '2026-11-04', endLimit: '22:20', individual: true });
  assert.equal(plan.ok, false);
  assert.ok(plan.errors.some(text => text.includes('23:00')));
  assert.equal(plan.late, true);
  const odd = checkOvertimePlan({ date: '2026-11-20', start: '09:32', end: '11:00', reason: '会議' }, { today: '2026-11-04', endLimit: '22:20', individual: true });
  assert.ok(odd.errors.some(text => text.includes('5分単位')));
  const good = checkOvertimePlan({ date: '2026-11-20', start: '09:30', end: '11:00', reason: '教室会議' }, { today: '2026-11-04', endLimit: '22:20', individual: true });
  assert.deepEqual([good.ok, good.minutes, good.late], [true, 90, false]);
});

test('reconciliation pays within the approved plan and asks for a report beyond it', () => {
  const actual = { overtime_minutes: 120, night_overtime_minutes: 0, day_off: false } as DayActual;
  const plans = [{ date: weekday, minutes: 90, status: 'approved' as const }];
  const over = reconcileDay(weekday, actual, plans, null);
  assert.deepEqual([over.state, over.payable_minutes, over.unapproved_minutes], ['needs_report', 90, 30]);
  const reported = reconcileDay(weekday, actual, plans, { date: weekday, status: 'approved' });
  assert.deepEqual([reported.state, reported.payable_minutes], ['reported', 120]);
  const under = reconcileDay(weekday, { ...actual, overtime_minutes: 60 }, plans, null);
  assert.deepEqual([under.state, under.payable_minutes], ['under', 60]);
  assert.equal(reconcileDay(weekday, null, plans, null).state, 'not_worked');
  const summary = summarizeMonth([over, reconcileDay('2026-11-05', null, [], null)], new Map([[weekday, actual]]), 5);
  assert.deepEqual(summary.open_days, [weekday]);
  assert.equal(summary.grade_payable_minutes, 0);
  assert.equal(summarizeMonth([reported], new Map([[weekday, actual]]), 3).grade_payable_minutes, 120);
});

test('summer 2026 baselines match the rule sheet (203 min x days without Sundays and Obon)', () => {
  const season = normalizeSeason(SUMMER_2026_TEMPLATE, 'summer_2026');
  assert.equal(seasonLessonDays(season, 'group_online'), 29);
  assert.equal(seasonLessonDays(season, 'junior_exam'), 30);
  const computed = normalizeSeason({ ...SUMMER_2026_TEMPLATE, baselines: {} });
  assert.equal(seasonBaselineMinutes(computed, 'group_online', 'group'), 5887);
  assert.equal(seasonBaselineMinutes(computed, 'junior_exam', 'academy'), 6090);
  assert.equal(seasonBaselineMinutes(season, 'group_online', 'hq_group'), 3271);
  assert.equal(season.courses.find(course => course.grade === '中3' && course.name === '数学')?.minutes, 70);
});

test('excess lesson allowance follows the grade rules', () => {
  const season = normalizeSeason(SUMMER_2026_TEMPLATE, 'summer_2026');
  const grade5 = computeSeasonAllowance({ season, division: 'group_online', baselineType: 'group', grade: 5, approvedLessonMinutes: 5887 + 120, overtimeMinutes: 600 });
  assert.deepEqual([grade5.excess_minutes, grade5.amount, grade5.compare_with_overtime], [120, 3000, true]);
  // 4等級以下：時間外 8時間 → 8÷4×3 = 6時間（360分）を差し引く
  const grade3 = computeSeasonAllowance({ season, division: 'group_online', baselineType: 'group', grade: 3, approvedLessonMinutes: 5887 + 600, overtimeMinutes: 480 });
  assert.deepEqual([grade3.overtime_deduction_minutes, grade3.excess_minutes, grade3.amount], [360, 240, 1600]);
  const grade1 = computeSeasonAllowance({ season, division: 'group_online', baselineType: 'group', grade: 1, approvedLessonMinutes: 5887 + 60, overtimeMinutes: 0 });
  assert.equal(grade1.amount, 250);
  assert.equal(computeSeasonAllowance({ season, division: 'group_online', baselineType: 'group', grade: null, approvedLessonMinutes: 9000, overtimeMinutes: 0 }).grade_missing, true);
});

test('short days without an entered break do not lose the prescribed break', () => {
  const short = computeDayActual({ date: weekday, startIso: iso(weekday, '19:00'), endIso: iso(weekday, '21:50'), schedule: lateShift })!;
  assert.deepEqual([short.break_minutes, short.worked_minutes], [0, 170]);
  const long = computeDayActual({ date: weekday, startIso: iso(weekday, '13:50'), endIso: iso(weekday, '22:20'), schedule: lateShift })!;
  assert.deepEqual([long.break_minutes, long.worked_minutes, long.overtime_minutes], [60, 450, 0]);
});
