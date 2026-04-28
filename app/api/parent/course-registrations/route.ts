import { NextRequest } from 'next/server';
import { FieldValue } from 'firebase-admin/firestore';
import { adminDb } from '@/lib/firebase-admin';
import { getServerUser, jsonError } from '@/lib/server-auth';
import { writeLearningEvent } from '@/lib/events';

export const runtime = 'nodejs';

export async function POST(request: NextRequest) {
  try {
    const user = await getServerUser(request);
    if (user.role !== 'parent') throw new Error('forbidden');

    const body = await request.json();
    const studentId = String(body.student_id || '').trim();
    const requestId = String(body.request_id || '').trim();
    const term = String(body.term || '').trim();
    const year = Number(body.year || new Date().getFullYear());
    const selectedCourseIds = Array.isArray(body.selected_course_ids)
      ? body.selected_course_ids.map((id: unknown) => String(id).trim()).filter(Boolean)
      : [];

    if (!studentId || !term || selectedCourseIds.length === 0) {
      return Response.json({ ok: false, error: 'student_id, term, selected_course_ids are required' }, { status: 400 });
    }

    const linkedIds = Array.isArray(user.profile.student_ids) ? user.profile.student_ids : [];
    const studentSnap = await adminDb().collection('users').doc(studentId).get();
    const student = studentSnap.data() || {};
    if (!linkedIds.includes(studentId) && student.parent_uid !== user.uid) throw new Error('forbidden');

    const db = adminDb();
    const ref = db.collection('course_registrations').doc(`${user.uid}_${studentId}_${year}_${term}_${requestId || 'direct'}`);
    await ref.set({
      request_id: requestId || null,
      parent_id: user.uid,
      parent_name: user.profile.parent_name || user.profile.name || '',
      student_id: studentId,
      student_name: student.student_name || student.name || '',
      grade: student.grade || '',
      year,
      term,
      selected_course_ids: selectedCourseIds,
      status: 'submitted',
      updated_at: FieldValue.serverTimestamp(),
      created_at: FieldValue.serverTimestamp(),
    }, { merge: true });

    const eventId = await writeLearningEvent({
      actor_id: user.uid,
      actor_role: user.role,
      type: 'parent_course_registration_submitted',
      target_id: ref.id,
      target_type: 'course_registration',
      school: student.school || student.school_id || user.school,
      metadata: { student_id: studentId, year, term, selected_course_ids: selectedCourseIds },
    });

    return Response.json({ ok: true, registration_id: ref.id, event_id: eventId });
  } catch (error) {
    return jsonError(error);
  }
}
