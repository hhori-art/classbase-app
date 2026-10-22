import { NextRequest } from 'next/server';
import { getServerUser, jsonError, requireRole } from '@/lib/server-auth';
import { buildStudentTimetable } from '@/lib/server/student-timetable';

export const runtime = 'nodejs';

/** 生徒本人の時間割（毎週の曜日×時限と、今日から14日間の授業・休講）。他の生徒は指定できない。 */
export async function GET(request: NextRequest) {
  try {
    const user = await getServerUser(request);
    requireRole(user, ['student']);
    const timetable = await buildStudentTimetable({ id: user.uid, profile: user.profile }, { audience: 'student' });
    return Response.json({ ok: true, ...timetable }, { headers: { 'Cache-Control': 'private, no-store' } });
  } catch (error) {
    return jsonError(error);
  }
}
