import { NextRequest } from 'next/server';
import { revalidateTag } from 'next/cache';
import { FieldValue } from 'firebase-admin/firestore';
import { adminDb } from '@/lib/firebase-admin';
import { getServerUser, jsonError } from '@/lib/server-auth';
import { writeLearningEvent } from '@/lib/events';

export const runtime = 'nodejs';

type ImportType = 'lesson_schedule' | 'curriculum';
type NormalizedRow = {
  title: string;
  startDate?: string;
  endDate?: string;
  monthLabel?: string;
  weekNo?: string;
  term?: string;
  category?: string;
  audience?: string;
  grade?: string;
  subject?: string;
  unit?: string;
  courseName?: string;
  lessonNo?: string;
  schoolId?: string | null;
  notes?: string;
  raw: unknown;
};
type CurriculumCourseColumn = {
  col: number;
  subject: string;
  courseName: string;
};
type CurriculumBlock = {
  grade: string;
  gradeCol: number;
  monthCol: number;
  weekCol: number;
  startCol: number;
  endCol: number;
  columns: CurriculumCourseColumn[];
};
type CurriculumParseDebug = {
  mode: 'auto' | 'legacy';
  subject_row: number;
  course_header_row: number;
  detected_blocks: CurriculumBlock[];
  detected_columns: Array<CurriculumCourseColumn & { grade: string }>;
  imported_by_grade: Record<string, number>;
  imported_by_subject: Record<string, number>;
};
type CurriculumParseResult = {
  rows: NormalizedRow[];
  debug: CurriculumParseDebug;
};

const DATE_KEYS = ['日付', '授業日', '予定日', '実施日', 'date', 'target_date'];
const START_KEYS = ['開始日', '期間開始', 'start_date', 'start'];
const END_KEYS = ['終了日', '期間終了', 'end_date', 'end'];
const TITLE_KEYS = ['タイトル', '予定名', '授業内容', '内容', 'テーマ', '単元名', 'title'];
const SUBJECT_KEYS = ['科目', '教科', 'subject'];
const GRADE_KEYS = ['学年', '対象学年', 'grade'];
const UNIT_KEYS = ['単元', '単元名', 'カリキュラム', 'unit'];
const LESSON_KEYS = ['回', '回数', '講座回', 'No', 'no', 'lesson_no'];
const SCHOOL_KEYS = ['校舎', '校舎ID', 'school', 'school_id'];
const NOTE_KEYS = ['備考', 'メモ', 'note', 'notes'];

const pick = (row: Record<string, unknown>, keys: string[]) => {
  for (const key of keys) {
    const value = row[key];
    if (value !== undefined && String(value).trim() !== '') return String(value).trim();
  }
  return '';
};

const sanitizeId = (value: string) => value.replace(/[^\p{Letter}\p{Number}_-]+/gu, '_').slice(0, 140);

const normalizeDate = (value: string, defaultYear: number) => {
  const raw = String(value || '').trim();
  if (!raw) return '';

  const serial = Number(raw);
  if (/^\d+(\.\d+)?$/.test(raw) && serial > 30000 && serial < 70000) {
    const date = new Date(Date.UTC(1899, 11, 30 + Math.floor(serial)));
    return date.toISOString().slice(0, 10);
  }

  const normalized = raw.replace(/[年月.]/g, '/').replace(/日/g, '').replace(/-/g, '/');
  const full = normalized.match(/^(\d{4})\/(\d{1,2})\/(\d{1,2})$/);
  if (full) return `${full[1]}-${full[2].padStart(2, '0')}-${full[3].padStart(2, '0')}`;

  const short = normalized.match(/^(\d{1,2})\/(\d{1,2})$/);
  if (short) return `${defaultYear}-${short[1].padStart(2, '0')}-${short[2].padStart(2, '0')}`;

  return '';
};

const splitList = (value: string) => value
  .split(/[、,／/]/)
  .map(item => item.trim())
  .filter(Boolean);

