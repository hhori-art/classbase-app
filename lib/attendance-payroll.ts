export type PayrollCategory = 'lesson' | 'office' | 'interview' | 'other';

export type PayrollRateMaster = {
  id?: string;
  person_code: string;
  person_name: string;
  normalized_name?: string;
  effective_from: string;
  school_code?: string;
  normal_lesson_rate?: number;
  breakthrough_lesson_rate?: number;
  hourly_rates: Record<PayrollCategory, number>;
  allowances: Record<PayrollCategory, number>;
};

export type RegularAttendanceInterval = {
  id?: string;
  person_code: string;
  person_name: string;
  normalized_name?: string;
  date: string;
  start_time: string;
  end_time: string;
  work_type?: string;
  source_name?: string;
};

export type PayrollWorkRecord = {
  id: string;
  teacher_id: string;
  teacher_name: string;
  person_code: string;
  school_code?: string;
  school_name?: string;
  tp_serial?: string;
  date: string;
  attendance_kind?: string;
  start_time?: string | null;
  end_time?: string | null;
  work_segments?: Array<{ start?: string; end?: string; type?: string; note?: string }>;
  transportation?: Array<{ cost?: number | string }>;
};

export type PayrollAlert = {
  code: 'rate_missing' | 'rate_ambiguous' | 'time_overlap' | 'invalid_segment' | 'other_note_required';
  severity: 'warning' | 'danger';
  person_code: string;
  person_name: string;
  date?: string;
  work_record_id?: string;
  detail: string;
};

export type PayrollCategorySummary = {
  minutes: number;
  hourly_rate: number;
  allowance_count: number;
  allowance_rate: number;
  hourly_amount: number;
  allowance_amount: number;
  amount: number;
};

export type PayrollPersonSummary = {
  teacher_id: string;
  person_code: string;
  person_name: string;
  school_code: string;
  school_name: string;
  tp_serial: string;
  normal_lesson_rate: number;
  breakthrough_lesson_rate: number;
  rate_master_id?: string;
  rate_effective_from?: string;
  work_days: number;
  total_minutes: number;
  categories: Record<PayrollCategory, PayrollCategorySummary>;
  transportation_amount: number;
  total_payment: number;
  gross_payment: number;
  alert_count: number;
};

const CATEGORIES: PayrollCategory[] = ['lesson', 'office', 'interview', 'other'];

export const normalizePayrollName = (value: unknown) =>
  String(value || '')
    .normalize('NFKC')
    .replace(/先生(?:\s*)$/g, '')
    .replace(/様(?:\s*)$/g, '')
    .replace(/[\s　・･.,，、()（）【】\[\]]/g, '')
    .toLowerCase();

export const normalizePersonCode = (value: unknown) =>
  String(value || '').normalize('NFKC').replace(/[\s　]/g, '').trim();

export function mapWorkTypeToPayrollCategory(type: unknown): PayrollCategory | null {
  const normalized = String(type || '').trim().toLowerCase();
  if (['break', '休憩'].includes(normalized)) return null;
  if (['lesson', 'breakthrough', 'breakthrough_lesson', '授業', '突破ゼミの授業'].includes(normalized)) return 'lesson';
  if (['office', 'breakthrough_office', '事務', '研修', '突破ゼミの事務'].includes(normalized)) return 'office';
  // 画面上の「サブ（面接）」と旧登録値を、給与上のサブ区分へまとめる。
  if (['interview', 'support', 'sub_staff', 'substaff', '面接', '面接指導', 'サポート', 'サブ', 'サブスタッフ'].includes(normalized)) return 'interview';
  return 'other';
}

export const isBreakthroughWorkRecord = (record: PayrollWorkRecord) =>
  record.attendance_kind === 'breakthrough' ||
  (record.work_segments || []).some(segment =>
    ['breakthrough', 'breakthrough_lesson', 'breakthrough_office'].includes(String(segment.type || ''))
  );

function clockMinutes(value: unknown) {
  const matched = String(value || '').trim().match(/^(\d{1,2}):(\d{2})/);
  if (!matched) return null;
  const hour = Number(matched[1]);
  const minute = Number(matched[2]);
  if (!Number.isInteger(hour) || !Number.isInteger(minute) || hour > 47 || minute > 59) return null;
  return hour * 60 + minute;
}

export function intervalMinutes(start: unknown, end: unknown) {
  const startMinutes = clockMinutes(start);
  let endMinutes = clockMinutes(end);
  if (startMinutes === null || endMinutes === null) return null;
  if (endMinutes <= startMinutes) endMinutes += 24 * 60;
  return { start: startMinutes, end: endMinutes, duration: endMinutes - startMinutes };
}

