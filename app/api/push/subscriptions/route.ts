import { NextRequest } from 'next/server';
import { FieldValue } from 'firebase-admin/firestore';
import { adminDb } from '@/lib/firebase-admin';
import { getServerUser, jsonError } from '@/lib/server-auth';
import { MAX_PUSH_SUBSCRIPTIONS_PER_USER, PUSH_SUBSCRIPTIONS, pushSubscriptionId } from '@/lib/server/web-push';

export const runtime = 'nodejs';

// この端末への通知（Web Push）の登録・解除。保存するのはログイン中の本人の分だけ。

const KEY_PATTERN = /^[A-Za-z0-9_-]+={0,2}$/;

function parseEndpoint(value: unknown) {
  const endpoint = String(value || '').trim();
  if (!endpoint || endpoint.length > 2048) return null;
  try {
    const url = new URL(endpoint);
    if (url.protocol !== 'https:' || !url.hostname || url.username || url.password) return null;
    return url.toString();
  } catch {
    return null;
  }
}

function parseKey(value: unknown, min: number, max: number) {
  const key = String(value || '').trim();
  return key.length >= min && key.length <= max && KEY_PATTERN.test(key) ? key : null;
}

const millis = (value: any) => Number(value?.toMillis?.() || 0);

export async function POST(request: NextRequest) {
  try {
    const user = await getServerUser(request);
    const body = await request.json().catch(() => ({}));
    const subscription = body?.subscription || {};
    const endpoint = parseEndpoint(subscription.endpoint);
    const p256dh = parseKey(subscription.keys?.p256dh, 40, 200);
    const auth = parseKey(subscription.keys?.auth, 8, 64);
    if (!endpoint || !p256dh || !auth) {
      return Response.json({ ok: false, error: 'invalid-subscription' }, { status: 400 });
    }

    const db = adminDb();
    const id = pushSubscriptionId(endpoint);
    const collection = db.collection(PUSH_SUBSCRIPTIONS);
    // 同じ人の端末は最大10台。新しい端末を登録するときは古いものから外す。
    const existing = await collection.where('user_id', '==', user.uid).limit(MAX_PUSH_SUBSCRIPTIONS_PER_USER + 10).get();
    const others = existing.docs.filter(doc => doc.id !== id)
      .sort((a, b) => millis(a.data()?.updated_at || a.data()?.created_at) - millis(b.data()?.updated_at || b.data()?.created_at));
    const removeCount = Math.max(0, others.length - (MAX_PUSH_SUBSCRIPTIONS_PER_USER - 1));
    const batch = db.batch();
    others.slice(0, removeCount).forEach(doc => batch.delete(doc.ref));
    const alreadyMine = existing.docs.some(doc => doc.id === id);
    batch.set(collection.doc(id), {
      user_id: user.uid,
      role: user.role,
      endpoint,
      keys: { p256dh, auth },
      user_agent: String(request.headers.get('user-agent') || '').slice(0, 300),
      ...(alreadyMine ? {} : { created_at: FieldValue.serverTimestamp() }),
      updated_at: FieldValue.serverTimestamp(),
    }, { merge: true });
    await batch.commit();
    return Response.json({ ok: true, removed: removeCount });
  } catch (error) {
    return jsonError(error);
  }
}

export async function DELETE(request: NextRequest) {
  try {
    const user = await getServerUser(request);
    const body = await request.json().catch(() => ({}));
    const endpoint = parseEndpoint(body?.endpoint);
    if (!endpoint) return Response.json({ ok: false, error: 'invalid-endpoint' }, { status: 400 });
    const ref = adminDb().collection(PUSH_SUBSCRIPTIONS).doc(pushSubscriptionId(endpoint));
    const snap = await ref.get();
    // 他の人の端末の登録は消さない（存在を知らせないよう、結果は同じにする）。
    if (snap.exists && snap.data()?.user_id === user.uid) await ref.delete();
    return Response.json({ ok: true });
  } catch (error) {
    return jsonError(error);
  }
}
