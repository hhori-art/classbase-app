import { NextRequest } from 'next/server';
import { FieldValue } from 'firebase-admin/firestore';
import { adminAuth, adminDb } from '@/lib/firebase-admin';
import { canManageSchool, getServerUser, jsonError, requireMaster } from '@/lib/server-auth';

const STATUSES = ['active', 'suspended', 'withdrawn', 'archived'];

export async function POST(request: NextRequest) {
  try {
    const user = await getServerUser(request);
    requireMaster(user);

    const body = await request.json();
    const requestedIds = Array.isArray(body.user_ids)
      ? body.user_ids.map((value: unknown) => String(value || '').trim()).filter(Boolean)
      : [String(body.user_id || '').trim()].filter(Boolean);
    const userIds = Array.from(new Set<string>(requestedIds));
    const status = String(body.status || '');
    if (userIds.length === 0 || userIds.length > 100 || !STATUSES.includes(status)) {
      return Response.json({ ok: false, error: 'invalid user_id/user_ids/status' }, { status: 400 });
    }
    if (userIds.includes(user.uid)) {
      return Response.json({ ok: false, error: '自分自身のアカウント状態は変更できません' }, { status: 400 });
    }

    const db = adminDb();
    const refs = userIds.map(userId => db.collection('users').doc(userId));
    const targetSnaps = await db.getAll(...refs);
    if (targetSnaps.some(snap => !snap.exists)) {
      return Response.json({ ok: false, error: 'user not found' }, { status: 404 });
    }

    const targets = targetSnaps.map(snap => ({ id: snap.id, ref: snap.ref, data: snap.data() || {} }));
    for (const target of targets) {
      const targetSchool = target.data.school_id || target.data.school;
      if (!canManageSchool(user, targetSchool)) throw new Error('forbidden');
      if (target.data.role === 'master' && target.id !== user.uid) {
        return Response.json({ ok: false, error: 'マスター管理者の状態はこの画面から変更できません' }, { status: 400 });
      }
    }

    const auth = adminAuth();
    const desiredDisabled = status !== 'active';
    const priorAuthDisabled = new Map(targets.map(target => [
      target.id,
      ['suspended', 'withdrawn', 'archived'].some(previous =>
        target.data.account_status === previous || target.data.status === previous
      ),
    ]));
    const changedAuthIds: string[] = [];

    try {
      for (const target of targets) {
        await auth.updateUser(target.id, { disabled: desiredDisabled });
        changedAuthIds.push(target.id);
      }

      const now = FieldValue.serverTimestamp();
      const batch = db.batch();
      const eventIds: string[] = [];
      targets.forEach(target => {
        batch.set(target.ref, {
          account_status: status,
          status,
          suspended_at: status === 'suspended' ? now : target.data.suspended_at || null,
          withdrawn_at: status === 'withdrawn' ? now : target.data.withdrawn_at || null,
          archived_at: status === 'archived' ? now : target.data.archived_at || null,
          ...(status === 'active' ? { restored_at: now, restored_by: user.uid } : {}),
          updated_at: now,
          updated_by: user.uid,
        }, { merge: true });
        const eventRef = db.collection('learning_events').doc();
        eventIds.push(eventRef.id);
        batch.set(eventRef, {
          actor_id: user.uid,
          actor_role: user.role,
          type: 'account_status_changed',
          target_id: target.id,
          target_type: 'user',
          school: target.data.school_id || target.data.school || '',
          metadata: { status, bulk: userIds.length > 1 },
          created_at: now,
        });
      });
      await batch.commit();

      await Promise.allSettled(targets.map(target => auth.revokeRefreshTokens(target.id)));
      return Response.json({ ok: true, count: targets.length, event_id: eventIds[0], event_ids: eventIds });
    } catch (error) {
      await Promise.allSettled(changedAuthIds.map(uid =>
        auth.updateUser(uid, { disabled: priorAuthDisabled.get(uid) === true })
      ));
      throw error;
    }
  } catch (error) {
    return jsonError(error);
  }
}
