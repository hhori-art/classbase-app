import test from 'node:test';
import assert from 'node:assert/strict';
import JSZip from 'jszip';
import {
  calculateAttendancePayroll,
  mapWorkTypeToPayrollCategory,
  normalizeRegularAttendanceIntervalRecord,
  overlapMinutes,
  parseRateMasterCsv,
  parseRegularAttendanceCsv,
  regularAttendancePersonKey,
  resolveLegacyLessonRates,
} from '../lib/attendance-payroll.ts';
import { parseRegularAttendanceXlsx } from '../lib/attendance-xlsx.ts';
import { buildOriginalPayrollHtml } from '../lib/attendance-original-export.ts';
import { automaticPremiumMinutes, calculateIntegratedPayroll, classifyExternalAttendance, DEFAULT_INDIVIDUAL_RATE_MAPPINGS, DEFAULT_PREMIUM_RULES, parseSchoolDistributionCsv } from '../lib/attendance-integrated-payroll.ts';
import { buildQ141PayrollWorkbook } from '../lib/payroll-q141-xlsx.ts';

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

test('旧システム勤怠一覧CSVを授業・事務・サポートの内訳で取り込む', () => {
  const csv = [
    '校舎番号,職員番号,氏名,日付,出勤時刻,退勤時刻,授業(開始),授業(終了),事務・研修(開始),事務・研修(終了),サポート(開始),サポート(終了),授業時間(~22時),授業時間(22時~),事務・研修時間(~22時),事務・研修時間(22時~),サポート時間(~22時),サポート時間(22時~)',
    '111,13042137,古田 陽人,2026-09-29,18:58,22:30,19:40,22:00,19:00,22:30,,,2:10,,0:50,0:30,,',
  ].join('\n');
  const parsed = parseRegularAttendanceCsv(csv);
  assert.deepEqual(parsed.errors, []);
  assert.equal(parsed.data.length, 2);
  assert.deepEqual(parsed.data.map(item => ({ type: item.work_type, minutes: item.actual_minutes, school: item.school_code })), [
    { type: '授業', minutes: 130, school: '111' },
    { type: '事務・研修', minutes: 80, school: '111' },
  ]);
});

test('旧勤怠CSVは同一行を二重計上せず、同一職員コードの氏名揺れを同一人物として扱う', () => {
  const csv = [
    '職員番号,氏名,日付,開始,終了,勤務区分',
    '13042137,山田 太郎,2026-09-01,09:00,10:00,事務',
    '13042137,山田 太郎,2026-09-01,09:00,10:00,事務',
  ].join('\n');
  const parsed = parseRegularAttendanceCsv(csv);
  assert.equal(parsed.data.length, 1);
  assert.match(parsed.warnings[0], /重複/);
  assert.equal(regularAttendancePersonKey({ person_code: '13042137', person_name: '山田 太郎', normalized_name: '山田太郎' }), 'code:13042137');
  assert.equal(regularAttendancePersonKey({ person_code: '13042137', person_name: '山田太郎', normalized_name: '山田太郎' }), 'code:13042137');
});

test('空欄の開始・終了時刻を00:00として受理しない', () => {
  const parsed = parseRegularAttendanceCsv('職員番号,氏名,日付,開始,終了\n1,山田 太郎,2026-09-01,,');
  assert.equal(parsed.data.length, 0);
  assert.match(parsed.errors[0], /開始、終了は必須/);
});

test('旧システム勤怠一覧の退勤前データは全体を失敗させず対象外にする', () => {
  const parsed = parseRegularAttendanceCsv('職員番号,氏名,日付,出勤時刻,退勤時刻\n1,山田 太郎,2026-09-01,18:50,');
  assert.equal(parsed.data.length, 0);
  assert.deepEqual(parsed.errors, []);
  assert.match(parsed.warnings[0], /退勤時刻がない/);
});

test('API-synced camelCase attendance fields normalize to payroll fields', () => {
  assert.deepEqual(normalizeRegularAttendanceIntervalRecord({
    id: 'sync-1', employeeId: ' 0001 ', personCode: '0001', personName: '山田 太郎',
    date: '2026-08-01', startTime: '09:00', endTime: '10:30', workType: '個別通常（1：2）',
    courseCode: '0070', source: '旧システムDB',
  }), {
    id: 'sync-1', person_code: '0001', person_name: '山田 太郎', normalized_name: '',
    date: '2026-08-01', start_time: '09:00', end_time: '10:30', work_type: '個別通常（1：2）',
    school_code: '', school_name: '', course_code: '0070', course_name: '', work_code: '',
    actual_minutes: 0, payroll_tier: '', source_name: '旧システムDB',
  });
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
    school_code: '', school_name: '', course_code: '', course_name: '', work_code: '', actual_minutes: 260, payroll_tier: '',
  });
});

