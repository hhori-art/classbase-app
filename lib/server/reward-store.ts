import { FieldValue } from 'firebase-admin/firestore';
import { unstable_cache } from 'next/cache';
import { adminDb } from '@/lib/firebase-admin';
import { canManageAdminApp } from '@/lib/admin-app-access';
import { resolveAttendanceSchoolCode } from '@/lib/attendance-schools';
import type { ServerUser } from '@/lib/server-auth';
import { hasStudentFeatureOverride, isStudentFeatureEnabled } from '@/lib/portal-feature-access';
import { findRewardPreset, presetRewardKind } from '@/lib/reward-presets';
import { findBadge } from '@/lib/gamification';
import { GACHA_RATE_SCALE, type PublicGacha, type PublicReward, type RewardKind } from '@/lib/rewards';

export const REWARD_CATALOG_TAG = 'reward-catalog';

type Tx = FirebaseFirestore.Transaction;
type Data = FirebaseFirestore.DocumentData;

const schoolCode = (value: unknown) => resolveAttendanceSchoolCode(value) || String(value || '').trim();

export const studentSchoolOf = (profile: Data) =>
  schoolCode(profile.school_id || profile.school_code || profile.school);

/** 景品・ガチャ・特別バッジの設定は理社講座の管理権限を持つ管理者とマスターが行う。 */
export function canManageRewardCatalog(user: ServerUser) {
  return user.role === 'master' || (user.role === 'admin' && canManageAdminApp(user, 'science_social'));
}

export function requireRewardCatalogManager(user: ServerUser) {
  if (!canManageRewardCatalog(user)) throw new Error('forbidden');
}

/** 生徒個人への操作（ポイント増減・発送・バッジ授与）は、マスター以外は担当校の生徒に限る。 */
export function canManageStudentRewards(user: ServerUser, profile: Data) {
  if (!canManageRewardCatalog(user)) return false;
  if (user.role === 'master') return true;
  const target = studentSchoolOf(profile);
  if (!target) return false;
  return [user.school, ...user.school_ids].some(value => schoolCode(value) === target);
}

const loadStudentVisibility = unstable_cache(async () => {
  const snap = await adminDb().collection('settings').doc('portal_visibility').get();
  return (snap.data()?.student || {}) as Record<string, boolean>;
}, ['student-portal-visibility-v1'], { revalidate: 60, tags: ['portal-visibility'] });

/** 景品交換・ガチャは、全体設定で公開中か、マスターが個別に許可した生徒だけが使える。 */
export async function requireStudentShopAccess(user: ServerUser) {
  if (hasStudentFeatureOverride(user.profile, 'shop')) return;
  if (!isStudentFeatureEnabled(await loadStudentVisibility(), user.profile, 'shop')) throw new Error('shop-disabled');
}

export function rewardKindOf(data: Data): RewardKind {
  const preset = findRewardPreset(data.preset_id);
  if (preset) return presetRewardKind(preset);
  return data.kind === 'digital' ? 'digital' : 'physical';
}

/** プリセット景品（きせかえ・バーチャル背景・限定バッジ）は1人1回だけ手に入る。 */
export function presetOf(data: Data | undefined) {
  return findRewardPreset(data?.preset_id) || null;
}

export function ownsPreset(profile: Data, data: Data | undefined) {
  const preset = presetOf(data);
  return Boolean(preset && Array.isArray(profile.owned_cosmetics) && profile.owned_cosmetics.includes(preset.id));
}

/**
 * プリセット景品を手に入れた時のユーザー更新。呼び出し側のユーザー書き込みにまとめて渡す
 * （同じトランザクションで users を二重に書かないため）。限定バッジは earned_badges にも追加する。
 */
export function presetOwnershipUpdates(data: Data | undefined): Record<string, unknown> {
  const preset = presetOf(data);
  if (!preset) return {};
  return {
    owned_cosmetics: FieldValue.arrayUnion(preset.id),
    ...(preset.category === 'badge' && findBadge(preset.id) ? { earned_badges: FieldValue.arrayUnion(preset.id) } : {}),
  };
}

export function stockOf(data: Data): number | null {
  if (data.stock === null || data.stock === undefined || data.stock === '') return null;
  const stock = Number(data.stock);
  return Number.isInteger(stock) && stock >= 0 ? stock : 0;
}

