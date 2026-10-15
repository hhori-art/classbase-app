import { NextRequest } from 'next/server';
import { getServerUser, jsonError, requireMaster } from '@/lib/server-auth';

export async function POST(request: NextRequest) {
  try {
    const user = await getServerUser(request);
    requireMaster(user);
    return Response.json({ ok: false, error: 'notification queue retired; use /api/admin/notifications' }, { status: 410 });
  } catch (error) {
    return jsonError(error);
  }
}