test('打刻勤怠情報 workbook format imports group and individual lesson detail rows', async () => {
  const headers = [
    'work_date', 'work_school_code', 'mas_school_school_name', 'school_code', 'mas_school_1_school_name',
    'staff_code', 'staff_name', 'staff_kbn', 'course_code', 'course_name', 'work_code', 'work_name',
    '勤怠情報②_start_time', '勤怠情報②_end_time', '勤怠情報②_work_time',
    'tbl_time_Link_start_time', 'tbl_time_Link_end_time', 'tbl_time_Link_work_time',
  ];
  const rows = [
    ['2026/08/01', '0321', 'AC明石', '0321', 'AC明石', '00110515', '堀　靖弘', '9', '0357', '夏期授業（中学部）', '', '', '11:50', '13:10', '80', '10:32', '21:50', '675'],
    ['2026/08/01', '0321', 'AC明石', '0321', 'AC明石', '00110515', '堀　靖弘', '9', '0069', '個別通常（1：1）', '', '', '13:20', '14:30', '70', '10:32', '21:50', '675'],
    ['2026/08/01', '0321', 'AC明石', '0321', 'AC明石', '00110515', '堀　靖弘', '9', '', '', '007', '事務（個別・通常）', '14:30', '15:00', '30', '10:32', '21:50', '675'],
    ['2026/08/01', '0321', 'AC明石', '0321', 'AC明石', '00110515', '堀　靖弘', '9', '', '', '016', '休憩', '15:00', '15:10', '10', '10:32', '21:50', '675'],
  ];
  const cell = (reference: string, value: string) => `<c r="${reference}" t="inlineStr"><is><t>${value}</t></is></c>`;
  const letters = headers.map((_, index) => String.fromCharCode(65 + index));
  const xmlRows = [headers, ...rows].map((row, rowIndex) => `<row r="${rowIndex + 1}">${row.map((value, columnIndex) => cell(`${letters[columnIndex]}${rowIndex + 1}`, value)).join('')}</row>`).join('');
  const zip = new JSZip();
  zip.file('xl/worksheets/sheet1.xml', `<?xml version="1.0"?><worksheet xmlns="http://schemas.openxmlformats.org/spreadsheetml/2006/main"><sheetData>${xmlRows}</sheetData></worksheet>`);

  const parsed = await parseRegularAttendanceXlsx(await zip.generateAsync({ type: 'nodebuffer' }));

  assert.deepEqual(parsed.errors, []);
  assert.equal(parsed.data.length, 3);
  assert.deepEqual(parsed.data.map(item => classifyExternalAttendance(item)), ['group_lesson', 'individual_1', 'office']);
  assert.deepEqual(parsed.data[1], {
    person_code: '00110515', person_name: '堀　靖弘', normalized_name: '堀靖弘',
    date: '2026-08-01', start_time: '13:20', end_time: '14:30', work_type: '個別通常（1：1）',
    school_code: '0321', school_name: 'AC明石', course_code: '0069', course_name: '個別通常（1：1）',
    work_code: '', actual_minutes: 70, payroll_tier: '9',
  });
});

test('external attendance is classified and calculated with detailed rate master items', () => {
  const external = [
    { person_code: '0001', person_name: '山田 太郎', date: '2026-07-01', start_time: '09:00', end_time: '10:30', actual_minutes: 90, course_code: '0070', course_name: '個別通常（1：2）' },
    { person_code: '0001', person_name: '山田 太郎', date: '2026-07-02', start_time: '10:00', end_time: '11:00', actual_minutes: 60, work_code: '006', work_type: '事務（集団・通常）' },
  ];
  assert.equal(classifyExternalAttendance(external[0]), 'individual_2');
  assert.equal(classifyExternalAttendance(external[1]), 'office');
  assert.equal(classifyExternalAttendance({ ...external[1], work_type: '付随 割増2' }), 'incidental_premium_2');
  const result = calculateIntegratedPayroll({
    month: '2026-07', scope: 'external', systemRows: [], externalAttendance: external, schoolDistributions: [], adjustments: [],
    rates: [{ person_code: '0001', person_name: '山田太郎', effective_from: '2026-07-01', hourly_rates: { lesson: 2000, office: 1200, interview: 1200, other: 1200 }, allowances: { lesson: 0, office: 0, interview: 0, other: 0 }, rate_items: { individual_2: 1400, office: 1200 } }],
  });
  assert.equal(result.rows[0].q141.individual_2.amount, 2100);
  assert.equal(result.rows[0].q141.office.amount, 1200);
  assert.equal(result.rows[0].total_payment, 3300);
});

