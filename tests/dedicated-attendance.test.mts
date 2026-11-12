import assert from 'node:assert/strict';
import test from 'node:test';
import { checkOvertimePlan, computeDayActual, computeOvertimePay, nthBusinessDay, projectedMonthOvertime, reconcileDay, summarizeMonth, type DayActual, type MonthSummary, type PlanLike } from '../lib/dedicated-overtime.ts';
import { countedLessonMinutes, lessonTerm, lessonTermOf, needsLessonMinutes, normalizeLessonExclusions, summarizeLessonTerm } from '../lib/dedicated-lesson-term.ts';
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

test('excess lesson allowance uses the person\'s overtime unit rate, not a grade table', () => {
  const season = normalizeSeason(SUMMER_2026_TEMPLATE, 'summer_2026');
  const grade5 = computeSeasonAllowance({ season, division: 'group_online', baselineType: 'group', grade: 5, unitRate: 2400, approvedLessonMinutes: 5887 + 120, overtimeMinutes: 600 });
  assert.deepEqual([grade5.excess_minutes, grade5.rate, grade5.amount, grade5.compare_with_overtime], [120, 2400, 4800, true]);
  // 4等級以下：時間外 8時間 → 8÷4×3 = 6時間（360分）を差し引く
  const grade3 = computeSeasonAllowance({ season, division: 'group_online', baselineType: 'group', grade: 3, unitRate: 1800, approvedLessonMinutes: 5887 + 600, overtimeMinutes: 480 });
  assert.deepEqual([grade3.overtime_deduction_minutes, grade3.excess_minutes, grade3.amount], [360, 240, 7200]);
  const missing = computeSeasonAllowance({ season, division: 'group_online', baselineType: 'group', grade: 1, unitRate: null, approvedLessonMinutes: 5887 + 60, overtimeMinutes: 0 });
  assert.deepEqual([missing.amount, missing.rate_missing], [0, true]);
});

const emptySummary = (patch: Partial<MonthSummary>): MonthSummary => ({
  actual_minutes: 0, planned_minutes: 0, payable_minutes: 0, payable_night_minutes: 0, payable_day_off_minutes: 0, payable_day_off_night_minutes: 0,
  special_minutes: 0, special_by_kind: {}, over60_minutes: 0, over60_night_minutes: 0,
  within_minutes: 0, night_regular_minutes: 0, transfer_premium_minutes: 0, unapproved_minutes: 0, open_days: [], waiting_days: [], over_monthly_limit: false, grade_payable_minutes: null, ...patch,
  // 特訓のない月は、時間外勤務手当の対象＝支給の対象。
  overtime_minutes: patch.overtime_minutes ?? patch.payable_minutes ?? 0,
});

test('overtime pay uses 1.25 / 1.5 / 1.35 / 1.6 / 1.0 and rounds each line up', () => {
  // 普通 120分・深夜 30分（勤務日）、休日 60分・うち休日深夜 20分、時間内 30分、深夜手当 20分
  const summary = emptySummary({ payable_minutes: 210, payable_night_minutes: 50, payable_day_off_minutes: 60, payable_day_off_night_minutes: 20, within_minutes: 30, night_regular_minutes: 20 });
  const pay = computeOvertimePay(summary, { grade: 3, unitRate: 2000 });
  const amount = (key: string) => pay.lines.find(line => line.key === key)!.amount;
  assert.deepEqual(pay.lines.map(line => [line.key, line.minutes]), [['normal', 120], ['night', 30], ['holiday', 40], ['holiday_night', 20], ['over60', 0], ['over60_night', 0], ['within', 30], ['night_premium', 20], ['transfer_premium', 0]]);
  assert.equal(amount('normal'), 5000); // 2000 × 1.25 × 2h
  assert.equal(amount('night'), 1500); // 2000 × 1.5 × 0.5h
  assert.equal(amount('holiday'), 1800); // 2000 × 1.35 × 40/60
  assert.equal(amount('holiday_night'), 1067); // 2000 × 1.6 × 20/60 = 1066.7 → 切り上げ
  assert.equal(amount('within'), 1000);
  assert.equal(amount('night_premium'), 167); // 2000 × 0.25 × 20/60 = 166.7
  assert.equal(pay.overtime_payable_amount, 5000 + 1500 + 1800 + 1067);
  assert.equal(pay.total_amount, 5000 + 1500 + 1800 + 1067 + 1000 + 167);
  const manager = computeOvertimePay(summary, { grade: 6, unitRate: 2000 });
  assert.deepEqual([manager.overtime_payable_amount, manager.total_amount], [0, 167]);
});

