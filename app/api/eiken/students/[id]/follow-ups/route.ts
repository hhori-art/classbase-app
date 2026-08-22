import { NextRequest } from 'next/server';
import { FieldValue } from 'firebase-admin/firestore';
import { z } from 'zod';
import { adminDb } from '@/lib/firebase-admin';
import { canReadEikenStudent, requireEikenAccess } from '@/lib/eiken/access';
import { getServerUser, jsonError, requireRole } from '@/lib/server-auth';

export const runtime = 'nodejs';

const inputSchema = z.object({
  course_id: z.string().trim().min(1),
  note: z.string().trim().min(1).max(2000),
  status: z.enum(['noted', 'contacted', 'resolved']).default('noted'),
});

export async function POST(request: NextRequest, context: { params: { id: string } }) {
  try {
    const user = await getServerUser(request);
    requireRole(user, ['teacher', 'admin', 'master']);
    await requireEikenAccess(user);
    const studentId = String(context.params.id || '');
    const input = inputSchema.parse(await request.json());
    if (!(await canReadEikenStudent(user, studentId, input.course_id))) {
      throw new Error('forbidden');
    }

    const ref = adminDb().collection('eiken_follow_up_records').doc();
    await ref.set({
      student_id: studentId,
      course_id: input.course_id,
      note: input.note,
      status: input.status,
      created_by: user.uid,
      created_by_role: user.role,
      created_at: FieldValue.serverTimestamp(),
      updated_at: FieldValue.serverTimestamp(),
    });
    return Response.json({ ok: true, id: ref.id });
  } catch (error) {
    if (error instanceof z.ZodError) {
      return Response.json({ ok: false, error: 'invalid-input', details: error.flatten() }, { status: 400 });
    }
    return jsonError(error);
  }
}