test('individual lesson tiers use TANKA 1-3 for regular and 4-6 for entrance/high school', () => {
  const externalAttendance = ['0069', '0070', '0071', '0072', '0073', '0074'].map((course_code, index) => ({
    person_code: '0001', person_name: '山田 太郎', date: `2026-07-${String(index + 1).padStart(2, '0')}`,
    start_time: '10:00', end_time: '11:00', actual_minutes: 60, course_code,
  }));
  const common = {
    month: '2026-07', scope: 'external' as const, systemRows: [], externalAttendance, schoolDistributions: [], adjustments: [],
    rates: [{
      person_code: '0001', person_name: '山田 太郎', effective_from: '2026-07-01',
      hourly_rates: { lesson: 2000, office: 1200, interview: 1200, other: 1200 }, allowances: { lesson: 0, office: 0, interview: 0, other: 0 },
      rate_items: { individual_1: 1100, individual_2: 1200, individual_3: 1300, individual_4: 1400, individual_5: 1500, individual_6: 1600 },
    }],
  };
  const result = calculateIntegratedPayroll(common);
  assert.deepEqual([
    result.rows[0].q141.individual_1.amount, result.rows[0].q141.individual_2.amount, result.rows[0].q141.individual_3.amount,
    result.rows[0].q141.individual_4.amount, result.rows[0].q141.individual_5.amount, result.rows[0].q141.individual_6.amount,
  ], [1100, 1200, 1300, 1400, 1500, 1600]);
  assert.equal(result.rows[0].categories.lesson.minutes, 360);
  assert.equal(result.rows[0].categories.lesson.amount, 8100);

  const individualRateMappings = DEFAULT_INDIVIDUAL_RATE_MAPPINGS.map(mapping => mapping.attendance_key === 'individual_1' ? { ...mapping, rate_item_key: 'individual_6' as const } : mapping);
  const remapped = calculateIntegratedPayroll({ ...common, individualRateMappings });
  assert.equal(remapped.rows[0].q141.individual_1.rate, 1600);
  assert.equal(remapped.rows[0].q141.individual_1.amount, 1600);
});

test('combined payroll keeps new-system and old-system amounts independent', () => {
  const systemRows = [{
    teacher_id: 'teacher-1', person_code: '0001', person_name: '山田 太郎',
    school_code: '01', school_name: '三田校', tp_serial: '',
    normal_lesson_rate: 2000, breakthrough_lesson_rate: 2000,
    rate_effective_from: '2026-07-01', work_days: 1, total_minutes: 60,
    categories: {
      lesson: { minutes: 0, hourly_rate: 2000, allowance_count: 0, allowance_rate: 0, hourly_amount: 0, allowance_amount: 0, amount: 0 },
      office: { minutes: 60, hourly_rate: 1200, allowance_count: 0, allowance_rate: 0, hourly_amount: 1200, allowance_amount: 0, amount: 1200 },
      interview: { minutes: 0, hourly_rate: 1200, allowance_count: 0, allowance_rate: 0, hourly_amount: 0, allowance_amount: 0, amount: 0 },
      other: { minutes: 0, hourly_rate: 1200, allowance_count: 0, allowance_rate: 0, hourly_amount: 0, allowance_amount: 0, amount: 0 },
    },
    transportation_amount: 0, total_payment: 1200, gross_payment: 1200, alert_count: 0,
  }];
  const result = calculateIntegratedPayroll({
    month: '2026-07', scope: 'combined', systemRows,
    externalAttendance: [{
      person_code: '0001', person_name: '山田 太郎', date: '2026-07-02',
      start_time: '10:00', end_time: '10:30', actual_minutes: 30, work_type: '事務',
    }],
    rates: [{
      person_code: '0001', person_name: '山田 太郎', effective_from: '2026-07-01',
      hourly_rates: { lesson: 2000, office: 1200, interview: 1200, other: 1200 },
      allowances: { lesson: 0, office: 0, interview: 0, other: 0 },
    }],
    schoolDistributions: [], adjustments: [],
  });

  assert.equal(result.rows[0].source_amounts.system, 1200);
  assert.equal(result.rows[0].source_amounts.external, 600);
  assert.equal(result.rows[0].q141.office.amount, 1800);
  assert.equal(result.rows[0].total_payment, 1800);
});

