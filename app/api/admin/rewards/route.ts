import { randomUUID } from 'node:crypto';
import { NextRequest } from 'next/server';
import { FieldValue } from 'firebase-admin/firestore';
import { adminBucket, adminDb } from '@/lib/firebase-admin';
import { getServerUser, jsonError, requireRole } from '@/lib/server-auth';
import { revalidateTag } from 'next/cache';

export const runtime = 'nodejs';

const MAX_IMAGE_BYTES = 5 * 1024 * 1024;
const IMAGE_TYPES: Record<string, { extension: string; valid: (bytes: Uint8Array) => boolean }> = {
  'image/jpeg': { extension: 'jpg', valid: bytes => bytes[0] === 0xff && bytes[1] === 0xd8 && bytes[2] === 0xff },
  'image/png': { extension: 'png', valid: bytes => bytes[0] === 0x89 && bytes[1] === 0x50 && bytes[2] === 0x4e && bytes[3] === 0x47 },
  'image/webp': { extension: 'webp', valid: bytes => String.fromCharCode(...bytes.slice(0, 4)) === 'RIFF' && String.fromCharCode(...bytes.slice(8, 12)) === 'WEBP' },
};

export async function GET(request: NextRequest) {
  try {
    const user = await getServerUser(request);
    requireRole(user, ['master']);
    const snap = await adminDb().collection('rewards').orderBy('required_coins', 'asc').limit(500).get();
    return Response.json({ ok: true, rewards: snap.docs.map(doc => ({ id: doc.id, ...doc.data() })) });
  } catch (error) {
    return jsonError(error);
  }
}

export async function POST(request: NextRequest) {
  try {
    const user = await getServerUser(request);
    requireRole(user, ['master']);
    const form = await request.formData();
    const name = String(form.get('name') || '').trim();
    const cost = Number(form.get('required_coins'));
    const image = form.get('image');
    if (!name || name.length > 120 || !Number.isInteger(cost) || cost <= 0 || cost > 1_000_000) {
      return Response.json({ ok: false, error: '景品名は120文字以内、必要コインは1〜1,000,000の整数で入力してください' }, { status: 400 });
    }
    if (!(image instanceof File) || image.size <= 0 || image.size > MAX_IMAGE_BYTES) {
      return Response.json({ ok: false, error: '画像はJPEG・PNG・WebPの5MB以内にしてください' }, { status: 400 });
    }
    const imageType = IMAGE_TYPES[String(image.type || '').toLowerCase()];
    const bytes = new Uint8Array(await image.arrayBuffer());
    if (!imageType || !imageType.valid(bytes)) {
      return Response.json({ ok: false, error: '画像の形式を確認してください' }, { status: 400 });
    }
    const db = adminDb();
    const rewardRef = db.collection('rewards').doc();
    const token = randomUUID();
    const path = `rewards/${rewardRef.id}/${randomUUID()}.${imageType.extension}`;
    const bucket = adminBucket();
    await bucket.file(path).save(Buffer.from(bytes), {
      resumable: false,
      validation: 'crc32c',
      metadata: {
        contentType: image.type,
        metadata: { firebaseStorageDownloadTokens: token, uploadedBy: user.uid, purpose: 'reward_image' },
      },
    });
    const imageUrl = `https://firebasestorage.googleapis.com/v0/b/${encodeURIComponent(bucket.name)}/o/${encodeURIComponent(path)}?alt=media&token=${encodeURIComponent(token)}`;
    await rewardRef.create({
      name, required_coins: cost, image_url: imageUrl, image_path: path,
      active: true, archived: false, created_by: user.uid,
      created_at: FieldValue.serverTimestamp(), updated_at: FieldValue.serverTimestamp(),
    });
    revalidateTag('reward-catalog');
    return Response.json({ ok: true, reward: { id: rewardRef.id, name, required_coins: cost, image_url: imageUrl, active: true, archived: false } });
  } catch (error) {
    return jsonError(error);
  }
}

export async function PATCH(request: NextRequest) {
  try {
    const user = await getServerUser(request);
    requireRole(user, ['master']);
    const body = await request.json();
    const id = String(body.id || '').trim();
    const active = body.active;
    if (!id || typeof active !== 'boolean') return Response.json({ ok: false, error: 'id and active are required' }, { status: 400 });
    const ref = adminDb().collection('rewards').doc(id);
    try {
      await ref.update({ active, archived: !active, updated_by: user.uid, updated_at: FieldValue.serverTimestamp() });
    } catch (error: any) {
      if (String(error?.code) === '5' || String(error?.code) === 'not-found') return Response.json({ ok: false, error: 'reward not found' }, { status: 404 });
      throw error;
    }
    revalidateTag('reward-catalog');
    return Response.json({ ok: true, id, active });
  } catch (error) {
    return jsonError(error);
  }
}
