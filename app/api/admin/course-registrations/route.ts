import { NextRequest } from 'next/server';
import { FieldValue } from 'firebase-admin/firestore';
import { adminDb } from '@/lib/firebase-admin';
import { canManageSchool, getServerUser, isAdminLike, jsonError } from '@/lib/server-auth';
import { normalizeCourseGrade } from '@/lib/course-registration-rules';
import { verifyCourseRegistrationToken } from '@/lib/server/course-registration-token';

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
    const selectedCourseIds: string[] = Array.isArray(body.selected_course_ids)
      ? Array.from(new Set(body.selected_course_ids.map((id: unknown) => String(id).trim()).filter(Boolean)))
      : [];
    const selectedCourseLabels: string[] = Array.isArray(body.selected_course_labels)
      ? Array.from(new Set(body.selected_course_labels.map((label: unknown) => String(label).trim()).filter(Boolean)))
      : [];
    const registrationTokens: string[] = Array.isArray(body.registration_tokens)
      ? body.registration_tokens.map((token: unknown) => String(token || '')).filter(Boolean)
      : [];
    if (!studentId || selectedCourseIds.length > 100) {
      return Response.json({ ok: false, error: '受講講座の選択内容を確認してください。' }, { status: 400 });
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

    let grants: ReturnType<typeof verifyCourseRegistrationToken>[] = [];
    if (selectedCourseIds.length > 0) {
      if (registrationTokens.length !== selectedCourseIds.length) {
        return Response.json({ ok: false, error: '講座候補が更新されています。画面を再読み込みしてください。' }, { status: 400 });
      }
      try {
        grants = registrationTokens.map(token => verifyCourseRegistrationToken(token, actor.uid, normalizeCourseGrade(student.grade)));
      } catch {
        return Response.json({ ok: false, error: '講座候補が更新されています。画面を再読み込みしてください。' }, { status: 403 });
      }
      const grantById = new Map(grants.map(grant => [grant.option_id, grant]));
      if (grantById.size !== selectedCourseIds.length || selectedCourseIds.some(id => !grantById.has(id)) || grants.some(grant => grant.year !== year || grant.term !== term || grant.registration_type !== 'regular')) {
        return Response.json({ ok: false, error: '選択した講座と登録対象の期が一致しません。' }, { status: 400 });
      }
      const coursesBySchedule = new Map<string, string>();
      const schedulesByCourse = new Map<string, string>();
      for (const grant of grants) {
        const scheduleKey = `${grant.day}__${grant.slot}`;
        const courseKey = String(grant.course_key || grant.stable_key)
          .replace(new RegExp(`_${String(grant.day).replace(/[.*+?^${}()|[\]\\]/g, '\\$&')}_${String(grant.slot).replace(/[.*+?^${}()|[\]\\]/g, '\\$&')}$`), '');
        if (coursesBySchedule.has(scheduleKey) && coursesBySchedule.get(scheduleKey) !== courseKey) {
          return Response.json({ ok: false, error: '同じ曜日・時限に複数の講座は登録できません。' }, { status: 400 });
        }
        if (schedulesByCourse.has(courseKey) && schedulesByCourse.get(courseKey) !== scheduleKey) {
          return Response.json({ ok: false, error: '同じ講座を別の曜日・時限で重複登録することはできません。' }, { status: 400 });
        }
        coursesBySchedule.set(scheduleKey, courseKey);
        schedulesByCourse.set(courseKey, scheduleKey);
      }
    }
    const verifiedCourseKeys = Array.from(new Set(grants.map(grant => grant.stable_key).filter(Boolean)));

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
      registration_type: 'regular',
      selected_course_ids: selectedCourseIds,
      selected_course_labels: selectedCourseLabels,
      selected_course_keys: verifiedCourseKeys,
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
      if (docSnap.id !== registrationRef.id && String(docSnap.data().registration_type || 'regular') === 'regular') {
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
      selected_course_keys: verifiedCourseKeys,
      course_registration_year: year,
      course_registration_term: term,
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
      selected_course_keys: verifiedCourseKeys,
    });
  } catch (error) {
    return jsonError(error);
  }
}
