import { NextRequest } from 'next/server';
import { buildEikenStudentDetail } from '@/lib/eiken/data';
import { requireEikenAccess } from '@/lib/eiken/access';
import { getServerUser, jsonError, requireRole } from '@/lib/server-auth';

export const runtime = 'nodejs';

export async function GET(request: NextRequest, context: { params: { id: string } }) {
  try {
    const user = await getServerUser(request);
    requireRole(user, ['teacher', 'admin', 'master']);
    await requireEikenAccess(user);
    const studentId = String(context.params.id || '');
    const courseId = request.nextUrl.searchParams.get('course_id') || undefined;
    const detail = await buildEikenStudentDetail(user, studentId, courseId);
    return Response.json({ ok: true, detail });
  } catch (error) {
    return jsonError(error);
  }
}
