import { NextRequest } from 'next/server';
import { adminDb } from '@/lib/firebase-admin';
import { getServerUser, jsonError, requireRole, type ServerUser } from '@/lib/server-auth';
import { ATTENDANCE_SCHOOL_OPTION_GROUPS } from '@/lib/attendance-schools';
import { validateWeeklyAvailability } from '@/lib/teacher-weekly-availability';

export const runtime = 'nodejs';

// 講師の基本勤務設定（teacher_availability_profiles/{講師のuid}）の保存。
// 保存先は常にログイン中の講師本人の文書。管理画面（/master/shifts）が読む項目名・形はそのまま保つ。

const ALLOWED_WORKPLACES = new Set(ATTENDANCE_SCHOOL_OPTION_GROUPS.flatMap(group => group.schools.map(school => school.name)));

const teacherNameOf = (user: ServerUser) =>
  String(user.profile.name || user.profile.student_name || user.profile.display_name || user.email || '講師').trim();

export async function PUT(request: NextRequest) {
  try {
    const user = await getServerUser(request);
    requireRole(user, ['teacher']);
    const body = await request.json().catch(() => ({})) as Record<string, unknown>;
    // 他の講師の設定は保存できない（宛先を指定された場合は本人以外なら拒否する）。
    for (const field of ['teacher_id', 'user_id', 'uid']) {
      if (body[field] !== undefined && String(body[field]) !== user.uid) {
        return Response.json({ ok: false, error: 'forbidden' }, { status: 403 });
      }
    }

    const db = adminDb();
    const ref = db.collection('teacher_availability_profiles').doc(user.uid);
    const existingSnap = await ref.get();
    const existing = existingSnap.exists ? existingSnap.data() || {} : null;
    const result = validateWeeklyAvailability(body.weekdays, {
      isWorkplaceAllowed: value => ALLOWED_WORKPLACES.has(value),
      existing: existing?.weekdays,
    });
    if (!result.ok) return Response.json({ ok: false, error: result.error, weekday: result.weekday || null }, { status: 400 });

    const now = new Date().toISOString();
    await ref.set({
      teacher_id: user.uid,
      user_id: user.uid,
      teacher_name: teacherNameOf(user),
      weekdays: result.weekdays,
      updated_at: now,
      ...(existing?.created_at ? {} : { created_at: now }),
    }, { merge: true });
    return Response.json({ ok: true, weekdays: result.weekdays });
  } catch (error) {
    return jsonError(error);
  }
}
