import {
  BREAKTHROUGH_LESSON_RATE_ADDITION,
  breakthroughLessonRate,
  intervalMinutes,
  normalizePayrollName,
  normalizePersonCode,
  parseCsv,
  type PayrollAlert,
  type PayrollPersonSummary,
  type PayrollRateMaster,
  type PayrollWorkRecord,
  type RegularAttendanceInterval,
} from './attendance-payroll.ts';

export type IntegratedPayrollScope = 'breakthrough' | 'system' | 'external' | 'combined';
export type Q141RateKey =
  | 'group_lesson' | 'mentor' | 'training_1' | 'training_2' | 'training_3'
  | 'office' | 'office_premium_1' | 'office_premium_2' | 'incidental' | 'incidental_premium_1' | 'incidental_premium_2'
  | 'sogaku_lesson' | 'sub_staff'
  | 'individual_1' | 'individual_2' | 'individual_3' | 'individual_4' | 'individual_5' | 'individual_6'
  | 'ac_study' | 'private_tutor';

export type Q141PayrollValues = Record<Q141RateKey, { minutes: number; rate: number; amount: number }> & {
  special_1: number;
  special_2: number;
  special_3: number;
  special_4: number;
  transportation: number;
  taxable_total: number;
  nontaxable_total: number;
};

export type SchoolDistributionEntry = {
  id?: string;
  month: string;
  person_code: string;
  person_name: string;
  school_code?: string;
  school_name: string;
  allowance_amount: number;
  transportation_amount: number;
  detail: string;
};

export type PayrollAdjustment = {
  id?: string;
  month: string;
  person_code: string;
  person_name: string;
  school_code?: string;
  label: string;
  category: 'special_1' | 'special_2' | 'special_3' | 'special_4' | 'transportation';
  amount: number;
  reason: string;
  source_type?: string;
};

export type IntegratedPayrollRow = PayrollPersonSummary & {
  q141: Q141PayrollValues;
  source_amounts: { system: number; external: number; school_distribution: number; manual_adjustments: number };
  /** 法定割増の内訳。深夜（22〜5時）と1日8時間を超えた時間。授業など割増の列がない区分の割増分は特別勤務手当4へ入れる。 */
  premiums: { night_minutes: number; overtime_minutes: number; surcharge_amount: number };
};

export type PremiumRuleKey = 'training_2' | 'training_3' | 'office_premium_1' | 'office_premium_2' | 'incidental_premium_1' | 'incidental_premium_2';
export type IndividualRateKey = 'individual_1' | 'individual_2' | 'individual_3' | 'individual_4' | 'individual_5' | 'individual_6';
export type IndividualRateMapping = {
  attendance_key: IndividualRateKey;
  attendance_label: string;
  rate_item_key: IndividualRateKey;
};
export type PremiumRounding = 'round' | 'floor' | 'ceil';
export type PremiumCalculationRule = {
  key: PremiumRuleKey;
  label: string;
  base_key: 'training_1' | 'office' | 'incidental';
  multiplier: number;
  fixed_hourly_addition: number;
  rounding: PremiumRounding;
  enabled: boolean;
};

export const DEFAULT_PREMIUM_RULES: PremiumCalculationRule[] = [
  { key: 'training_2', label: '割増研修1', base_key: 'training_1', multiplier: 1.25, fixed_hourly_addition: 0, rounding: 'ceil', enabled: true },
  { key: 'training_3', label: '割増研修2', base_key: 'training_1', multiplier: 1.5, fixed_hourly_addition: 0, rounding: 'ceil', enabled: true },
  { key: 'office_premium_1', label: '割増事務1', base_key: 'office', multiplier: 1.25, fixed_hourly_addition: 0, rounding: 'ceil', enabled: true },
  { key: 'office_premium_2', label: '割増事務2', base_key: 'office', multiplier: 1.5, fixed_hourly_addition: 0, rounding: 'ceil', enabled: true },
  { key: 'incidental_premium_1', label: '割増付随1', base_key: 'incidental', multiplier: 1.25, fixed_hourly_addition: 0, rounding: 'ceil', enabled: true },
  { key: 'incidental_premium_2', label: '割増付随2', base_key: 'incidental', multiplier: 1.5, fixed_hourly_addition: 0, rounding: 'ceil', enabled: true },
];

export const DEFAULT_INDIVIDUAL_RATE_MAPPINGS: IndividualRateMapping[] = [
  { attendance_key: 'individual_1', attendance_label: '個別通常 1対1', rate_item_key: 'individual_1' },
  { attendance_key: 'individual_2', attendance_label: '個別通常 1対2', rate_item_key: 'individual_2' },
  { attendance_key: 'individual_3', attendance_label: '個別通常 1対3', rate_item_key: 'individual_3' },
  { attendance_key: 'individual_4', attendance_label: '個別中受・高 1対1', rate_item_key: 'individual_4' },
  { attendance_key: 'individual_5', attendance_label: '個別中受・高 1対2', rate_item_key: 'individual_5' },
  { attendance_key: 'individual_6', attendance_label: '個別中受・高 1対3', rate_item_key: 'individual_6' },
];