test('grade 5: night minutes converted to 1.25 can push 34:55 + 0:05 over the 35 hours', () => {
  const summary = emptySummary({ payable_minutes: 2100, payable_night_minutes: 5 });
  const pay = computeOvertimePay(summary, { grade: 5, unitRate: 2000 });
  assert.equal(pay.equivalent_minutes, 2101); // 2095 + 5 × 1.5/1.25
  assert.equal(pay.threshold_minutes, 2100);
  assert.equal(pay.overtime_payable_amount, 42); // 1分 × 2000 × 1.25 ÷ 60 = 41.7 → 切り上げ
  const exact = computeOvertimePay(emptySummary({ payable_minutes: 2100 }), { grade: 5, unitRate: 2000 });
  assert.equal(exact.overtime_payable_amount, 0);
  // 時短勤務は28時間超
  const short = computeOvertimePay(emptySummary({ payable_minutes: 28 * 60 + 60 }), { grade: 5, unitRate: 2000, shortTime: true });
  assert.deepEqual([short.threshold_minutes, short.overtime_payable_amount], [1680, 2500]);
  const day = reconcileDay(weekday, { overtime_minutes: 2100, night_overtime_minutes: 5, day_off: false } as DayActual, [], { date: weekday, status: 'approved' });
  assert.equal(summarizeMonth([day], new Map([[weekday, { day_off: false } as DayActual]]), 5).grade_payable_minutes, 1);
});

test('within-8-hours time is counted at 1.0, and office staff can extend after the shift end', () => {
  // 所定 13:50〜22:20（7時間30分）、12:20 出勤：12:20〜13:20 が時間外、13:20〜13:50 が時間内
  const day = computeDayActual({ date: weekday, startIso: iso(weekday, '12:20'), endIso: iso(weekday, '22:20'), schedule: lateShift })!;
  assert.deepEqual([day.overtime_minutes, day.within_minutes, day.night_regular_minutes], [60, 30, 20]);
  // 事務職員：所定 9:00〜16:30（休憩60分・6時間30分）、終業の後に広げる → 16:30〜18:00 が時間内、18:00 以降が時間外
  const office = { start_time: '09:00', end_time: '16:30', break_minutes: 60, work_days: [1, 2, 3, 4, 5], extend_side: 'after' as const };
  const late = computeDayActual({ date: weekday, startIso: iso(weekday, '09:00'), endIso: iso(weekday, '19:00'), schedule: office })!;
  assert.deepEqual([late.overtime_minutes, late.within_minutes], [60, 90]);
  assert.deepEqual(late.spans.map(span => `${span.kind} ${span.start}-${span.end}`), ['after 18:00-19:00']);
  // 時短（1日6時間）：6時間を超えて8時間までは時間内
  const shortShift = { start_time: '10:00', end_time: '17:00', break_minutes: 60, work_days: [1, 2, 3, 4, 5], extend_side: 'after' as const };
  const shortDay = computeDayActual({ date: weekday, startIso: iso(weekday, '10:00'), endIso: iso(weekday, '18:00'), schedule: shortShift })!;
  assert.deepEqual([shortDay.overtime_minutes, shortDay.within_minutes], [0, 60]);
});

test('company holidays count as days off, and the D08 deadline is the 2nd business day', () => {
  const holiday = '2026-11-03'; // 火曜・文化の日
  const day = computeDayActual({ date: holiday, startIso: iso(holiday, '13:00'), endIso: iso(holiday, '15:00'), schedule: officeShift, holiday: true })!;
  assert.deepEqual([day.day_off, day.overtime_minutes], [true, 120]);
  // 2026年11月：1日(日)、2日(月)、3日(火・休日)、4日(水) → 2営業日目は4日
  assert.equal(nthBusinessDay('2026-11', 2, new Set([holiday])), '2026-11-04');
  assert.equal(nthBusinessDay('2026-11', 2), '2026-11-03');
});

test('short days without an entered break do not lose the prescribed break', () => {
  const short = computeDayActual({ date: weekday, startIso: iso(weekday, '19:00'), endIso: iso(weekday, '21:50'), schedule: lateShift })!;
  assert.deepEqual([short.break_minutes, short.worked_minutes], [0, 170]);
  const long = computeDayActual({ date: weekday, startIso: iso(weekday, '13:50'), endIso: iso(weekday, '22:20'), schedule: lateShift })!;
  assert.deepEqual([long.break_minutes, long.worked_minutes, long.overtime_minutes], [60, 450, 0]);
});

