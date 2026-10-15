import assert from 'node:assert/strict';
import test from 'node:test';
import { calculateIntegratedPayroll } from '../lib/attendance-integrated-payroll.ts';
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
