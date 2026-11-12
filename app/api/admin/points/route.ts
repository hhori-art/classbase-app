import { NextRequest } from 'next/server';
import { FieldValue } from 'firebase-admin/firestore';
import { adminDb } from '@/lib/firebase-admin';
import { getServerUser, jsonError } from '@/lib/server-auth';
import { findBadge } from '@/lib/gamification';
import { STUDENT_FEATURE_OVERRIDE_LABELS, hasStudentFeatureOverride, isStudentFeatureOverrideKey } from '@/lib/portal-feature-access';
import { canManageStudentRewards, requireRewardCatalogManager, studentSchoolOf } from '@/lib/server/reward-store';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

const MAX_ADJUSTMENT = 10_000;
const iso = (value: any) => value?.toDate?.()?.toISOString?.() || (typeof value === 'string' ? value : null);
const badRequest = (error: string) => Response.json({ ok: false, error }, { status: 400 });

// user_id なし：担当範囲の生徒一覧（コイン残高つき）。user_id あり：その生徒の最近のコイン履歴。
export async function GET(request: NextRequest) {
  try {
    const user = await getServerUser(request);
    requireRewardCatalogManager(user);
    const db = adminDb();
    const userId = request.nextUrl.searchParams.get('user_id') || '';
    if (userId) {
      const profileSnap = await db.collection('users').doc(userId).get();
      const profile = profileSnap.data() || {};
      if (!profileSnap.exists || profile.role !== 'student' || !canManageStudentRewards(user, profile)) throw new Error('forbidden');
      const historySnap = await db.collection('coin_transactions').where('user_id', '==', userId).limit(300).get();
      const history = historySnap.docs
        .map(doc => {
          const data = doc.data();
          return { id: doc.id, amount: Number(data.amount || 0), reason: String(data.reason || ''), source: String(data.source || ''), created_at: iso(data.created_at) };
        })
        .sort((a, b) => String(b.created_at || '').localeCompare(String(a.created_at || '')))
        .slice(0, 50);
      return Response.json({ ok: true, history, earned_badges: Array.isArray(profile.earned_badges) ? profile.earned_badges : [] });
    }
    const snap = await db.collection('users').where('role', '==', 'student')
      .select('student_name', 'name', 'grade', 'school_id', 'school_code', 'school', 'coins', 'total_coins', 'earned_badges', 'lifetime_id', 'account_status', 'status', 'feature_overrides')
      .limit(5000).get();
    const students = snap.docs
      .map(doc => ({ id: doc.id, data: doc.data() }))
      .filter(({ data }) => canManageStudentRewards(user, data))
      .map(({ id, data }) => ({
        id,
        name: String(data.student_name || data.name || '名前未設定'),
        grade: String(data.grade || ''),
        school: studentSchoolOf(data),
        login_id: String(data.lifetime_id || ''),
        coins: Number(data.coins || 0),
        total_coins: Number(data.total_coins || 0),
        badge_count: Array.isArray(data.earned_badges) ? data.earned_badges.length : 0,
        inactive: ['suspended', 'withdrawn', 'archived'].includes(String(data.account_status || data.status || '').toLowerCase()),
        shop_override: hasStudentFeatureOverride(data, 'shop'),
        community_override: hasStudentFeatureOverride(data, 'community'),
      }))
      .sort((a, b) => a.school.localeCompare(b.school, 'ja') || a.grade.localeCompare(b.grade, 'ja') || a.name.localeCompare(b.name, 'ja'));
    return Response.json({ ok: true, students }, { headers: { 'Cache-Control': 'private, no-store' } });
  } catch (error) {
    return jsonError(error);
  }
}