const toAsciiDigits = (value: string) => value.replace(/[０-９]/g, char => String.fromCharCode(char.charCodeAt(0) - 0xfee0));
const monthNumber = (value: string) => {
  const match = toAsciiDigits(String(value || '')).match(/(\d{1,2})月/);
  return match ? Number(match[1]) : 0;
};
const isYearCell = (value: string) => /^\d{4}$/.test(toAsciiDigits(String(value || '').trim()));
const weekTerm = (week: string) => {
  if (week === 'SS') return 'term2';
  const no = Number(week);
  if (!Number.isFinite(no)) return 'other';
  if (no <= 16) return 'term1';
  if (no <= 30) return 'term2';
  return 'term3';
};
const termLabel = (term: string) => (
  term === 'term1' ? '1学期' :
  term === 'term2' ? '2学期' :
  term === 'term3' ? '3学期' :
  term === 'summer_special' ? '夏期講習' :
  'その他'
);
const termStartWeek = (term: string) => (
  term === 'term1' ? '1' :
  term === 'term2' ? '17' :
  term === 'term3' ? '31' :
  term === 'summer_special' ? 'SS' :
  ''
);
const normalizeGrade = (value: unknown) => {
  const raw = toAsciiDigits(String(value || ''));
  if (raw.includes('3')) return '中3';
  if (raw.includes('2')) return '中2';
  if (raw.includes('1')) return '中1';
  return raw.trim();
};
const normalizeGrades = (value: unknown) => Array.isArray(value)
  ? Array.from(new Set(value.map(normalizeGrade).filter(Boolean)))
  : [];
const termAppliesToGrade = (term: any, grade: unknown) => {
  const grades = normalizeGrades(term.grades);
  if (grades.length === 0) return true;
  const normalizedGrade = normalizeGrade(grade);
  return Boolean(normalizedGrade && grades.includes(normalizedGrade));
};
const resolveConfiguredTerm = (week: string, terms: any[], grade?: unknown) => {
  if (!terms.length) return null;
  const applicableTerms = terms
    .filter(term => termAppliesToGrade(term, grade))
    .sort((a, b) => normalizeGrades(b.grades).length - normalizeGrades(a.grades).length);
  if (week === 'SS') {
    return applicableTerms.find(term => term.includes_ss === true)
      || applicableTerms.find(term => term.id === 'term2')
      || applicableTerms.find(term => term.id === 'summer_special')
      || null;
  }
  const no = Number(week);
  if (!Number.isFinite(no)) return null;
  return applicableTerms.find(term => no >= Number(term.start_week || 0) && no <= Number(term.end_week || 0)) || null;
};
const scheduleCategory = (status: string) => {
  if (/お休み|休館日|休講|調休/.test(status)) return 'closed';
  if (/模試/.test(status)) return 'exam';
  if (/講習|週/.test(status)) return 'lesson';
  return 'event';
};
const scheduleTitle = (status: string) => {
  const category = scheduleCategory(status);
  if (category === 'lesson' && /\d+週/.test(status)) return `授業実施日 ${status}`;
  if (category === 'closed') return status;
  return status || '年間予定';
};
const isMatrix = (value: unknown): value is string[][] => Array.isArray(value) && value.every(row => Array.isArray(row));

const parseCsv = (text: string) => {
  const csvRows: string[][] = [];
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
      if (row.some(value => value !== '')) csvRows.push(row);
      row = [];
      cell = '';
    } else {
      cell += char;
    }
  }

  row.push(cell.trim());
  if (row.some(value => value !== '')) csvRows.push(row);

  const [headers = [], ...body] = csvRows;
  return {
    matrix: csvRows,
    rows: body.map(values => Object.fromEntries(headers.map((header, index) => [header.trim(), values[index] || '']))),
  };
};

const googleSheetCsvUrl = (value: string) => {
  const raw = String(value || '').trim();
  if (!raw) return '';
  try {
    const url = new URL(raw);
    const match = url.pathname.match(/\/spreadsheets\/d\/([^/]+)/);
    if (!match) return raw;
    const gid = url.searchParams.get('gid') || '0';
    return `https://docs.google.com/spreadsheets/d/${match[1]}/export?format=csv&gid=${encodeURIComponent(gid)}`;
  } catch {
    return raw;
  }
};

