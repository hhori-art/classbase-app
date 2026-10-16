import { NextRequest } from 'next/server';
import { getServerUser, jsonError, requireRole } from '@/lib/server-auth';
import { loadPublicRewardCatalog, requireStudentShopAccess } from '@/lib/server/reward-store';

export async function GET(request: NextRequest) {
  try {
    const user = await getServerUser(request);
    requireRole(user, ['student']);
    await requireStudentShopAccess(user);
    const catalog = await loadPublicRewardCatalog();
    return Response.json({ ok: true, ...catalog });
  } catch (error) {
    return jsonError(error);
  }
}
