import { NextRequest } from 'next/server';
import { FieldValue } from 'firebase-admin/firestore';
import { adminDb } from '@/lib/firebase-admin';
import { getServerUser, jsonError, requireRole } from '@/lib/server-auth';
import { writeLearningEvent } from '@/lib/events';

export const runtime = 'nodejs';

const clean = (value: unknown) => String(value || '').trim();

export async function POST(request: NextRequest) {
  try {
    const user = await getServerUser(request);
    requireRole(user, ['student']);

    const body = await request.json();
    const day = clean(body.day_of_week || body.day);
    const science = clean(body.subject_science || body.science);
    const social = clean(body.subject_social || body.social);

    if (!day && !science && !social) {
      return Response.json({ ok: false, error: 'no-change-fields' }, { status: 400 });
    }

    const updates: Record<string, unknown> = {
      updated_at: FieldValue.serverTimestamp(),
      course_settings_updated_at: FieldValue.serverTimestamp(),
      course_settings_updated_by: user.uid,
      course_settings_approval_status: 'not_required',
    };
    if (day) updates.day_of_week = day.replace('曜日', '');
    if (science) updates.subject_science = science;
    if (social) updates.subject_social = social;

    await adminDb().collection('users').doc(user.uid).set(updates, { merge: true });

    const eventId = await writeLearningEvent({
      actor_id: user.uid,
      actor_role: user.role,
      type: 'student_course_settings_updated',
      target_id: user.uid,
      target_type: 'user',
      school: user.school,
      metadata: { day, science, social, immediate: true },
    });

    return Response.json({ ok: true, updates, event_id: eventId });
  } catch (error) {
    return jsonError(error);
  }
}
