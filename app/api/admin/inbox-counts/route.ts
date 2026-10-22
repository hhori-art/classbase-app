import { NextRequest } from 'next/server';
import { getServerUser, jsonError, type ServerUser } from '@/lib/server-auth';
import { hasAdminAppPermission } from '@/lib/admin-app-permissions';
import { isDedicatedAttendanceApproverProfile } from '@/lib/employment-category';
import { loadInboxCounts, type InboxCounts } from '@/lib/server/admin-inbox';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

// サイドバーの件数は2分ごと・画面移動のたびに取りに来るため、利用者ごとに60秒だけ覚えておく。
const CACHE_MS = 60_000;
const MAX_CACHE_ENTRIES = 500;
const cache = new Map<string, { at: number; counts: InboxCounts }>();

const isAdminViewer = (user: ServerUser) =>
  user.role === 'master' ||
  ((['admin', 'attendance_admin'] as string[]).includes(user.role) && (
    hasAdminAppPermission(user.profile?.role, user.profile, 'science_social') ||
    hasAdminAppPermission(user.profile?.role, user.profile, 'attendance') ||
    hasAdminAppPermission(user.profile?.role, user.profile, 'eiken') ||
    hasAdminAppPermission(user.profile?.role, user.profile, 'online_school')
  )) ||
  isDedicatedAttendanceApproverProfile(user.profile || {});

/** 管理画面の「今日の対応」とサイドバーの件数。見られる画面の分だけ返す（マスター専用の件数はマスターだけ）。 */
export async function GET(request: NextRequest) {
  try {
    const user = await getServerUser(request);
    if (!isAdminViewer(user)) throw new Error('forbidden');
    const now = Date.now();
    const cached = cache.get(user.uid);
    if (cached && now - cached.at < CACHE_MS) {
      return Response.json({ ok: true, counts: cached.counts, cached: true }, { headers: { 'Cache-Control': 'private, no-store' } });
    }
    const counts = await loadInboxCounts(user);
    if (cache.size >= MAX_CACHE_ENTRIES) {
      for (const [key, entry] of cache) if (now - entry.at >= CACHE_MS) cache.delete(key);
      if (cache.size >= MAX_CACHE_ENTRIES) cache.clear();
    }
    // 数えられなかった件数があるときは覚えずに、次の取得でもう一度数える。
    if (!Object.values(counts).some(value => value === null)) cache.set(user.uid, { at: now, counts });
    return Response.json({ ok: true, counts }, { headers: { 'Cache-Control': 'private, no-store' } });
  } catch (error) {
    return jsonError(error);
  }
}
