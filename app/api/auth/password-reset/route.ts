import { NextRequest } from 'next/server';
import { FieldValue } from 'firebase-admin/firestore';
import { ACCOUNT_SECRETS_COLLECTION } from '@/lib/server/account-secrets';
import { adminAuth, adminDb } from '@/lib/firebase-admin';
import { getServerUser, isAdminLike, jsonError } from '@/lib/server-auth';
import { assertAccountTargetAllowed } from '@/lib/server/account-credentials';
import { hashSecret, newSecretToken } from '@/lib/server/password-recovery';
import { notifyPasswordChanged, openResetTokenRefs, resetTokensOf, revokeOtherResetTokens, revokedResetToken } from '@/lib/server/password-reset-notice';
import { PASSWORD_RESET_TTL_MS } from '@/lib/password-reset-rules';
import { PASSWORD_MAX_LENGTH, passwordPolicyError } from '@/lib/password-policy';

export const runtime = 'nodejs';

const ADMIN_ROLES = new Set([
  'master', 'admin', 'master_admin', 'super_admin', 'school_admin',
  'branch_admin', 'campus_admin', 'classroom_admin', 'test_admin',
]);

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

    assertAccountTargetAllowed(actor, targetSnap.data() || {});

    // 管理者が出すリンクも10分・1回限り。前に出したリンクは使えなくする。
    await revokeOtherResetTokens(userId);
    const token = newSecretToken();
    const expiresAt = new Date(Date.now() + PASSWORD_RESET_TTL_MS);
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
    if (!password || password.length > PASSWORD_MAX_LENGTH) {
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
    // 新しいリンクが出た・別のリンクで変更済みのときは使えない。
    if (tokenData.revoked_at) return Response.json({ ok: false, error: 'token-revoked' }, { status: 400 });
    if (Number.isNaN(expiresAt.getTime()) || expiresAt.getTime() < Date.now()) {
      return Response.json({ ok: false, error: 'token-expired' }, { status: 400 });
    }

    const userId = String(tokenData.user_id || '');
    if (!userId) return Response.json({ ok: false, error: 'invalid-token' }, { status: 400 });
    const checked = await db.runTransaction(async transaction => {
      const fresh = await transaction.get(tokenDoc.ref);
      if (fresh.data()?.used_at || fresh.data()?.processing_at) throw new Error('token-used');
      if (fresh.data()?.revoked_at) throw new Error('token-revoked');
      const target = await transaction.get(db.collection('users').doc(userId));
      if (!target.exists) throw new Error('invalid-token');
      const targetRole = String(target.data()?.role || '').toLowerCase();
      if (ADMIN_ROLES.has(targetRole)) throw new Error('reset-target-not-allowed');
      // 新しいパスワードのきまり（本人の種別とIDで判定する）。合わないときは何も書かない。
      const profile = target.data() || {};
      const policyError = passwordPolicyError(password, targetRole, [profile.lifetime_id, profile.login_id, profile.initial_login_id, profile.email]);
      if (policyError) return { policyError, profile };
      // 同じアカウントのほかのリンクも、ここで使えなくする（2本のリンクを同時に使わせない）。
      const others = openResetTokenRefs(await transaction.get(resetTokensOf(userId)), tokenDoc.id);
      transaction.set(tokenDoc.ref, { processing_at: FieldValue.serverTimestamp() }, { merge: true });
      others.forEach(ref => transaction.set(ref, revokedResetToken('password_changed'), { merge: true }));
      return { policyError: '', profile };
    });
    if (checked.policyError) {
      return Response.json({ ok: false, error: 'password-policy', message: checked.policyError }, { status: 400 });
    }

    try {
      await adminAuth().updateUser(userId, { password });
      await adminAuth().revokeRefreshTokens(userId);
      await db.collection('users').doc(userId).set({
        initial_password: FieldValue.delete(),
        raw_password: FieldValue.delete(),
        password: FieldValue.delete(),
        isFirstLogin: false,
        password_changed_at: FieldValue.serverTimestamp(),
        updated_at: FieldValue.serverTimestamp(),
      }, { merge: true });
      // 初期パスワード（ハッシュ）も消す（KDL診断 A.3.1）。
      await db.collection(ACCOUNT_SECRETS_COLLECTION).doc(userId).delete();
      await tokenDoc.ref.set({
        used_at: FieldValue.serverTimestamp(),
        processing_at: FieldValue.delete(),
      }, { merge: true });
    } catch (error) {
      await tokenDoc.ref.set({ processing_at: FieldValue.delete() }, { merge: true }).catch(() => undefined);
      throw error;
    }

    // 本人へ知らせる（失敗しても変更は成功のまま）。
    await notifyPasswordChanged({ userId, tokenId: tokenDoc.id, profile: checked.profile, changedAt: new Date() })
      .catch(notifyError => console.error('Password changed notice failed:', notifyError));

    return Response.json({ ok: true });
  } catch (error) {
    return jsonError(error);
  }
}
