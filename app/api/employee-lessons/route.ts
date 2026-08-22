import { createHash } from 'crypto';
import { NextRequest } from 'next/server';
import { FieldValue } from 'firebase-admin/firestore';
import { adminDb } from '@/lib/firebase-admin';
import { canManageAttendance, getServerUser, jsonError } from '@/lib/server-auth';
import { employeeLessonMinutes, validateEmployeeLesson, type EmployeeLessonInput } from '@/lib/employee-lessons';
import { isDedicatedProfile } from '@/lib/employment-category';

export const runtime = 'nodejs';

const COLLECTION = 'employee_lesson_assignments';
const clean = (value: unknown, max = 160) => String(value ?? '').normalize('NFKC').trim().slice(0, max);

function monthRange(raw: string) {
  const now = new Date(Date.now() + 9 * 60 * 60 * 1000).toISOString().slice(0, 7);
  const month = /^\d{4}-\d{2}$/.test(raw) ? raw : now;
  const [year, monthNumber] = month.split('-').map(Number);
  return { month, start: `${month}-01`, end: `${month}-${String(new Date(year, monthNumber, 0).getDate()).padStart(2, '0')}` };
}

function requireManager(user: Awaited<ReturnType<typeof getServerUser>>) {
  if (!canManageAttendance(user)) throw new Error('forbidden');
}

function normalizedInput(body: Record<string, unknown>): EmployeeLessonInput {
  const role = ['main', 'sub', 'other'].includes(String(body.role)) ? body.role as EmployeeLessonInput['role'] : 'main';
  return {
    school_code: clean(body.school_code, 40),
    school_name: clean(body.school_name, 100),
    lesson_date: clean(body.lesson_date, 10),
    employee_id: clean(body.employee_id, 128),
    person_code: clean(body.person_code, 40),
    employee_name: clean(body.employee_name, 100),
    start_time: clean(body.start_time, 5),
    end_time: clean(body.end_time, 5),
    course_name: clean(body.course_name, 120),
    role,
    note: clean(body.note, 500),
  };
}

export async function GET(request: NextRequest) {
  try {
    const user = await getServerUser(request);
    requireManager(user);
    const { month, start, end } = monthRange(clean(request.nextUrl.searchParams.get('month'), 7));
    const db = adminDb();
    const [lessonSnap, userSnap] = await Promise.all([
      db.collection(COLLECTION).where('lesson_date', '>=', start).where('lesson_date', '<=', end).limit(3000).get(),
      db.collection('users').where('role', 'in', ['teacher', 'attendance_admin']).limit(5000).get(),
    ]);
    const employees = userSnap.docs
      .map(doc => ({ id: doc.id, ...doc.data() }))
      .filter((item: any) => isDedicatedProfile(item))
      .map((item: any) => ({
        id: item.id,
        name: clean(item.name || item.teacher_name || item.displayName || item.student_name, 100),
        person_code: clean(item.lifetime_id || item.staff_id || item.employee_id || item.teacher_code, 40),
        school_code: clean(item.school_code || item.school_id, 40),
        school_name: clean(item.school_name || item.school || item.classroom, 100),
      }))
      .sort((a, b) => a.name.localeCompare(b.name, 'ja'));
    const lessons = lessonSnap.docs
      .map(doc => ({ id: doc.id, ...doc.data() }))
      .sort((a: any, b: any) => `${b.lesson_date}_${b.start_time}`.localeCompare(`${a.lesson_date}_${a.start_time}`));
    return Response.json({ ok: true, month, lessons, employees }, { headers: { 'Cache-Control': 'no-store, max-age=0' } });
  } catch (error) {
    return jsonError(error);
  }
}

export async function POST(request: NextRequest) {
  try {
    const user = await getServerUser(request);
    requireManager(user);
    const body = await request.json() as Record<string, unknown>;
    const action = clean(body.action, 20);
    const db = adminDb();
    if (action === 'delete') {
      const id = clean(body.id, 80);
      if (!id) return Response.json({ ok: false, error: '削除対象を指定してください。' }, { status: 400 });
      await db.collection(COLLECTION).doc(id).delete();
      return Response.json({ ok: true });
    }
    if (action !== 'create') return Response.json({ ok: false, error: '操作が不正です。' }, { status: 400 });
    const input = normalizedInput(body);
    const errors = validateEmployeeLesson(input);
    if (errors.length) return Response.json({ ok: false, error: errors.join('\n') }, { status: 400 });
    const lessonMinutes = employeeLessonMinutes(input.start_time, input.end_time) as number;
    const identity = input.employee_id || input.person_code || input.employee_name;
    const id = createHash('sha256').update([
      input.school_code || input.school_name, input.lesson_date, identity,
      input.start_time, input.end_time, input.course_name || '', input.role || 'main',
    ].join('\u001f')).digest('hex').slice(0, 40);
    const ref = db.collection(COLLECTION).doc(id);
    try {
      await ref.create({
        ...input,
        lesson_minutes: lessonMinutes,
        source_type: 'manual',
        created_by: user.uid,
        created_at: FieldValue.serverTimestamp(),
        updated_at: FieldValue.serverTimestamp(),
      });
    } catch (error: any) {
      if (error?.code === 6 || error?.code === 'already-exists') {
        return Response.json({ ok: false, error: '同じ職員・日時・講座の授業が既に登録されています。' }, { status: 409 });
      }
      throw error;
    }
    return Response.json({ ok: true, id, lesson_minutes: lessonMinutes });
  } catch (error) {
    return jsonError(error);
  }
}
