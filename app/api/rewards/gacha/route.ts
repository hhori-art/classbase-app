import { randomInt } from 'node:crypto';
import { NextRequest } from 'next/server';
import { revalidateTag } from 'next/cache';
import { FieldValue } from 'firebase-admin/firestore';
import { adminDb } from '@/lib/firebase-admin';
import { getServerUser, jsonError, requireRole } from '@/lib/server-auth';
import { newlyEligibleBadges } from '@/lib/server/badges';
import {
  drawGachaItem, isRewardDeliverable, ownsPreset, presetOf, presetOwnershipUpdates, requireStudentShopAccess, normalizeGachaItems, REWARD_CATALOG_TAG, rewardKindOf,
  studentSchoolOf, validateGachaRates, writeRewardDelivery,
} from '@/lib/server/reward-store';
import { GACHA_RATE_SCALE } from '@/lib/rewards';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

const drawResultOf = (data: FirebaseFirestore.DocumentData) => ({
  result: data.result === 'win' ? 'win' : 'miss',
  reward: data.reward_id ? {
    id: String(data.reward_id), name: String(data.reward_name || ''),
    image_url: String(data.reward_image_url || ''),
    kind: data.reward_kind === 'digital' || data.reward_kind === 'cosmetic' ? data.reward_kind : 'physical',
    preset_id: String(data.reward_preset_id || ''),
  } : null,
  refund: Number(data.refund || 0),
});

// ガチャを1回まわす。抽選・コイン消費・景品の受け渡し記録を1トランザクションで確定する。
export async function POST(request: NextRequest) {
  try {
    const user = await getServerUser(request);
    requireRole(user, ['student']);
    await requireStudentShopAccess(user);
    const body = await request.json().catch(() => ({}));
    const gachaId = String(body.gacha_id || '').trim().slice(0, 200);
    const drawId = String(body.draw_id || '').trim();
    if (!gachaId || !/^[a-zA-Z0-9_-]{8,80}$/.test(drawId)) {
      return Response.json({ ok: false, error: 'gacha_id and draw_id are required' }, { status: 400 });
    }
    const db = adminDb();
    const gachaRef = db.collection('gachas').doc(gachaId);
    const userRef = db.collection('users').doc(user.uid);
    const drawRef = db.collection('gacha_draws').doc(`${user.uid}_${drawId}`);

    const outcome = await db.runTransaction(async tx => {
      const [gachaSnap, userSnap, drawSnap] = await Promise.all([tx.get(gachaRef), tx.get(userRef), tx.get(drawRef)]);
      const profile = userSnap.data() || {};
      if (drawSnap.exists) {
        return { applied: false, coins: Number(profile.coins || 0), new_badges: [] as string[], ...drawResultOf(drawSnap.data() || {}) };
      }
      const gacha = gachaSnap.data() || {};
      const cost = Number(gacha.cost);
      const items = normalizeGachaItems(gacha.items);
      const missWeight = Math.round(Number(gacha.miss_weight || 0));
      const missRefund = Math.max(0, Math.min(cost, Math.floor(Number(gacha.miss_refund_coins || 0))));
      if (!gachaSnap.exists || gacha.active === false || gacha.archived === true || !Number.isInteger(cost) || cost <= 0 ||
          items.length === 0 || !validateGachaRates(items, missWeight)) {
        throw new Error('gacha-not-available');
      }
      const rewardSnaps = await Promise.all(items.map(item => tx.get(db.collection('rewards').doc(item.reward_id))));
      const rewards = new Map(rewardSnaps.map(snap => [snap.id, snap.data()]));
      const currentCoins = Number(profile.coins || 0);
      if (!userSnap.exists || currentCoins < cost) throw new Error('insufficient-coins');

      const roll = randomInt(GACHA_RATE_SCALE);
      // 在庫切れ・停止中、またはすでに持っているきせかえ等ははずれになる（画面にも明記）。
      const prizeId = drawGachaItem(items.map(item => {
        const reward = rewards.get(item.reward_id);
        return { ...item, available: isRewardDeliverable(reward) && !ownsPreset(profile, reward) };
      }), roll);
      const prize = prizeId ? rewards.get(prizeId) || null : null;
      const refund = prize ? 0 : missRefund;
      const gachaName = String(gacha.name || 'ガチャ');
      const newBadges = newlyEligibleBadges({
        ...profile,
        gacha_draw_count: Number(profile.gacha_draw_count || 0) + 1,
        gacha_win_count: Number(profile.gacha_win_count || 0) + (prize ? 1 : 0),
      });

      tx.set(db.collection('coin_transactions').doc(`${user.uid}_gacha_${drawId}`), {
        user_id: user.uid, amount: -cost, reason: `ガチャ: ${gachaName}`,
        actor_id: user.uid, source: 'gacha_draw', source_id: drawId,
        metadata: { gacha_id: gachaId, reward_id: prizeId, result: prize ? 'win' : 'miss' },
        created_at: FieldValue.serverTimestamp(),
      });
      if (refund > 0) {
        tx.set(db.collection('coin_transactions').doc(`${user.uid}_gacha_refund_${drawId}`), {
          user_id: user.uid, amount: refund, reason: `ガチャはずれ返却: ${gachaName}`,
          actor_id: user.uid, source: 'gacha_miss_refund', source_id: drawId,
          metadata: { gacha_id: gachaId }, created_at: FieldValue.serverTimestamp(),
        });
      }
      tx.set(userRef, {
        coins: FieldValue.increment(refund - cost),
        gacha_draw_count: FieldValue.increment(1),
        gacha_win_count: FieldValue.increment(prize ? 1 : 0),
        ...(prize ? presetOwnershipUpdates(prize) : {}),
        ...(newBadges.length || (prize && presetOf(prize)?.category === 'badge')
          ? { earned_badges: FieldValue.arrayUnion(...newBadges, ...(prize && presetOf(prize)?.category === 'badge' ? [presetOf(prize)!.id] : [])) }
          : {}),
        updated_at: FieldValue.serverTimestamp(),
      }, { merge: true });
      const drawRecord = {
        user_id: user.uid, gacha_id: gachaId, gacha_name: gachaName, cost, roll,
        result: prize ? 'win' : 'miss', refund,
        reward_id: prizeId, reward_name: prize ? String(prize.name || '') : null,
        reward_image_url: prize ? String(prize.image_url || '') : null,
        reward_kind: prize ? rewardKindOf(prize) : null,
        reward_preset_id: prize ? presetOf(prize)?.id || null : null,
        created_at: FieldValue.serverTimestamp(),
      };
      tx.set(drawRef, drawRecord);
      if (prize && prizeId) {
        writeRewardDelivery(tx, {
          userId: user.uid,
          userName: String(user.profile.student_name || user.profile.name || user.email || '生徒'),
          userSchool: studentSchoolOf(user.profile),
          rewardId: prizeId, reward: prize, origin: 'gacha', originId: drawId,
          refundableCost: 0, gachaId, gachaName,
        });
      }
      return { applied: true, coins: currentCoins - cost + refund, new_badges: newBadges, ...drawResultOf(drawRecord) };
    });
    if (outcome.applied && outcome.result === 'win') revalidateTag(REWARD_CATALOG_TAG);
    return Response.json({ ok: true, ...outcome }, { headers: { 'Cache-Control': 'private, no-store' } });
  } catch (error) {
    return jsonError(error);
  }
}