const parseLessonCalendarMatrix = (matrix: string[][], defaultYear: number): NormalizedRow[] => {
  const rows: NormalizedRow[] = [];
  for (let headerRow = 0; headerRow < matrix.length - 2; headerRow += 1) {
    const row = matrix[headerRow] || [];
    for (let col = 0; col < row.length - 1; col += 1) {
      if (!isYearCell(row[col] || '')) continue;
      const year = Number(toAsciiDigits(row[col] || '')) || defaultYear;
      const month = monthNumber(row[col + 1] || '');
      if (!year || month < 1 || month > 12 || !/月/.test(row[col + 1] || '')) continue;
      const lastDay = new Date(year, month, 0).getDate();
      for (let dateRow = headerRow + 2; dateRow < Math.min(headerRow + 14, matrix.length - 1); dateRow += 2) {
        const statusRow = matrix[dateRow + 1] || [];
        for (let dayOffset = 0; dayOffset < 7; dayOffset += 1) {
          const day = Number(toAsciiDigits((matrix[dateRow] || [])[col + dayOffset] || ''));
          const status = String(statusRow[col + dayOffset] || '').trim();
          if (!day || day > lastDay || !status) continue;
          const date = `${year}-${String(month).padStart(2, '0')}-${String(day).padStart(2, '0')}`;
          const weekMatch = toAsciiDigits(status).match(/(\d+)週/);
          const weekNo = weekMatch ? weekMatch[1] : (/夏期講習/.test(status) ? 'SS' : '');
          rows.push({
            title: scheduleTitle(status),
            startDate: date,
            endDate: date,
            weekNo,
            term: weekTerm(weekNo),
            category: scheduleCategory(status),
            audience: 'all',
            notes: status,
            raw: { date, status, source_row: dateRow, source_col: col + dayOffset },
          });
        }
      }
    }
  }
  const unique = new Map<string, NormalizedRow>();
  rows.forEach(row => unique.set(`${row.startDate}_${row.notes}`, row));
  return Array.from(unique.values());
};

const carryHeader = (matrix: string[][], row: number, col: number) => {
  for (let c = col; c >= 0; c -= 1) {
    const value = String((matrix[row] || [])[c] || '').trim();
    if (value) return value;
  }
  return '';
};

const isMonthWeekPair = (matrix: string[][], col: number) => {
  const month = String((matrix[0] || [])[col] || '').trim();
  const week = String((matrix[0] || [])[col + 1] || '').trim();
  return month === '月' && /授業週/.test(week);
};

const curriculumUnitValue = (value: unknown) => String(value || '').trim();
const isIgnorableCurriculumUnit = (value: string) => {
  const normalized = toAsciiDigits(value.normalize('NFKC')).trim();
  return !normalized || normalized === 'SS';
};

const detectCurriculumBlocks = (matrix: string[][], subjectRow = 1, courseHeaderRow = 5): CurriculumBlock[] => {
  const header = matrix[0] || [];
  const grades = header
    .map((value, col) => ({ grade: normalizeGrade(value), col }))
    .filter(item => ['中1', '中2', '中3'].includes(item.grade))
    .sort((a, b) => a.col - b.col);
  const monthPairs = header
    .map((_, col) => ({ col, weekCol: col + 1 }))
    .filter(pair => isMonthWeekPair(matrix, pair.col))
    .sort((a, b) => a.col - b.col);
  if (grades.length === 0 || monthPairs.length < grades.length) return [];

  return grades.map((gradeHeader, index) => {
    const pair = monthPairs[index];
    const nextGradeCol = grades[index + 1]?.col ?? Number.POSITIVE_INFINITY;
    const nextMonthCol = monthPairs[index + 1]?.col ?? Number.POSITIVE_INFINITY;
    const endCandidates = [
      Number.isFinite(nextGradeCol) ? nextGradeCol - 1 : Number.POSITIVE_INFINITY,
      Number.isFinite(nextMonthCol) ? nextMonthCol - 1 : Number.POSITIVE_INFINITY,
      pair.col > gradeHeader.col ? pair.col - 1 : Number.POSITIVE_INFINITY,
      header.length - 1,
    ].filter(Number.isFinite);
    const startCol = gradeHeader.col;
    const endCol = Math.max(startCol, Math.min(...endCandidates));
    const columns: CurriculumCourseColumn[] = [];
    for (let col = startCol; col <= endCol; col += 1) {
      if (col === pair.col || col === pair.weekCol) continue;
      const subject = carryHeader(matrix, subjectRow, col);
      if (!subject || ['月', '授業週', gradeHeader.grade].includes(subject)) continue;
      const courseName = String((matrix[courseHeaderRow] || [])[col] || '').trim() || subject || '講座';
      columns.push({ col, subject, courseName });
    }
    return {
      grade: gradeHeader.grade,
      gradeCol: gradeHeader.col,
      monthCol: pair.col,
      weekCol: pair.weekCol,
      startCol,
      endCol,
      columns,
    };
  }).filter(block => block.columns.length > 0);
};

