import {
  getCurrentSchoolYear,
  getRecordingYearScope,
  normalizeRecordingType,
  normalizeSchoolYear,
  recordingTypeLabel,
  type RecordingType,
  type RecordingYearScope,
} from '@/lib/recordings';
import { extractAnnualRecordingUrls, recordingStartMillis, type AnnualRecordingUrl, type AnnualRecordingUrlPart } from '@/lib/annual-recording-urls';

// 過去の録画（年度ごとの録画一覧CSV・個別の録画CSV）を class_recordings 用のデータに変換する。

export type PublishedData = {
  id: string;
  original_shift_id?: string;
  /** 授業の前後の集会（グループミーティング）の録画のときの講師配置。 */
  group_meeting_shift_id?: string;
  target_date: string;
  title: string;
  video_url: string;
  grade: string;
  subject: string;
  unit?: string;
  detail_subject?: string;
  teacher_name?: string;
  recording_type?: RecordingType;
  recording_type_label?: string;
  school_year?: number;
  year_scope?: RecordingYearScope;
  source?: string;
  status?: string;
  difficulty?: string;
  csv_import_key?: string;
  zoom_recording_file_id?: string;
  target_recording_file_id?: string;
  target_recording_type?: string;
  zoom_recording_files?: any[];
  recording_meeting_id?: string;
  trim_start_seconds?: number;
  trim_end_seconds?: number | null;
  is_replacement?: boolean;
  replacement_reason?: string;
  replacement_source_title?: string;
  period?: string;
  stopped_reason?: string;
  auto_published_at?: string;
  /** 年度録画一覧の「ID」列（Zoomのサインインアドレス）。Zoom APIで録画を特定するのに使う。 */
  recording_host_email?: string;
  /** 共有URLの startTime（ミリ秒）。 */
  recording_start_ms?: number | null;
  recording_part?: AnnualRecordingUrlPart;
  zoom_meeting_uuid?: string;
  zoom_resolved_at?: string;
  zoom_resolve_error?: string;
};

type RecordingInput = Omit<Partial<PublishedData>, 'school_year' | 'recording_type'> & {
  school_year?: string | number | null;
  recording_type?: string | null;
};

const csvHeaderAliases = {
  target_date: ['日付', '授業日', 'target_date', 'date'],
  title: ['タイトル', '録画タイトル', 'title'],
  video_url: ['URL', '録画URL', '動画URL', 'video_url', 'url'],
  grade: ['学年', 'grade'],
  subject: ['科目', '教科', 'subject'],
  unit: ['単元', '単元名', '分野', 'unit'],
  detail_subject: ['分野', '詳細科目', 'detail_subject'],
  teacher_name: ['講師', '担当講師', 'teacher_name'],
  school_year: ['年度', 'school_year'],
  recording_type: ['種別', '授業種別', 'recording_type', 'type'],
  difficulty: ['難易度', 'レベル', 'difficulty'],
} as const;

const annualRecordingCsvAliases = {
  class_name: ['クラス', '講座', 'class_name', 'class'],
  publish: ['UP', '公開', '公開対象', 'publish', 'is_published'],
  host_email: ['ID', 'Zoom ID', 'ZoomID', 'アカウント', 'host_email'],
  note: ['備考', 'note'],
} as const;

function parseCsv(text: string) {
  const rows: string[][] = [];
  let row: string[] = [];
  let cell = '';
  let quoted = false;

  for (let i = 0; i < text.length; i += 1) {
    const char = text[i];
    const next = text[i + 1];
    if (char === '"' && quoted && next === '"') {
      cell += '"';
      i += 1;
    } else if (char === '"') {
      quoted = !quoted;
    } else if (char === ',' && !quoted) {
      row.push(cell.trim());
      cell = '';
    } else if ((char === '\n' || char === '\r') && !quoted) {
      if (char === '\r' && next === '\n') i += 1;
      row.push(cell.trim());
      if (row.some(value => value !== '')) rows.push(row);
      row = [];
      cell = '';
    } else {
      cell += char;
    }
  }

  row.push(cell.trim());
  if (row.some(value => value !== '')) rows.push(row);
  return rows;
}

function findCsvValue(row: Record<string, string>, key: keyof typeof csvHeaderAliases) {
  const aliases = csvHeaderAliases[key];
  for (const alias of aliases) {
    const value = row[alias];
    if (value !== undefined && value !== '') return value;
  }
  return '';
}

