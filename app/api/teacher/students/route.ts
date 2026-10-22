import { NextRequest } from 'next/server';
import { getServerUser, jsonError, requireScienceSocialStaff } from '@/lib/server-auth';
import { accessibleTeacherStudents } from '@/lib/server/teacher-student-access';

export const dynamic = 'force-dynamic';

export async function GET(request: NextRequest) {
  try {
    const user = await getServerUser(request);
    requireScienceSocialStaff(user);

    const students = (await accessibleTeacherStudents(user))
      .sort((a, b) => String(a.grade || '').localeCompare(String(b.grade || '')));

    return Response.json({ ok: true, students });
  } catch (error) {
    return jsonError(error);
  }
}