export function overlapMinutes(
  leftStart: unknown,
  leftEnd: unknown,
  rightStart: unknown,
  rightEnd: unknown,
) {
  const left = intervalMinutes(leftStart, leftEnd);
  const right = intervalMinutes(rightStart, rightEnd);
  if (!left || !right) return 0;
  return Math.max(0, Math.min(left.end, right.end) - Math.max(left.start, right.start));
}

const emptyCategory = (): PayrollCategorySummary => ({
  minutes: 0,
  hourly_rate: 0,
  allowance_count: 0,
  allowance_rate: 0,
  hourly_amount: 0,
  allowance_amount: 0,
  amount: 0,
});

function matchPerson(
  personCode: string,
  personName: string,
  candidateCode: string,
  candidateName: string,
) {
  const code = normalizePersonCode(personCode);
  const otherCode = normalizePersonCode(candidateCode);
  if (code && otherCode) return code === otherCode;
  return Boolean(normalizePayrollName(personName) && normalizePayrollName(personName) === normalizePayrollName(candidateName));
}

function selectLatestRate(
  personCode: string,
  personName: string,
  rates: PayrollRateMaster[],
  monthEnd: string,
) {
  const candidates = rates
    .filter(rate => rate.effective_from <= monthEnd && matchPerson(personCode, personName, rate.person_code, rate.person_name))
    .sort((a, b) => b.effective_from.localeCompare(a.effective_from));
  return { rate: candidates[0], ambiguous: candidates.length > 1 && candidates[0].effective_from === candidates[1].effective_from };
}

const roundYen = (value: number) => Math.round((Number.isFinite(value) ? value : 0) + Number.EPSILON);

