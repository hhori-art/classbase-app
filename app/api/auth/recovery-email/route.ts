import { NextRequest } from 'next/server';
import { FieldValue, Timestamp } from 'firebase-admin/firestore';
import { adminDb } from '@/lib/firebase-admin';
import { getServerUser, jsonError } from '@/lib/server-auth';
import {
  EMAIL_VERIFICATION_TTL_MS,
  consumeRateLimit,
  getPublicBaseUrl,
  hashSecret,
  isUsableRecoveryEmail,
  newSecretToken,
  normalizeEmail,
  queueRecoveryEmail,
  requestFingerprint,
} from '@/lib/server/password-recovery';

export const runtime = 'nodejs';

export async function POST(request: NextRequest) {
  try {
    const user = await getServerUser(request);
    const body = await request.json();
    const email = normalizeEmail(body.email);
    if (!isUsableRecoveryEmail(email)) {
      return Response.json({ ok: false, error: 'invalid-email' }, { status: 400 });
    }

    const allowed = await consumeRateLimit(
      requestFingerprint(['verify-email', user.uid]),
      3,
      60 * 60 * 1000
    );
    if (!allowed) return Response.json({ ok: false, error: 'too-many-requests' }, { status: 429 });

    const token = newSecretToken();
    const expiresAt = new Date(Date.now() + EMAIL_VERIFICATION_TTL_MS);
    await adminDb().collection('email_verification_tokens').add({
      user_id: user.uid,
      email,
      token_hash: hashSecret(token),
      expires_at: Timestamp.fromDate(expiresAt),
      used_at: null,
      created_at: FieldValue.serverTimestamp(),
    });

    const actionUrl = `${getPublicBaseUrl(request)}/verify-email?token=${encodeURIComponent(token)}`;
    await queueRecoveryEmail({
      to: email,
      subject: '【創造学園アプリ】連絡先メールの確認',
      heading: '連絡先メールを確認してください',
      body: 'このメールアドレスを、パスワードを忘れたときの本人確認先として登録します。',
      actionLabel: 'メールアドレスを確認する',
      actionUrl,
      expiresIn: '30分',
      kind: 'recovery_email_verification',
      userId: user.uid,
    });

    await adminDb().collection('users').doc(user.uid).set({
      pending_recovery_email: email,
      recovery_email_verification_sent_at: FieldValue.serverTimestamp(),
      updated_at: FieldValue.serverTimestamp(),
    }, { merge: true });

    return Response.json({ ok: true });
  } catch (error) {
    return jsonError(error);
  }
}

export async function PATCH(request: NextRequest) {
  try {
    const body = await request.json();
    const token = String(body.token || '').trim();
    if (!token) return Response.json({ ok: false, error: 'invalid-token' }, { status: 400 });

    const snapshot = await adminDb().collection('email_verification_tokens')
      .where('token_hash', '==', hashSecret(token))
      .limit(1)
      .get();
    if (snapshot.empty) return Response.json({ ok: false, error: 'invalid-token' }, { status: 400 });

    const tokenRef = snapshot.docs[0].ref;
    await adminDb().runTransaction(async transaction => {
      const tokenSnapshot = await transaction.get(tokenRef);
      const data = tokenSnapshot.data() || {};
      const expiresAt = data.expires_at?.toMillis?.() || 0;
      if (data.used_at || expiresAt < Date.now()) throw new Error('invalid-or-expired-token');

      const userRef = adminDb().collection('users').doc(String(data.user_id || ''));
      transaction.set(userRef, {
        recovery_email: normalizeEmail(data.email),
        recovery_email_verified_at: FieldValue.serverTimestamp(),
        pending_recovery_email: FieldValue.delete(),
        updated_at: FieldValue.serverTimestamp(),
      }, { merge: true });
      transaction.set(tokenRef, { used_at: FieldValue.serverTimestamp() }, { merge: true });
    });

    return Response.json({ ok: true });
  } catch (error) {
    const message = error instanceof Error ? error.message : '';
    if (message === 'invalid-or-expired-token') {
      return Response.json({ ok: false, error: message }, { status: 400 });
    }
    return jsonError(error);
  }
}

