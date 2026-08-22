import { NextRequest } from 'next/server';
import { requireEikenAccess } from '@/lib/eiken/access';
import {
  buildParentEikenDashboard,
  buildStaffEikenDashboard,
  buildStudentEikenDashboard,
} from '@/lib/eiken/data';
import { getServerUser, jsonError } from '@/lib/server-auth';

export const runtime = 'nodejs';

export async function GET(request: NextRequest) {
  try {
    const user = await getServerUser(request);
    await requireEikenAccess(user);

    if (user.role === 'student') {
      return Response.json({ ok: true, role: user.role, dashboard: await buildStudentEikenDashboard(user.uid) });
    }
    if (user.role === 'parent') {
      const studentId = request.nextUrl.searchParams.get('student_id') || undefined;
      return Response.json({ ok: true, role: user.role, ...(await buildParentEikenDashboard(user, studentId)) });
    }
    if (user.role === 'teacher' || user.role === 'admin' || user.role === 'master') {
      return Response.json({ ok: true, role: user.role, dashboard: await buildStaffEikenDashboard(user) });
    }
    throw new Error('forbidden');
  } catch (error) {
    return jsonError(error);
  }
}