const legacyCurriculumBlocks = (matrix: string[][]): CurriculumBlock[] => {
  const blocks = [
    { grade: '中1', monthCol: 0, weekCol: 1, startCol: 2, endCol: 9 },
    { grade: '中2', monthCol: 10, weekCol: 11, startCol: 12, endCol: 19 },
    { grade: '中3', monthCol: 25, weekCol: 26, startCol: 20, endCol: 24 },
  ];
  return blocks.map(block => {
    const columns: CurriculumCourseColumn[] = [];
    for (let col = block.startCol; col <= block.endCol; col += 1) {
      const subject = carryHeader(matrix, 1, col);
      const courseName = String((matrix[5] || [])[col] || '').trim() || subject || '講座';
      if (subject) columns.push({ col, subject, courseName });
    }
    return { ...block, gradeCol: block.startCol, columns };
  });
};

const findCurriculumCourseHeaderRow = (matrix: string[][], blocks: CurriculumBlock[]) => {
  const courseCols = blocks.flatMap(block => block.columns.map(column => column.col));
  if (courseCols.length === 0) return 5;
  let best = { row: 5, score: -1 };
  for (let row = 2; row <= Math.min(8, matrix.length - 1); row += 1) {
    const score = courseCols.filter(col => {
      const value = String((matrix[row] || [])[col] || '').trim();
      return value && !/^(\d+|SS|\d+月)$/.test(toAsciiDigits(value.normalize('NFKC')));
    }).length;
    if (score > best.score) best = { row, score };
    if (score >= Math.ceil(courseCols.length * 0.7)) return row;
  }
  return best.row;
};

const countRowsBy = (rows: NormalizedRow[], key: 'grade' | 'subject') => rows.reduce((acc, row) => {
  const value = String(row[key] || '未設定');
  acc[value] = (acc[value] || 0) + 1;
  return acc;
}, {} as Record<string, number>);

const parseCurriculumMatrixWithBlocks = (
  matrix: string[][],
  blocks: CurriculumBlock[],
  mode: 'auto' | 'legacy',
  subjectRow = 1,
  courseHeaderRow = 5,
): CurriculumParseResult => {
  const rows: NormalizedRow[] = [];
  for (const block of blocks) {
    for (let r = 2; r < matrix.length; r += 1) {
      if (r === courseHeaderRow) continue;
      const monthLabel = String((matrix[r] || [])[block.monthCol] || '').trim();
      const weekNo = toAsciiDigits(String((matrix[r] || [])[block.weekCol] || '').trim());
      if (!monthLabel || !weekNo) continue;
      for (const column of block.columns) {
        const unit = curriculumUnitValue((matrix[r] || [])[column.col]);
        if (isIgnorableCurriculumUnit(unit)) continue;
        const subject = column.subject || carryHeader(matrix, subjectRow, column.col);
        const courseName = String((matrix[courseHeaderRow] || [])[column.col] || '').trim() || column.courseName || subject || '講座';
        const term = weekTerm(weekNo);
        const weekLabel = weekNo === 'SS' ? '夏期講習' : `${weekNo}週`;
        rows.push({
          title: `${block.grade} ${courseName} ${monthLabel} ${weekLabel}`,
          monthLabel,
          weekNo,
          term,
          category: 'curriculum',
          audience: 'parent',
          grade: block.grade,
          subject,
          unit,
          courseName,
          notes: `${termLabel(term)} / ${monthLabel} / ${weekLabel}`,
          raw: {
            row: r,
            col: column.col,
            unit,
            parser_mode: mode,
            month_col: block.monthCol,
            week_col: block.weekCol,
          },
        });
      }
    }
  }
  const detectedBlocks = blocks.map(block => ({
    ...block,
    columns: block.columns.map(column => ({ ...column })),
  }));
  const detectedColumns = blocks.flatMap(block => block.columns.map(column => ({
    ...column,
    grade: block.grade,
  })));
  return {
    rows,
    debug: {
      mode,
      subject_row: subjectRow,
      course_header_row: courseHeaderRow,
      detected_blocks: detectedBlocks,
      detected_columns: detectedColumns,
      imported_by_grade: countRowsBy(rows, 'grade'),
      imported_by_subject: countRowsBy(rows, 'subject'),
    },
  };
};