export function calculateAttendancePayroll(input: {
  month: string;
  scope?: 'breakthrough' | 'all';
  records: PayrollWorkRecord[];
  rates: PayrollRateMaster[];
  regularAttendance: RegularAttendanceInterval[];
}) {
  const month = /^\d{4}-\d{2}$/.test(input.month) ? input.month : new Date().toISOString().slice(0, 7);
  const lastDay = new Date(Number(month.slice(0, 4)), Number(month.slice(5, 7)), 0).getDate();
  const monthEnd = `${month}-${String(lastDay).padStart(2, '0')}`;
  const scope = input.scope || 'breakthrough';
  const alerts: PayrollAlert[] = [];
  const regularByDatePerson = new Map<string, RegularAttendanceInterval[]>();
  input.regularAttendance.forEach(regular => {
    const keys = new Set<string>();
    const code = normalizePersonCode(regular.person_code);
    const name = normalizePayrollName(regular.person_name);
    if (code) keys.add(`${regular.date}\u001fcode:${code}`);
    if (name) keys.add(`${regular.date}\u001fname:${name}`);
    keys.forEach(key => regularByDatePerson.set(key, [...(regularByDatePerson.get(key) || []), regular]));
  });
  const grouped = new Map<string, {
    teacher_id: string;
    person_code: string;
    person_name: string;
    school_code: string;
    school_name: string;
    tp_serial: string;
    records: PayrollWorkRecord[];
    minutes: Record<PayrollCategory, number>;
    allowanceDays: Record<PayrollCategory, Set<string>>;
    transportation: number;
  }>();

  input.records
    .filter(record => record.date.startsWith(month))
    .filter(record => scope === 'all' || isBreakthroughWorkRecord(record))
    .forEach(record => {
      const key = normalizePersonCode(record.person_code) || record.teacher_id || normalizePayrollName(record.teacher_name);
      const current = grouped.get(key) || {
        teacher_id: record.teacher_id,
        person_code: normalizePersonCode(record.person_code),
        person_name: record.teacher_name,
        school_code: String(record.school_code || ''),
        school_name: String(record.school_name || ''),
        tp_serial: String(record.tp_serial || ''),
        records: [],
        minutes: { lesson: 0, office: 0, interview: 0, other: 0 },
        allowanceDays: { lesson: new Set<string>(), office: new Set<string>(), interview: new Set<string>(), other: new Set<string>() },
        transportation: 0,
      };
      current.records.push(record);
      current.transportation += (record.transportation || []).reduce((sum, item) => sum + (Number(item.cost) || 0), 0);

      (record.work_segments || []).forEach(segment => {
        const category = mapWorkTypeToPayrollCategory(segment.type);
        if (!category) return;
        const interval = intervalMinutes(segment.start, segment.end);
        if (!interval || interval.duration <= 0 || interval.duration > 24 * 60) {
          alerts.push({
            code: 'invalid_segment', severity: 'danger', person_code: current.person_code,
            person_name: current.person_name, date: record.date, work_record_id: record.id,
            detail: `業務時間「${segment.start || '未入力'}〜${segment.end || '未入力'}」を計算できません。`,
          });
          return;
        }
        current.minutes[category] += interval.duration;
        current.allowanceDays[category].add(record.date);
        if (category === 'other' && !String(segment.note || '').trim()) {
          alerts.push({
            code: 'other_note_required', severity: 'warning', person_code: current.person_code,
            person_name: current.person_name, date: record.date, work_record_id: record.id,
            detail: '「その他」の具体的な業務内容が未入力です。',
          });
        }

        const regularCandidates = new Map<string, RegularAttendanceInterval>();
        const personCode = normalizePersonCode(current.person_code);
        const personName = normalizePayrollName(current.person_name);
        if (personCode) (regularByDatePerson.get(`${record.date}\u001fcode:${personCode}`) || []).forEach(regular => regularCandidates.set(regular.id || `${regular.start_time}_${regular.end_time}_${regular.work_type}`, regular));
        if (personName) (regularByDatePerson.get(`${record.date}\u001fname:${personName}`) || []).forEach(regular => regularCandidates.set(regular.id || `${regular.start_time}_${regular.end_time}_${regular.work_type}`, regular));
        Array.from(regularCandidates.values())
          .filter(regular => matchPerson(current.person_code, current.person_name, regular.person_code, regular.person_name))
          .forEach(regular => {
            const overlap = overlapMinutes(segment.start, segment.end, regular.start_time, regular.end_time);
            if (overlap <= 0) return;
            alerts.push({
              code: 'time_overlap', severity: 'danger', person_code: current.person_code,
              person_name: current.person_name, date: record.date, work_record_id: record.id,
              detail: `本システム ${segment.start}〜${segment.end} と通常勤怠 ${regular.start_time}〜${regular.end_time} が${overlap}分重複しています${regular.work_type ? `（${regular.work_type}）` : ''}。`,
            });
          });
      });
      grouped.set(key, current);
    });

  const rows: PayrollPersonSummary[] = [];
  grouped.forEach(person => {
    const totalMinutes = CATEGORIES.reduce((sum, category) => sum + person.minutes[category], 0);
    if (totalMinutes <= 0) return;
    const { rate, ambiguous } = selectLatestRate(person.person_code, person.person_name, input.rates, monthEnd);
    if (!rate) {
      alerts.push({
        code: 'rate_missing', severity: 'danger', person_code: person.person_code,
        person_name: person.person_name,
        detail: `対象月に有効な単価マスターがありません。個人コード「${person.person_code || '未設定'}」または氏名を確認してください。`,
      });
    } else if (ambiguous) {
      alerts.push({
        code: 'rate_ambiguous', severity: 'warning', person_code: person.person_code,
        person_name: person.person_name,
        detail: `適用開始日 ${rate.effective_from} の単価マスターが複数あります。最新登録を使用しています。`,
      });
    }

    const categories = {} as Record<PayrollCategory, PayrollCategorySummary>;
    CATEGORIES.forEach(category => {
      const minutes = person.minutes[category];
      const hourlyRate = Number(rate?.hourly_rates?.[category] || 0);
      const allowanceRate = Number(rate?.allowances?.[category] || 0);
      const allowanceCount = person.allowanceDays[category].size;
      const hourlyAmount = roundYen(minutes / 60 * hourlyRate);
      const allowanceAmount = roundYen(allowanceCount * allowanceRate);
      categories[category] = {
        minutes,
        hourly_rate: hourlyRate,
        allowance_count: allowanceCount,
        allowance_rate: allowanceRate,
        hourly_amount: hourlyAmount,
        allowance_amount: allowanceAmount,
        amount: hourlyAmount + allowanceAmount,
      };
    });
    const totalPayment = CATEGORIES.reduce((sum, category) => sum + categories[category].amount, 0);
    const personAlerts = alerts.filter(alert => matchPerson(person.person_code, person.person_name, alert.person_code, alert.person_name));
    rows.push({
      teacher_id: person.teacher_id,
      person_code: person.person_code,
      person_name: person.person_name,
      school_code: person.school_code || rate?.school_code || '',
      school_name: person.school_name,
      tp_serial: person.tp_serial,
      normal_lesson_rate: Number(rate?.normal_lesson_rate ?? rate?.hourly_rates?.lesson ?? 0),
      breakthrough_lesson_rate: Number(rate?.breakthrough_lesson_rate ?? rate?.hourly_rates?.lesson ?? 0),
      rate_master_id: rate?.id,
      rate_effective_from: rate?.effective_from,
      work_days: new Set(person.records.map(record => record.date)).size,
      total_minutes: totalMinutes,
      categories,
      transportation_amount: roundYen(person.transportation),
      total_payment: totalPayment,
      gross_payment: totalPayment + roundYen(person.transportation),
      alert_count: personAlerts.length,
    });
  });

  rows.sort((a, b) => a.person_code.localeCompare(b.person_code, undefined, { numeric: true }) || a.person_name.localeCompare(b.person_name, 'ja'));
  return {
    month,
    scope,
    rows,
    alerts,
    totals: {
      people: rows.length,
      total_minutes: rows.reduce((sum, row) => sum + row.total_minutes, 0),
      total_payment: rows.reduce((sum, row) => sum + row.total_payment, 0),
      transportation_amount: rows.reduce((sum, row) => sum + row.transportation_amount, 0),
      gross_payment: rows.reduce((sum, row) => sum + row.gross_payment, 0),
      danger: alerts.filter(alert => alert.severity === 'danger').length,
      warning: alerts.filter(alert => alert.severity === 'warning').length,
    },
  };
}