function normalizeCsvHeader(value?: string | null) {
  return String(value || '').replace(/^\uFEFF/, '').normalize('NFKC').trim().toLowerCase();
}

function findCsvHeaderIndex(rows: string[][]) {
  const knownHeaders = Object.values(csvHeaderAliases).flat().map(value => normalizeCsvHeader(value));
  return rows.findIndex(row => {
    const normalized = row.map(value => normalizeCsvHeader(value));
    const matches = normalized.filter(value => knownHeaders.includes(value));
    return matches.length >= 2 && normalized.some(value => csvHeaderAliases.video_url.map(alias => normalizeCsvHeader(alias)).includes(value));
  });
}

function findHeaderColumn(headers: string[], aliases: readonly string[]) {
  const normalizedAliases = aliases.map(alias => normalizeCsvHeader(alias));
  return headers.findIndex(header => normalizedAliases.includes(normalizeCsvHeader(header)));
}

function isCsvTruthy(value?: string | null) {
  return ['true', '1', 'yes', 'y', 'up', '公開', '済', '✓', '✔'].includes(normalizeCsvHeader(value));
}

function isHttpUrl(value?: string | null) {
  return /^https?:\/\/\S+$/i.test(String(value || '').trim());
}

function detectCsvSchoolYear(rows: string[][], headerIndex: number) {
  for (const value of rows.slice(0, Math.max(headerIndex, 0)).flat()) {
    const match = String(value || '').normalize('NFKC').match(/(20\d{2})\s*年度/);
    if (match) return Number(match[1]);
  }
  return getCurrentSchoolYear();
}

function normalizeCsvGrade(value?: string | null) {
  const text = String(value || '').normalize('NFKC').replace(/\s+/g, '');
  const grades = ['1', '2', '3'].filter(grade => new RegExp(`中(?:学)?${grade}`).test(text));
  if (grades.length > 1) return '共通';
  if (/中(?:学)?1|1年/.test(text)) return '中1';
  if (/中(?:学)?2|2年/.test(text)) return '中2';
  if (/中(?:学)?3|3年/.test(text)) return '中3';
  return text || 'その他';
}

function subjectFromClassName(value?: string | null) {
  const text = String(value || '').normalize('NFKC').trim();
  if (/理科|物理|化学|生物|地学/.test(text)) return '理科';
  if (/社会|地理|歴史|公民/.test(text)) return '社会';
  return '全科目';
}