/** 公開中で在庫があり、デジタル景品ならファイルが登録済みであること。 */
export function isRewardDeliverable(data: Data | undefined) {
  if (!data || data.active === false || data.archived === true || !String(data.name || '').trim()) return false;
  const stock = stockOf(data);
  if (stock !== null && stock <= 0) return false;
  if (data.preset_id) return Boolean(presetOf(data));
  if (rewardKindOf(data) === 'digital' && !String(data.digital_file_path || '')) return false;
  return true;
}

export function publicReward(id: string, data: Data): PublicReward {
  return {
    id,
    name: String(data.name || ''),
    description: String(data.description || ''),
    required_coins: Number(data.required_coins || 0),
    image_url: String(data.image_url || ''),
    kind: rewardKindOf(data),
    stock: stockOf(data),
    exchangeable: data.exchangeable !== false,
    preset_id: presetOf(data)?.id || '',
  };
}

type DeliveryInput = {
  userId: string;
  userName: string;
  userSchool: string;
  rewardId: string;
  reward: Data;
  origin: 'shop' | 'gacha';
  originId: string;
  /** 取り消し時に返金するコイン数（ガチャ景品は回した分を返金しないため 0）。 */
  refundableCost: number;
  gachaId?: string;
  gachaName?: string;
};

/**
 * 景品の受け渡し記録を作る。実物は発送管理用の requests、デジタルは reward_grants に保存する。
 * 呼び出し側のトランザクション内で、読み取りをすべて終えた後に呼ぶこと。
 */
export function writeRewardDelivery(tx: Tx, input: DeliveryInput) {
  const db = adminDb();
  const kind = rewardKindOf(input.reward);
  const rewardName = String(input.reward.name || '').trim();
  const stock = stockOf(input.reward);
  if (stock !== null) {
    tx.update(db.collection('rewards').doc(input.rewardId), { stock: FieldValue.increment(-1), updated_at: FieldValue.serverTimestamp() });
  }
  const common = {
    user_id: input.userId,
    reward_id: input.rewardId,
    reward_name: rewardName,
    reward_image_url: String(input.reward.image_url || ''),
    origin: input.origin,
    origin_id: input.originId,
    gacha_id: input.gachaId || null,
    gacha_name: input.gachaName || null,
    created_at: FieldValue.serverTimestamp(),
  };
  if (kind === 'digital' || kind === 'cosmetic') {
    // デジタル・きせかえは受け取り記録だけを残す（所有は presetOwnershipUpdates で users に記録）。
    const preset = presetOf(input.reward);
    const grantRef = db.collection('reward_grants').doc(`${input.origin}_${input.userId}_${input.originId}`);
    tx.set(grantRef, {
      ...common,
      kind,
      preset_id: preset?.id || null,
      builtin_asset: preset && kind === 'digital' ? preset.id : null,
      digital_file_path: String(input.reward.digital_file_path || ''),
      digital_file_name: preset && kind === 'digital' ? `${preset.id}.png` : String(input.reward.digital_file_name || ''),
      download_count: 0,
    });
    return { kind, grant_id: grantRef.id, request_id: null };
  }
  const requestRef = db.collection('requests').doc(`${input.origin === 'shop' ? 'exchange' : 'gacha'}_${input.userId}_${input.originId}`);
  tx.set(requestRef, {
    ...common,
    type: 'exchange',
    kind,
    // 既存の申請画面との互換のため camelCase の項目も保存する。
    userId: input.userId,
    userName: input.userName,
    rewardId: input.rewardId,
    rewardName,
    cost: input.refundableCost,
    school: input.userSchool,
    status: 'pending',
  });
  return { kind, grant_id: null, request_id: requestRef.id };
}