test('half-day leave fills the shortfall, so work after the shift end counts as time within (1.0)', async () => {
  const { buildMonth, dedicatedStaffFromProfile } = await import('../lib/dedicated-month.ts');
  const staff = dedicatedStaffFromProfile('u1', { name: '専任', job_grade: 3, overtime_unit_rate: 2000, prescribed_work_start: '13:50', prescribed_work_end: '22:20', prescribed_break_minutes: 60, prescribed_work_days: [1, 2, 3, 4, 5, 6] });
  // 半日有休（3:45）で 17:35 出勤、22:50 退勤 → 所定を超えた 22:20〜22:50 が時間内
  const record = { id: 'r1', date: weekday, start_time: iso(weekday, '17:35'), end_time: iso(weekday, '22:50'), dedicated_break_minutes: 0 };
  const without = buildMonth({ staff, month: '2026-11', records: [record], plans: [], reports: [] }).days.find(day => day.date === weekday)!;
  assert.equal(without.reconciliation.within_minutes, 0);
  const withLeave = buildMonth({ staff, month: '2026-11', records: [{ ...record, dedicated_adjustment: { kind: 'half_leave', minutes: 225 } }], plans: [], reports: [] });
  const day = withLeave.days.find(item => item.date === weekday)!;
  assert.deepEqual([day.adjustment?.credited_minutes, day.reconciliation.within_minutes, day.actual?.overtime_minutes], [225, 30, 0]);
  assert.equal(withLeave.pay.lines.find(line => line.key === 'within')!.amount, 1000);
});

test('time transfer moves minutes from another day: within first, then overtime, keeping the 0.25 premium', async () => {
  const { buildMonth, dedicatedStaffFromProfile } = await import('../lib/dedicated-month.ts');
  const staff = dedicatedStaffFromProfile('u1', { name: '専任', job_grade: 3, overtime_unit_rate: 2000, prescribed_work_start: '13:50', prescribed_work_end: '22:20', prescribed_break_minutes: 60, prescribed_work_days: [1, 2, 3, 4, 5, 6] });
  const source = '2026-11-05';
  // 元の日：12:20〜22:20 → 時間外 60分（12:20〜13:20）・時間内 30分。承認済みの報告あり。
  const sourceRecord = { id: 'r0', date: source, start_time: iso(source, '12:20'), end_time: iso(source, '22:20') };
  const target = '2026-11-06';
  // 振替先：15:20 出勤（1時間30分足りない）、22:20 退勤
  const targetRecord = { id: 'r1', date: target, start_time: iso(target, '15:20'), end_time: iso(target, '22:20'), dedicated_break_minutes: 60, dedicated_adjustment: { kind: 'time_transfer', minutes: 60, from_date: source } };
  const view = buildMonth({ staff, month: '2026-11', records: [sourceRecord, targetRecord], plans: [], reports: [{ id: 'p', user_id: 'u1', date: source, status: 'approved', reason: '面談' }] });
  const from = view.days.find(day => day.date === source)!;
  const to = view.days.find(day => day.date === target)!;
  assert.deepEqual(to.adjustment?.credited_minutes, 60);
  assert.deepEqual(from.transferred_to, [{ date: target, minutes: 60 }]);
  // 時間内30分 → 時間外30分 の順に使う
  assert.deepEqual([from.reconciliation.within_minutes, from.reconciliation.payable_minutes, from.reconciliation.transfer_premium_minutes], [0, 30, 30]);
  assert.equal(view.pay.lines.find(line => line.key === 'transfer_premium')!.amount, 250); // 2000 × 0.25 × 0.5h
  // 元の日に残っている分しか移せない
  const greedy = buildMonth({ staff, month: '2026-11', records: [sourceRecord, { ...targetRecord, dedicated_adjustment: { kind: 'time_transfer', minutes: 300, from_date: source } }], plans: [], reports: [{ id: 'p', user_id: 'u1', date: source, status: 'approved', reason: '面談' }] });
  assert.equal(greedy.days.find(day => day.date === target)!.adjustment?.credited_minutes, 90);
});