export function parseCsv(text: string) {
  const rows: string[][] = [];
  let row: string[] = [];
  let cell = '';
  let quoted = false;
  const source = String(text || '').replace(/^\uFEFF/, '');
  for (let index = 0; index < source.length; index += 1) {
    const char = source[index];
    if (quoted) {
      if (char === '"' && source[index + 1] === '"') { cell += '"'; index += 1; }
      else if (char === '"') quoted = false;
      else cell += char;
    } else if (char === '"') quoted = true;
    else if (char === ',') { row.push(cell.trim()); cell = ''; }
    else if (char === '\n') { row.push(cell.trim()); rows.push(row); row = []; cell = ''; }
    else if (char !== '\r') cell += char;
  }
  if (cell.length || row.length) { row.push(cell.trim()); rows.push(row); }
  return rows.filter(item => item.some(value => value !== ''));
}

const normalizedHeader = (value: unknown) => String(value || '').normalize('NFKC').toLowerCase().replace(/[\s　_()（）・･/／-]/g, '');

function rowValue(headers: string[], row: string[], aliases: string[]) {
  const normalizedAliases = aliases.map(normalizedHeader);
  const index = headers.findIndex(header => normalizedAliases.includes(normalizedHeader(header)));
  return index >= 0 ? String(row[index] || '').trim() : '';
}

function firstRowValue(headers: string[], row: string[], aliases: string[]) {
  for (const alias of aliases) {
    const value = rowValue(headers, row, [alias]);
    if (value) return value;
  }
  return '';
}

const numberValue = (value: unknown) => {
  const cleaned = String(value || '').normalize('NFKC').replace(/[￥¥,，\s]/g, '');
  if (!cleaned) return 0;
  const parsed = Number(cleaned);
  return Number.isFinite(parsed) && parsed >= 0 ? parsed : NaN;
};

const dateValue = (value: unknown) => {
  const normalized = String(value || '').normalize('NFKC').trim().replace(/[./]/g, '-');
  const matched = normalized.match(/^(\d{4})-(\d{1,2})-(\d{1,2})$/);
  if (matched) return `${matched[1]}-${matched[2].padStart(2, '0')}-${matched[3].padStart(2, '0')}`;
  const excelSerial = Number(normalized);
  if (!Number.isFinite(excelSerial) || excelSerial < 20_000 || excelSerial > 100_000) return '';
  return new Date(Date.UTC(1899, 11, 30) + Math.floor(excelSerial) * 86_400_000).toISOString().slice(0, 10);
};

