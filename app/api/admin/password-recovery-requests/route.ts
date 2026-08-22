import { NextRequest } from 'next/server';
import { FieldValue } from 'firebase-admin/firestore';
import { adminDb } from '@/lib/firebase-admin';
import { getServerUser, jsonError, requireMaster } from '@/lib/server-auth';

export const runtime = 'nodejs';

export async function GET(request: NextRequest) {
  try {
    const actor = await getServerUser(request);
    requireMaster(actor);
    const snapshot = await adminDb().collection('password_recovery_requests')
      .orderBy('created_at', 'desc')
      .limit(100)
      .get();
    const requests = snapshot.docs.map(doc => {
      const data = doc.data();
      return {
        id: doc.id,
        ...data,
        created_at: data.created_at?.toDate?.()?.toISOString?.() || null,
        updated_at: data.updated_at?.toDate?.()?.toISOString?.() || null,
      };
    });
    return Response.json({ ok: true, requests });
  } catch (error) {
    return jsonError(error);
  }
}

export async function PATCH(request: NextRequest) {
  try {
    const actor = await getServerUser(request);
    requireMaster(actor);
    const body = await request.json();
    const requestId = String(body.request_id || '').trim();
    const status = String(body.status || '').trim();
    if (!requestId || !['pending', 'resolved', 'rejected'].includes(status)) {
      return Response.json({ ok: false, error: 'invalid-request' }, { status: 400 });
    }
    await adminDb().collection('password_recovery_requests').doc(requestId).set({
      status,
      handled_by: actor.uid,
      handled_at: status === 'pending' ? null : FieldValue.serverTimestamp(),
      updated_at: FieldValue.serverTimestamp(),
    }, { merge: true });
    return Response.json({ ok: true });
  } catch (error) {
    return jsonError(error);
  }
}