const AUTO_PREMIUM_START = '22:00';
const AUTO_PREMIUM_END = '05:00';
/** 労働基準法の1日の法定労働時間。これを超えた時間は時間外として割増する。 */
export const DAILY_STATUTORY_MINUTES = 8 * 60;
/**
 * 法定の最低ラインに合わせ、割増計算式の2段階を使う。
 *  - 割増1：深夜（22〜5時）だけ、または8時間超だけの時間（初期設定 1.25倍）
 *  - 割増2：深夜かつ8時間超の時間（初期設定 1.5倍）
 * 区分ごとの列：[割増1の列, 割増2の列]。割増1の列（旧勤怠の深夜行など）は、割増2に当たる分だけ割増2の列へ移す。
 */
const PREMIUM_COLUMNS: Partial<Record<Q141RateKey, [PremiumRuleKey | null, PremiumRuleKey | null]>> = {
  training_1: ['training_2', 'training_3'],
  office: ['office_premium_1', 'office_premium_2'],
  incidental: ['incidental_premium_1', 'incidental_premium_2'],
  training_2: [null, 'training_3'],
  office_premium_1: [null, 'office_premium_2'],
  incidental_premium_1: [null, 'incidental_premium_2'],
};
const ALREADY_PREMIUM_KEYS = new Set<Q141RateKey>(['training_2', 'training_3', 'office_premium_1', 'office_premium_2', 'incidental_premium_1', 'incidental_premium_2']);
/** 単価が1分あたりの区分（創学は分給）。 */
const PER_MINUTE_RATE_KEYS = new Set<Q141RateKey>(['sogaku_lesson']);
const amountForMinutes = (key: Q141RateKey, minutes: number, rate: number) =>
  PER_MINUTE_RATE_KEYS.has(key) ? minutes * rate : minutes / 60 * rate;

const RATE_KEYS: Q141RateKey[] = [
  'group_lesson', 'mentor', 'training_1', 'training_2', 'training_3',
  'office', 'office_premium_1', 'office_premium_2', 'incidental', 'incidental_premium_1', 'incidental_premium_2',
  'sogaku_lesson', 'sub_staff',
  'individual_1', 'individual_2', 'individual_3', 'individual_4', 'individual_5', 'individual_6',
  'ac_study', 'private_tutor',
];

// Payroll amounts and derived hourly rates use Excel ROUNDUP(value, 0).
const roundYen = (value: number) => Number.isFinite(value)
  ? Math.sign(value) * Math.ceil(Math.abs(value) - 1e-9)
  : 0;
const numeric = (value: unknown) => {
  const parsed = Number(String(value || '').normalize('NFKC').replace(/[￥¥,，\s]/g, ''));
  return Number.isFinite(parsed) && parsed >= 0 ? parsed : 0;
};
const normalizedHeader = (value: unknown) => String(value || '').normalize('NFKC').toLowerCase().replace(/[\s　_()（）・･/／-]/g, '');
const rowValue = (headers: string[], row: string[], aliases: string[]) => {
  const normalized = aliases.map(normalizedHeader);
  const index = headers.findIndex(header => normalized.includes(normalizedHeader(header)));
  return index >= 0 ? String(row[index] || '').trim() : '';
};

function emptyQ141(): Q141PayrollValues {
  const values = Object.fromEntries(RATE_KEYS.map(key => [key, { minutes: 0, rate: 0, amount: 0 }])) as Record<Q141RateKey, { minutes: number; rate: number; amount: number }>;
  return Object.assign(values, { special_1: 0, special_2: 0, special_3: 0, special_4: 0, transportation: 0, taxable_total: 0, nontaxable_total: 0 });
}

export function classifyExternalAttendance(item: RegularAttendanceInterval): Q141RateKey | null {
  const label = `${item.course_code || ''} ${item.course_name || ''} ${item.work_code || ''} ${item.work_type || ''}`.normalize('NFKC');
  if (RATE_KEYS.includes(String(item.payroll_tier || '') as Q141RateKey)) return String(item.payroll_tier) as Q141RateKey;
  if (/休憩/.test(label)) return null;
  if (/個別通常.*1[:：]1|^0069\b/.test(label)) return 'individual_1';
  if (/個別通常.*1[:：]2|^0070\b/.test(label)) return 'individual_2';
  if (/個別通常.*1[:：]3|^0071\b/.test(label)) return 'individual_3';
  if (/個別中受・?高.*1[:：]1|^0072\b/.test(label)) return 'individual_4';
  if (/個別中受・?高.*1[:：]2|^0073\b/.test(label)) return 'individual_5';
  if (/個別中受・?高.*1[:：]3|^0074\b/.test(label)) return 'individual_6';
  if (/創学授業|\b0601\b/.test(label)) return 'sogaku_lesson';
  if (/創学サブ|サブスタッフ|\b0602\b/.test(label)) return 'sub_staff';
  if (/メンター|\b0295\b/.test(label)) return 'mentor';
  if (/AC自習室|ＡＣ自習室|チュータ自習室|\b0281\b/.test(label)) return 'ac_study';
  if (/個別.*チュータ|ウイングネットチューター|学習支援チューター|\b0321\b|\b0501\b/.test(label)) return 'private_tutor';
  if (/付随/.test(label)) return /割増2|深夜2/.test(label) ? 'incidental_premium_2' : /割増|深夜/.test(label) ? 'incidental_premium_1' : 'incidental';
  if (/研修/.test(label)) return /割増2|深夜2/.test(label) ? 'training_3' : /割増|深夜/.test(label) ? 'training_2' : 'training_1';
  if (/事務|掃除|監督|ケアデー|オリテ|送迎|自習室|有休|作業/.test(label)) {
    return /割増2|深夜2/.test(label) ? 'office_premium_2' : /割増|深夜/.test(label) ? 'office_premium_1' : 'office';
  }
  if (item.course_code || item.course_name) return 'group_lesson';
  return 'office';
}

