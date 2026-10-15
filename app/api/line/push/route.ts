import { NextRequest } from 'next/server';
import { getServerUser, isAdminLike, jsonError } from '@/lib/server-auth';

export async function POST(request: NextRequest) {
  try {
    const user = await getServerUser(request);
    if (!isAdminLike(user)) {
      return Response.json({ error: 'forbidden' }, { status: 403 });
    }
    return Response.json({ error: 'retired', replacement: '/api/admin/notifications' }, { status: 410 });
  } catch (error: any) {
    return jsonError(error);
  }
}