const timeValue = (value: unknown) => {
  const normalized = String(value || '').normalize('NFKC').trim().replace(/時/g, ':').replace(/分/g, '');
  const matched = normalized.match(/^(\d{1,2}):(\d{1,2})/);
  if (matched) {
    const hour = Number(matched[1]);
    const minute = Number(matched[2]);
    return hour <= 47 && minute <= 59 ? `${String(hour).padStart(2, '0')}:${String(minute).padStart(2, '0')}` : '';
  }
  const excelTime = Number(normalized);
  if (!Number.isFinite(excelTime) || excelTime < 0 || excelTime >= 2) return '';
  const minutes = Math.round((excelTime % 1) * 24 * 60);
  return `${String(Math.floor(minutes / 60) % 24).padStart(2, '0')}:${String(minutes % 60).padStart(2, '0')}`;
};

export function resolveLegacyLessonRates(input: { edic?: number; sogaku?: number; individual1?: number; individual4?: number }) {
  const positive = (value: unknown) => {
    const parsed = Number(value || 0);
    return Number.isFinite(parsed) && parsed > 0 ? parsed : 0;
  };
  const edicRate = positive(input.edic);
  return { normal: edicRate, breakthrough: edicRate };
}

function parseLegacyRateRows(sourceRows: string[][]) {
  const [headers, ...rows] = sourceRows;
  const data: PayrollRateMaster[] = [];
  const errors: string[] = [];
  if (!headers) return { data, errors: ['単価データが空です。'], format: 'legacy_rate_sheet' as const };
  const requiredAliases = [
    ['支給年月'], ['所属教室番号'], ['職員コード'], ['expr1002', '氏名'],
    ['事務_tanka'], ['サブスタッフ_tanka'],
  ];
  const missing = requiredAliases.filter(aliases => !headers.some(header => aliases.map(normalizedHeader).includes(normalizedHeader(header))));
  if (missing.length) return {
    data,
    errors: [`原本の単価シートに必要な列がありません: ${missing.map(aliases => aliases[0]).join('、')}`],
    format: 'legacy_rate_sheet' as const,
  };

  rows.forEach((row, index) => {
    const line = index + 2;
    const personCode = normalizePersonCode(rowValue(headers, row, ['職員コード', '個人コード']));
    const personName = rowValue(headers, row, ['expr1002', '氏名']);
    if (!personCode && !personName) return;
    const paymentMonth = String(rowValue(headers, row, ['支給年月'])).normalize('NFKC').replace(/[^0-9]/g, '').slice(0, 6);
    const monthMatch = paymentMonth.match(/^(\d{4})(\d{2})$/);
    if (!monthMatch || Number(monthMatch[2]) < 1 || Number(monthMatch[2]) > 12) {
      errors.push(`${line}行目: 支給年月をYYYYMM形式で入力してください。`);
      return;
    }
    const rate = (aliases: string[]) => numberValue(rowValue(headers, row, aliases));
    const sourceRates = {
      edic: rate(['EDIC授業_TANKA']),
      sogaku: rate(['創学授業_TANKA']),
      individual1: rate(['個別授業1_TANKA']),
      individual4: rate(['個別授業4_TANKA']),
      office: rate(['事務_TANKA']),
      interview: rate(['サブスタッフ_TANKA']),
    };
    if (Object.values(sourceRates).some(value => Number.isNaN(value))) {
      errors.push(`${line}行目: 単価は0以上の数値で入力してください。`);
      return;
    }
    const lessonRates = resolveLegacyLessonRates(sourceRates);
    const interviewRate = sourceRates.interview || sourceRates.office;
    data.push({
      person_code: personCode,
      person_name: personName,
      normalized_name: normalizePayrollName(personName),
      effective_from: `${monthMatch[1]}-${monthMatch[2]}-01`,
      school_code: normalizePersonCode(rowValue(headers, row, ['所属教室番号'])),
      normal_lesson_rate: lessonRates.normal,
      breakthrough_lesson_rate: lessonRates.breakthrough,
      hourly_rates: { lesson: lessonRates.breakthrough, office: sourceRates.office, interview: interviewRate, other: sourceRates.office },
      allowances: { lesson: 0, office: 0, interview: 0, other: 0 },
    });
  });
  return { data, errors, format: 'legacy_rate_sheet' as const };
}

