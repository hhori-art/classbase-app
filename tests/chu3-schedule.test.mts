import assert from 'node:assert/strict';
import test from 'node:test';
import { applyChu3Rules, baseCourseName, chu3SelectionsFromIds, computeCivicsRooms, courseBranchNumber } from '../lib/chu3-schedule.ts';

// 11/2（月）の配置表：理科が入れ替わった後（1限 化学・地学、2限 物理・生物）。社会は 1限 公民③④、2限 公民①②。
const day = '2026-11-02';
const shift = (id: string, period: number, subject: string, detail: string) => ({ id, target_date: day, target_grade: '中3', target_subject: subject, target_detail_subject: detail, period });
const shifts = [
  shift('chem1', 1, '理科', '化学'), shift('geo1', 1, '理科', '地学'),
  shift('civ3', 1, '社会', '公民③'), shift('civ4', 1, '社会', '公民④'),
  shift('phys2', 2, '理科', '物理'), shift('bio2', 2, '理科', '生物'),
  shift('civ1', 2, '社会', '公民①'), shift('civ2', 2, '社会', '公民②'),
];
const periodOf = (item: any) => item.period;
const notPrep = () => false;
const run = (ids: string[], eligible: string[], room: 1 | 2 | null = null) => [...applyChu3Rules({
  shifts, eligible: new Set(eligible), selections: chu3SelectionsFromIds(ids), periodOf, isTestPrep: notPrep, civicsRoomFor: () => room,
})].sort();

test('reads 中3 selections from stable keys and course ids', () => {
  const selections = chu3SelectionsFromIds(['course_中3_社会_公民_月_1限', 'shift_class_2026_term3_中3_理科_化学_月_2時間目', 'course_中3_社会_通常公民_木_1限']);
  assert.deepEqual(selections.get('月'), [{ subject: '社会', course: '公民', period: 1 }, { subject: '理科', course: '化学', period: 2 }]);
  assert.deepEqual(selections.get('木'), [{ subject: '社会', course: '公民', period: 1 }]);
  // 単元つきの古い講座ID
  assert.deepEqual(chu3SelectionsFromIds(['class_2026_term_custom_1_中3_社会_公民_裁判所_金_2時間目']).get('金'), [{ subject: '社会', course: '公民', period: 2 }]);
  assert.equal(baseCourseName('【対策標準】化学'), '化学');
  assert.deepEqual([courseBranchNumber('公民③'), courseBranchNumber('公民④'), courseBranchNumber('公民')], [3, 4, null]);
});

test('science follows the registered course when periods swap, and social takes the other period', () => {
  // 10月は「2限 化学 ＋ 1限 公民」。11/2は化学が1限になるので、公民は2限（①②）。
  assert.deepEqual(run(['course_中3_理科_化学_月_2限', 'course_中3_社会_公民_月_1限'], ['civ3', 'civ4']), ['chem1', 'civ1', 'civ2']);
  // 「1限 物理 ＋ 2限 公民」→ 物理は2限、公民は1限（③④）。2限に理科と社会が重ならない。
  assert.deepEqual(run(['course_中3_理科_物理_月_1限', 'course_中3_社会_公民_月_2限'], ['phys2', 'civ1', 'civ2']), ['civ3', 'civ4', 'phys2']);
  // 生物の登録で化学に入らない。
  assert.deepEqual(run(['course_中3_理科_生物_月_1限'], ['chem1']), ['bio2']);
});

test('social goes to the assigned room when two rooms share a period', () => {
  assert.deepEqual(run(['course_中3_理科_化学_月_2限', 'course_中3_社会_公民_月_1限'], [], 1), ['chem1', 'civ1']);
  assert.deepEqual(run(['course_中3_理科_化学_月_2限', 'course_中3_社会_公民_月_1限'], [], 2), ['chem1', 'civ2']);
  // 社会だけ登録した日は、登録した時限のまま。
  assert.deepEqual(run(['course_中3_社会_公民_月_2限'], [], 2), ['civ2']);
});

test('civics rooms split the students taking social in the same period in half', () => {
  const roster = ['s1', 's2', 's3', 's4', 's5'].map((id, index) => ({
    student_id: id,
    selections: chu3SelectionsFromIds(index < 3 ? ['course_中3_理科_化学_月_2限', 'course_中3_社会_公民_月_1限'] : ['course_中3_理科_物理_月_1限', 'course_中3_社会_公民_月_2限']),
  }));
  const rooms = computeCivicsRooms(day, shifts, roster, periodOf);
  // s1〜s3 は11/2に公民が2限、s4・s5 は1限。時限ごとに半分ずつ。
  assert.deepEqual(['s1', 's2', 's3', 's4', 's5'].map(id => rooms.get(id)), [1, 1, 2, 1, 2]);
});

