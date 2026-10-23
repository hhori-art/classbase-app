import { NextRequest } from 'next/server';
import { FieldValue } from 'firebase-admin/firestore';
import { adminDb } from '@/lib/firebase-admin';
import { canManageSchool, getServerUser, isAdminLike, jsonError } from '@/lib/server-auth';
import { writeAuditLog } from '@/lib/server/audit-log';
import { prepareAuthAccountCredentials } from '@/lib/server/account-credentials';
import { writeLearningEvent } from '@/lib/events';
import { generateInitialPassword } from '@/lib/password';
import { anonymousParentName, anonymousStudentName, isNoPersonalInfoSchool } from '@/lib/no-personal-info-schools';

export const runtime = 'nodejs';
export const maxDuration = 60;

// 1回の要求で扱う生徒数の上限（60秒以内に収めるため）。画面側は lib/csv-chunks.ts で分割して送る。
const MAX_ROWS_PER_REQUEST = 40;
// 生徒・保護者の Auth アカウント作成を並列で行う数（Auth のレート制限に配慮）。
const IMPORT_CONCURRENCY = 4;

async function mapWithConcurrency<T>(items: T[], limit: number, worker: (item: T) => Promise<void>) {
  let cursor = 0;
  const runners = Array.from({ length: Math.min(limit, items.length) }, async () => {
    while (cursor < items.length) {
      const item = items[cursor++];
      await worker(item);
    }
  });
  await Promise.all(runners);
}

function parseCsv(text: string) {
  const rows: string[][] = [];
  let current = '';
  let row: string[] = [];
  let inQuotes = false;

  for (let i = 0; i < text.length; i++) {
    const char = text[i];
    const next = text[i + 1];
    if (char === '"' && inQuotes && next === '"') {
      current += '"';
      i++;
    } else if (char === '"') {
      inQuotes = !inQuotes;
    } else if (char === ',' && !inQuotes) {
      row.push(current.trim());
      current = '';
    } else if ((char === '\n' || char === '\r') && !inQuotes) {
      if (char === '\r' && next === '\n') i++;
      row.push(current.trim());
      if (row.some(cell => cell !== '')) rows.push(row);
      row = [];
      current = '';
    } else {
      current += char;
    }
  }

  row.push(current.trim());
  if (row.some(cell => cell !== '')) rows.push(row);
  return rows;
}

function cleanCell(value: unknown) {
  return String(value || '').replace(/^"|"$/g, '').trim();
}

function normalizeGrade(value: string) {
  return cleanCell(value)
    .replace(/[★☆◆◇●○\s]/g, '')
    .replace(/[Ａ-Ｚａ-ｚ０-９]/g, s => String.fromCharCode(s.charCodeAt(0) - 0xFEE0));
}

function normalizeCourseStartMonth(value: unknown, fallback = '') {
  const text = cleanCell(value).normalize('NFKC');
  if (!text) return fallback;
  const separated = text.match(/^(\d{4})[/.\-年](\d{1,2})(?:月)?$/);
  if (separated) return `${separated[1]}-${separated[2].padStart(2, '0')}`;
  const compact = text.match(/^(\d{4})(\d{2})$/);
  if (compact) return `${compact[1]}-${compact[2]}`;
  return text;
}

function findHeaderIndex(rows: string[][]) {
  return rows.findIndex((row, index) => index < 25 && row.some(cell => cell.includes('生涯番号') || cell.includes('ログインID') || cell === 'ID'));
}

function indexOf(header: string[], patterns: string[]) {
  return header.findIndex(cell => patterns.some(pattern => cell.includes(pattern)));
}

