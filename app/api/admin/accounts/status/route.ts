import { NextRequest } from 'next/server';
import { FieldValue } from 'firebase-admin/firestore';
import { adminDb } from '@/lib/firebase-admin';
import { canManageSchool, getServerUser, isAdminLike, jsonError } from '@/lib/server-auth';
import { writeLearningEvent } from '@/lib/events';

const STATUSES = ['active', 'suspended', 'withdrawn', 'archived'];

export async function POST(request: NextRequest) {
  try {
    const user = await getServerUser(request);
    if (!isAdminLike(user)) throw new Error('forbidden');

    const body = await request.json();
    const userId = String(body.user_id || '');
    const status = String(body.status || '');
    if (!userId || !STATUSES.includes(status)) {
      return Response.json({ ok: false, error: 'invalid user_id/status' }, { status: 400 });
    }

    const db = adminDb();
    const targetRef = db.collection('users').doc(userId);
    const targetSnap = await targetRef.get();
    if (!targetSnap.exists) return Response.json({ ok: false, error: 'user not found' }, { status: 404 });

    const target = targetSnap.data() || {};
    const targetSchool = target.school_id || target.school;
    if (!canManageSchool(user, targetSchool)) throw new Error('forbidden');

    await targetRef.set({
      account_status: status,
      status,
      suspended_at: status === 'suspended' ? FieldValue.serverTimestamp() : target.suspended_at || null,
      withdrawn_at: status === 'withdrawn' ? FieldValue.serverTimestamp() : target.withdrawn_at || null,
      archived_at: status === 'archived' ? FieldValue.serverTimestamp() : target.archived_at || null,
      updated_at: FieldValue.serverTimestamp(),
      updated_by: user.uid,
    }, { merge: true });

    const eventId = await writeLearningEvent({
      actor_id: user.uid,
      actor_role: user.role,
      type: 'account_status_changed',
      target_id: userId,
      target_type: 'user',
      school: targetSchool,
      metadata: { status },
    });

    return Response.json({ ok: true, event_id: eventId });
  } catch (error) {
    return jsonError(error);
  }
}

