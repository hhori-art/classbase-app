import { NextRequest } from 'next/server';
import { FieldValue } from 'firebase-admin/firestore';
import { adminDb } from '@/lib/firebase-admin';
import { getServerUser, jsonError, requireRole } from '@/lib/server-auth';

export const runtime = 'nodejs';

export async function POST(request: NextRequest) {
  try {
    const user = await getServerUser(request);
    requireRole(user, ['teacher', 'admin', 'master']);

    const body = await request.json();
    const studentId = String(body.student_id || '');
    const year = String(body.year || new Date().getFullYear());
    const resolved = Boolean(body.resolved);

    if (!studentId) {
      return Response.json({ ok: false, error: 'student_id is required' }, { status: 400 });
    }

    await adminDb().collection('pf_resolutions').doc(`${studentId}_${year}`).set({
      student_id: studentId,
      year,
      att: resolved,
      hw: resolved,
      updated_at: new Date().toISOString(),
      updated_at_server: FieldValue.serverTimestamp(),
      updated_by: user.uid,
    }, { merge: true });

    return Response.json({ ok: true });
  } catch (error) {
    return jsonError(error);
  }
}
