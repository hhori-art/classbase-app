import { NextRequest } from 'next/server';
import { FieldValue } from 'firebase-admin/firestore';
import { adminAuth, adminDb } from '@/lib/firebase-admin';
import { getServerUser, jsonError, requireMaster } from '@/lib/server-auth';
import { writeLearningEvent } from '@/lib/events';

export const runtime = 'nodejs';

export async function POST(request: NextRequest) {
  try {
    const actor = await getServerUser(request);
    requireMaster(actor);
    const body = await request.json().catch(() => ({}));
    const userId = String(body.user_id || '').trim();
    const password = String(body.password || '');
    if (!userId) return Response.json({ ok: false, error: '対象アカウンを選択してください。' }, { status: 400 });
    if (password.length < 6 || password.length > 128) {
      return Response.json({ ok: false, error: '新しいパスワードは6〜128文字で入力してください。' }, { status: 400 });
    }

    const db = adminDb();
    const userRef = db.collection('users').doc(userId);
    const snapshot = await userRef.get();
    if (!snapshot.exists) return Response.json({ ok: false, error: '対象アカウンが見つかりません。' }, { status: 404 });
    const profile = snapshot.data() || {};

    await adminAuth().updateUser(userId, { password });
    await adminAuth().revokeRefreshTokens(userId);

    const firstLoginCompleted = profile.isFirstLogin === false;
    await userRef.set({
      // 初回ログイン後のPWはFirestoreに保存しない。
      initial_password: firstLoginCompleted ? FieldValue.delete() : password,
      raw_password: firstLoginCompleted ? FieldValue.delete() : password,
      password: FieldValue.delete(),
      password_changed_at: FieldValue.serverTimestamp(),
      password_changed_by: actor.uid,
      credentials_synced_at: FieldValue.serverTimestamp(),
      credentials_synced_by: actor.uid,
      updated_at: FieldValue.serverTimestamp(),
    }, { merge: true });

    try {
      await writeLearningEvent({
        actor_id: actor.uid,
        actor_role: actor.role,
        type: 'account_password_changed_by_master',
        target_id: userId,
        target_type: 'user',
        school: String(profile.school_id || profile.school || actor.school || ''),
        metadata: { first_login_completed: firstLoginCompleted },
      });
    } catch (eventError) {
      console.error('[admin/accounts/password] audit event failed', eventError);
    }

    return Response.json({
      ok: true,
      user_id: userId,
      first_login_completed: firstLoginCompleted,
      reauth_required: actor.uid === userId,
    });
  } catch (error) {
    console.error('[admin/accounts/password] failed', error);
    return jsonError(error);
  }
}
