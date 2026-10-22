import { NextRequest } from 'next/server';
import { FieldValue } from 'firebase-admin/firestore';
import { adminDb } from '@/lib/firebase-admin';
import { getServerUser, jsonError } from '@/lib/server-auth';

export const runtime = 'nodejs';

const MARK_ALL_BATCH = 200;

const unreadQuery = (uid: string) => adminDb()
  .collection('user_notifications')
  .where('user_id', '==', uid)
  .where('read', '==', false);

/** 自分宛ての未読数（count() 集計は1,000件ごとに1読取）。使えないときは読み込んだ範囲で数える。 */
async function countUnread(uid: string, fallback: () => number) {
  try {
    const snap = await unreadQuery(uid).count().get();
    return Number(snap.data().count) || 0;
  } catch (error) {
    console.warn('[notifications] unread count fallback', error);
    return fallback();
  }
}

/** 自分宛ての未読を既読にする。1回の操作で最大 MARK_ALL_BATCH 件。残りがあれば remaining で知らせる。 */
async function markAllRead(uid: string) {
  const db = adminDb();
  const snap = await unreadQuery(uid).limit(MARK_ALL_BATCH).get();
  const own = snap.docs.filter(doc => doc.data()?.user_id === uid);
  if (own.length > 0) {
    const batch = db.batch();
    own.forEach(doc => batch.update(doc.ref, {
      read: true,
      read_at: FieldValue.serverTimestamp(),
      updated_at: FieldValue.serverTimestamp(),
    }));
    await batch.commit();
  }
  return { updated: own.length, remaining: snap.size >= MARK_ALL_BATCH };
}

export async function GET(request: NextRequest) {
  try {
    const user = await getServerUser(request);
    const limitParam = Number(request.nextUrl.searchParams.get('limit') || 30);
    const snap = await adminDb()
      .collection('user_notifications')
      .where('user_id', '==', user.uid)
      .limit(120)
      .get();

    const notifications = snap.docs
      .map(doc => ({ id: doc.id, ...doc.data() }))
      .sort((a: any, b: any) => {
        const at = typeof a.created_at?.toMillis === 'function' ? a.created_at.toMillis() : 0;
        const bt = typeof b.created_at?.toMillis === 'function' ? b.created_at.toMillis() : 0;
        return bt - at;
      })
      .slice(0, Math.min(Math.max(limitParam, 1), 80));

    // ベルの未読数は一覧（最新の数十件）ではなく、自分宛ての未読すべてを count() 集計で数える。
    const unreadCount = await countUnread(user.uid, () => snap.docs.filter(doc => doc.data()?.read === false).length);

    return Response.json({
      ok: true,
      notifications,
      unread_count: unreadCount,
    });
  } catch (error) {
    return jsonError(error);
  }
}

export async function PATCH(request: NextRequest) {
  try {
    const user = await getServerUser(request);
    const body = await request.json();
    if (body.all === true) {
      const result = await markAllRead(user.uid);
      return Response.json({ ok: true, ...result });
    }
    const id = String(body.id || '').trim();
    const read = body.read !== false;
    if (!id) return Response.json({ ok: false, error: 'id is required' }, { status: 400 });

    const ref = adminDb().collection('user_notifications').doc(id);
    const snap = await ref.get();
    if (!snap.exists || snap.data()?.user_id !== user.uid) throw new Error('forbidden');

    await ref.set({
      read,
      read_at: read ? FieldValue.serverTimestamp() : null,
      updated_at: FieldValue.serverTimestamp(),
    }, { merge: true });

    return Response.json({ ok: true });
  } catch (error) {
    return jsonError(error);
  }
}