// action: adjust（コイン増減）/ grant_badge / revoke_badge（先生からの特別バッジ）
export async function POST(request: NextRequest) {
  try {
    const actor = await getServerUser(request);
    requireRewardCatalogManager(actor);
    const body = await request.json().catch(() => ({}));
    const action = String(body.action || '');
    const userId = String(body.user_id || '').trim().slice(0, 200);
    if (!userId) return badRequest('user_id is required');
    const db = adminDb();
    const userRef = db.collection('users').doc(userId);

    if (action === 'adjust') {
      const amount = Number(body.amount);
      const reason = String(body.reason || '').trim().slice(0, 200);
      const adjustmentId = String(body.adjustment_id || '').trim();
      if (!Number.isInteger(amount) || amount === 0 || Math.abs(amount) > MAX_ADJUSTMENT) {
        return badRequest(`増減するコインは±${MAX_ADJUSTMENT.toLocaleString()}以内の0以外の整数で入力してください`);
      }
      if (!reason) return badRequest('理由を入力してください（生徒の履歴に表示されます）');
      if (!/^[a-zA-Z0-9_-]{8,80}$/.test(adjustmentId)) return badRequest('adjustment_id is required');
      const txRef = db.collection('coin_transactions').doc(`${userId}_admin_adjustment_${adjustmentId}`);
      const result = await db.runTransaction(async tx => {
        const [userSnap, txSnap] = await Promise.all([tx.get(userRef), tx.get(txRef)]);
        const profile = userSnap.data() || {};
        if (!userSnap.exists || profile.role !== 'student' || !canManageStudentRewards(actor, profile)) throw new Error('forbidden');
        if (txSnap.exists) return { applied: false, coins: Number(profile.coins || 0) };
        const current = Number(profile.coins || 0);
        if (current + amount < 0) throw new Error(`所持コイン（${current}）を超えて減らすことはできません`);
        tx.set(txRef, {
          user_id: userId, amount, reason: `${amount > 0 ? '先生から' : '調整'}: ${reason}`,
          actor_id: actor.uid, source: 'admin_adjustment', source_id: adjustmentId,
          metadata: { actor_role: actor.role }, created_at: FieldValue.serverTimestamp(),
        });
        // 加算は累計（ランク・ランキング）にも反映し、減算は所持コインだけを減らす。
        tx.set(userRef, {
          coins: FieldValue.increment(amount),
          ...(amount > 0 ? { total_coins: FieldValue.increment(amount) } : {}),
          updated_at: FieldValue.serverTimestamp(),
        }, { merge: true });
        tx.set(db.collection('admin_audit_logs').doc(), {
          action: 'points.adjust', target_type: 'user', target_id: userId, actor_uid: actor.uid, actor_role: actor.role,
          metadata: { amount, reason }, created_at: FieldValue.serverTimestamp(),
        });
        return { applied: true, coins: current + amount };
      });
      return Response.json({ ok: true, ...result });
    }

    if (action === 'grant_badge' || action === 'revoke_badge') {
      const badge = findBadge(body.badge_id);
      if (!badge || badge.metric !== 'manual') return badRequest('授与できるのは特別バッジだけです');
      const result = await db.runTransaction(async tx => {
        const userSnap = await tx.get(userRef);
        const profile = userSnap.data() || {};
        if (!userSnap.exists || profile.role !== 'student' || !canManageStudentRewards(actor, profile)) throw new Error('forbidden');
        const granting = action === 'grant_badge';
        tx.set(userRef, {
          earned_badges: granting ? FieldValue.arrayUnion(badge.id) : FieldValue.arrayRemove(badge.id),
          ...(!granting && profile.selected_badge === badge.id ? { selected_badge: 'badge_1' } : {}),
          updated_at: FieldValue.serverTimestamp(),
        }, { merge: true });
        tx.set(db.collection('admin_audit_logs').doc(), {
          action: granting ? 'badge.grant' : 'badge.revoke', target_type: 'user', target_id: userId,
          actor_uid: actor.uid, actor_role: actor.role, metadata: { badge_id: badge.id }, created_at: FieldValue.serverTimestamp(),
        });
        return { badge_id: badge.id, granted: granting };
      });
      return Response.json({ ok: true, ...result });
    }

    if (action === 'set_shop_override' || action === 'set_feature_override') {
      // 全体設定でオフでも個別に機能を見せる（景品交換・ガチャ、交流掲示板。テスト生徒など）。マスター限定。
      if (actor.role !== 'master') throw new Error('forbidden');
      if (typeof body.enabled !== 'boolean') return badRequest('enabled is required');
      const feature = action === 'set_shop_override' ? 'shop' : body.feature;
      if (!isStudentFeatureOverrideKey(feature)) return badRequest(`feature must be one of ${Object.keys(STUDENT_FEATURE_OVERRIDE_LABELS).join(', ')}`);
      const result = await db.runTransaction(async tx => {
        const userSnap = await tx.get(userRef);
        if (!userSnap.exists || userSnap.data()?.role !== 'student') throw new Error('student-not-found');
        tx.set(userRef, { feature_overrides: { [feature]: body.enabled }, updated_at: FieldValue.serverTimestamp() }, { merge: true });
        tx.set(db.collection('admin_audit_logs').doc(), {
          action: `feature_override.${feature}`, target_type: 'user', target_id: userId, actor_uid: actor.uid, actor_role: actor.role,
          metadata: { enabled: body.enabled }, created_at: FieldValue.serverTimestamp(),
        });
        return { [`${feature}_override`]: body.enabled };
      });
      return Response.json({ ok: true, ...result });
    }

    return badRequest('invalid action');
  } catch (error) {
    return jsonError(error);
  }
}
