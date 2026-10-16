import { NextRequest } from 'next/server';
import { getServerUser, jsonError, requireRole } from '@/lib/server-auth';
import { syncEarnedBadges } from '@/lib/server/badges';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

// トロフィー画面を開いた時に呼び、各機能のカウンターから獲得済みバッジを確定する。
export async function POST(request: NextRequest) {
  try {
    const user = await getServerUser(request);
    requireRole(user, ['student']);
    const result = await syncEarnedBadges(user.uid);
    return Response.json({ ok: true, ...result }, { headers: { 'Cache-Control': 'private, no-store' } });
  } catch (error) {
    return jsonError(error);
  }
}
