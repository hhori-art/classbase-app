import { NextRequest } from 'next/server';
import { FieldValue } from 'firebase-admin/firestore';
import { adminDb } from '@/lib/firebase-admin';
import { getServerUser, jsonError } from '@/lib/server-auth';

export const runtime = 'nodejs';

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

    return Response.json({
      ok: true,
      notifications,
    });
  } catch (error) {
    return jsonError(error);
  }
}

export async function PATCH(request: NextRequest) {
  try {
    const user = await getServerUser(request);
    const body = await request.json();
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
