import { NextRequest } from 'next/server';
import { FieldValue } from 'firebase-admin/firestore';
import { adminDb } from '@/lib/firebase-admin';
import { getServerUser, jsonError, requireRole } from '@/lib/server-auth';
import { writeLearningEvent } from '@/lib/events';

export const runtime = 'nodejs';

export async function POST(request: NextRequest) {
  try {
    const user = await getServerUser(request);
    requireRole(user, ['parent', 'student']);

    const body = await request.json();
    const studentId = String(body.student_id || '').trim();
    const requestId = String(body.request_id || '').trim();
    const term = String(body.term || '').trim();
    const year = Number(body.year || new Date().getFullYear());
    const selectedCourseIds = Array.isArray(body.selected_course_ids)
      ? body.selected_course_ids.map((id: unknown) => String(id).trim()).filter(Boolean)
      : [];
    const courseSettings = body.course_settings && typeof body.course_settings === 'object'
      ? body.course_settings
      : {};
    const day = String(courseSettings.day_of_week || '').replace('曜日', '').trim();
    const science = String(courseSettings.subject_science || '').trim();
    const social = String(courseSettings.subject_social || '').trim();

    if (!studentId || !term || selectedCourseIds.length === 0) {
      return Response.json({ ok: false, error: 'student_id, term, selected_course_ids are required' }, { status: 400 });
    }

    const linkedIds = Array.isArray(user.profile.student_ids) ? user.profile.student_ids : [];
    const studentSnap = await adminDb().collection('users').doc(studentId).get();
    const student = studentSnap.data() || {};
    const isOwnStudentRequest = user.role === 'student' && user.uid === studentId;
    const isLinkedParentRequest = user.role === 'parent' && (linkedIds.includes(studentId) || student.parent_uid === user.uid);
    if (!isOwnStudentRequest && !isLinkedParentRequest) throw new Error('forbidden');

    const db = adminDb();
    const parentId = user.role === 'parent' ? user.uid : String(student.parent_uid || '');
    const ref = db.collection('course_registrations').doc(`${parentId || user.uid}_${studentId}_${year}_${term}_${requestId || 'direct'}`);
    const payload = {
      request_id: requestId || null,
      parent_id: parentId || null,
      parent_name: user.role === 'parent' ? user.profile.parent_name || user.profile.name || '' : '',
      student_id: studentId,
      student_name: student.student_name || student.name || '',
      grade: student.grade || '',
      year,
      term,
      selected_course_ids: selectedCourseIds,
      status: 'active',
      approval_status: 'not_required',
      updated_by: user.uid,
      updated_by_role: user.role,
      updated_at: FieldValue.serverTimestamp(),
      created_at: FieldValue.serverTimestamp(),
    };

    const batch = db.batch();
    batch.set(ref, payload, { merge: true });
    batch.set(db.collection('users').doc(studentId), {
      active_course_registration_id: ref.id,
      selected_course_ids: selectedCourseIds,
      course_registration_status: 'active',
      course_registration_updated_at: FieldValue.serverTimestamp(),
      ...(day ? { day_of_week: day } : {}),
      ...(science ? { subject_science: science } : {}),
      ...(social ? { subject_social: social } : {}),
      ...(day || science || social ? {
        course_settings_updated_at: FieldValue.serverTimestamp(),
        course_settings_updated_by: user.uid,
        course_settings_approval_status: 'not_required',
      } : {}),
    }, { merge: true });
    await batch.commit();

    const eventId = await writeLearningEvent({
      actor_id: user.uid,
      actor_role: user.role,
      type: 'parent_course_registration_submitted',
      target_id: ref.id,
      target_type: 'course_registration',
      school: student.school || student.school_id || user.school,
      metadata: {
        student_id: studentId,
        year,
        term,
        selected_course_ids: selectedCourseIds,
        course_settings: { day_of_week: day, subject_science: science, subject_social: social },
        immediate: true,
      },
    });

    return Response.json({ ok: true, registration_id: ref.id, event_id: eventId });
  } catch (error) {
    return jsonError(error);
  }
}
