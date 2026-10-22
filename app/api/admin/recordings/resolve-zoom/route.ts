import { NextRequest } from 'next/server';
import { getServerUser, isAdminLike, jsonError } from '@/lib/server-auth';
import { resolveCsvRecordingsWithZoom } from '@/lib/server/zoom-recording-resolve';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';
export const maxDuration = 60;

/** 録画一覧から取り込んだ録画を、Zoom APIの録画ファイルに結びつける（パスコード不要で再生できるようにする）。 */
export async function POST(request: NextRequest) {
  try {
    const user = await getServerUser(request);
    if (!isAdminLike(user)) throw new Error('forbidden');
    const body = await request.json().catch(() => ({}));
    const ids = Array.isArray(body.ids) ? body.ids.map((id: unknown) => String(id || '')) : [];
    if (ids.length === 0) throw new Error('ids-required');
    if (ids.length > 200) throw new Error('too-many-ids');
    return Response.json({ ok: true, ...(await resolveCsvRecordingsWithZoom(ids)) });
  } catch (error) {
    return jsonError(error);
  }
}
