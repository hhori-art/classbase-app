/**
 * Monoxer「宿題回数ログ」CSV（生徒 × クラス × Book ごとの累計学習回数）の読み取りと集計。
 *
 * 列：スクールID, スクール名, クラスID, クラス名, 生徒番号, 表示名, Book ID, Book名, 学習回数
 * - 日付の列はない。1ファイル＝出力した時点の累計（スナップショット）。
 * - 期間ごとの宿題量は「前回取り込んだ累計との差」で数える。
 * - 同じ生徒・同じBookが学年クラスと科目クラスの両方に出ることがあるので、生徒 × Book でまとめる。
 */

export type MonoxerStudyBook = { name: string; count: number; classes: string[] };
export type MonoxerStudyStudent = { studentNumber: string; displayName: string; books: Record<string, MonoxerStudyBook> };
export type MonoxerStudyHistoryEntry = { date: string; total: number; gained: number | null; books_studied: number | null; import_id: string };

/** 見出し・値の表記ゆれ（全角半角・BOM・前後の空白や引用符）をそろえる。 */
export const normalizeMonoxerText = (value: unknown) => String(value ?? '')
  .replace(/﻿/g, '')
  .normalize('NFKC')
  .replace(/^["'\s]+|["'\s]+$/g, '')
  .replace(/\s+/g, ' ')
  .trim();

const headerKey = (value: unknown) => normalizeMonoxerText(value).toLowerCase().replace(/[\s_\-]/g, '');

const STUDY_HEADERS = {
  studentNumber: ['生徒番号', '生涯番号'],
  displayName: ['表示名', '氏名', '生徒氏名'],
  bookId: ['bookid'],
  bookName: ['book名', 'bookname'],
  count: ['学習回数'],
  className: ['クラス名'],
};

/** 見出し行が「宿題回数ログ」形式なら列番号を返す。 */
export function monoxerStudyColumns(headers: string[]) {
  const keys = headers.map(headerKey);
  const find = (names: string[]) => keys.findIndex(key => names.includes(key));
  const columns = {
    studentNumber: find(STUDY_HEADERS.studentNumber),
    displayName: find(STUDY_HEADERS.displayName),
    bookId: find(STUDY_HEADERS.bookId),
    bookName: find(STUDY_HEADERS.bookName),
    count: find(STUDY_HEADERS.count),
    className: find(STUDY_HEADERS.className),
  };
  return columns.studentNumber >= 0 && columns.bookId >= 0 && columns.count >= 0 ? columns : null;
}

/** 生徒番号の表記ゆれ（全角数字・Excelで付く「.0」）をそろえる。 */
export const normalizeStudentNumber = (value: unknown) => normalizeMonoxerText(value).replace(/\.0+$/, '').replace(/\s/g, '');

/** CSVの行を生徒 × Book にまとめる。同じBookが複数クラスに出たら、回数は大きいほう（同じ値のはず）を使う。 */
export function collectMonoxerStudy(rows: string[][], headerIndex: number, columns: NonNullable<ReturnType<typeof monoxerStudyColumns>>) {
  const students = new Map<string, MonoxerStudyStudent>();
  let invalidRows = 0;
  for (let index = headerIndex + 1; index < rows.length; index++) {
    const row = rows[index];
    const studentNumber = normalizeStudentNumber(row[columns.studentNumber]);
    const bookId = normalizeMonoxerText(row[columns.bookId]);
    const count = Number(normalizeMonoxerText(row[columns.count]).replace(/,/g, ''));
    if (!studentNumber || !bookId || !Number.isFinite(count) || count < 0) {
      invalidRows++;
      continue;
    }
    const student = students.get(studentNumber) || { studentNumber, displayName: '', books: {} };
    if (!student.displayName && columns.displayName >= 0) student.displayName = normalizeMonoxerText(row[columns.displayName]);
    const book = student.books[bookId] || { name: '', count: 0, classes: [] };
    book.name = book.name || (columns.bookName >= 0 ? normalizeMonoxerText(row[columns.bookName]).slice(0, 160) : '');
    book.count = Math.max(book.count, Math.round(count));
    const className = columns.className >= 0 ? normalizeMonoxerText(row[columns.className]).slice(0, 80) : '';
    if (className && !book.classes.includes(className) && book.classes.length < 5) book.classes.push(className);
    student.books[bookId] = book;
    students.set(studentNumber, student);
  }
  return { students, invalidRows };
}

export const totalStudyCount = (books: Record<string, { count: number }>) =>
  Object.values(books || {}).reduce((sum, book) => sum + (Number(book?.count) || 0), 0);

/**
 * 前回の累計（baseline）から今回の累計までに増えた回数。Bookごとに差を取り、減った分は0として扱う。
 * baseline が無い（初めての取り込み）ときは null。
 */
export function studyGain(current: Record<string, { count: number }>, baseline: Record<string, { count: number }> | null) {
  if (!baseline) return { gained: null, booksStudied: null };
  let gained = 0;
  let booksStudied = 0;
  Object.entries(current).forEach(([bookId, book]) => {
    const diff = Math.max(0, (Number(book.count) || 0) - (Number(baseline[bookId]?.count) || 0));
    gained += diff;
    if (diff > 0) booksStudied++;
  });
  return { gained, booksStudied };
}

/**
 * 既存の進捗ドキュメントに今回のスナップショットを重ねる。
 * - 同じ日に取り込み直したら、その日の記録を置き換える（差は前回の日付の累計と比べる）
 * - すでにより新しい日の取り込みがあるときは古いファイルとして扱わない（null）
 */
export function mergeStudySnapshot(previous: Record<string, any> | null, snapshot: { date: string; books: Record<string, MonoxerStudyBook>; importId: string }) {
  const lastDate = String(previous?.last_snapshot_date || '');
  if (lastDate && snapshot.date < lastDate) return null;
  const sameDay = Boolean(lastDate && snapshot.date === lastDate);
  const baselineBooks: Record<string, MonoxerStudyBook> | null = sameDay
    ? (previous?.previous_books || null)
    : (previous?.books || null);
  const baselineDate = sameDay ? String(previous?.previous_snapshot_date || '') : lastDate;
  const { gained, booksStudied } = studyGain(snapshot.books, baselineBooks);
  const history: MonoxerStudyHistoryEntry[] = (Array.isArray(previous?.history) ? previous!.history : [])
    .filter((entry: MonoxerStudyHistoryEntry) => entry && entry.date !== snapshot.date);
  history.push({ date: snapshot.date, total: totalStudyCount(snapshot.books), gained, books_studied: booksStudied, import_id: snapshot.importId });
  history.sort((a, b) => a.date.localeCompare(b.date));
  return {
    books: snapshot.books,
    previous_books: baselineBooks,
    previous_snapshot_date: baselineDate || null,
    last_snapshot_date: snapshot.date,
    total_count: totalStudyCount(snapshot.books),
    book_count: Object.keys(snapshot.books).length,
    history: history.slice(-104),
  };
}

/** 期間 [start, end] の宿題（学習回数）のまとめ。取り込みが無い期間は measured=false。 */
export function studySummaryForRange(progress: Record<string, any> | null | undefined, start: string, end: string) {
  const history: MonoxerStudyHistoryEntry[] = Array.isArray(progress?.history) ? progress!.history : [];
  const inRange = history.filter(entry => entry.date >= start && entry.date <= end);
  const measured = inRange.filter(entry => entry.gained !== null);
  const latest = [...history].reverse().find(entry => entry.date <= end) || null;
  return {
    measured: measured.length > 0,
    period_count: measured.length ? measured.reduce((sum, entry) => sum + (Number(entry.gained) || 0), 0) : null,
    books_studied: measured.length ? Math.max(...measured.map(entry => Number(entry.books_studied) || 0)) : null,
    total_count: latest ? latest.total : null,
    last_snapshot_date: latest ? latest.date : null,
  };
}