test('premium attendance is calculated automatically and supports editable formulas', () => {
  const common = {
    month: '2026-07', scope: 'external' as const, systemRows: [], schoolDistributions: [], adjustments: [],
    externalAttendance: [{ person_code: '0001', person_name: '山田 太郎', date: '2026-07-02', start_time: '22:00', end_time: '23:00', actual_minutes: 60, work_type: '事務 深夜' }],
    rates: [{ person_code: '0001', person_name: '山田 太郎', effective_from: '2026-07-01', hourly_rates: { lesson: 2000, office: 1200, interview: 1200, other: 1200 }, allowances: { lesson: 0, office: 0, interview: 0, other: 0 }, rate_items: { office: 1200, office_premium_1: 9999 } }],
  };
  const defaultResult = calculateIntegratedPayroll(common);
  assert.equal(defaultResult.rows[0].q141.office_premium_1.rate, 1500);
  assert.equal(defaultResult.rows[0].q141.office_premium_1.amount, 1500);

  const premiumRules = DEFAULT_PREMIUM_RULES.map(rule => rule.key === 'office_premium_1' ? { ...rule, multiplier: 1.4, fixed_hourly_addition: 20 } : rule);
  const customResult = calculateIntegratedPayroll({ ...common, premiumRules });
  assert.equal(customResult.rows[0].q141.office_premium_1.rate, 1700);
  assert.equal(customResult.rows[0].q141.office_premium_1.amount, 1700);
});

test('ordinary punched attendance is split into normal and premium minutes from 22:00 to 05:00', () => {
  assert.equal(automaticPremiumMinutes('21:30', '23:15'), 75);
  assert.equal(automaticPremiumMinutes('23:00', '02:00'), 180);
  assert.equal(automaticPremiumMinutes('04:30', '06:00'), 30);
  assert.equal(automaticPremiumMinutes('09:00', '18:00'), 0);

  const result = calculateIntegratedPayroll({
    month: '2026-07', scope: 'external', systemRows: [], schoolDistributions: [], adjustments: [],
    externalAttendance: [{ person_code: '0001', person_name: '山田 太郎', date: '2026-07-02', start_time: '21:30', end_time: '23:15', work_type: '事務' }],
    rates: [{ person_code: '0001', person_name: '山田 太郎', effective_from: '2026-07-01', hourly_rates: { lesson: 2000, office: 1200, interview: 1200, other: 1200 }, allowances: { lesson: 0, office: 0, interview: 0, other: 0 } }],
  });
  assert.equal(result.rows[0].q141.office.minutes, 30);
  assert.equal(result.rows[0].q141.office.amount, 600);
  assert.equal(result.rows[0].q141.office_premium_1.minutes, 75);
  assert.equal(result.rows[0].q141.office_premium_1.amount, 1875);
});

test('new-system office attendance crossing 22:00 shows the premium minutes at the premium rate', () => {
  const result = calculateIntegratedPayroll({
    month: '2026-08', scope: 'system', systemRows: [], externalAttendance: [], schoolDistributions: [], adjustments: [],
    systemAttendance: [{ person_code: '13041162', person_name: '仲澤 芽衣', date: '2026-08-21', start_time: '21:40', end_time: '22:10', actual_minutes: 30, work_type: 'office', payroll_tier: 'office' }],
    rates: [{ person_code: '13041162', person_name: '仲澤 芽衣', effective_from: '2026-04-01', hourly_rates: { lesson: 0, office: 1120, interview: 0, other: 1120 }, allowances: { lesson: 0, office: 0, interview: 0, other: 0 } }],
  });
  assert.equal(result.rows[0].q141.office.minutes, 20);
  assert.equal(result.rows[0].q141.office.rate, 1120);
  assert.equal(result.rows[0].q141.office.amount, 374);
  assert.equal(result.rows[0].q141.office_premium_1.minutes, 10);
  assert.equal(result.rows[0].q141.office_premium_1.rate, 1400);
  assert.equal(result.rows[0].q141.office_premium_1.amount, 234);
});

