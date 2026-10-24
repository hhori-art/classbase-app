import { NextRequest } from 'next/server';
import { FieldValue } from 'firebase-admin/firestore';
import { revalidateTag } from 'next/cache';
import { adminDb } from '@/lib/firebase-admin';
import { getServerUser, jsonError } from '@/lib/server-auth';
import { GACHA_RATE_SCALE } from '@/lib/rewards';
import { normalizeGachaItems, REWARD_CATALOG_TAG, requireRewardCatalogEditor, validateGachaRates } from '@/lib/server/reward-store';
import { saveRewardImage } from '@/lib/server/reward-uploads';

export const runtime = 'nodejs';

const MAX_GACHA_ITEMS = 30;
const iso = (value: any) => value?.toDate?.()?.toISOString?.() || (typeof value === 'string' ? value : null);
const badRequest = (error: string) => Response.json({ ok: false, error }, { status: 400 });

export async function GET(request: NextRequest) {
  try {
    const user = await getServerUser(request);
    requireRewardCatalogEditor(user);
    const db = adminDb();
    const [gachaSnap, drawSnap] = await Promise.all([
      db.collection('gachas').limit(100).get(),
      db.collection('gacha_draws').orderBy('created_at', 'desc').limit(300).get(),
    ]);
    // 直近の抽選結果を集計し、設定した排出率と実績を見比べられるようにする。
    const stats = new Map<string, { draws: number; wins: number; byReward: Record<string, number> }>();
    drawSnap.docs.forEach(doc => {
      const data = doc.data();
      const current = stats.get(data.gacha_id) || { draws: 0, wins: 0, byReward: {} };
      current.draws += 1;
      if (data.result === 'win' && data.reward_id) {
        current.wins += 1;
        current.byReward[data.reward_id] = (current.byReward[data.reward_id] || 0) + 1;
      }
      stats.set(data.gacha_id, current);
    });
    return Response.json({
      ok: true,
      gachas: gachaSnap.docs.map(doc => {
        const data = doc.data();
        return {
          id: doc.id, name: data.name || '', description: data.description || '', cost: data.cost || 0,
          image_url: data.image_url || '', items: normalizeGachaItems(data.items),
          miss_weight: Number(data.miss_weight || 0), miss_refund_coins: Number(data.miss_refund_coins || 0),
          sort_order: Number(data.sort_order || 0), active: data.active !== false && data.archived !== true,
          recent_stats: stats.get(doc.id) || { draws: 0, wins: 0, byReward: {} },
          updated_at: iso(data.updated_at),
        };
      }).sort((a, b) => a.sort_order - b.sort_order || a.cost - b.cost),
    });
  } catch (error) {
    return jsonError(error);
  }
}

// 新規作成と編集（id 指定時）。排出率は 0.01% 単位で、景品の合計＋はずれ＝100% にする。
export async function POST(request: NextRequest) {
  try {
    const user = await getServerUser(request);
    requireRewardCatalogEditor(user);
    const form = await request.formData();
    const id = String(form.get('id') || '').trim();
    const name = String(form.get('name') || '').trim();
    const description = String(form.get('description') || '').trim();
    const cost = Number(form.get('cost'));
    const missWeight = Math.round(Number(form.get('miss_weight') || 0));
    const missRefund = Number(form.get('miss_refund_coins') || 0);
    const sortOrder = Number(form.get('sort_order') || 0);
    let rawItems: unknown = [];
    try { rawItems = JSON.parse(String(form.get('items') || '[]')); } catch { return badRequest('景品の設定を読み取れませんでした'); }
    const items = normalizeGachaItems(rawItems);
    const image = form.get('image');

    if (!name || name.length > 80) return badRequest('ガチャ名は80文字以内で入力してください');
    if (description.length > 1000) return badRequest('説明は1000文字以内で入力してください');
    if (!Number.isInteger(cost) || cost <= 0 || cost > 100_000) return badRequest('1回のコインは1〜100,000の整数で入力してください');
    if (items.length === 0 || items.length > MAX_GACHA_ITEMS) return badRequest(`景品は1〜${MAX_GACHA_ITEMS}件設定してください`);
    if (new Set(items.map(item => item.reward_id)).size !== items.length) return badRequest('同じ景品が重複しています');
    if (!Number.isInteger(missWeight) || missWeight < 0 || missWeight > GACHA_RATE_SCALE) return badRequest('はずれの確率を確認してください');
    if (!validateGachaRates(items, missWeight)) return badRequest('景品とはずれの確率の合計を100%にしてください');
    if (!Number.isInteger(missRefund) || missRefund < 0 || missRefund > cost) return badRequest('はずれ時に戻すコインは0〜1回のコイン以下にしてください');
    if (!Number.isInteger(sortOrder) || Math.abs(sortOrder) > 10_000) return badRequest('表示順は整数で入力してください');

    const db = adminDb();
    const rewardSnaps = await db.getAll(...items.map(item => db.collection('rewards').doc(item.reward_id)));
    if (rewardSnaps.some(snap => !snap.exists)) return badRequest('存在しない景品が含まれています');

    const ref = id ? db.collection('gachas').doc(id) : db.collection('gachas').doc();
    if (id && !(await ref.get()).exists) return Response.json({ ok: false, error: 'gacha not found' }, { status: 404 });
    const updates: Record<string, unknown> = {
      name, description, cost, items, miss_weight: missWeight, miss_refund_coins: missRefund, sort_order: sortOrder,
      updated_by: user.uid, updated_at: FieldValue.serverTimestamp(),
    };
    if (image instanceof File && image.size > 0) {
      try {
        const saved = await saveRewardImage(image, `gachas/${ref.id}`, user.uid);
        updates.image_url = saved.url;
        updates.image_path = saved.path;
      } catch (error) {
        return badRequest(error instanceof Error ? error.message : '画像を保存できませんでした');
      }
    }
    if (id) await ref.update(updates);
    else await ref.create({ ...updates, active: true, archived: false, created_by: user.uid, created_at: FieldValue.serverTimestamp() });
    await db.collection('admin_audit_logs').add({
      action: id ? 'gacha.update' : 'gacha.create', target_type: 'gacha', target_id: ref.id,
      actor_uid: user.uid, actor_role: user.role, metadata: { name, cost, items, miss_weight: missWeight, miss_refund_coins: missRefund },
      created_at: FieldValue.serverTimestamp(),
    });
    revalidateTag(REWARD_CATALOG_TAG);
    return Response.json({ ok: true, id: ref.id });
  } catch (error) {
    return jsonError(error);
  }
}

export async function PATCH(request: NextRequest) {
  try {
    const user = await getServerUser(request);
    requireRewardCatalogEditor(user);
    const body = await request.json();
    const id = String(body.id || '').trim();
    if (!id || typeof body.active !== 'boolean') return badRequest('id and active are required');
    const ref = adminDb().collection('gachas').doc(id);
    try {
      await ref.update({ active: body.active, archived: !body.active, updated_by: user.uid, updated_at: FieldValue.serverTimestamp() });
    } catch (error: any) {
      if (String(error?.code) === '5' || String(error?.code) === 'not-found') return Response.json({ ok: false, error: 'gacha not found' }, { status: 404 });
      throw error;
    }
    revalidateTag(REWARD_CATALOG_TAG);
    return Response.json({ ok: true, id, active: body.active });
  } catch (error) {
    return jsonError(error);
  }
}
