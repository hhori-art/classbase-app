import { NextRequest } from 'next/server';
import { FieldValue } from 'firebase-admin/firestore';
import { adminDb } from '@/lib/firebase-admin';
import { getServerUser, jsonError } from '@/lib/server-auth';
import { revalidateTag } from 'next/cache';
import { REWARD_CATALOG_TAG, requireRewardCatalogEditor, rewardKindOf, stockOf } from '@/lib/server/reward-store';
import { saveDigitalRewardFile, saveRewardImage } from '@/lib/server/reward-uploads';
import { findRewardPreset, presetRewardKind } from '@/lib/reward-presets';
import { preparedMessageOr } from '@/lib/api-error';

export const runtime = 'nodejs';

const iso = (value: any) => value?.toDate?.()?.toISOString?.() || (typeof value === 'string' ? value : null);

const badRequest = (error: string) => Response.json({ ok: false, error }, { status: 400 });

export async function GET(request: NextRequest) {
  try {
    const user = await getServerUser(request);
    requireRewardCatalogEditor(user);
    const snap = await adminDb().collection('rewards').orderBy('required_coins', 'asc').limit(500).get();
    return Response.json({
      ok: true,
      rewards: snap.docs.map(doc => {
        const data = doc.data();
        return {
          id: doc.id, name: data.name, description: data.description || '', required_coins: data.required_coins,
          image_url: data.image_url || '', kind: rewardKindOf(data),
          stock: stockOf(data), exchangeable: data.exchangeable !== false, preset_id: findRewardPreset(data.preset_id)?.id || '',
          digital_file_name: data.digital_file_name || '', digital_file_size: data.digital_file_size || 0,
          active: data.active !== false && data.archived !== true,
          created_at: iso(data.created_at), updated_at: iso(data.updated_at),
        };
      }),
    });
  } catch (error) {
    return jsonError(error);
  }
}

// 新規登録と編集（id 指定時）。画像・ダウンロードファイルは指定された時だけ差し替える。
export async function POST(request: NextRequest) {
  try {
    const user = await getServerUser(request);
    requireRewardCatalogEditor(user);
    const form = await request.formData();
    const id = String(form.get('id') || '').trim();
    const presetIdInput = String(form.get('preset_id') || '').trim();
    const preset = presetIdInput ? findRewardPreset(presetIdInput) : null;
    if (presetIdInput && !preset) return badRequest('プリセットが見つかりません');
    const name = String(form.get('name') || preset?.name || '').trim();
    const description = String(form.get('description') || preset?.description || '').trim();
    const cost = Number(form.get('required_coins') || preset?.defaultCost);
    const stockRaw = String(form.get('stock') ?? '').trim();
    const stock = stockRaw === '' ? null : Number(stockRaw);
    const exchangeable = form.get('exchangeable') !== 'false';
    const image = form.get('image');
    const digitalFile = form.get('digital_file');

    if (!name || name.length > 120) return badRequest('景品名は120文字以内で入力してください');
    if (description.length > 1000) return badRequest('説明は1000文字以内で入力してください');
    if (!Number.isInteger(cost) || cost <= 0 || cost > 1_000_000) return badRequest('必要コインは1〜1,000,000の整数で入力してください');
    if (stock !== null && (!Number.isInteger(stock) || stock < 0 || stock > 100_000)) return badRequest('在庫は0〜100,000の整数か、空欄（無制限）にしてください');

    const db = adminDb();
    const ref = id ? db.collection('rewards').doc(id) : db.collection('rewards').doc();
    const existing = id ? await ref.get() : null;
    if (id && !existing?.exists) return Response.json({ ok: false, error: 'reward not found' }, { status: 404 });
    const current = existing?.data() || {};
    // プリセット景品（きせかえ等）は種類をプリセットで固定し、画像の代わりにアプリ内で描画する。
    const effectivePreset = preset || findRewardPreset(current.preset_id);
    const kind = effectivePreset ? presetRewardKind(effectivePreset) : form.get('kind') === 'digital' ? 'digital' : 'physical';
    const hasImage = image instanceof File && image.size > 0;
    const hasDigitalFile = digitalFile instanceof File && digitalFile.size > 0;
    if (!id && !hasImage && !effectivePreset) return badRequest('景品の画像を選択してください');
    if (kind === 'digital' && !effectivePreset && !hasDigitalFile && !current.digital_file_path) return badRequest('ダウンロードさせるファイルを選択してください');

    const updates: Record<string, unknown> = {
      name, description, required_coins: cost, kind, stock, exchangeable,
      ...(effectivePreset ? { preset_id: effectivePreset.id } : {}),
      updated_by: user.uid, updated_at: FieldValue.serverTimestamp(),
    };
    try {
      if (hasImage) {
        const saved = await saveRewardImage(image as File, `rewards/${ref.id}`, user.uid);
        updates.image_url = saved.url;
        updates.image_path = saved.path;
      }
      if (hasDigitalFile && !effectivePreset) {
        const saved = await saveDigitalRewardFile(digitalFile as File, ref.id, user.uid);
        updates.digital_file_path = saved.path;
        updates.digital_file_name = saved.name;
        updates.digital_file_size = saved.size;
        updates.digital_content_type = saved.contentType;
      }
    } catch (error) {
      return badRequest(preparedMessageOr(error, 'ファイルを保存できませんでした', 'admin-rewards-upload'));
    }
    if (id) {
      await ref.update(updates);
    } else {
      await ref.create({ ...updates, active: true, archived: false, created_by: user.uid, created_at: FieldValue.serverTimestamp() });
    }
    await db.collection('admin_audit_logs').add({
      action: id ? 'reward.update' : 'reward.create', target_type: 'reward', target_id: ref.id,
      actor_uid: user.uid, actor_role: user.role, metadata: { name, cost, kind, stock }, created_at: FieldValue.serverTimestamp(),
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
    const active = body.active;
    if (!id || typeof active !== 'boolean') return badRequest('id and active are required');
    const ref = adminDb().collection('rewards').doc(id);
    try {
      await ref.update({ active, archived: !active, updated_by: user.uid, updated_at: FieldValue.serverTimestamp() });
    } catch (error: any) {
      if (String(error?.code) === '5' || String(error?.code) === 'not-found') return Response.json({ ok: false, error: 'reward not found' }, { status: 404 });
      throw error;
    }
    revalidateTag(REWARD_CATALOG_TAG);
    return Response.json({ ok: true, id, active });
  } catch (error) {
    return jsonError(error);
  }
}
