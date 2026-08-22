import test from 'node:test';
import assert from 'node:assert/strict';
import JSZip from 'jszip';
import {
  calculateAttendancePayroll,
  mapWorkTypeToPayrollCategory,
  overlapMinutes,
  parseRateMasterCsv,
  parseRegularAttendanceCsv,
  resolveLegacyLessonRates,
} from '../lib/attendance-payroll.ts';
import { parseRegularAttendanceXlsx } from '../lib/attendance-xlsx.ts';
import { buildOriginalPayrollHtml } from '../lib/attendance-original-export.ts';

test('legacy work types map to the four payroll categories', () => {
  assert.equal(mapWorkTypeToPayrollCategory('breakthrough_lesson'), 'lesson');
  assert.equal(mapWorkTypeToPayrollCategory('breakthrough_office'), 'office');
  assert.equal(mapWorkTypeToPayrollCategory('support'), 'interview');
  assert.equal(mapWorkTypeToPayrollCategory('サブスタッフ'), 'interview');
  assert.equal(mapWorkTypeToPayrollCategory('interview'), 'interview');
  assert.equal(mapWorkTypeToPayrollCategory('面接指導'), 'interview');
  assert.equal(mapWorkTypeToPayrollCategory('grading'), 'other');
  assert.equal(mapWorkTypeToPayrollCategory('break'), null);
});

test('time overlap uses half-open intervals', () => {
  assert.equal(overlapMinutes('09:00', '10:00', '09:30', '10:30'), 30);
  assert.equal(overlapMinutes('09:00', '10:00', '10:00', '11:00'), 0);
});

test('interview attendance is aggregated as sub payroll', () => {
  const result = calculateAttendancePayroll({
    month: '2026-08',
    scope: 'all',
    records: [{
      id: 'interview-1', teacher_id: 'teacher-1', teacher_name: '山田 太郎', person_code: '0001',
      date: '2026-08-02', attendance_kind: 'normal',
      work_segments: [{ start: '13:00', end: '15:00', type: 'interview', note: '面接' }],
    }],
    rates: [{
      id: 'rate-1', person_code: '0001', person_name: '山田太郎', effective_from: '2026-08-01',
      hourly_rates: { lesson: 2500, office: 1200, interview: 1600, other: 1200 },
      allowances: { lesson: 0, office: 0, interview: 0, other: 0 },
    }],
    regularAttendance: [],
  });

  assert.equal(result.rows[0].categories.interview.minutes, 120);
  assert.equal(result.rows[0].categories.interview.amount, 3200);
  assert.equal(result.rows[0].total_payment, 3200);
});

test('monthly payroll applies the latest rate and detects regular-attendance overlap', () => {
  const result = calculateAttendancePayroll({
    month: '2026-08',
    scope: 'breakthrough',
    records: [{
      id: 'work-1', teacher_id: 'teacher-1', teacher_name: '山田 太郎', person_code: '0001',
      date: '2026-08-01', attendance_kind: 'breakthrough',
      work_segments: [
        { start: '09:00', end: '11:00', type: 'breakthrough_lesson', note: '授業' },
        { start: '11:00', end: '12:00', type: 'breakthrough_office', note: '準備' },
      ],
      transportation: [{ cost: 500 }],
    }],
    rates: [{
      id: 'rate-1', person_code: '0001', person_name: '山田太郎', effective_from: '2026-04-01',
      hourly_rates: { lesson: 2500, office: 1200, interview: 1500, other: 1200 },
      allowances: { lesson: 500, office: 100, interview: 0, other: 0 },
    }],
    regularAttendance: [{
      id: 'regular-1', person_code: '0001', person_name: '山田 太郎', date: '2026-08-01',
      start_time: '10:30', end_time: '17:00', work_type: '通常勤務',
    }],
  });

  assert.equal(result.rows.length, 1);
  assert.equal(result.rows[0].categories.lesson.amount, 5500);
  assert.equal(result.rows[0].categories.office.amount, 1300);
  assert.equal(result.rows[0].total_payment, 6800);
  assert.equal(result.rows[0].gross_payment, 7300);
  assert.equal(result.alerts.filter(alert => alert.code === 'time_overlap').length, 2);
  const originalHtml = buildOriginalPayrollHtml('2026-08', result.rows);
  assert.match(originalHtml, /通常授業/);
  assert.match(originalHtml, /ｻﾌﾞ（面談）/);
  assert.match(originalHtml, /<td class="total">6800<\/td>/);
});

test('CSV import parsers accept Japanese payroll headers', () => {
  const rates = parseRateMasterCsv('個人コード,氏名,適用開始日,授業時給,事務時給,面接時給,その他時給,事業手当\n0001,山田 太郎,2026/04/01,"2,500",1200,1500,1200,500');
  assert.deepEqual(rates.errors, []);
  assert.equal(rates.data[0].hourly_rates.lesson, 2500);

  const regular = parseRegularAttendanceCsv('個人コード,氏名,日付,開始,終了,勤務区分\n0001,山田 太郎,2026/08/01,09:00,17:00,通常勤務');
  assert.deepEqual(regular.errors, []);
  assert.equal(regular.data[0].date, '2026-08-01');
});

