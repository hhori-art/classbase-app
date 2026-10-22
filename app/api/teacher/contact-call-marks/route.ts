import { NextRequest } from 'next/server';
import { FieldValue } from 'firebase-admin/firestore';
import { adminDb } from '@/lib/firebase-admin';
import { getServerUser, jsonError, requireScienceSocialStaff } from '@/lib/server-auth';
import { jstDateKey } from '@/lib/date-key';
import { accessibleTeacherStudents } from '@/lib/server/teacher-student-access';

export const runtime = 'nodejs';

// 未連絡リストの「電話済」記録。日付＋生徒IDをドキュメントIDにして、
// 同じ日に同じ家庭へ複数の講師が重ねて電話しないよう共有する。
const COLLECTION = 'contact_call_logs';
const MAX_STUDENTS_PER_READ = 300;
const MAX_PAST_DAYS = 14;

const clean = (value: unknown, max = 200) => String(value ?? '').normalize('NFKC').trim().slice(0, max);
const isSafeId = (value: string) => Boolean(value) && value.length <= 128 && !value.includes('/') && value !== '.' && value !== '..';

function validDateKey(value: unknown) {
  const date = clean(value, 10);
  if (!/^\d{4}-\d{2}-\d{2}$/.test(date)) return '';
  const parsed = new Date(`${date}T00:00:00Z`);
  if (Number.isNaN(parsed.getTime()) || parsed.toISOString().slice(0, 10) !== date) return '';
  const today = new Date(`${jstDateKey()}T00:00:00Z`).getTime();
  const diffDays = (today - parsed.getTime()) / (24 * 60 * 60 * 1000);
  // 未来日や古すぎる日付の記録・参照は受け付けない
  if (diffDays < 0 || diffDays > MAX_PAST_DAYS) return '';
  return date;
}

const docId = (date: string, studentId: string) => `${date}_${studentId}`;

const toMark = (data: Record<string, any>) => ({
  student_id: String(data.student_id || ''),
  date: String(data.date || ''),
  teacher_id: String(data.teacher_id || ''),
  teacher_name: String(data.teacher_name || ''),
  marked_at: String(data.marked_at || ''),
  note: String(data.note || ''),
});

export async function GET(request: NextRequest) {
  try {
    const user = await getServerUser(request);
    requireScienceSocialStaff(user);

    const date = validDateKey(request.nextUrl.searchParams.get('date'));
    if (!date) return Response.json({ ok: false, error: '日付が正しくありません。' }, { status: 400 });

    const requestedIds = Array.from(new Set(
      clean(request.nextUrl.searchParams.get('student_ids'), 20000).split(',').map(id => clean(id, 128)).filter(isSafeId),
    ));
    if (requestedIds.length > MAX_STUDENTS_PER_READ) {
      return Response.json({ ok: false, error: '一度に確認できる生徒数を超えています。' }, { status: 400 });
    }
    if (requestedIds.length === 0) return Response.json({ ok: true, date, marks: [] }, { headers: { 'Cache-Control': 'no-store' } });

    // 担当校舎の生徒に限定してから、日付＋生徒IDのドキュメントだけを読む（クエリなし・件数上限あり）
    const accessible = await accessibleTeacherStudents(user);
    const accessibleIds = new Set(accessible.flatMap(student => [student.id, student.uid].map(value => String(value || '')).filter(Boolean)));
    const targetIds = requestedIds.filter(id => accessibleIds.has(id));
    const db = adminDb();
    const snaps = await Promise.all(targetIds.map(id => db.collection(COLLECTION).doc(docId(date, id)).get()));
    const marks = snaps.filter(snap => snap.exists).map(snap => toMark(snap.data() || {}));

    return Response.json({ ok: true, date, marks }, { headers: { 'Cache-Control': 'no-store' } });
  } catch (error) {
    return jsonError(error);
  }
}

export async function POST(request: NextRequest) {
  try {
    const user = await getServerUser(request);
    requireScienceSocialStaff(user);

    const body = await request.json().catch(() => ({})) as Record<string, unknown>;
    const studentId = clean(body.student_id, 128);
    const date = validDateKey(body.date);
    const rawNote = String(body.note || '').trim();
    if (!isSafeId(studentId)) return Response.json({ ok: false, error: 'student_id is required' }, { status: 400 });
    if (!date) return Response.json({ ok: false, error: '日付が正しくありません。' }, { status: 400 });
    if (rawNote.length > 1000) return Response.json({ ok: false, error: 'note-too-long' }, { status: 400 });

    const accessible = await accessibleTeacherStudents(user);
    const student = accessible.find(item => item.id === studentId || item.uid === studentId);
    if (!student) throw new Error('forbidden');
    const studentName = String(student.student_name || student.name || '生徒').slice(0, 120);
    const teacherName = String(user.profile.name || user.profile.teacher_name || user.email || '講師').slice(0, 120);

    const db = adminDb();
    const ref = db.collection(COLLECTION).doc(docId(date, studentId));
    const mark = {
      student_id: studentId,
      student_name: studentName,
      date,
      teacher_id: user.uid,
      teacher_name: teacherName,
      note: rawNote,
      marked_at: new Date().toISOString(),
      created_at: FieldValue.serverTimestamp(),
    };

    // 既に他の講師が記録済みなら上書きせず、その記録を返す（二重電話の防止）
    const existing = await db.runTransaction(async transaction => {
      const snap = await transaction.get(ref);
      if (snap.exists) return toMark(snap.data() || {});
      transaction.create(ref, mark);
      return null;
    });
    if (existing) {
      return Response.json({ ok: false, error: 'already-marked', mark: existing }, { status: 409 });
    }

    // 従来の連絡履歴にも残す
    await db.collection('contact_logs').add({
      student_id: studentId,
      student_name: studentName,
      teacher_id: user.uid,
      teacher_name: teacherName,
      result: '電話済み(繋がらず/留守)',
      content: rawNote,
      call_date: date,
      created_at: FieldValue.serverTimestamp(),
    });

    return Response.json({ ok: true, mark: toMark(mark) });
  } catch (error) {
    return jsonError(error);
  }
}
