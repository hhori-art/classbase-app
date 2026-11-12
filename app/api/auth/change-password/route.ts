import { NextRequest } from 'next/server';
import { FieldValue } from 'firebase-admin/firestore';
import { adminAuth, adminDb } from '@/lib/firebase-admin';
import { getServerUser, jsonError } from '@/lib/server-auth';
import { passwordPolicyError } from '@/lib/password-policy';
import { clearInitialPasswordWrites } from '@/lib/server/account-secrets';
import { verifyCurrentPassword } from '@/lib/server/current-password';

export const runtime = 'nodejs';

export async function POST(request: NextRequest) {
  try {
    const user = await getServerUser(request);
    const body = await request.json().catch(() => ({}));
    const password = String(body.password || '');
    const firstLogin = user.profile.isFirstLogin === true;

    const policyError = passwordPolicyError(password, user.profile.role, [user.profile.lifetime_id, user.profile.initial_login_id, user.email]);
    if (policyError) return Response.json({ ok: false, error: policyError, code: 'password-policy' }, { status: 400 });

    // 今のパスワードを確かめる（KDL診断 E.2.2）。初回ログインの直後は、その場で入れたばかりなので聞かない。
    if (!firstLogin) {
      const check = await verifyCurrentPassword(request, user, body.current_password);
      if (!check.ok) return Response.json({ ok: false, error: check.message, code: check.code, retry_after_seconds: check.retryAfterSeconds }, { status: check.status });
    }

    await adminAuth().updateUser(user.uid, { password });
    await adminAuth().revokeRefreshTokens(user.uid);
    // 初期パスワードは、自分のパスワードに変えたら消す（KDL診断 A.3.1）。
    const cleared = clearInitialPasswordWrites(user.uid);
    const batch = adminDb().batch();
    batch.delete(cleared.secretRef);
    batch.set(adminDb().collection('users').doc(user.uid), {
      ...cleared.userPatch,
      isFirstLogin: false,
      password_changed_at: FieldValue.serverTimestamp(),
      updated_at: FieldValue.serverTimestamp(),
    }, { merge: true });
    await batch.commit();

    // ほかの端末のログインは切れる。この端末は、返したトークンで入り直す。
    const token = await adminAuth().createCustomToken(user.uid);
    return Response.json({ ok: true, token });
  } catch (error) {
    return jsonError(error);
  }
}