function timeNumber(value: string) {
  const match = String(value || '').match(/^(\d{1,2}):(\d{2})/);
  if (!match) return null;
  const hour = Number(match[1]);
  const minute = Number(match[2]);
  return hour >= 0 && hour <= 23 && minute >= 0 && minute <= 59 ? hour * 60 + minute : null;
}

/** Returns minutes inside the recurring 22:00–05:00 premium band, including overnight shifts. */
export function automaticPremiumMinutes(startTime: string, endTime: string) {
  const start = timeNumber(startTime);
  const rawEnd = timeNumber(endTime);
  const premiumStart = timeNumber(AUTO_PREMIUM_START);
  const rawPremiumEnd = timeNumber(AUTO_PREMIUM_END);
  if (start === null || rawEnd === null || premiumStart === null || rawPremiumEnd === null) return 0;
  const end = rawEnd <= start ? rawEnd + 1440 : rawEnd;
  const premiumEnd = rawPremiumEnd <= premiumStart ? rawPremiumEnd + 1440 : rawPremiumEnd;
  let minutes = 0;
  for (const offset of [-1440, 0, 1440]) {
    minutes += Math.max(0, Math.min(end, premiumEnd + offset) - Math.max(start, premiumStart + offset));
  }
  return Math.min(end - start, minutes);
}

const clockLabel = (minutes: number) => {
  const value = ((minutes % 1440) + 1440) % 1440;
  return `${String(Math.floor(value / 60)).padStart(2, '0')}:${String(value % 60).padStart(2, '0')}`;
};
/** 開始から duration 分のうち深夜帯の分。深夜帯の判定は既存の automaticPremiumMinutes を使う。 */
const nightMinutesWithin = (start: number, duration: number) =>
  duration > 0 ? Math.min(duration, automaticPremiumMinutes(clockLabel(start), clockLabel(start + duration))) : 0;

export type StatutoryPremiumSplit = { night: number; overtime: number; tier1: number; tier2: number };

/**
 * 1人・1日の勤務を開始時刻の順に並べ、各勤務の深夜・8時間超の分と、割増1・割増2に当たる分を求める。
 * 8時間を超えた分は勤務の後ろ側から数える。
 */
export function splitStatutoryPremiums(items: Array<{ start_time: string; minutes: number }>): StatutoryPremiumSplit[] {
  const order = items.map((item, index) => ({ index, start: timeNumber(item.start_time) }))
    .sort((a, b) => (a.start ?? 0) - (b.start ?? 0) || a.index - b.index);
  const result = items.map(() => ({ night: 0, overtime: 0, tier1: 0, tier2: 0 }));
  let worked = 0;
  order.forEach(({ index, start }) => {
    const minutes = Math.max(0, items[index].minutes);
    const overtime = Math.min(minutes, Math.max(0, worked + minutes - DAILY_STATUTORY_MINUTES));
    worked += minutes;
    const regular = minutes - overtime;
    const nightRegular = start === null ? 0 : nightMinutesWithin(start, regular);
    const nightOvertime = start === null ? 0 : nightMinutesWithin(start + regular, overtime);
    result[index] = {
      night: nightRegular + nightOvertime,
      overtime,
      tier1: nightRegular + (overtime - nightOvertime),
      tier2: nightOvertime,
    };
  });
  return result;
}

function hasDetailedExternalCategory(item: RegularAttendanceInterval) {
  const workType = String(item.work_type || '').normalize('NFKC').replace(/\s/g, '');
  return Boolean(item.course_code || item.course_name || item.work_code || item.payroll_tier || (workType && !/^通常勤務$/.test(workType)));
}

function matchingRates(personCode: string, personName: string, rates: PayrollRateMaster[], monthEnd: string) {
  const code = normalizePersonCode(personCode);
  const name = normalizePayrollName(personName);
  return rates.filter(rate => rate.effective_from <= monthEnd && (
    (code && normalizePersonCode(rate.person_code) === code) || (!code && name && normalizePayrollName(rate.person_name) === name)
  )).sort((a, b) => b.effective_from.localeCompare(a.effective_from));
}

