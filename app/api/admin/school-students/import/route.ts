import { NextRequest } from 'next/server';
import { FieldValue } from 'firebase-admin/firestore';
import { adminAuth, adminDb } from '@/lib/firebase-admin';
import { canManageSchool, getServerUser, isAdminLike, jsonError } from '@/lib/server-auth';
import { writeLearningEvent } from '@/lib/events';

export const runtime = 'nodejs';

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

function findHeaderIndex(rows: string[][]) {
  return rows.findIndex((row, index) => index < 25 && row.some(cell => cell.includes('生涯番号') || cell.includes('ログインID') || cell === 'ID'));
}

function indexOf(header: string[], patterns: string[]) {
  return header.findIndex(cell => patterns.some(pattern => cell.includes(pattern)));
}

function normalizeEmail(loginId: string, email?: string) {
  const cleaned = String(email || '').trim();
  if (cleaned.includes('@')) return cleaned;
  return `${String(loginId).trim()}@classbase.local`;
}

function isNotFound(error: any) {
  const message = String(error?.message || '').toLowerCase();
  return error?.code === 'auth/user-not-found' || message.includes('no user record') || message.includes('not found');
}

async function upsertAuthUser(loginId: string, password: string, displayName: string, email?: string) {
  const auth = adminAuth();
  const normalizedEmail = normalizeEmail(loginId, email);
  try {
    const existing = await auth.getUserByEmail(normalizedEmail);
    await auth.updateUser(existing.uid, { password, displayName, emailVerified: true, disabled: false });
    return { uid: existing.uid, email: normalizedEmail, updated: true };
  } catch (error: any) {
    if (!isNotFound(error)) throw error;
    const created = await auth.createUser({ email: normalizedEmail, password, displayName, emailVerified: true });
    return { uid: created.uid, email: normalizedEmail, updated: false };
  }
}

export async function POST(request: NextRequest) {
  try {
    const actor = await getServerUser(request);
    if (!isAdminLike(actor)) throw new Error('forbidden');

    const body = await request.json();
    const csvText = String(body.csv_text || '');
    const requestedSchool = String(body.school_id || body.school || '').trim();
    const school = actor.role === 'master' ? requestedSchool : actor.school_ids[0] || actor.school || '';
    const defaultPassword = String(body.default_password || 'class1234').trim();

    if (!csvText.trim()) return Response.json({ ok: false, error: 'csv_text is required' }, { status: 400 });
    if (!school) return Response.json({ ok: false, error: 'school is required' }, { status: 400 });
    if (!canManageSchool(actor, school)) throw new Error('forbidden');
    if (defaultPassword.length < 6) return Response.json({ ok: false, error: 'password must be 6+ characters' }, { status: 400 });

    const rows = parseCsv(csvText);
    const headerIndex = findHeaderIndex(rows);
    if (headerIndex === -1) return Response.json({ ok: false, error: 'CSVヘッダーに「生涯番号」または「ログインID」が必要です' }, { status: 400 });

    const header = rows[headerIndex].map(cleanCell);
    const idx = {
      id: indexOf(header, ['生涯番号', 'ログインID', 'ID']),
      grade: indexOf(header, ['学年']),
      classroom: indexOf(header, ['所属教室', '教室', 'クラス']),
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
    const processed = new Set<string>();

    for (let i = headerIndex + 1; i < rows.length; i++) {
      const cols = rows[i].map(cleanCell);
      const loginId = cleanCell(cols[idx.id]);
      if (!loginId || processed.has(loginId)) continue;
      processed.add(loginId);

      try {
        let studentName = '';
        if (idx.lastName !== -1 || idx.firstName !== -1) {
          studentName = `${idx.lastName !== -1 ? cols[idx.lastName] || '' : ''} ${idx.firstName !== -1 ? cols[idx.firstName] || '' : ''}`.trim();
        }
        if (!studentName && idx.name !== -1) studentName = cols[idx.name] || '';
        if (!studentName) studentName = `生徒 ${loginId}`;

        const parentName = idx.parentName !== -1 && cols[idx.parentName]
          ? cols[idx.parentName]
          : `${studentName} 保護者`;
        const parentLoginId = `${loginId}P`;

        const studentAuth = await upsertAuthUser(loginId, defaultPassword, studentName);
        const parentAuth = await upsertAuthUser(parentLoginId, defaultPassword, parentName);
        const now = FieldValue.serverTimestamp();

        await db.collection('users').doc(studentAuth.uid).set({
          uid: studentAuth.uid,
          id: studentAuth.uid,
          role: 'student',
          email: studentAuth.email,
          lifetime_id: loginId,
          initial_login_id: loginId,
          initial_password: defaultPassword,
          raw_password: defaultPassword,
          student_name: studentName,
          grade: idx.grade !== -1 ? normalizeGrade(cols[idx.grade]) : '',
          school_id: school,
          school,
          classroom: idx.classroom !== -1 ? cols[idx.classroom] || '' : '',
          phone_number: idx.phone !== -1 ? cols[idx.phone] || '' : '',
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
          initial_password: defaultPassword,
          raw_password: defaultPassword,
          parent_name: parentName,
          name: parentName,
          phone_number: idx.parentPhone !== -1 ? cols[idx.parentPhone] || '' : '',
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
          day_of_week: idx.day !== -1 ? cols[idx.day] || '' : '',
          subject_science: idx.science !== -1 ? cols[idx.science] || '' : '',
          subject_social: idx.social !== -1 ? cols[idx.social] || '' : '',
          phone_number: idx.phone !== -1 ? cols[idx.phone] || '' : '',
          lifetime_id: loginId,
          initial_password: defaultPassword,
          parent_uid: parentAuth.uid,
          parent_name: parentName,
          parent_login_id: parentLoginId,
          parent_initial_password: defaultPassword,
          account_status: 'active',
        });
      } catch (error: any) {
        errors.push({ row: i + 1, login_id: loginId, error: error.message || String(error) });
      }
    }

    const eventId = await writeLearningEvent({
      actor_id: actor.uid,
      actor_role: actor.role,
      type: 'school_students_csv_imported',
      target_type: 'user',
      school,
      metadata: { count: results.length, errors: errors.length },
    });

    return Response.json({ ok: true, school, count: results.length, students: results, errors, event_id: eventId });
  } catch (error) {
    return jsonError(error);
  }
}
