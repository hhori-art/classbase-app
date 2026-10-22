import crypto from 'crypto';
import { NextRequest } from 'next/server';
import { FieldValue } from 'firebase-admin/firestore';
import { adminDb } from '@/lib/firebase-admin';
import { getServerUser, isAdminLike, jsonError, requireRole } from '@/lib/server-auth';
import { writeAuditLog } from '@/lib/server/audit-log';
import { learningCompleted, normalizePfHeader, numericScore, parsePfCsv, type PfLearningKind } from '@/lib/pf-analytics';
import { getAllQueryDocuments } from '@/lib/server/firestore-pagination';
import { jstDateKey, weekdayFromDateKey } from '@/lib/date-key';
import { collectMonoxerStudy, mergeStudySnapshot, monoxerStudyColumns, normalizeStudentNumber } from '@/lib/monoxer-study';

export const runtime = 'nodejs';

const MAX_CSV_BYTES = 8 * 1024 * 1024;
// 宿題回数ログ（生徒 × Book の累計）は1万行を超えるので、行数の上限は大きめにする。
const MAX_CSV_ROWS = 50_001;
const clean = (value: unknown) => String(value || '').trim();
const schoolOf = (data: Record<string, any>) => clean(data.school_id || data.school || data.classroom || data.classroom_name);
const nameOf = (data: Record<string, any>) => clean(data.student_name || data.name || data.display_name || data.displayName).replace(/[\s　]/g, '');
const idOf = (data: Record<string, any>) => clean(data.lifetime_id || data.login_id || data.student_code || data.user_code);

const aliases = {
  id: ['生涯番号', '生徒番号', 'ユーザーid', 'ユーザー番号', 'studentid', 'userid', 'loginid', 'id'],
  name: ['氏名', '生徒氏名', 'ユーザー名', '名前', 'studentname', 'username', 'name'],
  date: ['実施日', '学習日', '提出日', '完了日', '受験日', '日付', 'date', 'completedat'],
  kind: ['種別', '種類', 'カテゴリ', 'category', 'type', 'kind'],
  title: ['課題名', '小テスト名', '教材名', 'コンテンツ名', 'タイトル', 'task', 'content', 'title'],
  status: ['提出状況', '実施状況', '完了状況', 'ステータス', '進捗', 'status', 'completed'],
  score: ['正答率', '得点率', 'スコア', '得点', 'score', 'accuracy'],
  school: ['校舎', '教室', '所属校舎', 'school', 'classroom'],
};

const normalizedAliases = Object.fromEntries(Object.entries(aliases).map(([key, values]) => [key, values.map(normalizePfHeader)]));

const columnIndex = (headers: string[], key: keyof typeof aliases) => {
  const values = normalizedAliases[key];
  return headers.findIndex(header => values.includes(normalizePfHeader(header)));
};

const normalizeDate = (value: unknown, fallback: string) => {
  const raw = clean(value).normalize('NFKC');
  const match = raw.match(/(20\d{2})[年/.-](\d{1,2})[月/.-](\d{1,2})/);
  if (!match) return fallback;
  const candidate = `${match[1]}-${String(Number(match[2])).padStart(2, '0')}-${String(Number(match[3])).padStart(2, '0')}`;
  return weekdayFromDateKey(candidate) ? candidate : fallback;
};

const detectKind = (requested: unknown, ...values: unknown[]): PfLearningKind => {
  if (requested === 'homework' || requested === 'quiz') return requested;
  const text = values.map(clean).join(' ');
  return /(小テスト|確認テスト|quiz|test)/i.test(text) ? 'quiz' : 'homework';
};