function matchRate(personCode: string, personName: string, rates: PayrollRateMaster[], monthEnd: string) {
  return matchingRates(personCode, personName, rates, monthEnd)[0];
}

function rateFor(rate: PayrollRateMaster | undefined, key: Q141RateKey) {
  const direct = Number(rate?.rate_items?.[key] || 0);
  if (direct > 0) return direct;
  if (key === 'sub_staff') return Number(rate?.hourly_rates?.interview || rate?.hourly_rates?.office || 0);
  if (key === 'office' || key.startsWith('office_') || key.startsWith('incidental')) return Number(rate?.hourly_rates?.office || 0);
  return Number(rate?.normal_lesson_rate || rate?.hourly_rates?.lesson || 0);
}

function premiumRuleFor(key: Q141RateKey, rules: PremiumCalculationRule[]) {
  return rules.find(rule => rule.enabled && rule.key === key);
}

function calculatedRateFor(rate: PayrollRateMaster | undefined, key: Q141RateKey, rules: PremiumCalculationRule[], individualMappings: IndividualRateMapping[]) {
  const rule = premiumRuleFor(key, rules);
  if (!rule) {
    const individualMapping = individualMappings.find(mapping => mapping.attendance_key === key);
    return rateFor(rate, individualMapping?.rate_item_key || key);
  }
  return roundYen(rateFor(rate, rule.base_key) * rule.multiplier + rule.fixed_hourly_addition);
}

export function parseSchoolDistributionCsv(text: string) {
  const rows = parseCsv(text);
  const monthText = rows.slice(0, 7).flat().join(' ');
  const monthMatch = monthText.normalize('NFKC').match(/(20\d{2})年\s*(\d{1,2})月/);
  const month = monthMatch ? `${monthMatch[1]}-${monthMatch[2].padStart(2, '0')}` : '';
  const headerIndex = rows.findIndex(row => row.some(cell => normalizedHeader(cell) === normalizedHeader('職員コード')) && row.some(cell => normalizedHeader(cell).includes(normalizedHeader('手当計'))));
  if (!month || headerIndex < 0) return { month, data: [] as SchoolDistributionEntry[], errors: ['年月または「職員コード／手当計」の見出しを確認してください。'] };
  const headers = rows[headerIndex];
  const data: SchoolDistributionEntry[] = [];
  rows.slice(headerIndex + 1).forEach(row => {
    const personCode = normalizePersonCode(rowValue(headers, row, ['職員コード', '個人コード']));
    const personName = rowValue(headers, row, ['職員氏名', '氏名']);
    if (!personCode && !personName) return;
    const totalAllowance = rowValue(headers, row, ['手当計①＋②（1回\\3,000）', '手当計①＋②', '手当計']);
    const totalTransportation = rowValue(headers, row, ['交通費計①＋②', '交通費計']);
    const allowanceAmount = numeric(totalAllowance) || numeric(row[12]);
    const transportationAmount = numeric(totalTransportation) || numeric(row[13]);
    if (allowanceAmount <= 0 && transportationAmount <= 0) return;
    data.push({
      month, person_code: personCode, person_name: personName,
      school_name: rowValue(headers, row, ['教室名', '所属教室名']), allowance_amount: allowanceAmount,
      transportation_amount: transportationAmount,
      detail: [rowValue(headers, row, ['実施日']), rowValue(headers, row, ['実施高校名']), rowValue(headers, row, ['実施日②']), rowValue(headers, row, ['実施高校名②'])].filter(Boolean).join(' / '),
    });
  });
  return { month, data, errors: data.length ? [] : ['支給対象となる手当または交通費がありません。'] };
}

