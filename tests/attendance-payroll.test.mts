import assert from 'node:assert/strict';
import test from 'node:test';
import { calculateIntegratedPayroll, DEFAULT_PREMIUM_RULES } from '../lib/attendance-integrated-payroll.ts';
import { resolveLegacyLessonRates, type PayrollRateMaster } from '../lib/attendance-payroll.ts';

const rate: PayrollRateMaster = {
  person_code: 'T001',
  person_name: '突破 太郎',
  effective_from: '2026-10-01',
  normal_lesson_rate: 1_000,
  breakthrough_lesson_rate: 1_500,
  hourly_rates: { lesson: 1_000, office: 800, interview: 800, other: 800 },
  allowances: { lesson: 0, office: 0, interview: 0, other: 0 },
  rate_items: { group_lesson: 1_000, office: 800 },
};

test('突破ゼミの授業だけ授業単価に500円を加算し、事務単価は変えない', () => {
  const result = calculateIntegratedPayroll({
    month: '2026-10',
    scope: 'system',
    systemRows: [],
    systemAttendance: [
      { person_code: 'T001', person_name: '突破 太郎', date: '2026-10-04', start_time: '13:00', end_time: '14:00', actual_minutes: 60, payroll_tier: 'group_lesson', attendance_program: 'normal' },
      { person_code: 'T001', person_name: '突破 太郎', date: '2026-10-04', start_time: '14:00', end_time: '15:00', actual_minutes: 60, payroll_tier: 'group_lesson', attendance_program: 'breakthrough' },
      { person_code: 'T001', person_name: '突破 太郎', date: '2026-10-04', start_time: '15:00', end_time: '16:00', actual_minutes: 60, payroll_tier: 'office', attendance_program: 'breakthrough' },
    ],
    externalAttendance: [],
    rates: [rate],
    schoolDistributions: [],
    adjustments: [],
  });

  assert.equal(result.rows.length, 1);
  assert.equal(result.rows[0].q141.group_lesson.minutes, 120);
  assert.equal(result.rows[0].q141.group_lesson.amount, 2_500);
  assert.equal(result.rows[0].q141.office.amount, 800);
  assert.equal(result.rows[0].normal_lesson_rate, 1_000);
  assert.equal(result.rows[0].breakthrough_lesson_rate, 1_500);
  assert.equal(result.rows[0].total_payment, 3_300);
});

test('単価取込時に突破ゼミ授業単価を通常授業単価プラス500円とする', () => {
  assert.deepEqual(resolveLegacyLessonRates({ edic: 1_200 }), { normal: 1_200, breakthrough: 1_700 });
  assert.deepEqual(resolveLegacyLessonRates({ edic: 0 }), { normal: 0, breakthrough: 0 });
});

const fullRate: PayrollRateMaster = {
  person_code: 'T002',
  person_name: '割増 花子',
  effective_from: '2026-10-01',
  normal_lesson_rate: 1_000,
  hourly_rates: { lesson: 1_000, office: 800, interview: 800, other: 800 },
  allowances: { lesson: 0, office: 0, interview: 0, other: 0 },
  rate_items: { group_lesson: 1_000, office: 800, sogaku_lesson: 50, private_tutor: 1_280, mentor: 1_120 },
};
const systemPayroll = (systemAttendance: Parameters<typeof calculateIntegratedPayroll>[0]['systemAttendance']) => calculateIntegratedPayroll({
  month: '2026-10', scope: 'system', systemRows: [], systemAttendance, externalAttendance: [], rates: [fullRate], schoolDistributions: [], adjustments: [],
}).rows[0];
const shift = (start_time: string, end_time: string, actual_minutes: number, payroll_tier: string) => ({
  person_code: 'T002', person_name: '割増 花子', date: '2026-10-05', start_time, end_time, actual_minutes, payroll_tier, attendance_program: 'normal',
});

test('創学授業は創学単価を1分あたりの単価（分給）として計算する', () => {
  const row = systemPayroll([shift('17:00', '18:30', 90, 'sogaku_lesson')]);
  assert.equal(row.q141.sogaku_lesson.minutes, 90);
  assert.equal(row.q141.sogaku_lesson.amount, 4_500);
});

