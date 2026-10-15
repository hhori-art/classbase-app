import { getCourseSubjectGroup, toAsciiDigits } from '@/lib/course-text';

export const normalizeShiftGrade = (value: unknown) => {
  const raw = toAsciiDigits(String(value || '').normalize('NFKC')).replace(/[\s　]/g, '');
  if (/中(?:学)?3|3年/.test(raw)) return '中3';
  if (/中(?:学)?2|2年/.test(raw)) return '中2';
  if (/中(?:学)?1|1年/.test(raw)) return '中1';
  return raw;
};

export const normalizeShiftSubject = (value: unknown) => {
  const raw = String(value || '').normalize('NFKC').trim();
  return getCourseSubjectGroup(raw) || raw;
};

export const normalizeShiftIdentityText = (value: unknown) => String(value || '')
  .normalize('NFKC')
  .replace(/[\s　]/g, '')
  .toLowerCase();

/** 同じ講座の同期表記（対策物理 / 【対策】物理など）を同一視する。 */
export const normalizeShiftCourseIdentity = (value: unknown) => normalizeShiftIdentityText(value)
  .replace(/[【】\[\]]/g, '')
  .replace(/^定期テスト対策/, '対策')
  .replace(/^テスト対策/, '対策')
  .replace(/^通常/, '');

export const normalizeShiftPeriod = (value: unknown): 1 | 2 | null => {
  const raw = toAsciiDigits(String(value ?? '').normalize('NFKC')).trim();
  if (!raw) return null;
  if (/^1$/.test(raw) || /(?:^|[^0-9])1\s*(?:時間目|時限|限|コマ)/.test(raw)) return 1;
  if (/^2$/.test(raw) || /(?:^|[^0-9])2\s*(?:時間目|時限|限|コマ)/.test(raw)) return 2;
  return null;
};

export const redirectedShiftDetailFromTeacher = (value: unknown, currentDetail: unknown = '') => {
  const normalized = String(value || '')
    .normalize('NFKC')
    .replace(/[①➀]/g, '1').replace(/[②➁]/g, '2').replace(/[③➂]/g, '3')
    .replace(/[④➃]/g, '4').replace(/[⑤➄]/g, '5').replace(/[⑥➅]/g, '6')
    .replace(/[⑦➆]/g, '7').replace(/[⑧➇]/g, '8').replace(/[⑨➈]/g, '9')
    .replace(/[\s　]/g, '')
    .trim();
  const raw = normalized.includes('⇒') ? normalized.split('⇒').pop() || '' : normalized;
  const match = raw.match(/^((?:対策)?(?:物理|化学|生物|地学|地理|歴史|公民)[0-9]*)へ$/);
  if (match?.[1]) return match[1];
  const numberOnly = raw.match(/^([1-9])へ$/)?.[1];
  if (!numberOnly) return '';
  const base = String(currentDetail || '').normalize('NFKC').replace(/[\s　]/g, '').replace(/[0-9]+$/, '');
  return base ? `${base}${numberOnly}` : '';
};

export const shiftTeacherNameAfterChange = (value: unknown) => {
  const raw = String(value || '').trim();
  if (!raw.includes('⇒')) return raw;
  const parts = raw.split('⇒').map(part => part.trim()).filter(Boolean);
  return parts.at(-1) || raw.replace(/⇒/g, '').trim();
};

type ShiftSyncStructureRow = {
  sync_key?: unknown;
  target_date?: unknown;
  role_type?: unknown;
  grade?: unknown;
  subject?: unknown;
  teacher_name?: unknown;
  detail_subject?: unknown;
  place?: unknown;
  unit?: unknown;
  meeting_id?: unknown;
  signin_address?: unknown;
  note?: unknown;
  source_row?: unknown;
  source_col?: unknown;
};

export const isValidShiftDate = (value: unknown) => {
  const date = String(value || '').trim();
  if (!/^\d{4}-\d{2}-\d{2}$/.test(date)) return false;
  const parsed = new Date(`${date}T00:00:00Z`);
  return !Number.isNaN(parsed.getTime()) && parsed.toISOString().slice(0, 10) === date;
};

export function validateShiftSyncStructure(rows: ShiftSyncStructureRow[]) {
  const errors: string[] = [];
  const dates = new Set<string>();
  const mainDates = new Set<string>();
  const syncKeys = new Set<string>();
  rows.forEach((row, index) => {
    const line = index + 1;
    const date = String(row.target_date || '').trim();
    const role = String(row.role_type || 'main').trim();
    if (!isValidShiftDate(date)) errors.push(`${line}件目: 対象日はYYYY-MM-DD形式の実在する日付で入力してください。`);
    else dates.add(date);
    if (!['main', 'sub', 'general'].includes(role)) errors.push(`${line}件目: 配置役割はmain、sub、generalのいずれかにしてください。`);
    if (role === 'main' && isValidShiftDate(date)) mainDates.add(date);
    if (role !== 'general' && (!normalizeShiftGrade(row.grade) || !normalizeShiftSubject(row.subject))) {
      errors.push(`${line}件目: 主担当・サポートは学年と教科が必要です。`);
    }
    const syncKey = String(row.sync_key || '').trim();
    if (syncKey) {
      if (syncKeys.has(syncKey)) errors.push(`${line}件目: 同期キー「${syncKey}」が入力内で重複しています。`);
      syncKeys.add(syncKey);
    }
    const limits: Array<[keyof ShiftSyncStructureRow, number, string]> = [
      ['sync_key', 300, '同期キー'], ['teacher_name', 120, '講師名'], ['grade', 40, '学年'],
      ['subject', 80, '科目'], ['detail_subject', 160, '詳細科目'], ['place', 160, '教室'],
      ['unit', 1000, '単元'], ['meeting_id', 80, '会議ID'], ['signin_address', 320, 'サインインアドレス'],
      ['note', 2000, '備考'],
    ];
    limits.forEach(([key, max, label]) => {
      if (String(row[key] || '').length > max) errors.push(`${line}件目: ${label}は${max}文字以内にしてください。`);
    });
    for (const [key, label] of [['source_row', '元行'], ['source_col', '元列']] as const) {
      const value = row[key];
      if (value !== undefined && value !== null && value !== '' && (!Number.isInteger(Number(value)) || Number(value) < 0 || Number(value) > 100000)) {
        errors.push(`${line}件目: ${label}は0〜100000の整数で指定してください。`);
      }
    }
  });
  dates.forEach(date => {
    if (!mainDates.has(date)) errors.push(`${date}: 主担当の授業配置が1件もないため同期できません。`);
  });
  return { valid: errors.length === 0, errors };
}