export async function POST(request: NextRequest) {
  try {
    const actor = await getServerUser(request);
    if (!isAdminLike(actor)) throw new Error('forbidden');

    const body = await request.json();
    const csvText = String(body.csv_text || '');
    const requestedSchool = String(body.school_id || body.school || '').trim();
    const school = requestedSchool || actor.school_ids[0] || actor.school || '';
    const requestedDefaultPassword = String(body.default_password || '').trim();
    const defaultCourseStartMonth = normalizeCourseStartMonth(body.default_course_start_month);
    const importFileName = String(body.file_name || '校舎別生徒アカウント.csv').trim().slice(0, 240);
    // 分割して送るときは同じキーで1つの取込履歴にまとめる（他人の履歴に書き込めないよう actor の uid を前に付ける）。
    const importKey = String(body.import_key || '').replace(/[^A-Za-z0-9_-]/g, '').slice(0, 64);
    const rowOffset = Math.max(0, Math.min(100000, Number(body.row_offset) || 0));

    if (!csvText.trim()) return Response.json({ ok: false, error: 'csv_text is required' }, { status: 400 });
    if (!school) return Response.json({ ok: false, error: 'school is required' }, { status: 400 });
    if (!canManageSchool(actor, school)) throw new Error('forbidden');
    if (requestedDefaultPassword && requestedDefaultPassword.length < 6) return Response.json({ ok: false, error: 'password must be 6+ characters' }, { status: 400 });

    const rows = parseCsv(csvText.replace(/^\uFEFF/, ''));
    const headerIndex = findHeaderIndex(rows);
    if (headerIndex === -1) {
      const firstLine = (rows[0] || []).slice(0, 4).join(',').slice(0, 60);
      return Response.json({
        ok: false,
        error: `CSVヘッダーに「生涯番号」または「ログインID」が必要です（読み取った1行目: ${firstLine || '空'}）。文字化けしている場合は文字コードを切り替えてください。`,
      }, { status: 400 });
    }

    const header = rows[headerIndex].map(cleanCell);
    const idx = {
      id: indexOf(header, ['生涯番号', 'ログインID', 'ID']),
      grade: indexOf(header, ['学年']),
      classroom: indexOf(header, ['所属教室', '教室', 'クラス']),
      middleSchool: indexOf(header, ['中学校', '所属中学', '学校名']),
      courseStartMonth: indexOf(header, ['受講開始月', '開始月']),
      siblingGroup: indexOf(header, ['兄弟姉妹グループ', '兄弟グループ', '兄弟姉妹ID']),
      twinFlag: indexOf(header, ['双子', '双子フラグ']),
      password: indexOf(header, ['初期パスワード', 'パスワード']),
      parentPassword: indexOf(header, ['保護者初期パスワード', '保護者パスワード']),
      trialEvents: indexOf(header, ['体験授業', '体験イベント', 'イベント']),
      trialContinued: indexOf(header, ['継続', '継続フラグ']),
      lastName: header.findIndex(cell => cell === '氏'),
      firstName: header.findIndex(cell => cell === '名'),
      name: indexOf(header, ['氏名', '名前', '生徒名']),
      phone: indexOf(header, ['電話']),
      day: indexOf(header, ['曜日']),
      science: indexOf(header, ['理科']),
      social: indexOf(header, ['社会']),
      parentName: indexOf(header, ['保護者氏名', '保護者名', '保護者']),
      parentPhone: indexOf(header, ['保護者電話', '緊急連絡先']),
    };

    if (idx.id === -1) return Response.json({ ok: false, error: 'ID列が見つかりません' }, { status: 400 });

    const db = adminDb();
    const results: any[] = [];
    const errors: any[] = [];
    const preserved: { row: number; login_id: string }[] = [];
    const processed = new Set<string>();
    const siblingGroups = new Map<string, { uid: string; twin: boolean }[]>();

    const targets: { i: number; cols: string[]; loginId: string }[] = [];
    for (let i = headerIndex + 1; i < rows.length; i++) {
      const cols = rows[i].map(cleanCell);
      const loginId = cleanCell(cols[idx.id]);
      if (!loginId || processed.has(loginId)) continue;
      processed.add(loginId);
      targets.push({ i, cols, loginId });
    }
    if (targets.length > MAX_ROWS_PER_REQUEST) {
      return Response.json({ ok: false, error: `1回に取り込めるのは${MAX_ROWS_PER_REQUEST}名までです。画面を再読み込みしてからお試しください。` }, { status: 400 });
    }

    await mapWithConcurrency(targets, IMPORT_CONCURRENCY, async ({ i, cols, loginId }) => {
      try {
        let studentName = '';
        if (idx.lastName !== -1 || idx.firstName !== -1) {
          studentName = `${idx.lastName !== -1 ? cols[idx.lastName] || '' : ''} ${idx.firstName !== -1 ? cols[idx.firstName] || '' : ''}`.trim();
        }
        if (!studentName && idx.name !== -1) studentName = cols[idx.name] || '';
        if (!studentName) studentName = `生徒 ${loginId}`;
        // 個人情報を入れずにテストしている校舎では、CSVに氏名があっても生徒番号を名前にし、電話番号は取り込まない。
        const anonymous = isNoPersonalInfoSchool(school);
        if (anonymous) studentName = anonymousStudentName(loginId);

        const parentName = anonymous
          ? anonymousParentName(loginId)
          : idx.parentName !== -1 && cols[idx.parentName]
            ? cols[idx.parentName]
            : `${studentName} 保護者`;
        const parentLoginId = `${loginId}P`;
        const siblingGroup = idx.siblingGroup !== -1 ? cleanCell(cols[idx.siblingGroup]) : '';
        const twin = idx.twinFlag !== -1 && ['1', 'true', 'TRUE', '○', '〇', '有', 'はい', '双子'].includes(cleanCell(cols[idx.twinFlag]));
        const trialEventIds = idx.trialEvents !== -1
          ? cleanCell(cols[idx.trialEvents]).split(/[、,／/|]/).map(v => v.trim()).filter(Boolean)
          : [];
        const trialContinued = idx.trialContinued !== -1 && ['1', 'true', 'TRUE', '○', '〇', '有', 'はい', '継続'].includes(cleanCell(cols[idx.trialContinued]));
        const courseStartMonth = normalizeCourseStartMonth(
          idx.courseStartMonth !== -1 ? cols[idx.courseStartMonth] : '',
          defaultCourseStartMonth,
        );
        const studentPassword = idx.password !== -1 && cleanCell(cols[idx.password])
          ? cleanCell(cols[idx.password])
          : requestedDefaultPassword || generateInitialPassword();
        const parentPassword = idx.parentPassword !== -1 && cleanCell(cols[idx.parentPassword])
          ? cleanCell(cols[idx.parentPassword])
          : requestedDefaultPassword || generateInitialPassword();
        if (studentPassword.length < 6 || parentPassword.length < 6) {
          throw new Error('初期パスワードは6文字以上にしてください');
        }

        const syncStudent = await prepareAuthAccountCredentials({ actor, loginId, password: studentPassword, displayName: studentName, preserveActivatedPassword: true });
        const syncParent = await prepareAuthAccountCredentials({ actor, loginId: parentLoginId, password: parentPassword, displayName: parentName, preserveActivatedPassword: true });
        const studentAuth = await syncStudent();
        const parentAuth = await syncParent();
        const now = FieldValue.serverTimestamp();
        // ログイン済みで本人がパスワードを変えているアカウントは、初期パスワードを書き戻さない。
        const studentCredentials = studentAuth.password_preserved ? {} : { initial_password: studentPassword, raw_password: studentPassword, isFirstLogin: true };
        const parentCredentials = parentAuth.password_preserved ? {} : { initial_password: parentPassword, raw_password: parentPassword, isFirstLogin: true };
        if (studentAuth.password_preserved) preserved.push({ row: rowOffset + i + 1, login_id: loginId });

        await db.collection('users').doc(studentAuth.uid).set({
          uid: studentAuth.uid,
          id: studentAuth.uid,
          role: 'student',
          email: studentAuth.email,
          lifetime_id: loginId,
          initial_login_id: loginId,
          ...studentCredentials,
          student_name: studentName,
          grade: idx.grade !== -1 ? normalizeGrade(cols[idx.grade]) : '',
          school_id: school,
          school,
          classroom: idx.classroom !== -1 ? cols[idx.classroom] || '' : '',
          middle_school: idx.middleSchool !== -1 ? cols[idx.middleSchool] || '' : '',
          course_start_month: courseStartMonth,
          sibling_group_key: siblingGroup || null,
          trial_event_ids: trialEventIds,
          trial_continued: trialContinued,
          phone_number: !anonymous && idx.phone !== -1 ? cols[idx.phone] || '' : '',
          day_of_week: idx.day !== -1 ? cols[idx.day] || '' : '',
          subject_science: idx.science !== -1 ? cols[idx.science] || '' : '',
          subject_social: idx.social !== -1 ? cols[idx.social] || '' : '',
          parent_ids: FieldValue.arrayUnion(parentAuth.uid),
          parent_uid: parentAuth.uid,
          account_status: 'active',
          status: 'active',
          created_at: now,
          updated_at: now,
          updated_by: actor.uid,
        }, { merge: true });

        await db.collection('users').doc(parentAuth.uid).set({
          uid: parentAuth.uid,
          id: parentAuth.uid,
          role: 'parent',
          email: parentAuth.email,
          lifetime_id: parentLoginId,
          initial_login_id: parentLoginId,
          ...parentCredentials,
          parent_name: parentName,
          name: parentName,
          phone_number: !anonymous && idx.parentPhone !== -1 ? cols[idx.parentPhone] || '' : '',
          student_ids: FieldValue.arrayUnion(studentAuth.uid),
          school_id: school,
          school,
          account_status: 'active',
          status: 'active',
          created_at: now,
          updated_at: now,
          updated_by: actor.uid,
        }, { merge: true });

        results.push({
          id: studentAuth.uid,
          uid: studentAuth.uid,
          student_name: studentName,
          grade: idx.grade !== -1 ? normalizeGrade(cols[idx.grade]) : '',
          school_id: school,
          classroom: idx.classroom !== -1 ? cols[idx.classroom] || '' : '',
          middle_school: idx.middleSchool !== -1 ? cols[idx.middleSchool] || '' : '',
          course_start_month: courseStartMonth,
          sibling_group_key: siblingGroup || '',
          trial_event_ids: trialEventIds,
          trial_continued: trialContinued,
          day_of_week: idx.day !== -1 ? cols[idx.day] || '' : '',
          subject_science: idx.science !== -1 ? cols[idx.science] || '' : '',
          subject_social: idx.social !== -1 ? cols[idx.social] || '' : '',
          phone_number: !anonymous && idx.phone !== -1 ? cols[idx.phone] || '' : '',
          lifetime_id: loginId,
          initial_password: studentAuth.password_preserved ? '' : studentPassword,
          isFirstLogin: !studentAuth.password_preserved,
          parent_uid: parentAuth.uid,
          parent_name: parentName,
          parent_login_id: parentLoginId,
          parent_initial_password: parentAuth.password_preserved ? '' : parentPassword,
          parent_status: parentAuth.password_preserved ? 'activated' : undefined,
          account_status: 'active',
          role: 'student',
        });
        if (siblingGroup) {
          siblingGroups.set(siblingGroup, [...(siblingGroups.get(siblingGroup) || []), { uid: studentAuth.uid, twin }]);
        }
      } catch (error: any) {
        errors.push({ row: rowOffset + i + 1, login_id: loginId, error: error.message || String(error) });
      }
    });
    // 並列処理で順番が入れ替わるので、CSVの行順に戻す。
    const rowOf = new Map(targets.map(target => [target.loginId, target.i]));
    results.sort((a, b) => (rowOf.get(a.lifetime_id) ?? 0) - (rowOf.get(b.lifetime_id) ?? 0));
    errors.sort((a, b) => a.row - b.row);

    for (const group of siblingGroups.values()) {
      if (group.length < 2) continue;
      await Promise.all(group.map(member => {
        const siblingIds = group.map(item => item.uid).filter(uid => uid !== member.uid);
        const twinSiblingIds = member.twin ? group.filter(item => item.twin && item.uid !== member.uid).map(item => item.uid) : [];
        return db.collection('users').doc(member.uid).set({
          sibling_ids: siblingIds,
          twin_sibling_ids: twinSiblingIds,
          updated_at: FieldValue.serverTimestamp(),
          updated_by: actor.uid,
        }, { merge: true });
      }));
    }

    const eventId = await writeLearningEvent({
      actor_id: actor.uid,
      actor_role: actor.role,
      type: 'school_students_csv_imported',
      target_type: 'user',
      school,
      metadata: { count: results.length, errors: errors.length },
    });

    const importBatchRef = importKey
      ? db.collection('account_import_batches').doc(`${actor.uid}_${importKey}`)
      : db.collection('account_import_batches').doc();
    const userIds = results.map(student => String(student.id || student.uid || '')).filter(Boolean);
    const errorLines = errors.map(item => `行${item.row}: ${item.error}`).slice(0, 20);
    await importBatchRef.set(importKey ? {
      file_name: importFileName,
      role: 'student',
      // arrayUnion は要素0件を受け付けないため、追加分があるときだけ書く。
      ...(userIds.length ? { user_ids: FieldValue.arrayUnion(...userIds) } : {}),
      success_count: FieldValue.increment(results.length),
      error_count: FieldValue.increment(errors.length),
      ...(errorLines.length ? { errors: FieldValue.arrayUnion(...errorLines) } : {}),
      imported_at: FieldValue.serverTimestamp(),
      imported_by: actor.uid,
      source: 'school_students',
      school,
    } : {
      file_name: importFileName,
      role: 'student',
      user_ids: userIds,
      success_count: results.length,
      error_count: errors.length,
      errors: errorLines,
      imported_at: FieldValue.serverTimestamp(),
      imported_by: actor.uid,
      source: 'school_students',
      school,
    }, { merge: true });

    // 取込1回（分割送信なら1回分）につき1件。件数だけ残し、生徒の行の内容は残さない。
    await writeAuditLog({
      actor,
      action: 'school_students_import',
      target_type: 'account_import_batch',
      target_id: importBatchRef.id,
      target_label: importFileName,
      school_id: school,
      details: { row_offset: rowOffset, imported_count: results.length, error_count: errors.length, preserved_count: preserved.length },
    });

    return Response.json({ ok: true, school, count: results.length, students: results, errors, preserved, event_id: eventId, import_batch_id: importBatchRef.id });
  } catch (error) {
    return jsonError(error);
  }
}