// 特訓・月60時間超・月75時間の見込み（2026-10-28 給与担当の回答）
const fakeActual = (date: string, overtime: number, night = 0, dayOff = false) => ({
  date, start: '', end: '', break_minutes: 0, worked_minutes: overtime, day_off: dayOff, spans: [], overtime_minutes: overtime,
  night_overtime_minutes: night, within_minutes: 0, night_regular_minutes: 0, offset_minutes: 0, warnings: [],
}) as DayActual;
const approvedPlan = (date: string, minutes: number, special_kind: PlanLike['special_kind'] = null, night_minutes = 0): PlanLike => ({ date, minutes, night_minutes, status: 'approved', special_kind });
const summarize = (items: Array<{ actual: DayActual; plans: PlanLike[]; report?: Parameters<typeof reconcileDay>[3] }>, grade: number | null) => summarizeMonth(
  items.map(item => reconcileDay(item.actual.date, item.actual, item.plans, item.report || null)),
  new Map(items.map(item => [item.actual.date, item.actual])),
  grade,
);

test('specials are paid as an allowance: counted by kind, but kept out of overtime pay', async () => {
  const { buildMonth, dedicatedStaffFromProfile } = await import('../lib/dedicated-month.ts');
  const staff = dedicatedStaffFromProfile('u1', { name: '専任', job_grade: 3, overtime_unit_rate: 2000, prescribed_work_start: '13:50', prescribed_work_end: '22:20', prescribed_break_minutes: 60, prescribed_work_days: [1, 2, 3, 4, 5, 6] });
  const plan = (id: string, date: string, start: string, end: string, minutes: number, special_kind: PlanLike['special_kind']) => ({
    id, user_id: 'u1', date, start, end, break_minutes: 0, minutes, reason: '業務', source: 'individual' as const, status: 'approved' as const, special_kind,
  });
  const view = buildMonth({
    staff,
    month: '2026-11',
    records: [
      { id: 'r1', date: weekday, start_time: iso(weekday, '12:20'), end_time: iso(weekday, '22:20') },
      // 日曜特訓（公休日）10:00〜16:00・休憩60分 → 5時間
      { id: 'r2', date: sunday, start_time: iso(sunday, '10:00'), end_time: iso(sunday, '16:00'), dedicated_break_minutes: 60 },
    ],
    plans: [plan('p1', weekday, '12:20', '13:20', 60, null), plan('p2', sunday, '10:00', '16:00', 300, 'sunday')],
    reports: [],
  });
  assert.deepEqual([view.summary.payable_minutes, view.summary.special_minutes, view.summary.special_by_kind.sunday, view.summary.overtime_minutes], [360, 300, 300, 60]);
  assert.equal(view.summary.payable_day_off_minutes, 0);
  const minutes = (key: string) => view.pay.lines.find(line => line.key === key)!.minutes;
  assert.deepEqual([minutes('normal'), minutes('holiday')], [60, 0]);
  assert.equal(view.pay.overtime_payable_amount, 2500); // 2000 × 1.25 × 1h（特訓の5時間は入れない）
});

test('time reported beyond the plan takes the special kind chosen in the report', () => {
  const day = reconcileDay(weekday, fakeActual(weekday, 180), [approvedPlan(weekday, 60)], { date: weekday, status: 'approved', special_kind: 'toppa' });
  assert.deepEqual([day.payable_minutes, day.special_minutes, day.special_by_kind.toppa], [180, 120, 120]);
});

test('grade 5: specials do not count toward the 35 hours', () => {
  const summary = summarize([
    { actual: fakeActual('2026-11-02', 34 * 60), plans: [approvedPlan('2026-11-02', 34 * 60)] },
    { actual: fakeActual('2026-11-03', 120), plans: [approvedPlan('2026-11-03', 120, 'toppa')] },
  ], 5);
  assert.deepEqual([summary.overtime_minutes, summary.special_minutes, summary.grade_payable_minutes], [34 * 60, 120, 0]);
});