export function parseRateMasterCsv(text: string) {
  const sourceRows = parseCsv(text);
  const [headers, ...rows] = sourceRows;
  const data: PayrollRateMaster[] = [];
  const errors: string[] = [];
  if (!headers) return { data, errors: ['CSVが空です。'], format: 'standard' as const };
  if (headers.some(header => normalizedHeader(header) === normalizedHeader('支給年月')) &&
      headers.some(header => normalizedHeader(header) === normalizedHeader('職員コード'))) {
    return parseLegacyRateRows(sourceRows);
  }
  rows.forEach((row, index) => {
    const personCode = normalizePersonCode(rowValue(headers, row, ['個人コード', '職員番号', 'スタッフid', 'staffid', 'personcode']));
    const personName = rowValue(headers, row, ['氏名', '名前', '講師名', 'personname', 'name']);
    const effectiveFrom = dateValue(rowValue(headers, row, ['適用開始日', '適用日', 'effectivefrom']));
    const values = {
      lesson: numberValue(rowValue(headers, row, ['授業時給', '授業単価', 'lessonrate'])),
      office: numberValue(rowValue(headers, row, ['事務時給', '事務単価', 'officerate'])),
      interview: numberValue(rowValue(headers, row, ['面接時給', '面接単価', 'サブスタッフ時給', 'interviewrate'])),
      other: numberValue(rowValue(headers, row, ['その他時給', 'その他単価', 'otherrate'])),
    };
    const allowances = {
      lesson: numberValue(rowValue(headers, row, ['事業手当', '授業手当', 'lessonallowance'])),
      office: numberValue(rowValue(headers, row, ['事務手当', 'officeallowance'])),
      interview: numberValue(rowValue(headers, row, ['面接手当', 'サブスタッフ手当', 'interviewallowance'])),
      other: numberValue(rowValue(headers, row, ['その他手当', 'otherallowance'])),
    };
    const line = index + 2;
    if ((!personCode && !personName) || !effectiveFrom) errors.push(`${line}行目: 個人コード/氏名と適用開始日は必須です。`);
    if ([...Object.values(values), ...Object.values(allowances)].some(value => Number.isNaN(value))) errors.push(`${line}行目: 単価・手当は0以上の数値で入力してください。`);
    if (errors.some(error => error.startsWith(`${line}行目`))) return;
    data.push({ person_code: personCode, person_name: personName, normalized_name: normalizePayrollName(personName), effective_from: effectiveFrom, hourly_rates: values, allowances });
  });
  return { data, errors, format: 'standard' as const };
}

export function parseRegularAttendanceCsv(text: string) {
  return parseRegularAttendanceRows(parseCsv(text));
}

export function parseRegularAttendanceRows(sourceRows: string[][]) {
  const [headers, ...rows] = sourceRows;
  const data: RegularAttendanceInterval[] = [];
  const errors: string[] = [];
  if (!headers) return { data, errors: ['勤怠データが空です。'] };
  const actualMinutesHeader = headers.find(header => [
    '実働分', '実働時間分', '実働（分）ジツドウフン', '実働分ジツドウフン',
  ].map(normalizedHeader).includes(normalizedHeader(header)));
  rows.forEach((row, index) => {
    const personCode = normalizePersonCode(rowValue(headers, row, [
      '個人コード', '職員番号', '職員番号ショクインバンゴウ', 'スタッフid', 'staffid', 'personcode',
    ]));
    const personName = rowValue(headers, row, [
      '氏名', '名前', '講師名', '職員氏名', '職員氏名ショクインシメイ', 'personname', 'name',
    ]);
    const date = dateValue(rowValue(headers, row, ['日付', '勤務日', '勤務日キンムビ', 'date']));
    const startTime = timeValue(rowValue(headers, row, [
      '実働開始', '実働開始ジツドウカイシ', '開始', '開始時刻', '出勤', 'starttime',
    ]));
    const endTime = timeValue(rowValue(headers, row, [
      '実働終了', '実働終了ジツドウシュウリョウ', '終了', '終了時刻', '退勤', 'endtime',
    ]));
    const workType = firstRowValue(headers, row, [
      '作業名', '作業名サギョウメイ', '講座名', '講座名コウザメイ', '勤務区分', '業務区分', 'worktype',
    ]);
    const line = index + 2;
    const actualMinutes = actualMinutesHeader ? numberValue(rowValue(headers, row, [actualMinutesHeader])) : null;
    if (/休憩/.test(workType) || actualMinutes === 0) return;
    if ((!personCode && !personName) || !date || !startTime || !endTime) errors.push(`${line}行目: 個人コード/氏名、日付、開始、終了は必須です。`);
    if (startTime && endTime && !intervalMinutes(startTime, endTime)) errors.push(`${line}行目: 開始・終了時刻が不正です。`);
    if (errors.some(error => error.startsWith(`${line}行目`))) return;
    data.push({ person_code: personCode, person_name: personName, normalized_name: normalizePayrollName(personName), date, start_time: startTime, end_time: endTime, work_type: workType });
  });
  return { data, errors };
}