/** 「sozo_kyoumu_03@sozogakuen.co.jp\"」のような崩れも直す。アドレスとして読めなければ空。 */
function normalizeHostEmail(value?: string | null) {
  const text = String(value || '').normalize('NFKC').trim().replace(/["'\s]/g, '').toLowerCase();
  return /^[^@]+@[^@]+\.[^@]+$/.test(text) ? text : '';
}

/** 録画の開始時刻（日本時間）から時限を推定する。1限 19:20〜 / 2限 20:35〜。 */
function periodFromStartMillis(ms?: number | null) {
  if (!ms) return '';
  const jst = new Date(ms + 9 * 60 * 60 * 1000);
  const minutes = jst.getUTCHours() * 60 + jst.getUTCMinutes();
  if (minutes >= 18 * 60 + 30 && minutes < 20 * 60 + 30) return '1限';
  if (minutes >= 20 * 60 + 30 && minutes < 22 * 60) return '2限';
  return '';
}

function monthDayParts(value?: string | null) {
  const match = String(value || '').normalize('NFKC').trim().match(/^(\d{1,2})[\/.-](\d{1,2})/);
  if (!match) return null;
  const month = Number(match[1]);
  const day = Number(match[2]);
  if (month < 1 || month > 12 || day < 1 || day > 31) return null;
  return { month, day };
}

function dateKeyFromMonthDay(year: number, month: number, day: number) {
  return `${year}-${String(month).padStart(2, '0')}-${String(day).padStart(2, '0')}`;
}

function toJstDateKeyFromMillis(ms: number) {
  if (!Number.isFinite(ms) || ms <= 0) return '';
  return new Date(ms + 9 * 60 * 60 * 1000).toISOString().slice(0, 10);
}

function dateFromRecordingUrl(url?: string | null) {
  const text = String(url || '').trim();
  const match = text.match(/[?&]startTime=(\d{10,})/);
  return match ? toJstDateKeyFromMillis(Number(match[1])) : '';
}

function normalizeCsvDate(value?: string | null, url?: string | null, schoolYearValue?: string | number | null) {
  const text = String(value || '').trim();
  const ymd = text.match(/^(\d{4})[\/\-.年](\d{1,2})[\/\-.月](\d{1,2})/);
  if (ymd) {
    return `${ymd[1]}-${ymd[2].padStart(2, '0')}-${ymd[3].padStart(2, '0')}`;
  }

  const urlDate = dateFromRecordingUrl(url);
  if (urlDate) return urlDate;

  const schoolYear = normalizeSchoolYear(undefined, schoolYearValue);
  return `${schoolYear}-04-01`;
}

function recordingImportKey(item: Pick<PublishedData, 'video_url' | 'title' | 'grade' | 'subject' | 'unit' | 'recording_type'>) {
  return [
    item.recording_type || '',
    item.grade || '',
    item.subject || '',
    item.unit || '',
    item.title || '',
    item.video_url || '',
  ].join('|').trim();
}

export function stableCsvRecordingDocId(item: Pick<PublishedData, 'video_url' | 'title' | 'grade' | 'subject' | 'unit' | 'recording_type'>) {
  const key = recordingImportKey(item);
  let hash = 2166136261;
  for (let i = 0; i < key.length; i += 1) {
    hash ^= key.charCodeAt(i);
    hash = Math.imul(hash, 16777619);
  }
  return `csv_recording_${(hash >>> 0).toString(36)}`;
}

export function normalizeRecording(raw: RecordingInput): Omit<PublishedData, 'id'> {
  const schoolYear = normalizeSchoolYear(raw.target_date, raw.school_year);
  const recordingType = normalizeRecordingType(raw.recording_type);
  return {
    target_date: raw.target_date || '',
    title: raw.title || 'タイトルなし',
    video_url: raw.video_url || '',
    grade: raw.grade || 'その他',
    subject: raw.subject || '全科目',
    unit: raw.unit || '',
    detail_subject: raw.detail_subject || '',
    teacher_name: raw.teacher_name || '',
    recording_type: recordingType,
    recording_type_label: recordingTypeLabel(recordingType),
    school_year: schoolYear,
    year_scope: getRecordingYearScope(schoolYear),
    source: raw.source || 'manual',
    difficulty: raw.difficulty || '',
    csv_import_key: raw.csv_import_key || '',
    zoom_recording_file_id: raw.zoom_recording_file_id || raw.target_recording_file_id || '',
    target_recording_file_id: raw.target_recording_file_id || raw.zoom_recording_file_id || '',
    target_recording_type: raw.target_recording_type || '',
    zoom_recording_files: raw.zoom_recording_files || [],
    recording_meeting_id: raw.recording_meeting_id || '',
    ...(raw.original_shift_id ? { original_shift_id: raw.original_shift_id } : {}),
  };
}

export function parseRecordingCsv(text: string) {
    const rows = parseCsv(text.replace(/^\uFEFF/, ''));
    if (rows.length < 2) {
      throw new Error('CSVに取り込める行がありません。');
    }

    const headerIndex = findCsvHeaderIndex(rows);
    if (headerIndex < 0) {
      throw new Error('CSVの見出し行を判定できませんでした。URL列と学年・タイトルなどの列名を確認してください。');
    }

    const headers = rows[headerIndex].map(header => header.trim());
    const dataRows = rows.slice(headerIndex + 1);
    const publishColumn = findHeaderColumn(headers, annualRecordingCsvAliases.publish);
    const classColumn = findHeaderColumn(headers, annualRecordingCsvAliases.class_name);
    const urlColumn = findHeaderColumn(headers, csvHeaderAliases.video_url);
    const hostColumn = findHeaderColumn(headers, annualRecordingCsvAliases.host_email);
    const noteColumn = findHeaderColumn(headers, annualRecordingCsvAliases.note);
    const dateColumn = findHeaderColumn(headers, csvHeaderAliases.target_date);
    const isAnnualRecordingList = publishColumn >= 0 && classColumn >= 0;
    const detectedSchoolYear = detectCsvSchoolYear(rows, headerIndex);
    const items: Omit<PublishedData, 'id'>[] = [];
    let eligibleRows = 0;
    let excludedRows = 0;
    let noUrlRows = 0;
    let annualCalendarYear = detectedSchoolYear;
    let previousAnnualMonth: number | null = null;

    dataRows.forEach(values => {
      let annualTargetDate = '';
      if (isAnnualRecordingList && dateColumn >= 0) {
        const parts = monthDayParts(values[dateColumn]);
        if (parts) {
          if (previousAnnualMonth !== null && previousAnnualMonth >= 10 && parts.month <= 3) {
            annualCalendarYear += 1;
          }
          previousAnnualMonth = parts.month;
          annualTargetDate = dateKeyFromMonthDay(annualCalendarYear, parts.month, parts.day);
        }
      }

      if (isAnnualRecordingList && !isCsvTruthy(values[publishColumn])) {
        excludedRows += 1;
        return;
      }
      eligibleRows += 1;

      const row = headers.reduce<Record<string, string>>((acc, header, index) => {
        if (header) acc[header] = values[index]?.trim() || '';
        return acc;
      }, {});

      const videoUrls = isAnnualRecordingList
        ? extractAnnualRecordingUrls(values.slice(Math.max(urlColumn, 0)), noteColumn >= 0 ? values[noteColumn] : '')
        : [findCsvValue(row, 'video_url')].filter(isHttpUrl)
          .map((url): AnnualRecordingUrl => ({ url, part: null, start_ms: recordingStartMillis(url), replacement: false }));
      if (videoUrls.length === 0) {
        noUrlRows += 1;
        return;
      }

      const rawDate = findCsvValue(row, 'target_date');
      const csvSchoolYear = findCsvValue(row, 'school_year');
      const schoolYearValue = isAnnualRecordingList ? detectedSchoolYear : csvSchoolYear;
      const hasExplicitDate = rawDate.trim() !== '';
      const effectiveSchoolYear = !isAnnualRecordingList && !hasExplicitDate && !schoolYearValue
        ? getCurrentSchoolYear() - 1
        : schoolYearValue;

      const className = isAnnualRecordingList ? values[classColumn]?.trim() || '' : '';
      const unit = findCsvValue(row, 'unit');
      const baseTitle = findCsvValue(row, 'title') || `${className} ${unit}`.trim() || unit || className;
      const hostEmail = isAnnualRecordingList && hostColumn >= 0 ? normalizeHostEmail(values[hostColumn]) : '';
      videoUrls.forEach(({ url: videoUrl, part, start_ms: startMs, replacement, original_start_ms: originalStartMs }, urlIndex) => {
        // 差し替え録画は過去の日付のURLなので、授業日はシートの日付を優先する。
        const targetDate = isAnnualRecordingList
          ? annualTargetDate || (replacement ? '' : dateFromRecordingUrl(videoUrl)) || normalizeCsvDate(rawDate, videoUrl, effectiveSchoolYear)
          : normalizeCsvDate(rawDate, videoUrl, effectiveSchoolYear);
        const title = part ? `${baseTitle}（${part}）` : videoUrls.length > 1 ? `${baseTitle}（${urlIndex + 1}）` : baseTitle;
        const item = normalizeRecording({
          target_date: targetDate,
          title,
          video_url: videoUrl,
          grade: isAnnualRecordingList ? normalizeCsvGrade(findCsvValue(row, 'grade')) : findCsvValue(row, 'grade'),
          subject: findCsvValue(row, 'subject') || subjectFromClassName(className),
          unit,
          detail_subject: findCsvValue(row, 'detail_subject') || className,
          teacher_name: findCsvValue(row, 'teacher_name'),
          school_year: effectiveSchoolYear,
          recording_type: findCsvValue(row, 'recording_type') || (isAnnualRecordingList ? className : ''),
          difficulty: findCsvValue(row, 'difficulty'),
          source: isAnnualRecordingList ? 'annual_recording_csv_up' : 'csv_import',
        });
        items.push({
          ...item,
          csv_import_key: recordingImportKey(item),
          ...(isAnnualRecordingList ? {
            recording_host_email: hostEmail,
            recording_start_ms: startMs,
            recording_part: part,
            // 差し替え録画は別の日の録画なので、時限は差し替え前のURLの時刻から判定する。
            period: periodFromStartMillis(replacement ? originalStartMs : startMs),
            ...(replacement ? { is_replacement: true, replacement_reason: '録画一覧で差し替え指定' } : {}),
          } : {}),
        });
      });
    });

  return { items, isAnnualRecordingList, eligibleRows, excludedRows, noUrlRows };
}