const parseCurriculumMatrix = (matrix: string[][]): CurriculumParseResult => {
  const subjectRow = 1;
  let blocks = detectCurriculumBlocks(matrix, subjectRow, 5);
  if (blocks.length >= 3) {
    const courseHeaderRow = findCurriculumCourseHeaderRow(matrix, blocks);
    blocks = detectCurriculumBlocks(matrix, subjectRow, courseHeaderRow);
    return parseCurriculumMatrixWithBlocks(matrix, blocks, 'auto', subjectRow, courseHeaderRow);
  }
  const legacyBlocks = legacyCurriculumBlocks(matrix);
  return parseCurriculumMatrixWithBlocks(matrix, legacyBlocks, 'legacy', subjectRow, 5);
};

const normalizeGenericRows = (type: ImportType, rows: Record<string, unknown>[], defaultYear: number): NormalizedRow[] => {
  return rows.map(row => {
    const rawStart = pick(row, START_KEYS) || pick(row, DATE_KEYS);
    const rawEnd = pick(row, END_KEYS) || rawStart;
    const startDate = normalizeDate(rawStart, defaultYear);
    const endDate = normalizeDate(rawEnd, defaultYear) || startDate;
    const subject = pick(row, SUBJECT_KEYS);
    const grade = pick(row, GRADE_KEYS);
    const unit = pick(row, UNIT_KEYS);
    const lessonNo = pick(row, LESSON_KEYS);
    const title = pick(row, TITLE_KEYS) || [subject, grade, unit || lessonNo].filter(Boolean).join(' ') || (type === 'lesson_schedule' ? '年間授業予定' : '年間カリキュラム予定');
    return {
      title,
      startDate,
      endDate,
      weekNo: lessonNo,
      term: weekTerm(lessonNo),
      category: type === 'lesson_schedule' ? 'lesson' : 'curriculum',
      audience: type === 'lesson_schedule' ? 'all' : 'parent',
      grade,
      subject,
      unit,
      courseName: unit || subject,
      lessonNo,
      schoolId: pick(row, SCHOOL_KEYS) || null,
      notes: pick(row, NOTE_KEYS),
      raw: row,
    };
  });
};

const deleteCollectionQuery = async (
  query: FirebaseFirestore.Query,
  shouldDelete: (data: FirebaseFirestore.DocumentData) => boolean = () => true,
) => {
  let deleted = 0;
  const snap = await query.get();
  const targets = snap.docs.filter(doc => shouldDelete(doc.data()));
  for (let i = 0; i < targets.length; i += 400) {
    const chunk = targets.slice(i, i + 400);
    const batch = adminDb().batch();
    chunk.forEach(doc => batch.delete(doc.ref));
    await batch.commit();
    deleted += chunk.length;
  }
  return deleted;
};

