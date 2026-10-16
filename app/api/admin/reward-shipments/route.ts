import { NextRequest } from 'next/server';
import { FieldValue } from 'firebase-admin/firestore';
import { adminDb } from '@/lib/firebase-admin';
import { getServerUser, jsonError } from '@/lib/server-auth';
import { SHIPMENT_STATUSES, SHIPMENT_TRANSITIONS, type ShipmentStatus } from '@/lib/rewards';
import { canManageStudentRewards, rejectRewardRequest, requireRewardCatalogManager, studentSchoolOf } from '@/lib/server/reward-store';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

const iso = (value: any) => value?.toDate?.()?.toISOString?.() || (typeof value === 'string' ? value : null);
const statusOf = (value: unknown): ShipmentStatus =>
  (SHIPMENT_STATUSES as readonly string[]).includes(String(value)) ? value as ShipmentStatus : 'pending';

// 実物景品（交換・ガチャ当選）の発送状況一覧。マスター以外は担当校の生徒分だけを返す。
export async function GET(request: NextRequest) {
  try {
    const user = await getServerUser(request);
    requireRewardCatalogManager(user);
    const db = adminDb();
    const snap = await db.collection('requests').where('type', '==', 'exchange').limit(1000).get();
    const docs = snap.docs;
    const uids = Array.from(new Set(docs.map(doc => String(doc.data().userId || doc.data().user_id || '')).filter(Boolean)));
    const profileSnaps = uids.length ? await db.getAll(...uids.map(uid => db.collection('users').doc(uid))) : [];
    const profiles = new Map(profileSnaps.map(doc => [doc.id, doc.data() || {}]));
    const shipments = docs
      .map(doc => {
        const data = doc.data();
        const uid = String(data.userId || data.user_id || '');
        const profile = profiles.get(uid) || {};
        return { doc, data, uid, profile };
      })
      .filter(({ profile }) => canManageStudentRewards(user, profile))
      .map(({ doc, data, uid, profile }) => ({
        id: doc.id,
        user_id: uid,
        student_name: String(profile.student_name || profile.name || data.userName || '生徒'),
        school: studentSchoolOf(profile) || String(data.school || ''),
        grade: String(profile.grade || ''),
        reward_id: String(data.rewardId || data.reward_id || ''),
        reward_name: String(data.rewardName || data.reward_name || ''),
        reward_image_url: String(data.reward_image_url || ''),
        origin: data.origin === 'gacha' ? 'gacha' : 'shop',
        gacha_name: data.gacha_name || null,
        cost: Number(data.cost || 0),
        status: statusOf(data.status),
        shipping_note: String(data.shipping_note || ''),
        student_note: String(data.student_note || ''),
        created_at: iso(data.created_at),
        updated_at: iso(data.updated_at || data.processed_at),
      }))
      .sort((a, b) => String(b.created_at || '').localeCompare(String(a.created_at || '')));
    return Response.json({ ok: true, shipments }, { headers: { 'Cache-Control': 'private, no-store' } });
  } catch (error) {
    return jsonError(error);
  }
}

// 発送状況を進める。取り消し（rejected）はコインを返金し在庫を戻す。
export async function POST(request: NextRequest) {
  try {
    const actor = await getServerUser(request);
    requireRewardCatalogManager(actor);
    const body = await request.json().catch(() => ({}));
    const requestId = String(body.request_id || '').trim().slice(0, 300);
    const nextStatus = String(body.status || '') as ShipmentStatus;
    const note = String(body.shipping_note || '').trim().slice(0, 500);
    const studentNote = String(body.student_note || '').trim().slice(0, 300);
    if (!requestId || !(SHIPMENT_STATUSES as readonly string[]).includes(nextStatus) || nextStatus === 'pending') {
      return Response.json({ ok: false, error: 'invalid shipment update' }, { status: 400 });
    }
    const db = adminDb();
    const requestRef = db.collection('requests').doc(requestId);
    const result = await db.runTransaction(async tx => {
      const snap = await tx.get(requestRef);
      const data = snap.data() || {};
      if (!snap.exists || data.type !== 'exchange') throw new Error('shipment-not-found');
      const uid = String(data.userId || data.user_id || '');
      const profileSnap = await tx.get(db.collection('users').doc(uid));
      if (!canManageStudentRewards(actor, profileSnap.data() || {})) throw new Error('forbidden');
      const current = statusOf(data.status);
      if (!SHIPMENT_TRANSITIONS[current].includes(nextStatus)) throw new Error('shipment-status-not-allowed');
      if (nextStatus === 'rejected') return rejectRewardRequest(tx, requestRef, data, actor.uid, note);
      tx.update(requestRef, {
        status: nextStatus,
        shipping_note: note || data.shipping_note || '',
        student_note: studentNote || data.student_note || '',
        updated_at: FieldValue.serverTimestamp(),
        processed_at: FieldValue.serverTimestamp(),
        processed_by: actor.uid,
        status_history: FieldValue.arrayUnion({ status: nextStatus, at: new Date().toISOString(), by: actor.uid }),
      });
      return { status: nextStatus, refunded: 0 };
    });
    return Response.json({ ok: true, ...result });
  } catch (error) {
    return jsonError(error);
  }
}