test('keeps the original match when the registered course is not on that day', () => {
  assert.deepEqual(run(['course_中3_理科_天文_月_2限'], ['x']), ['x']);
});

test('works when only one period is requested (the join button asks per period)', () => {
  const ids = ['course_中3_理科_化学_月_2限', 'course_中3_社会_公民_月_1限'];
  const forPeriod = (period: number, eligible: string[]) => [...applyChu3Rules({
    shifts: shifts.filter(item => item.period === period), planShifts: shifts, eligible: new Set(eligible),
    selections: chu3SelectionsFromIds(ids), periodOf, isTestPrep: notPrep, civicsRoomFor: () => 2,
  })].sort();
  // 11/2：1限は化学（社会ではない）、2限は公民②。
  assert.deepEqual(forPeriod(1, ['civ3', 'civ4']), ['chem1']);
  assert.deepEqual(forPeriod(2, []), ['civ2']);
});

test('the registration screen shows each 中3 science course once per weekday, at the same period on every weekday of the term', async () => {
  const { collapseChu3ScienceOptions } = await import('../lib/chu3-schedule.ts');
  const option = (id: string, day: string, course: string, slot: string, dates: string[]) => ({ id, grade: '中3', subject: '理科', course_name: course, resolved_day: day, resolved_slot: slot, year: 2026, term: 'term3', matched_dates: dates });
  const out = collapseChu3ScienceOptions([
    // 金曜：今日（10/23）は入れ替わり前で1限、11/6からは2限
    option('fri-p1', '金', '物理', '1時間目', ['2026-10-23']),
    option('fri-p2', '金', '物理', '2時間目', ['2026-11-06', '2026-11-13', '2026-11-20']),
    // 月曜：11/2から2限だけ
    option('mon-p2', '月', '物理', '2時間目', ['2026-11-02', '2026-11-09', '2026-11-16']),
    option('fri-c1', '金', '化学', '1時間目', ['2026-11-06', '2026-11-13']),
    option('fri-c2', '金', '化学', '2時間目', ['2026-10-23']),
    { id: 's1', grade: '中3', subject: '社会', course_name: '公民', resolved_day: '金', resolved_slot: '1時間目', term: 'term3' },
    { id: 's2', grade: '中3', subject: '社会', course_name: '公民', resolved_day: '金', resolved_slot: '2時間目', term: 'term3' },
  ], '2026-10-23', (item: any) => [item.id]);
  assert.deepEqual(out.map((item: any) => item.id), ['fri-p2', 'mon-p2', 'fri-c1', 's1', 's2']);
  assert.deepEqual(out[0].alias_selection_ids, ['fri-p1']);
});

test('the registration screen uses the period at the start of the term from the placement sheet', async () => {
  const { collapseChu3ScienceOptions, chu3TermSciencePeriods } = await import('../lib/chu3-schedule.ts');
  // 第3期のはじめ（9/7）は 1限 物理・生物、2限 化学・地学。
  const termStart = [
    { id: 'a', target_date: '2026-09-07', target_grade: '中3', target_subject: '理科', target_detail_subject: '物理', period: 1 },
    { id: 'b', target_date: '2026-09-07', target_grade: '中3', target_subject: '理科', target_detail_subject: '化学', period: 2 },
  ];
  const periods = chu3TermSciencePeriods(termStart, (item: any) => item.period, () => false);
  assert.deepEqual([periods.get('物理'), periods.get('化学')], [1, 2]);
  // 今日より後の配置（11月は入れ替わり後）からは 2限 物理しか候補がなくても、期の時限（1限）で表示する。
  const out = collapseChu3ScienceOptions([
    { id: 'mon-p2', grade: '中3', subject: '理科', course_name: '物理', resolved_day: '月', resolved_slot: '2時間目', year: 2026, term: 'term3', stable_course_key: 'course_中3_理科_物理_月_2限', matched_dates: ['2026-11-02'] },
  ], '2026-10-23', (item: any) => [item.id, item.stable_course_key].filter(Boolean), new Map([['2026__term3', periods]]));
  assert.equal(out[0].resolved_slot, '1時間目');
  assert.equal(out[0].stable_course_key, undefined);
  assert.deepEqual(out[0].alias_selection_ids, ['mon-p2', 'course_中3_理科_物理_月_2限']);
});