export async function POST(request: NextRequest) {
  try {
    const user = await getServerUser(request);
    if (user.role !== 'master') throw new Error('forbidden');

    const body = await request.json();
    const type = String(body.type || '') as ImportType;
    let rows = Array.isArray(body.rows) ? body.rows : [];
    let matrix = isMatrix(body.matrix) ? body.matrix : [];
    const defaultYear = Number(body.year || new Date().getFullYear());
    if (!['lesson_schedule', 'curriculum'].includes(type)) {
      return Response.json({ ok: false, error: 'type must be lesson_schedule or curriculum' }, { status: 400 });
    }

    const sheetUrl = String(body.sheet_url || body.sheetUrl || '').trim();
    if (sheetUrl && rows.length === 0 && matrix.length === 0) {
      const csvUrl = googleSheetCsvUrl(sheetUrl);
      const csvRes = await fetch(csvUrl, { redirect: 'follow' });
      const contentType = csvRes.headers.get('content-type') || '';
      const text = (await csvRes.text()).replace(/^\uFEFF/, '');
      if (!csvRes.ok || contentType.includes('text/html') || /accounts\.google\.com|ServiceLogin|InteractiveLogin/i.test(text)) {
        return Response.json({
          ok: false,
          error: 'GoogleシートをCSVとして取得できませんでした。シートの共有設定を「リンクを知っている全員が閲覧可」にするか、CSVとして保存してアップロードしてください。',
        }, { status: 400 });
      }
      const parsed = parseCsv(text);
      rows = parsed.rows;
      matrix = parsed.matrix;
    }

    if (rows.length === 0 && matrix.length === 0) return Response.json({ ok: false, error: 'rows is required' }, { status: 400 });

    const db = adminDb();
    const collectionName = type === 'lesson_schedule' ? 'annual_lesson_schedules' : 'annual_curriculum_schedules';
    let curriculumDebug: CurriculumParseDebug | null = null;
    let normalizedRows: NormalizedRow[] = [];
    if (matrix.length > 0) {
      if (type === 'lesson_schedule') {
        normalizedRows = parseLessonCalendarMatrix(matrix, defaultYear);
      } else {
        const parsed = parseCurriculumMatrix(matrix);
        normalizedRows = parsed.rows;
        curriculumDebug = parsed.debug;
      }
    } else {
      normalizedRows = normalizeGenericRows(type, rows as Record<string, unknown>[], defaultYear);
    }
    if (normalizedRows.length === 0 && rows.length > 0) {
      normalizedRows = normalizeGenericRows(type, rows as Record<string, unknown>[], defaultYear);
      curriculumDebug = null;
    }
    if (normalizedRows.length === 0) {
      return Response.json({ ok: false, error: 'CSV形式を判定できませんでした。指定の年間授業予定またはカリキュラム原案CSVを選択してください。' }, { status: 400 });
    }

    const deletedAnnual = await deleteCollectionQuery(db.collection(collectionName).where('year', '==', defaultYear));
    let deletedRelated = 0;
    if (type === 'lesson_schedule') {
      deletedRelated += await deleteCollectionQuery(
        db.collection('monthly_schedules').where('year', '==', defaultYear),
        data => data.schedule_source === type,
      );
    } else {
      deletedRelated += await deleteCollectionQuery(db.collection('course_registration_options')
        .where('year', '==', defaultYear));
    }

    const lessonSnap = type === 'curriculum'
      ? await db.collection('annual_lesson_schedules').where('year', '==', defaultYear).get().catch(() => ({ docs: [] as any[] }))
      : { docs: [] as any[] };
    const weekStartDates = new Map<string, string>();
    lessonSnap.docs.forEach((doc: any) => {
      const data = doc.data();
      const weekNo = String(data.week_no || '');
      const date = String(data.start_date || data.target_date || '');
      if (weekNo && date && (!weekStartDates.has(weekNo) || date < (weekStartDates.get(weekNo) || ''))) {
        weekStartDates.set(weekNo, date);
      }
    });
    const termStartDates = new Map<string, string>();
    ['term1', 'term2', 'term3'].forEach(term => {
      const week = termStartWeek(term);
      if (weekStartDates.has(week)) termStartDates.set(term, weekStartDates.get(week)!);
    });
    const configuredTermSnap = await db.collection('curriculum_terms').where('year', '==', defaultYear).get().catch(() => ({ docs: [] as any[] }));
    const configuredTerms = configuredTermSnap.docs.map((doc: any) => ({ id: doc.id.replace(`${defaultYear}_`, ''), ...doc.data() }));

    const now = FieldValue.serverTimestamp();
    let imported = 0;
    let skipped = 0;
    let batch = db.batch();
    let writes = 0;
    const writtenOptionIds = new Set<string>();

    const commitIfNeeded = async (force = false) => {
      if (writes > 0 && (force || writes >= 240)) {
        await batch.commit();
        batch = db.batch();
        writes = 0;
      }
    };

    for (const row of normalizedRows) {
      const startDate = row.startDate || '';
      const endDate = row.endDate || startDate;
      if (type === 'lesson_schedule' && (!startDate || endDate < startDate)) {
        skipped += 1;
        continue;
      }

      const subject = row.subject || '';
      const grade = row.grade || '';
      const unit = row.unit || '';
      const weekNo = row.weekNo || row.lessonNo || '';
      const configuredTerm = resolveConfiguredTerm(weekNo, configuredTerms, grade);
      const term = configuredTerm?.id || row.term || weekTerm(weekNo);
      const title = row.title;
      const schoolId = row.schoolId || null;
      const notes = row.notes || '';
      const termStartDate = configuredTerm?.start_date || termStartDates.get(term) || weekStartDates.get(weekNo) || '';
      const registrationOpensAt = configuredTerm?.registration_opens_at || (termStartDate ? (() => {
        const d = new Date(`${termStartDate}T00:00:00+09:00`);
        d.setDate(d.getDate() - 7);
        return d.toISOString().slice(0, 10);
      })() : '');
      const displayTermLabel = configuredTerm?.label || termLabel(term);
      const idBase = `${type}_${startDate || row.monthLabel || defaultYear}_${weekNo}_${grade}_${subject}_${row.courseName || unit || title}`;
      const docId = sanitizeId(idBase);
      const docRef = db.collection(collectionName).doc(docId);
      const monthlyRef = db.collection('monthly_schedules').doc(`import_${docId}`);

      const commonData = {
        type,
        title,
        start_date: startDate || null,
        end_date: endDate || null,
        target_date: startDate || null,
        year: defaultYear,
        grade,
        grades: grade ? splitList(grade) : [],
        subject,
        unit,
        course_name: row.courseName || '',
        lesson_no: row.lessonNo || weekNo,
        week_no: weekNo,
        term,
        term_label: displayTermLabel,
        term_start_date: termStartDate || null,
        registration_opens_at: registrationOpensAt || null,
        month_label: row.monthLabel || '',
        school_id: schoolId,
        notes,
        raw: row.raw,
        source: 'csv_import',
        imported_by: user.uid,
        updated_at: now,
      };

      batch.set(docRef, { ...commonData, created_at: now }, { merge: true });
      writes += 1;
      if (type === 'lesson_schedule') {
        batch.set(monthlyRef, {
          ...Object.fromEntries(Object.entries(commonData).filter(([key]) => key !== 'raw')),
          description: notes || [subject, grade, unit].filter(Boolean).join(' / '),
          category: row.category || 'lesson',
          audience: row.audience || 'all',
          archived: false,
          schedule_source: type,
          source_id: docRef.id,
          created_by: user.uid,
          created_by_role: user.role,
          created_at: now,
        }, { merge: true });
        writes += 1;
      } else {
        const optionId = sanitizeId(`${defaultYear}_${term}_${grade}_${subject}_${row.courseName || subject}`);
        if (!writtenOptionIds.has(optionId)) {
          writtenOptionIds.add(optionId);
          batch.set(db.collection('course_registration_options').doc(optionId), {
            year: defaultYear,
            term,
            term_label: displayTermLabel,
            term_start_date: termStartDate || null,
            registration_opens_at: registrationOpensAt || null,
            grade,
            subject,
            course_name: row.courseName || subject || '講座',
            title: `${displayTermLabel} ${grade} ${row.courseName || subject || '講座'}`,
            is_active: true,
            source: 'curriculum_import',
            updated_at: now,
            created_at: now,
          }, { merge: true });
          writes += 1;
        }
      }
      imported += 1;
      await commitIfNeeded();
    }

    await commitIfNeeded(true);

    const eventId = await writeLearningEvent({
      actor_id: user.uid,
      actor_role: user.role,
      type: 'annual_schedule_csv_imported',
      target_type: collectionName,
      school: user.school,
      metadata: {
        type,
        imported,
        skipped,
        year: defaultYear,
        deleted_annual: deletedAnnual,
        deleted_related: deletedRelated,
        replace: true,
        parser_mode: curriculumDebug?.mode || null,
        imported_by_grade: curriculumDebug?.imported_by_grade || countRowsBy(normalizedRows, 'grade'),
        imported_by_subject: curriculumDebug?.imported_by_subject || countRowsBy(normalizedRows, 'subject'),
      },
    });

    revalidateTag('course-registration-options');

    return Response.json({
      ok: true,
      imported,
      skipped,
      deleted_annual: deletedAnnual,
      deleted_related: deletedRelated,
      replace: true,
      event_id: eventId,
      parser_mode: curriculumDebug?.mode || null,
      detected_blocks: curriculumDebug?.detected_blocks || [],
      detected_columns: curriculumDebug?.detected_columns || [],
      imported_by_grade: curriculumDebug?.imported_by_grade || countRowsBy(normalizedRows, 'grade'),
      imported_by_subject: curriculumDebug?.imported_by_subject || countRowsBy(normalizedRows, 'subject'),
    });
  } catch (error) {
    return jsonError(error);
  }
}
