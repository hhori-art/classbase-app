import { NextRequest } from 'next/server';
import { FieldValue } from 'firebase-admin/firestore';
import { adminDb } from '@/lib/firebase-admin';
import { canManageSchool, getServerUser, isAdminLike, jsonError } from '@/lib/server-auth';
import { writeAuditLog } from '@/lib/server/audit-log';
import { anonymousStudentName, isNoPersonalInfoSchool } from '@/lib/no-personal-info-schools';

export const runtime = 'nodejs';

export async function POST(request: NextRequest) {
  try {
    const actor = await getServerUser(request);
    if (!isAdminLike(actor)) throw new Error('forbidden');

    const body = await request.json();
    const userId = String(body.user_id || '').trim();
    if (!userId) return Response.json({ ok: false, error: 'user_id is required' }, { status: 400 });

    const db = adminDb();
    const ref = db.collection('users').doc(userId);
    const snap = await ref.get();
    if (!snap.exists) return Response.json({ ok: false, error: 'student not found' }, { status: 404 });

    const data = snap.data() || {};
    const targetSchool = data.school_id || data.school || data.classroom;
    if (!canManageSchool(actor, targetSchool)) throw new Error('forbidden');

    const updates: Record<string, unknown> = {
      camera_off_requested: Boolean(body.camera_off_requested),
      absence_call_not_required: Boolean(body.absence_call_not_required),
      updated_at: FieldValue.serverTimestamp(),
      updated_by: actor.uid,
    };
    if ('trial_continued' in body) updates.trial_continued = Boolean(body.trial_continued);
    if ('trial_event_ids' in body) updates.trial_event_ids = Array.isArray(body.trial_event_ids) ? body.trial_event_ids.map(String).filter(Boolean) : [];
    if ('middle_school' in body) updates.middle_school = String(body.middle_school || '').trim();
    if ('course_start_month' in body) updates.course_start_month = String(body.course_start_month || '').trim();
    if ('sibling_ids' in body) updates.sibling_ids = Array.isArray(body.sibling_ids) ? body.sibling_ids.map(String).filter(Boolean) : [];
    if ('twin_sibling_ids' in body) updates.twin_sibling_ids = Array.isArray(body.twin_sibling_ids) ? body.twin_sibling_ids.map(String).filter(Boolean) : [];
    if ('student_name' in body) {
      const name = String(body.student_name || '').trim().slice(0, 120);
      if (!name) return Response.json({ ok: false, error: '氏名は必須です' }, { status: 400 });
      updates.student_name = name;
    }
    if ('student_name_kana' in body) updates.student_name_kana = String(body.student_name_kana || '').trim().slice(0, 120);
    if ('grade' in body) updates.grade = String(body.grade || '').trim().slice(0, 20);
    if ('classroom' in body) updates.classroom = String(body.classroom || '').trim().slice(0, 120);
    if ('day_of_week' in body) updates.day_of_week = String(body.day_of_week || '').trim().slice(0, 20);
    if ('phone_number' in body) updates.phone_number = String(body.phone_number || '').trim().slice(0, 40);
    if ('member_type' in body) updates.member_type = body.member_type === 'general' ? 'general' : 'enrolled';
    if ('summer_course_status' in body) updates.summer_course_status = body.summer_course_status === 'attending' ? 'attending' : 'none';
    if ('summer_only' in body) updates.summer_only = Boolean(body.summer_only);
    // 個人情報を入れずにテストしている校舎では、氏名・ふりがな・電話番号は保存せず、名前は生徒番号にする。
    if (isNoPersonalInfoSchool(targetSchool)) {
      if ('student_name' in updates) updates.student_name = anonymousStudentName(data.lifetime_id || data.initial_login_id || userId);
      if ('student_name_kana' in updates) updates.student_name_kana = '';
      if ('phone_number' in updates) updates.phone_number = '';
    }

    await ref.set(updates, { merge: true });
    // 氏名などを誰がいつ変えたかを残す（値そのものは個人情報なので残さず、変えた項目だけを記録する）。
    const changed = Object.keys(updates).filter(key => !['updated_at', 'updated_by'].includes(key) && JSON.stringify(updates[key]) !== JSON.stringify(data[key]));
    if (changed.length) {
      await writeAuditLog({
        actor,
        action: 'student_profile_update',
        target_type: 'user',
        target_id: userId,
        target_label: String(data.lifetime_id || data.initial_login_id || userId),
        school_id: String(targetSchool || ''),
        details: { fields: changed.join(',') },
      });
    }
    return Response.json({ ok: true, updates });
  } catch (error) {
    return jsonError(error);
  }
}
