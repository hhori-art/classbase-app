import { NextRequest } from 'next/server';
import { FieldValue } from 'firebase-admin/firestore';
import { adminDb } from '@/lib/firebase-admin';
import { canManageSchool, getServerUser, isAdminLike, jsonError } from '@/lib/server-auth';

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

    await ref.set(updates, { merge: true });
    return Response.json({ ok: true, updates });
  } catch (error) {
    return jsonError(error);
  }
}
