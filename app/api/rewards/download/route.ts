import { NextRequest } from 'next/server';
import { FieldValue } from 'firebase-admin/firestore';
import { adminBucket, adminDb } from '@/lib/firebase-admin';
import { getServerUser, jsonError, requireRole } from '@/lib/server-auth';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

// 受け取り済みのデジタル景品について、5分間有効のダウンロードURLを発行する（アプリ内の背景はPNGを直接返す）。
export async function POST(request: NextRequest) {
  try {
    const user = await getServerUser(request);
    requireRole(user, ['student']);
    const body = await request.json().catch(() => ({}));
    const grantId = String(body.grant_id || '').trim().slice(0, 300);
    if (!grantId) return Response.json({ ok: false, error: 'grant_id is required' }, { status: 400 });
    const ref = adminDb().collection('reward_grants').doc(grantId);
    const snap = await ref.get();
    const grant = snap.data() || {};
    if (!snap.exists || grant.user_id !== user.uid) throw new Error('forbidden');
    if (grant.builtin_asset) {
      // アプリ内で描くバーチャル背景は、その場でPNGを生成して返す（保存ファイルなし）。
      const { renderVirtualBackgroundPng } = await import('@/lib/server/virtual-background-image');
      const image = renderVirtualBackgroundPng(String(grant.builtin_asset), String(grant.digital_file_name || 'virtual-background.png'));
      await ref.update({ download_count: FieldValue.increment(1), last_downloaded_at: FieldValue.serverTimestamp() });
      return image;
    }
    const path = String(grant.digital_file_path || '');
    if (!path.startsWith('reward_files/') || path.includes('..')) return Response.json({ ok: false, error: 'file not found' }, { status: 404 });
    const fileName = String(grant.digital_file_name || 'reward').replace(/["\\\r\n]/g, '_');
    const [url] = await adminBucket().file(path).getSignedUrl({
      version: 'v4',
      action: 'read',
      expires: Date.now() + 5 * 60 * 1000,
      responseDisposition: `attachment; filename*=UTF-8''${encodeURIComponent(fileName)}`,
    });
    await ref.update({ download_count: FieldValue.increment(1), last_downloaded_at: FieldValue.serverTimestamp() });
    return Response.json({ ok: true, url }, { headers: { 'Cache-Control': 'private, no-store' } });
  } catch (error) {
    return jsonError(error);
  }
}
