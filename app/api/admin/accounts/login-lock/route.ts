import { NextRequest } from 'next/server';
import { adminDb } from '@/lib/firebase-admin';
import { canManageSchool, getServerUser, jsonError, requireRole } from '@/lib/server-auth';
import { writeAuditLog } from '@/lib/server/audit-log';
import { loginLockStatus, unlockLoginAccount } from '@/lib/server/login-lock';

export const runtime = 'nodejs';

// 校舎管理者が解けるのは、担当校舎の生徒・保護者だけ（パスワードの変更と同じ範囲）。マスター（サポートセンター）はだれでも解ける。
const SCHOOL_ADMIN_TARGET_ROLES = new Set(['student', 'parent', 'guardian']);

async function loadTarget(request: NextRequest, userId: string) {
  const actor = await getServerUser(request);
  requireRole(actor, ['master', 'admin']);
  if (!userId) throw new Error('対象アカウントを選択してください。');
  const snap = await adminDb().collection('users').doc(userId).get();
  if (!snap.exists) throw new Error('対象アカウントが見つかりません。');
  const profile = snap.data() || {};
  if (actor.role !== 'master') {
    const school = String(profile.school_id || profile.school_code || profile.school || '').trim();
    if (!SCHOOL_ADMIN_TARGET_ROLES.has(String(profile.role || '').toLowerCase()) || !school || !canManageSchool(actor, school)) throw new Error('forbidden');
  }
  // ログインに使えるID（生徒番号・職員番号・メール）ごとにロックを数えているので、全部を見る。
  const accounts = Array.from(new Set([profile.lifetime_id, profile.initial_login_id, profile.email]
    .map(value => String(value || '').trim().toLowerCase()).filter(Boolean)));
  return { actor, profile, accounts };
}

export async function GET(request: NextRequest) {
  try {
    const { accounts } = await loadTarget(request, String(request.nextUrl.searchParams.get('user_id') || '').trim());
    const states = await Promise.all(accounts.map(account => loginLockStatus(account)));
    const lockedUntil = states.map(state => state.locked_until).filter(Boolean).sort().at(-1) || null;
    return Response.json({ ok: true, locked: Boolean(lockedUntil), locked_until: lockedUntil, has_failures: states.some(state => state.records > 0) });
  } catch (error) {
    return jsonError(error);
  }
}

export async function POST(request: NextRequest) {
  try {
    const body = await request.json().catch(() => ({}));
    const userId = String(body.user_id || '').trim();
    const { actor, profile, accounts } = await loadTarget(request, userId);
    const removed = (await Promise.all(accounts.map(account => unlockLoginAccount(account)))).reduce((sum, count) => sum + count, 0);
    await writeAuditLog({
      actor,
      action: 'login_lock_release',
      target_type: 'user',
      target_id: userId,
      target_label: String(profile.lifetime_id || profile.initial_login_id || ''),
      school_id: String(profile.school_id || profile.school || ''),
      details: { target_role: String(profile.role || ''), removed_records: removed },
    });
    return Response.json({ ok: true, removed });
  } catch (error) {
    return jsonError(error);
  }
}
