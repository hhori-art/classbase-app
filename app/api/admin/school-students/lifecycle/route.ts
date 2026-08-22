import { NextRequest } from 'next/server';
import { FieldValue } from 'firebase-admin/firestore';
import { adminDb } from '@/lib/firebase-admin';
import { canManageSchool, getServerUser, isAdminLike, jsonError } from '@/lib/server-auth';
import { writeLearningEvent } from '@/lib/events';

export const runtime = 'nodejs';

const monthPattern = /^\d{4}-\d{2}$/;

export async function POST(request: NextRequest) {
  try {
    const actor = await getServerUser(request);
    if (!isAdminLike(actor)) throw new Error('forbidden');
    const body = await request.json();
    const action = String(body.action || '').trim();
    const userId = String(body.user_id || '').trim();
    if (!userId) return Response.json({ ok: false, error: 'user_id is required' }, { status: 400 });

    const db = adminDb();
    const ref = db.collection('users').doc(userId);
    const snap = await ref.get();
    if (!snap.exists) return Response.json({ ok: false, error: 'student not found' }, { status: 404 });
    const student = snap.data() || {};
    if (!canManageSchool(actor, student.school_id || student.school)) throw new Error('forbidden');

    const updates: Record<string, unknown> = {
      updated_at: FieldValue.serverTimestamp(),
      updated_by: actor.uid,
    };

    if (action === 'transfer') {
      const nextSchool = String(body.school_id || body.school || '').trim();
      if (!nextSchool) return Response.json({ ok: false, error: 'school_id is required' }, { status: 400 });
      if (!canManageSchool(actor, nextSchool)) throw new Error('forbidden');
      Object.assign(updates, {
        previous_school_id: student.school_id || student.school || null,
        school_id: nextSchool,
        school: nextSchool,
        transferred_at: FieldValue.serverTimestamp(),
        transfer_note: String(body.note || '').slice(0, 500),
      });
    } else if (action === 'withdraw') {
      const cancelMonth = String(body.enrollment_cancel_month || '').trim();
      const reason = String(body.enrollment_cancel_reason || '').trim();
      if (!monthPattern.test(cancelMonth)) return Response.json({ ok: false, error: '解除月はYYYY-MMで入力してください' }, { status: 400 });
      if (!reason) return Response.json({ ok: false, error: '解除理由は必須です' }, { status: 400 });
      Object.assign(updates, {
        account_status: 'withdrawn',
        status: 'withdrawn',
        enrollment_cancel_month: cancelMonth,
        enrollment_cancel_reason: reason.slice(0, 1000),
        withdrawn_at: FieldValue.serverTimestamp(),
      });
    } else if (action === 'relations') {
      const siblingIds: string[] = Array.isArray(body.sibling_ids) ? body.sibling_ids.map(String).filter(Boolean) : [];
      const twinSiblingIds: string[] = Array.isArray(body.twin_sibling_ids) ? body.twin_sibling_ids.map(String).filter(Boolean) : [];
      Object.assign(updates, { sibling_ids: siblingIds, twin_sibling_ids: twinSiblingIds });
      await Promise.all(siblingIds.map(siblingId => db.collection('users').doc(siblingId).set({
        sibling_ids: FieldValue.arrayUnion(userId),
        ...(twinSiblingIds.includes(siblingId) ? { twin_sibling_ids: FieldValue.arrayUnion(userId) } : {}),
        updated_at: FieldValue.serverTimestamp(),
        updated_by: actor.uid,
      }, { merge: true })));
    } else {
      return Response.json({ ok: false, error: 'invalid action' }, { status: 400 });
    }

    await ref.set(updates, { merge: true });
    const eventId = await writeLearningEvent({
      actor_id: actor.uid,
      actor_role: actor.role,
      type: `school_student_${action}`,
      target_id: userId,
      target_type: 'user',
      school: String(updates.school_id || student.school_id || student.school || ''),
      metadata: { action },
    });

    return Response.json({ ok: true, updates, event_id: eventId });
  } catch (error) {
    return jsonError(error);
  }
}