export async function POST(request: NextRequest) {
  try {
    const actor = await getServerUser(request);
    requireRole(actor, ['master', 'admin']);
    if (!isAdminLike(actor)) throw new Error('forbidden');
    const body = await request.json();
    const csvText = String(body.csv_text || '');
    if (!csvText || Buffer.byteLength(csvText, 'utf8') > MAX_CSV_BYTES) {
      return Response.json({ ok: false, error: 'CSVは8MB以下にしてください。' }, { status: 413 });
    }
    const rows = parsePfCsv(csvText);
    if (rows.length > MAX_CSV_ROWS) {
      return Response.json({ ok: false, error: 'CSVはヘッダーを含め50,001行以内にしてください。' }, { status: 413 });
    }
    if (rows.some(row => row.length > 100 || row.some(cell => Buffer.byteLength(String(cell || ''), 'utf8') > 4_000))) {
      return Response.json({ ok: false, error: 'CSVの列数またはセルの文字数が上限を超えています。' }, { status: 400 });
    }
    const studyHeaderIndex = rows.slice(0, 12).findIndex(row => monoxerStudyColumns(row) !== null);
    if (studyHeaderIndex >= 0) {
      return await importStudyCounts(actor, body, rows, studyHeaderIndex);
    }
    if (rows.length > 10_001) {
      return Response.json({ ok: false, error: 'CSVはヘッダーを含め10,001行以内にしてください。' }, { status: 413 });
    }
    const headerIndex = rows.slice(0, 12).findIndex(row => {
      const headers = row.map(normalizePfHeader);
      return headers.some(header => normalizedAliases.id.includes(header) || normalizedAliases.name.includes(header));
    });
    if (headerIndex < 0) {
      return Response.json({ ok: false, error: 'CSVに「生涯番号」または「氏名」の列が必要です。' }, { status: 400 });
    }
    const headers = rows[headerIndex];
    const indexes = {
      id: columnIndex(headers, 'id'),
      name: columnIndex(headers, 'name'),
      date: columnIndex(headers, 'date'),
      kind: columnIndex(headers, 'kind'),
      title: columnIndex(headers, 'title'),
      status: columnIndex(headers, 'status'),
      score: columnIndex(headers, 'score'),
      school: columnIndex(headers, 'school'),
    };
    if (indexes.id < 0 && indexes.name < 0) throw new Error('student-identifier-column-missing');

    const db = adminDb();
    const studentDocs = await getAllQueryDocuments(db.collection('users').where('role', '==', 'student'));
    const students = studentDocs.map(doc => ({ id: doc.id, ...doc.data() } as any));
    const byId = new Map<string, any[]>();
    const names = new Map<string, any[]>();
    students.forEach(student => {
      const id = idOf(student);
      if (id) byId.set(id, [...(byId.get(id) || []), student]);
      const name = nameOf(student);
      if (name) names.set(name, [...(names.get(name) || []), student]);
    });
    const allowedSchools = actor.role === 'master'
      ? null
      : new Set([...(actor.school_ids || []), actor.school].map(clean).filter(Boolean));
    if (actor.role === 'admin' && (!allowedSchools || allowedSchools.size === 0)) throw new Error('forbidden');
    const fallbackDate = weekdayFromDateKey(body.target_date)
      ? String(body.target_date)
      : jstDateKey();
    const importId = crypto.randomUUID();
    let batch = db.batch();
    let batchCount = 0;
    let imported = 0;
    let unmatched = 0;
    let forbiddenSchool = 0;
    const warnings: string[] = [];
    const commit = async () => {
      if (!batchCount) return;
      await batch.commit();
      batch = db.batch();
      batchCount = 0;
    };

    for (let index = headerIndex + 1; index < rows.length; index++) {
      const row = rows[index];
      if (!row.some(Boolean)) continue;
      const externalId = indexes.id >= 0 ? clean(row[indexes.id]) : '';
      const normalizedName = indexes.name >= 0 ? clean(row[indexes.name]).replace(/[\s　]/g, '') : '';
      const nameMatches = normalizedName ? names.get(normalizedName) || [] : [];
      const idMatches = externalId ? byId.get(externalId) || [] : [];
      const student = idMatches.length === 1 ? idMatches[0] : (idMatches.length === 0 && nameMatches.length === 1 ? nameMatches[0] : null);
      if (!student) {
        unmatched++;
        if (warnings.length < 8) warnings.push(`${index + 1}行目: 生徒を一意に特定できません（${externalId || normalizedName || '識別子なし'}）`);
        continue;
      }
      if (externalId && normalizedName && nameOf(student) !== normalizedName) {
        unmatched++;
        if (warnings.length < 8) warnings.push(`${index + 1}行目: 生涯番号と氏名が一致しません（${externalId} / ${normalizedName}）`);
        continue;
      }
      if (allowedSchools && allowedSchools.size > 0 && !allowedSchools.has(schoolOf(student))) {
        forbiddenSchool++;
        continue;
      }
      const rawKind = indexes.kind >= 0 ? row[indexes.kind] : '';
      const title = indexes.title >= 0 ? clean(row[indexes.title]) : '';
      const status = indexes.status >= 0 ? clean(row[indexes.status]) : '';
      const score = indexes.score >= 0 ? numericScore(row[indexes.score]) : null;
      const kind = detectKind(body.kind, rawKind, title);
      const date = normalizeDate(indexes.date >= 0 ? row[indexes.date] : '', fallbackDate);
      const completed = status ? learningCompleted(status) : score !== null;
      const stableKey = [student.id, date, kind, title || `row-${index + 1}`].join('|');
      const docId = crypto.createHash('sha1').update(stableKey).digest('hex');
      batch.set(db.collection('pf_learning_records').doc(docId), {
        student_id: student.id,
        lifetime_id: idOf(student) || externalId,
        student_name: clean(student.student_name || student.name),
        school_id: schoolOf(student) || (indexes.school >= 0 ? clean(row[indexes.school]) : ''),
        grade: clean(student.grade),
        date,
        kind,
        title: title || (kind === 'quiz' ? '小テスト' : '宿題'),
        status: status || (completed ? '完了' : '未完了'),
        completed,
        score,
        source: 'monoxer_csv',
        source_file_name: clean(body.file_name).slice(0, 240),
        source_row: index + 1,
        import_id: importId,
        imported_by: actor.uid,
        imported_at: FieldValue.serverTimestamp(),
        updated_at: FieldValue.serverTimestamp(),
      }, { merge: true });
      imported++;
      batchCount++;
      if (batchCount >= 400) await commit();
    }
    await commit();

    await db.collection('pf_import_logs').doc(importId).set({
      file_name: clean(body.file_name).slice(0, 240),
      kind: clean(body.kind || 'auto'),
      target_date: fallbackDate,
      imported,
      unmatched,
      forbidden_school: forbiddenSchool,
      actor_id: actor.uid,
      actor_role: actor.role,
      created_at: FieldValue.serverTimestamp(),
    });

    await writeAuditLog({
      actor,
      action: 'pf_import',
      target_type: 'pf_import',
      target_id: importId,
      target_label: clean(body.file_name).slice(0, 240),
      details: { kind: clean(body.kind || 'auto'), target_date: fallbackDate, imported_count: imported, unmatched_count: unmatched, forbidden_school_count: forbiddenSchool },
    });

    return Response.json({ ok: true, import_id: importId, imported, unmatched, forbidden_school: forbiddenSchool, warnings });
  } catch (error) {
    return jsonError(error);
  }
}