test('science-social adds 200 yen per lesson day and 100 yen per support day without changing hourly pay', () => {
  const makeAttendance = (id: string, start_time: string, end_time: string, work_type: string, payroll_tier: string, attendance_program: string) => ({
    id, person_code: '0001', person_name: '山田 太郎', date: '2026-08-21', start_time, end_time,
    work_type, payroll_tier, attendance_program,
  });
  const input = {
    month: '2026-08', scope: 'system' as const, systemRows: [], externalAttendance: [], schoolDistributions: [], adjustments: [],
    systemAttendance: [
      makeAttendance('lesson-1', '09:00', '09:30', 'lesson', 'group_lesson', 'science_social'),
      makeAttendance('lesson-2', '09:30', '10:00', 'lesson', 'group_lesson', 'science_social'),
      makeAttendance('support-1', '10:00', '10:30', 'support', 'sub_staff', 'science_social'),
      makeAttendance('office-1', '10:30', '11:00', 'office', 'office', 'science_social'),
      makeAttendance('normal-lesson', '11:00', '11:30', 'lesson', 'group_lesson', 'normal'),
    ],
    rates: [{ person_code: '0001', person_name: '山田 太郎', effective_from: '2026-04-01', hourly_rates: { lesson: 1200, office: 1000, interview: 1000, other: 1000 }, allowances: { lesson: 0, office: 0, interview: 0, other: 0 } }],
  };
  const result = calculateIntegratedPayroll(input);
  const row = result.rows[0];
  assert.equal(row.q141.group_lesson.rate, 1200);
  assert.equal(row.q141.group_lesson.amount, 1800);
  assert.equal(row.q141.sub_staff.rate, 1000);
  assert.equal(row.q141.sub_staff.amount, 500);
  assert.equal(row.q141.office.amount, 500);
  assert.equal(row.q141.special_3, 300);
  assert.equal(row.total_payment, 3100);
  assert.equal(row.source_amounts.system, 3100);
  assert.equal(calculateIntegratedPayroll({ ...input, scope: 'external' }).rows.length, 0);
});

test('理社講座は1日に2コマ授業があっても3日分と600円、サポート2日分で200円を加算する', () => {
  const attendance = [
    ...['2026-08-07', '2026-08-17', '2026-08-21'].flatMap((date, day) => [
      { id: `lesson-${day}-1`, person_code: '13041162', person_name: '仲澤 芽衣', date, start_time: '19:20', end_time: '20:30', work_type: 'lesson', payroll_tier: 'group_lesson', attendance_program: 'science_social' },
      { id: `lesson-${day}-2`, person_code: '13041162', person_name: '仲澤 芽衣', date, start_time: '20:40', end_time: '21:40', work_type: 'lesson', payroll_tier: 'group_lesson', attendance_program: 'science_social' },
    ]),
    ...['2026-08-04', '2026-08-25'].map((date, day) => ({
      id: `support-${day}`, person_code: '13041162', person_name: '仲澤 芽衣', date,
      start_time: '18:30', end_time: '21:55', work_type: 'support', payroll_tier: 'sub_staff', attendance_program: 'science_social',
    })),
  ];
  const result = calculateIntegratedPayroll({
    month: '2026-08', scope: 'system', systemRows: [], systemAttendance: attendance,
    externalAttendance: [], schoolDistributions: [], adjustments: [],
    rates: [{ person_code: '13041162', person_name: '仲澤 芽衣', effective_from: '2026-04-01', hourly_rates: { lesson: 0, office: 0, interview: 0, other: 0 }, allowances: { lesson: 0, office: 0, interview: 0, other: 0 } }],
  });
  assert.equal(result.rows[0].q141.special_3, 800);
  assert.equal(result.rows[0].total_payment, 800);
  assert.equal(result.rows[0].source_amounts.system, 800);
});