/** 実物景品の取り消し：コインを返金し、在庫管理している景品は在庫を戻す。 */
export async function rejectRewardRequest(tx: Tx, requestRef: FirebaseFirestore.DocumentReference, data: Data, actorId: string, note: string) {
  const db = adminDb();
  const uid = String(data.userId || data.user_id || '');
  const cost = Number(data.cost || 0);
  if (!uid || !Number.isInteger(cost) || cost < 0 || cost > 1_000_000) throw new Error('invalid-refund-data');
  const userRef = db.collection('users').doc(uid);
  const refundRef = db.collection('coin_transactions').doc(`reward_refund_${requestRef.id}`);
  const rewardId = String(data.rewardId || data.reward_id || '');
  const rewardRef = rewardId ? db.collection('rewards').doc(rewardId) : null;
  const [userSnap, refundSnap, rewardSnap] = await Promise.all([
    tx.get(userRef), tx.get(refundRef), rewardRef ? tx.get(rewardRef) : Promise.resolve(null),
  ]);
  if (!userSnap.exists || userSnap.data()?.role !== 'student') throw new Error('student-not-found');
  if (cost > 0) {
    if (refundSnap.exists) throw new Error('refund-already-recorded');
    tx.set(refundRef, {
      user_id: uid, amount: cost, reason: `景品の取り消しによる返金: ${String(data.rewardName || data.reward_name || '')}`,
      actor_id: actorId, source: 'reward_exchange_refund', source_id: requestRef.id,
      metadata: { request_id: requestRef.id, reward_id: rewardId || null }, created_at: FieldValue.serverTimestamp(),
    });
    tx.update(userRef, { coins: FieldValue.increment(cost), updated_at: FieldValue.serverTimestamp() });
  }
  if (rewardSnap?.exists && stockOf(rewardSnap.data() || {}) !== null) {
    tx.update(rewardRef!, { stock: FieldValue.increment(1), updated_at: FieldValue.serverTimestamp() });
  }
  tx.update(requestRef, {
    status: 'rejected', refunded_coins: cost, shipping_note: note || data.shipping_note || '',
    processed_at: FieldValue.serverTimestamp(), processed_by: actorId,
    status_history: FieldValue.arrayUnion({ status: 'rejected', at: new Date().toISOString(), by: actorId }),
  });
  return { status: 'rejected' as const, refunded: cost };
}

export function normalizeGachaItems(raw: unknown) {
  const items = (Array.isArray(raw) ? raw : []).map((item: any) => ({
    reward_id: String(item?.reward_id || '').trim(),
    weight: Math.round(Number(item?.weight || 0)),
  })).filter(item => item.reward_id && Number.isInteger(item.weight) && item.weight > 0);
  return items;
}

export function validateGachaRates(items: { weight: number }[], missWeight: number) {
  const total = items.reduce((sum, item) => sum + item.weight, 0) + missWeight;
  return total === GACHA_RATE_SCALE;
}

/** 0〜(GACHA_RATE_SCALE-1) の乱数で抽選する。在庫切れ・停止中の景品の枠ははずれになる。 */
export function drawGachaItem(items: { reward_id: string; weight: number; available: boolean }[], roll: number) {
  let cursor = 0;
  for (const item of items) {
    cursor += item.weight;
    if (roll < cursor) return item.available ? item.reward_id : null;
  }
  return null;
}

export const loadPublicRewardCatalog = unstable_cache(async () => {
  const db = adminDb();
  const [rewardSnap, gachaSnap] = await Promise.all([
    db.collection('rewards').orderBy('required_coins', 'asc').limit(300).get(),
    db.collection('gachas').limit(50).get(),
  ]);
  const rewardData = new Map(rewardSnap.docs.map(doc => [doc.id, doc.data()]));
  const rewards = rewardSnap.docs
    .filter(doc => {
      const data = doc.data();
      return data.active !== false && data.archived !== true && data.exchangeable !== false;
    })
    .map(doc => publicReward(doc.id, doc.data()))
    .filter(reward => reward.name && Number.isInteger(reward.required_coins) && reward.required_coins > 0);
  const gachas: PublicGacha[] = gachaSnap.docs
    .map(doc => ({ id: doc.id, data: doc.data() }))
    .filter(({ data }) => data.active !== false && data.archived !== true)
    .map(({ id, data }) => ({
      id,
      name: String(data.name || ''),
      description: String(data.description || ''),
      cost: Number(data.cost || 0),
      image_url: String(data.image_url || ''),
      miss_weight: Number(data.miss_weight || 0),
      miss_refund_coins: Number(data.miss_refund_coins || 0),
      sort_order: Number(data.sort_order || 0),
      items: normalizeGachaItems(data.items).map(item => {
        const reward = rewardData.get(item.reward_id);
        return {
          reward_id: item.reward_id,
          weight: item.weight,
          name: String(reward?.name || '終了した景品'),
          image_url: String(reward?.image_url || ''),
          kind: rewardKindOf(reward || {}),
          preset_id: presetOf(reward)?.id || '',
          available: isRewardDeliverable(reward),
        };
      }),
    }))
    .filter(gacha => gacha.name && Number.isInteger(gacha.cost) && gacha.cost > 0)
    .sort((a, b) => a.sort_order - b.sort_order || a.cost - b.cost)
    .map(({ sort_order: _sortOrder, ...gacha }) => gacha);
  return { rewards, gachas };
}, ['active-reward-catalog-v2'], { revalidate: 60, tags: [REWARD_CATALOG_TAG] });
