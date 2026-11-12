import { NextRequest } from 'next/server';
import { FieldValue } from 'firebase-admin/firestore';
import { adminAuth, adminDb } from '@/lib/firebase-admin';
import { canManageSchool, getServerUser, jsonError, requireRole } from '@/lib/server-auth';
import { writeLearningEvent } from '@/lib/events';
import { writeAuditLog } from '@/lib/server/audit-log';
import { passwordPolicyError } from '@/lib/password-policy';
import { clearInitialPasswordWrites, initialPasswordWrites } from '@/lib/server/account-secrets';

export const runtime = 'nodejs';

// 校舎管理者が変更できるのは、担当校舎の生徒・保護者アカウントだけ。
const SCHOOL_ADMIN_TARGET_ROLES = new Set(['student', 'parent', 'guardian']);

export async function POST(request: NextRequest) {
  try {
    const actor = await getServerUser(request);
    requireRole(actor, ['master', 'admin']);
    const body = await request.json().catch(() => ({}));
    const userId = String(body.user_id || '').trim();
    const password = String(body.password || '');
    if (!userId) return Response.json({ ok: false, error: '対象アカウントを選択してください。' }, { status: 400 });
    const db = adminDb();
    const userRef = db.collection('users').doc(userId);
    const snapshot = await userRef.get();
    if (!snapshot.exists) return Response.json({ ok: false, error: '対象アカウントが見つかりません。' }, { status: 404 });
    const profile = snapshot.data() || {};
    const targetRole = String(profile.role || '').toLowerCase();
    if (actor.role !== 'master') {
      const targetSchool = String(profile.school_id || profile.school_code || profile.school || '').trim();
      const sameSchool = Boolean(targetSchool) && canManageSchool(actor, targetSchool);
      if (!SCHOOL_ADMIN_TARGET_ROLES.has(targetRole) || !sameSchool) {
        return Response.json({ ok: false, error: '担当校舎の生徒・保護者アカウントのみ変更できます。' }, { status: 403 });
      }
    }
    const policyError = passwordPolicyError(password, targetRole, [profile.lifetime_id, profile.initial_login_id, profile.email]);
    if (policyError) return Response.json({ ok: false, error: policyError }, { status: 400 });

    await adminAuth().updateUser(userId, { password });
    await adminAuth().revokeRefreshTokens(userId);

    // 初回ログイン前なら、初期パスワードとしてハッシュで置く（KDL診断 A.3.1。平文はどこにも置かない）。
    const firstLoginCompleted = profile.isFirstLogin === false;
    const secretWrites = firstLoginCompleted ? clearInitialPasswordWrites(userId) : initialPasswordWrites(userId, password, actor.uid);
    const batch = db.batch();
    if ('secret' in secretWrites) batch.set(secretWrites.secretRef, secretWrites.secret);
    else batch.delete(secretWrites.secretRef);
    batch.set(userRef, {
      ...secretWrites.userPatch,
      password_changed_at: FieldValue.serverTimestamp(),
      password_changed_by: actor.uid,
      credentials_synced_at: FieldValue.serverTimestamp(),
      credentials_synced_by: actor.uid,
      updated_at: FieldValue.serverTimestamp(),
    }, { merge: true });
    await batch.commit();

    try {
      await writeLearningEvent({
        actor_id: actor.uid,
        actor_role: actor.role,
        type: actor.role === 'master' ? 'account_password_changed_by_master' : 'account_password_changed_by_school_admin',
        target_id: userId,
        target_type: 'user',
        school: String(profile.school_id || profile.school || actor.school || ''),
        metadata: { first_login_completed: firstLoginCompleted, target_role: targetRole },
      });
    } catch (eventError) {
      console.error('[admin/accounts/password] audit event failed', eventError);
    }
    await writeAuditLog({
      actor,
      action: 'account_password_change',
      target_type: 'user',
      target_id: userId,
      target_label: String(profile.name || profile.student_name || profile.teacher_name || profile.lifetime_id || ''),
      school_id: String(profile.school_id || profile.school || ''),
      details: { target_role: targetRole, first_login_completed: firstLoginCompleted },
    });

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