test('transportation remains payable when all new-system work uses detailed payroll tiers', () => {
  const record = {
    id: 'work-1', teacher_id: 'teacher-1', teacher_name: '山田 太郎', person_code: '0001',
    date: '2026-08-21', work_segments: [], transportation: [{ cost: 500 }, { cost: '320' }],
  };
  const input = {
    month: '2026-08', scope: 'system' as const, systemRows: [], systemTransportationRecords: [record],
    systemAttendance: [{ person_code: '0001', person_name: '山田 太郎', date: '2026-08-21', start_time: '10:00', end_time: '11:00', actual_minutes: 60, work_type: 'office', payroll_tier: 'office' }],
    externalAttendance: [], schoolDistributions: [], adjustments: [],
    rates: [{ person_code: '0001', person_name: '山田 太郎', effective_from: '2026-04-01', hourly_rates: { lesson: 0, office: 1200, interview: 0, other: 1200 }, allowances: { lesson: 0, office: 0, interview: 0, other: 0 } }],
  };
  const result = calculateIntegratedPayroll(input);
  assert.equal(result.rows[0].transportation_amount, 820);
  assert.equal(result.rows[0].gross_payment, 2020);
  assert.equal(calculateIntegratedPayroll({ ...input, scope: 'external' }).rows.length, 0);
});

test('raw transportation records replace, rather than duplicate, system-row transportation', () => {
  const rate = { person_code: '0001', person_name: '山田 太郎', effective_from: '2026-04-01', hourly_rates: { lesson: 0, office: 1200, interview: 0, other: 1200 }, allowances: { lesson: 0, office: 0, interview: 0, other: 0 } };
  const record = { id: 'work-1', teacher_id: 'teacher-1', teacher_name: '山田 太郎', person_code: '0001', date: '2026-08-21', work_segments: [{ start: '10:00', end: '11:00', type: 'office' }], transportation: [{ cost: 500 }] };
  const systemRows = calculateAttendancePayroll({ month: '2026-08', scope: 'all', records: [record], rates: [rate], regularAttendance: [] }).rows;
  assert.equal(systemRows[0].transportation_amount, 500);
  const result = calculateIntegratedPayroll({ month: '2026-08', scope: 'system', systemRows, systemTransportationRecords: [record], externalAttendance: [], rates: [rate], schoolDistributions: [], adjustments: [] });
  assert.equal(result.rows[0].transportation_amount, 500);
});

test('all payroll categories round fractional yen up, including 40 minutes of late-night office work', () => {
  const result = calculateIntegratedPayroll({
    month: '2026-08', scope: 'system', systemRows: [], externalAttendance: [], schoolDistributions: [], adjustments: [],
    systemAttendance: [
      { person_code: '13041486', person_name: '白石 遥誠', date: '2026-08-21', start_time: '22:00', end_time: '22:40', actual_minutes: 40, work_type: 'office', payroll_tier: 'office' },
      { person_code: '13041486', person_name: '白石 遥誠', date: '2026-08-22', start_time: '12:00', end_time: '12:10', actual_minutes: 10, work_type: 'office', payroll_tier: 'office' },
    ],
    rates: [{ person_code: '13041486', person_name: '白石 遥誠', effective_from: '2026-04-01', hourly_rates: { lesson: 0, office: 1120, interview: 0, other: 1120 }, allowances: { lesson: 0, office: 0, interview: 0, other: 0 } }],
  });
  assert.equal(result.rows[0].q141.office_premium_1.rate, 1400);
  assert.equal(result.rows[0].q141.office_premium_1.amount, 934);
  assert.equal(result.rows[0].q141.office.amount, 187);
});

test('people without an effective rate master are excluded from payment but remain visible as danger alerts', () => {
  const result = calculateIntegratedPayroll({
    month: '2026-07', scope: 'external', systemRows: [], rates: [], schoolDistributions: [], adjustments: [],
    externalAttendance: [{ person_code: '9999', person_name: '未登録 職員', date: '2026-07-02', start_time: '10:00', end_time: '11:00', actual_minutes: 60, work_type: '事務' }],
  });
  assert.equal(result.rows.length, 0);
  assert.equal(result.alerts.length, 1);
  assert.equal(result.alerts[0].code, 'rate_missing');
  assert.equal(result.alerts[0].person_code, '9999');
  assert.equal(result.excluded_without_rate, 1);
});

