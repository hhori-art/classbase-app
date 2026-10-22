import { randomUUID } from 'node:crypto';
import { NextRequest } from 'next/server';
import { adminBucket } from '@/lib/firebase-admin';
import { getServerUser, jsonError, requireScienceSocialStaff } from '@/lib/server-auth';

export const runtime = 'nodejs';

const MAX_STAMP_BYTES = 2 * 1024 * 1024;
const EXTENSIONS: Record<string, string> = {
  'image/jpeg': 'jpg',
  'image/png': 'png',
  'image/webp': 'webp',
};

export async function POST(request: NextRequest) {
  try {
    const user = await getServerUser(request);
    requireScienceSocialStaff(user);
    const form = await request.formData();
    const fields = Object.fromEntries(form.entries());
    const image = fields.image;
    if (!(image instanceof File)) return Response.json({ ok: false, error: 'image is required' }, { status: 400 });
    const extension = EXTENSIONS[String(image.type || '').toLowerCase()];
    if (!extension || image.size <= 0 || image.size > MAX_STAMP_BYTES) {
      return Response.json({ ok: false, error: 'スタンプはJPEG・PNG・WebPの2MB以内にしてください' }, { status: 400 });
    }
    const token = randomUUID();
    const path = `stamps/${user.uid}/${Date.now()}_${randomUUID()}.${extension}`;
    const bucket = adminBucket();
    await bucket.file(path).save(Buffer.from(await image.arrayBuffer()), {
      resumable: false,
      validation: 'crc32c',
      metadata: {
        contentType: image.type,
        metadata: { firebaseStorageDownloadTokens: token, ownerUid: user.uid, purpose: 'homework_stamp' },
      },
    });
    const url = `https://firebasestorage.googleapis.com/v0/b/${encodeURIComponent(bucket.name)}/o/${encodeURIComponent(path)}?alt=media&token=${encodeURIComponent(token)}`;
    return Response.json({ ok: true, url });
  } catch (error) {
    return jsonError(error);
  }
}
