import { NextRequest } from 'next/server';
import { adminDb } from '@/lib/firebase-admin';
import { getServerUser, jsonError, requireRole } from '@/lib/server-auth';
import { toSafeTeacherStudent } from '@/lib/teacher-students';

export const dynamic = 'force-dynamic';

export async function GET(request: NextRequest) {
  try {
    const user = await getServerUser(request);
    requireRole(user, ['teacher', 'admin', 'master']);

    const snap = await adminDb()
      .collection('users')
      .where('role', '==', 'student')
      .get();

    const students = snap.docs
      .map((doc) => toSafeTeacherStudent(doc.id, doc.data()))
      .sort((a, b) => String(a.grade || '').localeCompare(String(b.grade || '')));

    return Response.json({ ok: true, students });
  } catch (error) {
    return jsonError(error);
  }
}