test('overtime beyond 60 hours a month is split out (night first), and days off are not counted', () => {
  const items = ['2026-11-02', '2026-11-03', '2026-11-04', '2026-11-05'].map((date, index) => {
    const actual = fakeActual(date, 1000, index === 3 ? 200 : 0);
    return { actual, plans: [approvedPlan(date, 1000, null, actual.night_overtime_minutes)] };
  });
  // 公休日の時間外（休日の割増）は60時間に数えない。
  items.push({ actual: fakeActual(sunday, 300, 0, true), plans: [approvedPlan(sunday, 300)] });
  const summary = summarize(items, 3);
  assert.deepEqual([summary.over60_minutes, summary.over60_night_minutes], [200, 200]);
  const pay = computeOvertimePay(summary, { grade: 3, unitRate: 2000 });
  const line = (key: string) => pay.lines.find(item => item.key === key)!;
  assert.deepEqual([line('normal').minutes, line('night').minutes, line('holiday').minutes, line('over60').minutes, line('over60_night').minutes], [3600, 0, 300, 200, 200]);
  assert.equal(line('over60').amount, 10000); // 2000 × 1.5 × 200/60
  assert.equal(line('over60_night').amount, 11667); // 2000 × 1.75 × 200/60 = 11666.7 → 切り上げ
});

test('the 75-hour projection uses the larger of actual and planned time, plus the new request', () => {
  const days = [
    reconcileDay('2026-11-02', fakeActual('2026-11-02', 100), [approvedPlan('2026-11-02', 50), { date: '2026-11-02', minutes: 100, status: 'pending' }], null),
    reconcileDay('2026-11-20', null, [approvedPlan('2026-11-20', 240, 'sunday')], null),
  ];
  assert.equal(projectedMonthOvertime(days, 60), 150 + 240 + 60);
});

test('lesson half-years: March-July and September-February', () => {
  assert.deepEqual(lessonTerm('2026-H1'), { id: '2026-H1', label: '2026年度 上半期（3〜7月）', start: '2026-03-01', end: '2026-07-31' });
  assert.equal(lessonTerm('2026-H2')!.end, '2027-02-28');
  assert.equal(lessonTerm('2027-H2')!.end, '2028-02-29');
  assert.equal(lessonTermOf('2027-01-15').id, '2026-H2');
  assert.equal(lessonTermOf('2026-08-10').id, '2026-H1');
  assert.equal(lessonTerm('2026-H3'), null);
});

test('lesson exclusions merge by reason and cannot exceed the lesson minutes', () => {
  assert.deepEqual(normalizeLessonExclusions([{ reason: 'toppa', minutes: 30 }, { reason: 'overtime', minutes: 20 }, { reason: 'toppa', minutes: 10 }], 120), [{ reason: 'overtime', minutes: 20 }, { reason: 'toppa', minutes: 40 }]);
  assert.equal(normalizeLessonExclusions([{ reason: 'toppa', minutes: 130 }], 120), null);
  assert.equal(normalizeLessonExclusions([{ reason: 'unknown', minutes: 10 }], 120), null);
  assert.equal(countedLessonMinutes({ lesson_minutes: 120, excluded: [{ reason: 'makeup', minutes: 45 }] }), 75);
  assert.equal(needsLessonMinutes(4), true);
  assert.equal(needsLessonMinutes(null), true);
  assert.equal(needsLessonMinutes(5), false);
});

test('half-year lesson total leaves out seasons, excluded lessons and pending claims', () => {
  const season = normalizeSeason({ ...SUMMER_2026_TEMPLATE, periods: { group_online: { start: '2026-07-20', end: '2026-08-31' }, individual: { start: '', end: '' }, junior_exam: { start: '', end: '' } } }, 'summer');
  const summary = summarizeLessonTerm({
    term: lessonTerm('2026-H1')!,
    seasons: [season],
    division: 'group_online',
    lessons: [
      { lesson_date: '2026-03-02', lesson_minutes: 120, status: 'approved', school_name: 'A校' },
      { lesson_date: '2026-04-06', lesson_minutes: 150, status: 'approved', school_name: 'B校', excluded: [{ reason: 'overtime', minutes: 50 }] },
      { lesson_date: '2026-05-11', lesson_minutes: 90, status: 'pending', school_name: 'A校' },
      { lesson_date: '2026-06-01', lesson_minutes: 60, status: 'rejected', school_name: 'A校' },
      { lesson_date: '2026-07-21', lesson_minutes: 180, status: 'approved', school_name: 'A校' },
      { lesson_date: '2026-09-01', lesson_minutes: 100, status: 'approved', school_name: 'A校' },
    ],
  });
  assert.equal(summary.counted_minutes, 220);
  assert.equal(summary.pending_minutes, 90);
  assert.deepEqual(summary.excluded_by_reason, { overtime: 50 });
  assert.equal(summary.season_minutes, 180);
  assert.equal(summary.days, 2);
  assert.deepEqual(summary.by_school, [{ school_name: 'A校', minutes: 120 }, { school_name: 'B校', minutes: 100 }]);
});