test('provided attendance workbook headers use actual work intervals and exclude breaks', async () => {
  const strings = [
    '勤務日キンムビ', '職員番号ショクインバンゴウ', '職員氏名ショクインシメイ',
    '作業名サギョウメイ', '実働開始ジツドウカイシ', '実働終了ジツドウシュウリョウ',
    '実働（分）ジツドウフン', '2026/07/01', '13038634', '堀　佳代',
    '事務（集団・通常）', '12:45', '17:05', '休憩', '17:05', '17:30',
  ];
  const sharedStrings = `<?xml version="1.0"?><sst xmlns="http://schemas.openxmlformats.org/spreadsheetml/2006/main">${strings.map(value => `<si><t>${value}</t></si>`).join('')}</sst>`;
  const cell = (reference: string, value: number, type = 's') => `<c r="${reference}" t="${type}"><v>${value}</v></c>`;
  const sheet = `<?xml version="1.0"?><worksheet xmlns="http://schemas.openxmlformats.org/spreadsheetml/2006/main"><sheetData>
    <row r="1">${cell('A1', 0)}${cell('B1', 1)}${cell('C1', 2)}${cell('D1', 3)}${cell('E1', 4)}${cell('F1', 5)}${cell('G1', 6)}</row>
    <row r="2">${cell('A2', 7)}${cell('B2', 8)}${cell('C2', 9)}${cell('D2', 10)}${cell('E2', 11)}${cell('F2', 12)}${cell('G2', 260, 'n')}</row>
    <row r="3">${cell('A3', 7)}${cell('B3', 8)}${cell('C3', 9)}${cell('D3', 13)}${cell('E3', 14)}${cell('F3', 15)}${cell('G3', 25, 'n')}</row>
  </sheetData></worksheet>`;
  const zip = new JSZip();
  zip.file('xl/sharedStrings.xml', sharedStrings);
  zip.file('xl/worksheets/sheet1.xml', sheet);
  const parsed = await parseRegularAttendanceXlsx(await zip.generateAsync({ type: 'nodebuffer' }));

  assert.deepEqual(parsed.errors, []);
  assert.equal(parsed.data.length, 1);
  assert.deepEqual(parsed.data[0], {
    person_code: '13038634', person_name: '堀　佳代', normalized_name: '堀佳代',
    date: '2026-07-01', start_time: '12:45', end_time: '17:05', work_type: '事務（集団・通常）',
  });
});

test('legacy rate sheet uses EDIC lesson rate directly for lesson payroll', () => {
  assert.deepEqual(resolveLegacyLessonRates({ edic: 2050, individual1: 1260, individual4: 1340 }), { normal: 2050, breakthrough: 2050 });
  assert.deepEqual(resolveLegacyLessonRates({ individual1: 2000, individual4: 2500 }), { normal: 0, breakthrough: 0 });

  const sample = calculateAttendancePayroll({
    month: '2026-04', scope: 'breakthrough', regularAttendance: [],
    records: [{
      id: 'original-sample', teacher_id: 'teacher', teacher_name: '○○●●', person_code: '11111111',
      school_name: '元町校', date: '2026-04-01', attendance_kind: 'breakthrough',
      work_segments: [
        { start: '09:00', end: '11:30', type: 'breakthrough_lesson' },
        { start: '12:00', end: '17:00', type: 'breakthrough_office' },
      ], transportation: [{ cost: 2000 }],
    }],
    rates: [{
      person_code: '11111111', person_name: '○○●●', effective_from: '2026-04-01',
      normal_lesson_rate: 2050, breakthrough_lesson_rate: 2050,
      hourly_rates: { lesson: 2050, office: 1120, interview: 1120, other: 1120 },
      allowances: { lesson: 0, office: 0, interview: 0, other: 0 },
    }],
  });
  assert.equal(sample.rows[0].categories.lesson.amount, 5125);
  assert.equal(sample.rows[0].categories.office.amount, 5600);
  assert.equal(sample.rows[0].total_payment, 10725);
  assert.equal(sample.rows[0].transportation_amount, 2000);
});

test('CSV exported from the original rate sheet is auto-detected', () => {
  const csv = [
    '支給年月,所属教室番号,職員コード,Expr1002,EDIC授業_TANKA,創学授業_TANKA,個別授業1_TANKA,個別授業4_TANKA,サブスタッフ_TANKA,事務_TANKA',
    '202604,7,13040792,上米良　美羽,2050,0,1260,1340,1120,1120',
  ].join('\n');
  const parsed = parseRateMasterCsv(csv);
  assert.equal(parsed.format, 'legacy_rate_sheet');
  assert.deepEqual(parsed.errors, []);
  assert.equal(parsed.data[0].effective_from, '2026-04-01');
  assert.equal(parsed.data[0].normal_lesson_rate, 2050);
  assert.equal(parsed.data[0].breakthrough_lesson_rate, 2050);
  assert.equal(parsed.data[0].hourly_rates.office, 1120);
});
