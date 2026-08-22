import { NextRequest } from 'next/server';
import { FieldValue } from 'firebase-admin/firestore';
import { adminAuth, adminDb } from '@/lib/firebase-admin';
import { getServerUser, isAdminLike, jsonError } from '@/lib/server-auth';
import { hashSecret, newSecretToken } from '@/lib/server/password-recovery';

export const runtime = 'nodejs';

export async function POST(request: NextRequest) {
  try {
    const actor = await getServerUser(request);
    if (!isAdminLike(actor)) throw new Error('forbidden');
    const body = await request.json();
    const userId = String(body.user_id || '').trim();
    if (!userId) return Response.json({ ok: false, error: 'user_id is required' }, { status: 400 });

    const db = adminDb();
    const targetSnap = await db.collection('users').doc(userId).get();
    if (!targetSnap.exists) return Response.json({ ok: false, error: 'user not found' }, { status: 404 });

    const token = newSecretToken();
    const expiresAt = new Date(Date.now() + 1000 * 60 * 60);
    await db.collection('password_reset_tokens').add({
      user_id: userId,
      token_hash: hashSecret(token),
      purpose: 'admin_issued',
      expires_at: expiresAt,
      used_at: null,
      created_by: actor.uid,
      created_at: FieldValue.serverTimestamp(),
    });

    return Response.json({ ok: true, token, expires_at: expiresAt.toISOString() });
  } catch (error) {
    return jsonError(error);
  }
}

export async function PATCH(request: NextRequest) {
  try {
    const body = await request.json();
    const token = String(body.token || '').trim();
    const password = String(body.password || '');
    if (!token) return Response.json({ ok: false, error: 'token is required' }, { status: 400 });
    if (password.length < 10 || password.length > 128) {
      return Response.json({ ok: false, error: 'password-length' }, { status: 400 });
    }

    const db = adminDb();
    const snap = await db.collection('password_reset_tokens')
      .where('token_hash', '==', hashSecret(token))
      .limit(1)
      .get();
    if (snap.empty) return Response.json({ ok: false, error: 'invalid-token' }, { status: 400 });

    const tokenDoc = snap.docs[0];
    const tokenData = tokenDoc.data() || {};
    const expiresAt = tokenData.expires_at?.toDate ? tokenData.expires_at.toDate() : new Date(tokenData.expires_at);
    if (tokenData.used_at) return Response.json({ ok: false, error: 'token-used' }, { status: 400 });
    if (Number.isNaN(expiresAt.getTime()) || expiresAt.getTime() < Date.now()) {
      return Response.json({ ok: false, error: 'token-expired' }, { status: 400 });
    }

    const userId = String(tokenData.user_id || '');
    await db.runTransaction(async transaction => {
      const fresh = await transaction.get(tokenDoc.ref);
      if (fresh.data()?.used_at || fresh.data()?.processing_at) throw new Error('token-used');
      transaction.set(tokenDoc.ref, { processing_at: FieldValue.serverTimestamp() }, { merge: true });
    });

    try {
      await adminAuth().updateUser(userId, { password });
      await adminAuth().revokeRefreshTokens(userId);
      await db.collection('users').doc(userId).set({
        initial_password: FieldValue.delete(),
        raw_password: FieldValue.delete(),
        isFirstLogin: false,
        password_changed_at: FieldValue.serverTimestamp(),
        updated_at: FieldValue.serverTimestamp(),
      }, { merge: true });
      await tokenDoc.ref.set({
        used_at: FieldValue.serverTimestamp(),
        processing_at: FieldValue.delete(),
      }, { merge: true });
    } catch (error) {
      await tokenDoc.ref.set({ processing_at: FieldValue.delete() }, { merge: true }).catch(() => undefined);
      throw error;
    }

    return Response.json({ ok: true });
  } catch (error) {
    return jsonError(error);
  }
}
