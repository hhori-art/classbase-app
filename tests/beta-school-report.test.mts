import assert from 'node:assert/strict';
import test from 'node:test';
import { BETA_REPORT_SCHOOL_CODES, formatBetaReport, isBetaReportPeriod, sumBetaStats } from '../lib/beta-school-report.ts';

const row = (code: string, values: Partial<Record<string, number>> = {}) => ({
  code, name: `校舎${code}`, students: 10, registered: 8, loginDay: 3, login7: 6, lessons: 4, joined: 3, absent: 1, ...values,
});

test('the beta report covers schools 112, 132 and 147 and stops after 11/21', () => {
  assert.deepEqual([...BETA_REPORT_SCHOOL_CODES], ['112', '132', '147']);
  assert.equal(isBetaReportPeriod('2026-11-21'), true);
  assert.equal(isBetaReportPeriod('2026-11-22'), false);
});

test('the beta report shows rates per school and the total, without names', () => {
  const rows = [row('112'), row('132', { lessons: 0, joined: 0 }), row('147', { students: 0, loginDay: 0, login7: 0 })];
  const total = sumBetaStats(rows);
  assert.equal(total.students, 20);
  assert.equal(total.lessons, 8);
  const { subject, body } = formatBetaReport('2026-10-23', rows);
  assert.match(subject, /10月23日（金）/);
  assert.match(body, /生徒ログイン率（当日）: 30%（3\/10人）/);
  assert.match(body, /授業参加率: 75%（参加 3\/4コマ・未参加 1コマ）/);
  assert.match(body, /授業参加率: 授業なし/);
  assert.match(body, /生徒ログイン率（当日）: —（0\/0人）/);
  assert.match(body, /■ 3校合計/);
  assert.doesNotMatch(body, /保護者/);
});