test('external-only attendance reports duplicate latest rate masters', () => {
  const baseRate = { person_code: '0001', person_name: '山田 太郎', effective_from: '2026-04-01', hourly_rates: { lesson: 2500, office: 1200, interview: 1200, other: 1200 }, allowances: { lesson: 0, office: 0, interview: 0, other: 0 } };
  const result = calculateIntegratedPayroll({
    month: '2026-07', scope: 'external', systemRows: [], schoolDistributions: [], adjustments: [],
    rates: [{ ...baseRate, id: 'rate-a' }, { ...baseRate, id: 'rate-b', hourly_rates: { ...baseRate.hourly_rates, office: 1300 } }],
    externalAttendance: [{ person_code: '0001', person_name: '山田 太郎', date: '2026-07-02', start_time: '10:00', end_time: '11:00', actual_minutes: 60, work_type: '事務' }],
  });
  assert.equal(result.rows.length, 1);
  assert.equal(result.alerts.filter(alert => alert.code === 'rate_ambiguous').length, 1);
});

test('code-based system attendance and name-only external attendance merge when the rate master identity is unique', () => {
  const rate = { person_code: '0001', person_name: '山田 太郎', effective_from: '2026-04-01', hourly_rates: { lesson: 2500, office: 1200, interview: 1200, other: 1200 }, allowances: { lesson: 0, office: 0, interview: 0, other: 0 } };
  const systemAttendance = [{ person_code: '0001', person_name: '山田 太郎', date: '2026-07-01', start_time: '09:00', end_time: '10:00', actual_minutes: 60, work_type: 'office', payroll_tier: 'office' }];
  const result = calculateIntegratedPayroll({
    month: '2026-07', scope: 'combined', systemRows: [], systemAttendance, schoolDistributions: [], adjustments: [], rates: [rate],
    externalAttendance: [{ person_code: '', person_name: '山田　太郎', date: '2026-07-02', start_time: '10:00', end_time: '11:00', actual_minutes: 60, work_type: '事務' }],
  });
  assert.equal(result.rows.length, 1);
  assert.equal(result.rows[0].person_code, '0001');
  assert.equal(result.rows[0].total_minutes, 120);
});

test('school distribution CSV uses the combined allowance and transportation columns', () => {
  const csv = [
    '　2026年7月 学校前配布申請,,,,,,,,,,,,,',
    ',,,,,,,,,,,,,',
    ',,,,,,,,,,,,,',
    ',,,,,,,,,,,,,',
    ',,,,,,,,,,,,,',
    ',,,,,,,,,,,,,',
    'NO,教室名,職員コード,職員氏名,手当計,交通費計,実施日,実施高校名,手当計 ②,交通費計 ②,実施日 ②,実施高校名 ②,手当計 ①＋②,交通費計 ①＋②',
    '1,創学三田校PL,13041737,九村 真以,3000,0,7/7,北摂三田,,,,,3000,620',
  ].join('\n');
  const parsed = parseSchoolDistributionCsv(csv);
  assert.deepEqual(parsed.errors, []);
  assert.equal(parsed.month, '2026-07');
  assert.equal(parsed.data[0].allowance_amount, 3000);
  assert.equal(parsed.data[0].transportation_amount, 620);
});

test('Q141 export contains four clearly named work-purpose sheets', async () => {
  const integrated = calculateIntegratedPayroll({
    month: '2026-07', scope: 'combined', systemRows: [], externalAttendance: [], rates: [],
    schoolDistributions: [{ month: '2026-07', person_code: '0001', person_name: '山田 太郎', school_name: '三田校', allowance_amount: 3000, transportation_amount: 620, detail: '7/7' }], adjustments: [],
  });
  const blob = await buildQ141PayrollWorkbook('2026-07', integrated.rows);
  const zip = await JSZip.loadAsync(await blob.arrayBuffer());
  const workbook = await zip.file('xl/workbook.xml')?.async('string');
  assert.match(workbook || '', /name="01_給与計算結果_Q141"/);
  assert.match(workbook || '', /name="02_TP取込データ"/);
  assert.match(workbook || '', /name="03_TP並替データ"/);
  assert.match(workbook || '', /name="04_金額照合"/);
  assert.doesNotMatch(workbook || '', /0819|0715/);
});

test('legacy rate sheet adds 500 yen to the EDIC rate for breakthrough lessons', () => {
  assert.deepEqual(resolveLegacyLessonRates({ edic: 2050, individual1: 1260, individual4: 1340 }), { normal: 2050, breakthrough: 2550 });
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
  assert.equal(sample.rows[0].breakthrough_lesson_rate, 2550);
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
  assert.equal(parsed.data[0].breakthrough_lesson_rate, 2550);
  assert.equal(parsed.data[0].hourly_rates.office, 1120);
});