test('ウイングネットは個別チューター単価、タブレット学習はメンター単価で計算する', () => {
  const row = systemPayroll([shift('15:00', '16:00', 60, 'private_tutor'), shift('16:00', '17:00', 60, 'mentor')]);
  assert.equal(row.q141.private_tutor.amount, 1_280);
  assert.equal(row.q141.mentor.amount, 1_120);
});

test('22時以降の授業は1.25倍になり、割増分を特別勤務手当4に入れる', () => {
  const row = systemPayroll([shift('21:00', '23:00', 120, 'group_lesson')]);
  assert.equal(row.q141.group_lesson.amount, 2_000);
  assert.equal(row.q141.special_4, 250);
  assert.equal(row.premiums.night_minutes, 60);
  assert.equal(row.total_payment, 2_250);
});

test('22時以降の事務は割増事務1（1.25倍）の列に入る', () => {
  const row = systemPayroll([shift('21:00', '23:00', 120, 'office')]);
  assert.equal(row.q141.office.minutes, 60);
  assert.equal(row.q141.office_premium_1.minutes, 60);
  assert.equal(row.q141.office_premium_1.amount, 1_000);
});

test('1日の実働が8時間を超えた分（深夜でない）は割増1（1.25倍・割増事務1の列）', () => {
  const row = systemPayroll([shift('09:00', '13:00', 240, 'office'), shift('14:00', '19:00', 300, 'office')]);
  assert.equal(row.q141.office.minutes, 480);
  assert.equal(row.q141.office_premium_1.minutes, 60);
  assert.equal(row.q141.office_premium_1.amount, 1_000);
  assert.equal(row.q141.office_premium_2.minutes, 0);
  assert.equal(row.premiums.overtime_minutes, 60);
});

test('深夜かつ8時間超の事務は割増2（1.5倍・割増事務2の列）', () => {
  const row = systemPayroll([shift('13:00', '17:00', 240, 'office'), shift('18:00', '23:00', 300, 'office')]);
  // 実働540分。22:00〜23:00が深夜かつ8時間超。深夜だけ・8時間超だけの時間はない。
  assert.equal(row.q141.office.minutes, 480);
  assert.equal(row.q141.office_premium_1.minutes, 0);
  assert.equal(row.q141.office_premium_2.minutes, 60);
  assert.equal(row.q141.office_premium_2.amount, 1_200);
});

test('授業の8時間超（深夜でない）は割増事務1の倍率で割増分を特別勤務手当4へ入れる', () => {
  const row = systemPayroll([shift('09:00', '13:00', 240, 'group_lesson'), shift('14:00', '19:00', 300, 'group_lesson')]);
  assert.equal(row.q141.group_lesson.amount, 9_000);
  assert.equal(row.q141.special_4, 250);
});

test('割増計算式の倍率を変えると授業の割増にも反映される', () => {
  const premiumRules = DEFAULT_PREMIUM_RULES.map(rule => rule.key === 'office_premium_1' ? { ...rule, multiplier: 1.3 } : rule);
  const row = calculateIntegratedPayroll({
    month: '2026-10', scope: 'system', systemRows: [], systemAttendance: [shift('21:00', '23:00', 120, 'group_lesson')], externalAttendance: [], rates: [fullRate], schoolDistributions: [], adjustments: [], premiumRules,
  }).rows[0];
  assert.equal(row.q141.special_4, 300);
});

test('授業の深夜かつ8時間超は割増2（1.5倍）', () => {
  const row = systemPayroll([shift('13:00', '17:00', 240, 'group_lesson'), shift('18:00', '23:00', 300, 'group_lesson')]);
  // 実働540分のうち、後ろの60分（22:00〜23:00）が深夜かつ8時間超。
  assert.equal(row.premiums.overtime_minutes, 60);
  assert.equal(row.premiums.night_minutes, 60);
  assert.equal(row.q141.group_lesson.amount, 9_000);
  assert.equal(row.q141.special_4, 500);
});

test('創学（分給）の授業にも深夜割増をかける', () => {
  const row = systemPayroll([shift('21:30', '22:30', 60, 'sogaku_lesson')]);
  assert.equal(row.q141.sogaku_lesson.amount, 3_000);
  // 30分 × 50円 × 0.25 = 375円
  assert.equal(row.q141.special_4, 375);
});