export function calculateIntegratedPayroll(input: {
  month: string;
  scope: IntegratedPayrollScope;
  systemRows: PayrollPersonSummary[];
  systemAttendance?: RegularAttendanceInterval[];
  systemTransportationRecords?: PayrollWorkRecord[];
  externalAttendance: RegularAttendanceInterval[];
  rates: PayrollRateMaster[];
  schoolDistributions: SchoolDistributionEntry[];
  adjustments: PayrollAdjustment[];
  premiumRules?: PremiumCalculationRule[];
  individualRateMappings?: IndividualRateMapping[];
  alerts?: PayrollAlert[];
}) {
  const lastDay = new Date(Number(input.month.slice(0, 4)), Number(input.month.slice(5, 7)), 0).getDate();
  const monthEnd = `${input.month}-${String(lastDay).padStart(2, '0')}`;
  const includeSystem = input.scope !== 'external';
  const includeExternal = input.scope === 'external' || input.scope === 'combined';
  const premiumRules = input.premiumRules?.length ? input.premiumRules : DEFAULT_PREMIUM_RULES;
  const individualRateMappings = input.individualRateMappings?.length ? input.individualRateMappings : DEFAULT_INDIVIDUAL_RATE_MAPPINGS;
  const alerts = [...(input.alerts || [])];
  const grouped = new Map<string, IntegratedPayrollRow>();
  const rateCodesByName = new Map<string, Set<string>>();
  input.rates.forEach(rate => {
    const name = normalizePayrollName(rate.person_name);
    const code = normalizePersonCode(rate.person_code);
    if (!name || !code) return;
    const codes = rateCodesByName.get(name) || new Set<string>();
    codes.add(code);
    rateCodesByName.set(name, codes);
  });
  const personKey = (personCode: string, personName: string) => {
    const code = normalizePersonCode(personCode);
    if (code) return code;
    const name = normalizePayrollName(personName);
    const rateCodes = rateCodesByName.get(name);
    return rateCodes?.size === 1 ? Array.from(rateCodes)[0] : name;
  };
  const ambiguousRatePeople = new Set(alerts.filter(alert => alert.code === 'rate_ambiguous').map(alert =>
    personKey(alert.person_code, alert.person_name)
  ).filter(Boolean));
  const ensure = (personCode: string, personName: string, base?: Partial<PayrollPersonSummary>) => {
    const key = personKey(personCode, personName);
    const rateCandidates = matchingRates(personCode, personName, input.rates, monthEnd);
    const rate = rateCandidates[0];
    if (key && rate && rateCandidates.length > 1 && rateCandidates[1].effective_from === rate.effective_from && !ambiguousRatePeople.has(key)) {
      ambiguousRatePeople.add(key);
      alerts.push({
        code: 'rate_ambiguous', severity: 'warning', person_code: normalizePersonCode(personCode), person_name: personName,
        detail: `適用開始日 ${rate.effective_from} の単価マスターが複数あります。使用する単価を1件に整理してください。`,
      });
    }
    const current = grouped.get(key) || {
      teacher_id: String(base?.teacher_id || ''), person_code: normalizePersonCode(personCode) || normalizePersonCode(rate?.person_code), person_name: personName || String(rate?.person_name || ''),
      school_code: String(base?.school_code || rate?.school_code || ''), school_name: String(base?.school_name || ''), tp_serial: String(base?.tp_serial || ''),
      normal_lesson_rate: Number(rate?.normal_lesson_rate || rate?.hourly_rates?.lesson || 0),
      breakthrough_lesson_rate: breakthroughLessonRate(rateFor(rate, 'group_lesson')),
      rate_master_id: rate?.id, rate_effective_from: rate?.effective_from, work_days: 0, total_minutes: 0,
      categories: {
        lesson: { minutes: 0, hourly_rate: rateFor(rate, 'group_lesson'), allowance_count: 0, allowance_rate: 0, hourly_amount: 0, allowance_amount: 0, amount: 0 },
        office: { minutes: 0, hourly_rate: rateFor(rate, 'office'), allowance_count: 0, allowance_rate: 0, hourly_amount: 0, allowance_amount: 0, amount: 0 },
        interview: { minutes: 0, hourly_rate: rateFor(rate, 'sub_staff'), allowance_count: 0, allowance_rate: 0, hourly_amount: 0, allowance_amount: 0, amount: 0 },
        other: { minutes: 0, hourly_rate: rateFor(rate, 'office'), allowance_count: 0, allowance_rate: 0, hourly_amount: 0, allowance_amount: 0, amount: 0 },
      },
      transportation_amount: 0, total_payment: 0, gross_payment: 0, alert_count: 0,
      q141: emptyQ141(), source_amounts: { system: 0, external: 0, school_distribution: 0, manual_adjustments: 0 },
      premiums: { night_minutes: 0, overtime_minutes: 0, surcharge_amount: 0 },
    } satisfies IntegratedPayrollRow;
    grouped.set(key, current);
    return { current, rate };
  };

  if (includeSystem) input.systemRows.forEach(row => {
    const { current } = ensure(row.person_code, row.person_name, row);
    current.teacher_id ||= row.teacher_id; current.school_name ||= row.school_name; current.tp_serial ||= row.tp_serial;
    current.work_days = Math.max(current.work_days, row.work_days);
    current.q141.group_lesson.minutes += row.categories.lesson.minutes;
    current.q141.group_lesson.amount += row.categories.lesson.amount;
    current.q141.office.minutes += row.categories.office.minutes + row.categories.other.minutes;
    current.q141.office.amount += row.categories.office.amount + row.categories.other.amount;
    current.q141.sub_staff.minutes += row.categories.interview.minutes;
    current.q141.sub_staff.amount += row.categories.interview.amount;
    // When raw work records are supplied, transportation is collected from them below.
    // This also covers people whose work was entirely moved to detailed attendance.
    if (!input.systemTransportationRecords) current.q141.transportation += row.transportation_amount;
    current.source_amounts.system += row.total_payment;
  });

  if (includeSystem) input.systemTransportationRecords?.forEach(record => {
    if (!record.date.startsWith(input.month)) return;
    const amount = (record.transportation || []).reduce((sum, item) => sum + (Number(item.cost) || 0), 0);
    if (!amount) return;
    const { current } = ensure(record.person_code, record.teacher_name, {
      teacher_id: record.teacher_id, school_code: record.school_code, school_name: record.school_name, tp_serial: record.tp_serial,
    });
    current.teacher_id ||= record.teacher_id;
    current.school_name ||= record.school_name || '';
    current.tp_serial ||= record.tp_serial || '';
    current.q141.transportation += amount;
  });

  const attendanceDates = new Map<string, Set<string>>();
  const minutesBySource = {
    system: new Map<string, Partial<Record<Q141RateKey, number>>>(),
    external: new Map<string, Partial<Record<Q141RateKey, number>>>(),
  };
  const breakthroughLessonMinutes = new Map<string, number>();
  const missingCategoryPeople = new Set<string>();
  const systemAllowanceDays = new Set<string>();
  const scienceSocialBonusDays = new Set<string>();
  // 割増のうち、割増の列がない区分（授業・個別など）の分。人ごとに合計してから円未満を切り上げる。
  const surchargeByPerson = new Map<string, { source: 'system' | 'external'; amount: number }[]>();
  const processAttendance = (item: RegularAttendanceInterval, source: 'system' | 'external', category: Q141RateKey, minutes: number, split: StatutoryPremiumSplit) => {
    const key = personKey(item.person_code, item.person_name);
    const { current, rate } = ensure(item.person_code, item.person_name, { school_code: item.school_code || '', school_name: item.school_name || '' });
    if (source === 'system') {
      // 理社講座の加算は、同一日に複数コマあっても「授業」と
      // 「サポート」の区分ごとに1回だけ支給する。時給には含めない。
      const scienceSocialBonusKind = item.attendance_program === 'science_social'
        ? category === 'group_lesson' || category === 'sogaku_lesson' || category.startsWith('individual_') ? 'lesson' : category === 'sub_staff' ? 'support' : ''
        : '';
      const scienceSocialBonusKey = scienceSocialBonusKind
        ? `${key}\u001f${item.date}\u001f${scienceSocialBonusKind}`
        : '';
      const scienceSocialBonus = scienceSocialBonusKey && !scienceSocialBonusDays.has(scienceSocialBonusKey)
        ? scienceSocialBonusKind === 'lesson' ? 200 : 100
        : 0;
      if (scienceSocialBonusKey) scienceSocialBonusDays.add(scienceSocialBonusKey);
      current.q141.special_3 += scienceSocialBonus;
      current.source_amounts.system += scienceSocialBonus;
      const broadCategory = category === 'sub_staff' ? 'interview' : (
        category === 'group_lesson' || category === 'sogaku_lesson' || category.startsWith('individual_') ? 'lesson' :
        category === 'office' || category.startsWith('office_') || category.startsWith('training_') || category === 'mentor' || category === 'ac_study' || category === 'private_tutor' ? 'office' : 'other'
      );
      const allowanceKey = `${key}\u001f${broadCategory}\u001f${item.date}`;
      if (!systemAllowanceDays.has(allowanceKey)) {
        systemAllowanceDays.add(allowanceKey);
        const allowance = Number(rate?.allowances?.[broadCategory] || 0);
        current.q141[category].amount += allowance;
        current.source_amounts.system += allowance;
      }
    }
    current.school_name ||= item.school_name || '';
    current.school_code ||= item.school_code || '';
    const sourceMinutes = minutesBySource[source].get(key) || {};
    // 法定割増（最低ライン）：深夜だけ・8時間超だけ → 割増1、深夜かつ8時間超 → 割増2。倍率は割増計算式の設定を使う。
    current.premiums.night_minutes += split.night;
    current.premiums.overtime_minutes += split.overtime;
    const columns = PREMIUM_COLUMNS[category];
    const allocations: Array<[Q141RateKey, number]> = [];
    if (columns) {
      const [tier1Column, tier2Column] = columns;
      const tier1ToColumn = tier1Column && premiumRuleFor(tier1Column, premiumRules) ? split.tier1 : 0;
      const tier2ToColumn = tier2Column && premiumRuleFor(tier2Column, premiumRules) ? split.tier2 : 0;
      allocations.push([category, minutes - tier1ToColumn - tier2ToColumn]);
      if (tier1Column && tier1ToColumn > 0) allocations.push([tier1Column, tier1ToColumn]);
      if (tier2Column && tier2ToColumn > 0) allocations.push([tier2Column, tier2ToColumn]);
    } else {
      allocations.push([category, minutes]);
    }
    // 授業・個別・創学など割増の列がない区分は、全時間を通常の単価で払い、
    // 割増事務1・2の計算式（倍率・固定加算）で求めた割増分だけを特別勤務手当4へ足す。
    if (!columns && !ALREADY_PREMIUM_KEYS.has(category) && (split.tier1 > 0 || split.tier2 > 0)) {
      const baseRate = calculatedRateFor(rate, category, premiumRules, individualRateMappings)
        + (source === 'system' && item.attendance_program === 'breakthrough' && category === 'group_lesson' ? BREAKTHROUGH_LESSON_RATE_ADDITION : 0);
      const extraRate = (ruleKey: PremiumRuleKey) => {
        const rule = premiumRuleFor(ruleKey, premiumRules);
        if (!rule) return 0;
        const fixed = PER_MINUTE_RATE_KEYS.has(category) ? rule.fixed_hourly_addition / 60 : rule.fixed_hourly_addition;
        return baseRate * (rule.multiplier - 1) + fixed;
      };
      const amount = amountForMinutes(category, split.tier1, extraRate('office_premium_1'))
        + amountForMinutes(category, split.tier2, extraRate('office_premium_2'));
      if (amount > 0) surchargeByPerson.set(key, [...(surchargeByPerson.get(key) || []), { source, amount }]);
    }
    allocations.forEach(([allocatedCategory, allocatedMinutes]) => {
      if (allocatedMinutes <= 0) return;
      current.q141[allocatedCategory].minutes += allocatedMinutes;
      current.q141[allocatedCategory].rate = calculatedRateFor(rate, allocatedCategory, premiumRules, individualRateMappings);
      sourceMinutes[allocatedCategory] = Number(sourceMinutes[allocatedCategory] || 0) + allocatedMinutes;
      if (source === 'system' && item.attendance_program === 'breakthrough' && allocatedCategory === 'group_lesson') {
        breakthroughLessonMinutes.set(key, Number(breakthroughLessonMinutes.get(key) || 0) + allocatedMinutes);
      }
    });
    minutesBySource[source].set(key, sourceMinutes);
    if (source === 'external' && !hasDetailedExternalCategory(item) && !missingCategoryPeople.has(key)) {
      missingCategoryPeople.add(key);
      alerts.push({
        code: 'external_category_missing', severity: 'warning', person_code: item.person_code, person_name: item.person_name,
        date: item.date, detail: '旧システムから業務区分が「通常勤務」のみで連携されています。講座・業務コードを含めて再同期するまで事務として仮集計します。',
      });
    }
    const dates = attendanceDates.get(key) || new Set<string>(); dates.add(item.date); attendanceDates.set(key, dates);
  };
  // 新・旧システムの勤務を合わせて、1人1日ごとに8時間を数える。
  // 支給の対象外（旧システムだけ・新システムだけの集計）でも、8時間の数え方には両方の勤務を入れる。
  const prepared: Array<{ item: RegularAttendanceInterval; source: 'system' | 'external'; category: Q141RateKey; minutes: number; dayKey: string; included: boolean }> = [];
  const prepare = (item: RegularAttendanceInterval, source: 'system' | 'external', included: boolean) => {
    const category = classifyExternalAttendance(item);
    if (!category) return;
    const interval = intervalMinutes(item.start_time, item.end_time);
    const minutes = Number(item.actual_minutes || interval?.duration || 0);
    if (minutes <= 0) return;
    prepared.push({ item, source, category, minutes, included, dayKey: `${personKey(item.person_code, item.person_name)}\u001f${item.date}` });
  };
  (input.systemAttendance || []).filter(item => item.date.startsWith(input.month)).forEach(item => prepare(item, 'system', includeSystem));
  input.externalAttendance.filter(item => item.date.startsWith(input.month)).forEach(item => prepare(item, 'external', includeExternal));
  const byDay = new Map<string, number[]>();
  prepared.forEach((entry, index) => byDay.set(entry.dayKey, [...(byDay.get(entry.dayKey) || []), index]));
  const splits: StatutoryPremiumSplit[] = prepared.map(() => ({ night: 0, overtime: 0, tier1: 0, tier2: 0 }));
  byDay.forEach(indexes => {
    const daySplits = splitStatutoryPremiums(indexes.map(index => ({ start_time: prepared[index].item.start_time, minutes: prepared[index].minutes })));
    indexes.forEach((index, position) => { splits[index] = daySplits[position]; });
  });
  prepared.forEach((entry, index) => {
    if (entry.included) processAttendance(entry.item, entry.source, entry.category, entry.minutes, splits[index]);
  });
  grouped.forEach((row, key) => {
    row.work_days = Math.max(row.work_days, attendanceDates.get(key)?.size || 0);
    RATE_KEYS.forEach(category => {
      const item = row.q141[category];
      if (!item.rate) item.rate = calculatedRateFor(matchRate(row.person_code, row.person_name, input.rates, monthEnd), category, premiumRules, individualRateMappings);
      const systemMinutes = Number(minutesBySource.system.get(key)?.[category] || 0);
      const externalMinutes = Number(minutesBySource.external.get(key)?.[category] || 0);
      const breakthroughMinutes = category === 'group_lesson'
        ? Math.min(systemMinutes, Number(breakthroughLessonMinutes.get(key) || 0))
        : 0;
      const normalSystemMinutes = systemMinutes - breakthroughMinutes;
      const systemAmount = roundYen(amountForMinutes(category, normalSystemMinutes, item.rate))
        + roundYen(amountForMinutes(category, breakthroughMinutes, item.rate + BREAKTHROUGH_LESSON_RATE_ADDITION));
      const externalAmount = roundYen(amountForMinutes(category, externalMinutes, item.rate));
      if (includeSystem) {
        item.amount += systemAmount;
        row.source_amounts.system += systemAmount;
      }
      if (includeExternal) {
        item.amount += externalAmount;
        row.source_amounts.external += externalAmount;
      }
    });
    const surcharges = surchargeByPerson.get(key) || [];
    (['system', 'external'] as const).forEach(source => {
      const amount = roundYen(surcharges.filter(entry => entry.source === source).reduce((sum, entry) => sum + entry.amount, 0));
      if (!amount) return;
      row.q141.special_4 += amount;
      row.premiums.surcharge_amount += amount;
      row.source_amounts[source] += amount;
    });
  });

  const includeAncillary = input.scope === 'combined';
  const q042People = new Set(input.adjustments.filter(item => item.month === input.month && item.source_type === 'q042').map(item => personKey(item.person_code, item.person_name)));
  if (includeAncillary) input.schoolDistributions.filter(item => item.month === input.month).forEach(item => {
    if (q042People.has(personKey(item.person_code, item.person_name))) return;
    const { current } = ensure(item.person_code, item.person_name, { school_name: item.school_name });
    current.q141.special_2 += item.allowance_amount;
    current.q141.transportation += item.transportation_amount;
    current.source_amounts.school_distribution += item.allowance_amount + item.transportation_amount;
  });
  if (includeAncillary) input.adjustments.filter(item => item.month === input.month).forEach(item => {
    // Q042の「その他4」は割増と紹介礼金が混在するため、自動割増との二重計上を防ぐ。
    if (item.source_type === 'q042' && item.category === 'special_4') return;
    const { current } = ensure(item.person_code, item.person_name, { school_code: item.school_code || '' });
    current.q141[item.category] += item.amount;
    current.source_amounts.manual_adjustments += item.amount;
  });

  const calculatedRows = Array.from(grouped.values()).filter(row => {
    const q = row.q141;
    const taxable = q.special_1 + q.special_2 + q.special_3 + q.special_4 + RATE_KEYS.reduce((sum, key) => sum + q[key].amount, 0);
    q.taxable_total = roundYen(taxable);
    q.nontaxable_total = roundYen(q.transportation);
    row.total_minutes = RATE_KEYS.reduce((sum, key) => sum + q[key].minutes, 0);
    row.categories.lesson.minutes = q.group_lesson.minutes + q.sogaku_lesson.minutes + q.individual_1.minutes + q.individual_2.minutes + q.individual_3.minutes + q.individual_4.minutes + q.individual_5.minutes + q.individual_6.minutes;
    row.categories.lesson.amount = q.group_lesson.amount + q.sogaku_lesson.amount + q.individual_1.amount + q.individual_2.amount + q.individual_3.amount + q.individual_4.amount + q.individual_5.amount + q.individual_6.amount;
    row.categories.office.minutes = q.office.minutes + q.office_premium_1.minutes + q.office_premium_2.minutes + q.training_1.minutes + q.training_2.minutes + q.training_3.minutes + q.mentor.minutes + q.ac_study.minutes + q.private_tutor.minutes;
    row.categories.office.amount = q.office.amount + q.office_premium_1.amount + q.office_premium_2.amount + q.training_1.amount + q.training_2.amount + q.training_3.amount + q.mentor.amount + q.ac_study.amount + q.private_tutor.amount;
    row.categories.interview.minutes = q.sub_staff.minutes; row.categories.interview.amount = q.sub_staff.amount;
    row.categories.other.amount = q.special_1 + q.special_2 + q.special_3 + q.special_4;
    row.transportation_amount = q.nontaxable_total; row.total_payment = q.taxable_total; row.gross_payment = q.taxable_total + q.nontaxable_total;
    const alreadyMissing = alerts.some(alert => alert.code === 'rate_missing' && (normalizePersonCode(alert.person_code) === row.person_code || (!alert.person_code && normalizePayrollName(alert.person_name) === normalizePayrollName(row.person_name))));
    if (row.total_minutes > 0 && !row.rate_effective_from && !alreadyMissing) alerts.push({ code: 'rate_missing', severity: 'danger', person_code: row.person_code, person_name: row.person_name, detail: '旧システム勤怠の給与計算に必要な単価マスターがありません。' });
    row.alert_count = alerts.filter(alert => normalizePersonCode(alert.person_code) === row.person_code || (!alert.person_code && normalizePayrollName(alert.person_name) === normalizePayrollName(row.person_name))).length;
    return row.gross_payment > 0 || row.total_minutes > 0;
  }).sort((a, b) => a.person_code.localeCompare(b.person_code, undefined, { numeric: true }));

  const rows = calculatedRows.filter(row => Boolean(row.rate_effective_from));
  const activityKeys = new Set(calculatedRows.map(row => personKey(row.person_code, row.person_name)));
  const activityAlerts = alerts.filter(alert => activityKeys.has(personKey(alert.person_code, alert.person_name)));
  return { rows, alerts: activityAlerts, excluded_without_rate: calculatedRows.length - rows.length };
}

export const q141RateKeys = RATE_KEYS;
