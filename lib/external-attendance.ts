import { normalizePayrollName, normalizePersonCode, type RegularAttendanceInterval } from './attendance-payroll.ts';

export type ExternalAttendanceFieldMap = Partial<Record<
  'id' | 'person_code' | 'person_name' | 'date' | 'start_time' | 'end_time' | 'work_type' | 'status' | 'updated_at',
  string
>>;

export type NormalizedExternalAttendance = RegularAttendanceInterval & {
  external_record_id: string;
  status: string;
  updated_at: string;
  deleted: boolean;
};

const aliases: Record<keyof Required<ExternalAttendanceFieldMap>, string[]> = {
  id: ['id', 'attendance_id', 'record_id', 'work_record_id'],
  person_code: ['person_code', 'employee_code', 'staff_code', 'employee_id', 'staff_id', '職員番号', '個人コード'],
  person_name: ['person_name', 'employee_name', 'staff_name', 'name', '職員氏名', '氏名'],
  date: ['date', 'work_date', 'attendance_date', '勤務日'],
  start_time: ['start_time', 'clock_in', 'clock_in_at', 'started_at', '勤務開始', '出勤時刻'],
  end_time: ['end_time', 'clock_out', 'clock_out_at', 'ended_at', '勤務終了', '退勤時刻'],
  work_type: ['work_type', 'attendance_type', 'category', '勤務区分'],
  status: ['status', 'state'],
  updated_at: ['updated_at', 'modified_at', 'last_modified_at'],
};

const deletedStatuses = new Set(['deleted', 'cancelled', 'canceled', 'void', '削除', '取消', 'キャンセル']);

export function readObjectPath(value: unknown, path: string): unknown {
  return path.split('.').filter(Boolean).reduce<unknown>((current, key) => {
    if (!current || typeof current !== 'object') return undefined;
    return (current as Record<string, unknown>)[key];
  }, value);
}

function firstValue(record: Record<string, unknown>, key: keyof Required<ExternalAttendanceFieldMap>, fieldMap: ExternalAttendanceFieldMap) {
  const configured = fieldMap[key];
  if (configured) return readObjectPath(record, configured);
  for (const alias of aliases[key]) {
    const value = readObjectPath(record, alias);
    if (value !== undefined && value !== null && value !== '') return value;
  }
  return '';
}

function jstParts(value: Date) {
  const parts = new Intl.DateTimeFormat('en-CA', {
    timeZone: 'Asia/Tokyo', year: 'numeric', month: '2-digit', day: '2-digit', hour: '2-digit', minute: '2-digit', hourCycle: 'h23',
  }).formatToParts(value).reduce<Record<string, string>>((result, part) => {
    if (part.type !== 'literal') result[part.type] = part.value;
    return result;
  }, {});
  return { date: `${parts.year}-${parts.month}-${parts.day}`, time: `${parts.hour}:${parts.minute}` };
}

function normalizeDate(value: unknown, fallbackTimestamp?: unknown) {
  const raw = String(value || '').trim();
  const match = raw.match(/^(\d{4})[\/-](\d{1,2})[\/-](\d{1,2})/);
  if (match) return `${match[1]}-${match[2].padStart(2, '0')}-${match[3].padStart(2, '0')}`;
  const source = raw || String(fallbackTimestamp || '');
  const date = new Date(source);
  return Number.isNaN(date.getTime()) ? '' : jstParts(date).date;
}

function normalizeTime(value: unknown) {
  const raw = String(value || '').trim();
  const match = raw.match(/^(\d{1,2}):(\d{2})/);
  if (match) return `${match[1].padStart(2, '0')}:${match[2]}`;
  const date = new Date(raw);
  return Number.isNaN(date.getTime()) ? '' : jstParts(date).time;
}

export function normalizeExternalAttendanceRecord(
  value: unknown,
  fieldMap: ExternalAttendanceFieldMap = {},
): { data?: NormalizedExternalAttendance; error?: string } {
  if (!value || typeof value !== 'object' || Array.isArray(value)) return { error: 'レコードがオブジェクトではありません。' };
  const record = value as Record<string, unknown>;
  const startRaw = firstValue(record, 'start_time', fieldMap);
  const endRaw = firstValue(record, 'end_time', fieldMap);
  const personCode = normalizePersonCode(firstValue(record, 'person_code', fieldMap));
  const personName = String(firstValue(record, 'person_name', fieldMap) || '').trim();
  const date = normalizeDate(firstValue(record, 'date', fieldMap), startRaw);
  const startTime = normalizeTime(startRaw);
  const endTime = normalizeTime(endRaw);
  const status = String(firstValue(record, 'status', fieldMap) || 'active').trim().toLowerCase();
  const externalId = String(firstValue(record, 'id', fieldMap) || '').trim();
  const deleted = deletedStatuses.has(status);

  if (!externalId) return { error: '外部レコードIDがありません。' };
  if (deleted) {
    return {
      data: {
        external_record_id: externalId,
        person_code: personCode,
        person_name: personName,
        normalized_name: normalizePayrollName(personName),
        date,
        start_time: startTime,
        end_time: endTime,
        work_type: String(firstValue(record, 'work_type', fieldMap) || ''),
        source_name: '',
        status,
        updated_at: String(firstValue(record, 'updated_at', fieldMap) || ''),
        deleted: true,
      },
    };
  }
  if (!personCode && !personName) return { error: `レコード ${externalId}: 職員コードまたは氏名がありません。` };
  if (!date) return { error: `レコード ${externalId}: 勤務日を判定できません。` };
  if (!startTime || !endTime) return { error: `レコード ${externalId}: 開始・終了時刻がありません。` };

  return {
    data: {
      external_record_id: externalId,
      person_code: personCode,
      person_name: personName,
      normalized_name: normalizePayrollName(personName),
      date,
      start_time: startTime,
      end_time: endTime,
      work_type: String(firstValue(record, 'work_type', fieldMap) || '通常勤務'),
      source_name: '',
      status,
      updated_at: String(firstValue(record, 'updated_at', fieldMap) || ''),
      deleted: false,
    },
  };
}

export function extractExternalAttendancePage(
  payload: unknown,
  recordsPath = '',
  cursorPath = '',
) {
  const candidate = recordsPath ? readObjectPath(payload, recordsPath) : payload;
  const records = Array.isArray(candidate)
    ? candidate
    : (candidate && typeof candidate === 'object'
      ? (['records', 'items', 'data'].map(key => (candidate as Record<string, unknown>)[key]).find(Array.isArray) as unknown[] | undefined)
      : undefined);
  if (!records) throw new Error('external-attendance-invalid-response');
  const cursor = cursorPath
    ? readObjectPath(payload, cursorPath)
    : (payload && typeof payload === 'object' ? ((payload as Record<string, unknown>).next_cursor || (payload as Record<string, unknown>).nextCursor) : '');
  return { records, nextCursor: String(cursor || '') };
}
