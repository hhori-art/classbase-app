import { NextRequest } from 'next/server';
import { getServerUser, jsonError, requireRole } from '@/lib/server-auth';
import { loadLinkedStudentForParent } from '@/lib/server/parent-learning-history';
import { buildStudentTimetable } from '@/lib/server/student-timetable';

export const runtime = 'nodejs';

/** 保護者が、紐づいているお子さまの時間割だけを見る。 */
export async function GET(request: NextRequest) {
  try {
    const user = await getServerUser(request);
    requireRole(user, ['parent']);
    const studentId = String(request.nextUrl.searchParams.get('student_id') || '').trim().slice(0, 128);
    if (!studentId || studentId.includes('/')) return Response.json({ ok: false, error: 'student_id is required' }, { status: 400 });
    const student = await loadLinkedStudentForParent(user, studentId);
    const timetable = await buildStudentTimetable({ id: student.id, profile: student.data }, { audience: 'parent' });
    return Response.json({ ok: true, student_id: student.id, ...timetable }, { headers: { 'Cache-Control': 'private, no-store' } });
  } catch (error) {
    return jsonError(error);
  }
}
