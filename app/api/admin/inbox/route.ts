import { NextRequest } from 'next/server';
import { getServerUser, jsonError, requireMaster } from '@/lib/server-auth';
import { loadInboxItems } from '@/lib/server/admin-inbox';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

/** 対応待ち一覧（マスター専用）。種類ごとに新しい順に最大10件。 */
export async function GET(request: NextRequest) {
  try {
    const user = await getServerUser(request);
    requireMaster(user);
    const groups = await loadInboxItems();
    return Response.json({ ok: true, groups }, { headers: { 'Cache-Control': 'private, no-store' } });
  } catch (error) {
    return jsonError(error);
  }
}
