import { NextRequest } from 'next/server';
import { FieldValue } from 'firebase-admin/firestore';
import { adminDb } from '@/lib/firebase-admin';
import { canManageSchool, getServerUser, isAdminLike, jsonError } from '@/lib/server-auth';

export const runtime = 'nodejs';

const safeDocPart = (value: string) => value.replace(/[^\p{Letter}\p{Number}_-]+/gu, '_').slice(0, 120) || 'manual';

export async function POST(request: NextRequest) {
  try {
    const actor = await getServerUser(request);
    if (!isAdminLike(actor)) throw new Error('forbidden');

    const body = await request.json();
    const studentId = String(body.student_id || '').trim();
    const term = String(body.term || '').trim() || 'manual';
    const year = Number(body.year || new Date().getFullYear());
    const selectedCourseIds = Array.isArray(body.selected_course_ids)
      ? Array.from(new Set(body.selected_course_ids.map((id: unknown) => String(id).trim()).filter(Boolean)))
      : [];
    const selectedCourseLabels = Array.isArray(body.selected_course_labels)
      ? Array.from(new Set(body.selected_course_labels.map((label: unknown) => String(label).trim()).filter(Boolean)))
      : [];

    if (!studentId || selectedCourseIds.length === 0) {
      return Response.json({ ok: false, error: 'student_id and selected_course_ids are required' }, { status: 400 });
    }

    const db = adminDb();
    const studentRef = db.collection('users').doc(studentId);
    const studentSnap = await studentRef.get();
    if (!studentSnap.exists) {
      return Response.json({ ok: false, error: 'student not found' }, { status: 404 });
    }

    const student = studentSnap.data() || {};
    const targetSchool = student.school_id || student.school || student.classroom || '';
    if (!canManageSchool(actor, targetSchool)) throw new Error('forbidden');

    const parentId = String(student.parent_uid || (Array.isArray(student.parent_ids) ? student.parent_ids[0] : '') || '');
    const registrationRef = db.collection('course_registrations').doc(`admin_${safeDocPart(studentId)}_${year}_${safeDocPart(term)}`);
    const existingSnap = await db.collection('course_registrations')
      .where('student_id', '==', studentId)
      .limit(100)
      .get();

    const registrationPayload = {
      request_id: 'admin_manual',
      parent_id: parentId || null,
      parent_name: student.parent_name || '',
      student_id: studentId,
      student_name: student.student_name || student.name || '',
      grade: student.grade || '',
      school: targetSchool || null,
      year,
      term,
      selected_course_ids: selectedCourseIds,
      selected_course_labels: selectedCourseLabels,
      status: 'active',
      approval_status: 'not_required',
      is_current: true,
      current: true,
      selected_by_admin: true,
      updated_by: actor.uid,
      updated_by_role: actor.role,
      updated_at: FieldValue.serverTimestamp(),
      created_at: FieldValue.serverTimestamp(),
    };

    const batch = db.batch();
    existingSnap.docs.forEach(docSnap => {
      if (docSnap.id !== registrationRef.id) {
        batch.set(docSnap.ref, {
          is_current: false,
          current: false,
          updated_at: FieldValue.serverTimestamp(),
        }, { merge: true });
      }
    });
    batch.set(registrationRef, registrationPayload, { merge: true });
    batch.set(studentRef, {
      active_course_registration_id: registrationRef.id,
      selected_course_ids: selectedCourseIds,
      selected_course_labels: selectedCourseLabels,
      course_registration_status: 'active',
      course_registration_updated_at: FieldValue.serverTimestamp(),
    }, { merge: true });
    batch.create(db.collection('action_logs').doc(), {
      action: 'admin_course_registration_saved',
      actor_id: actor.uid,
      actor_role: actor.role,
      target_id: studentId,
      target_type: 'student',
      school: targetSchool || null,
      metadata: {
        registration_id: registrationRef.id,
        year,
        term,
        selected_course_count: selectedCourseIds.length,
      },
      created_at: FieldValue.serverTimestamp(),
    });
    await batch.commit();

    return Response.json({
      ok: true,
      registration_id: registrationRef.id,
      selected_course_ids: selectedCourseIds,
      selected_course_labels: selectedCourseLabels,
    });
  } catch (error) {
    return jsonError(error);
  }
}