/**
 * Monoxer「宿題回数ログ」（生徒 × Book の累計学習回数）の取り込み。
 * 生徒番号（= 生涯番号）だけで照合し、生徒ごとに pf_study_progress/{生徒ID} へ累計と、前回からの増えた回数を残す。
 */
async function importStudyCounts(
  actor: Awaited<ReturnType<typeof getServerUser>>,
  body: Record<string, any>,
  rows: string[][],
  headerIndex: number,
) {
  const columns = monoxerStudyColumns(rows[headerIndex])!;
  const { students: csvStudents, invalidRows } = collectMonoxerStudy(rows, headerIndex, columns);
  const snapshotDate = weekdayFromDateKey(body.target_date) ? String(body.target_date) : jstDateKey();
  if (snapshotDate > jstDateKey()) {
    return Response.json({ ok: false, error: '出力日に未来の日付は指定できません。' }, { status: 400 });
  }

  const db = adminDb();
  const studentDocs = await getAllQueryDocuments(db.collection('users').where('role', '==', 'student'));
  const byNumber = new Map<string, any[]>();
  studentDocs.forEach(doc => {
    const student = { id: doc.id, ...doc.data() } as any;
    const number = normalizeStudentNumber(idOf(student));
    if (number) byNumber.set(number, [...(byNumber.get(number) || []), student]);
  });
  const allowedSchools = actor.role === 'master'
    ? null
    : new Set([...(actor.school_ids || []), actor.school].map(clean).filter(Boolean));
  if (actor.role === 'admin' && (!allowedSchools || allowedSchools.size === 0)) throw new Error('forbidden');

  const importId = crypto.randomUUID();
  const matched: Array<{ student: any; books: Record<string, any> }> = [];
  let unmatched = 0;
  let duplicated = 0;
  let forbiddenSchool = 0;
  const unmatchedSamples: string[] = [];
  csvStudents.forEach(entry => {
    const candidates = byNumber.get(entry.studentNumber) || [];
    if (candidates.length !== 1) {
      if (candidates.length > 1) duplicated++; else unmatched++;
      if (unmatchedSamples.length < 8) unmatchedSamples.push(`${entry.studentNumber}${entry.displayName ? `（${entry.displayName}）` : ''}${candidates.length > 1 ? '：同じ生涯番号の生徒が複数います' : ''}`);
      return;
    }
    const student = candidates[0];
    if (allowedSchools && !allowedSchools.has(schoolOf(student))) {
      forbiddenSchool++;
      return;
    }
    matched.push({ student, books: entry.books });
  });

  let imported = 0;
  let skippedOlder = 0;
  for (let offset = 0; offset < matched.length; offset += 300) {
    const chunk = matched.slice(offset, offset + 300);
    const refs = chunk.map(item => db.collection('pf_study_progress').doc(item.student.id));
    const snapshots = refs.length ? await db.getAll(...refs) : [];
    const batch = db.batch();
    chunk.forEach((item, index) => {
      const previous = snapshots[index]?.exists ? snapshots[index].data() || {} : null;
      const merged = mergeStudySnapshot(previous, { date: snapshotDate, books: item.books, importId });
      if (!merged) {
        skippedOlder++;
        return;
      }
      batch.set(refs[index], {
        student_id: item.student.id,
        lifetime_id: idOf(item.student),
        student_name: clean(item.student.student_name || item.student.name),
        school_id: schoolOf(item.student),
        grade: clean(item.student.grade),
        ...merged,
        source: 'monoxer_study_csv',
        source_file_name: clean(body.file_name).slice(0, 240),
        import_id: importId,
        imported_by: actor.uid,
        updated_at: FieldValue.serverTimestamp(),
      });
      imported++;
    });
    await batch.commit();
  }

  const warnings = [
    ...(unmatchedSamples.length ? [`アプリに登録されていない生徒番号（例）：${unmatchedSamples.join('、')}`] : []),
    ...(skippedOlder ? [`${skippedOlder}名は、この日付より新しい取り込みがあるため更新していません。`] : []),
    ...(invalidRows ? [`${invalidRows}行は生徒番号・Book ID・学習回数が読み取れないため飛ばしました。`] : []),
  ];
  await db.collection('pf_import_logs').doc(importId).set({
    file_name: clean(body.file_name).slice(0, 240),
    kind: 'monoxer_study_counts',
    target_date: snapshotDate,
    csv_students: csvStudents.size,
    imported,
    unmatched,
    duplicated,
    forbidden_school: forbiddenSchool,
    skipped_older: skippedOlder,
    invalid_rows: invalidRows,
    actor_id: actor.uid,
    actor_role: actor.role,
    created_at: FieldValue.serverTimestamp(),
  });
  await writeAuditLog({
    actor,
    action: 'pf_import',
    target_type: 'pf_import',
    target_id: importId,
    target_label: clean(body.file_name).slice(0, 240),
    details: {
      kind: 'monoxer_study_counts', target_date: snapshotDate, csv_student_count: csvStudents.size, imported_count: imported,
      unmatched_count: unmatched, duplicated_count: duplicated, forbidden_school_count: forbiddenSchool,
      skipped_older_count: skippedOlder, invalid_row_count: invalidRows,
    },
  });
  return Response.json({
    ok: true,
    mode: 'study_counts',
    import_id: importId,
    snapshot_date: snapshotDate,
    csv_students: csvStudents.size,
    imported,
    unmatched,
    duplicated,
    forbidden_school: forbiddenSchool,
    skipped_older: skippedOlder,
    invalid_rows: invalidRows,
    warnings,
  });
}
