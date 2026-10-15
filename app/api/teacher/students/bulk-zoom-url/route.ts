import { NextRequest } from 'next/server';
import { getServerUser, jsonError } from '@/lib/server-auth';

/**
 * Retired: meeting details are managed on authorized shift assignments. This
 * legacy bulk profile updater could otherwise overwrite unrelated students.
 */
export async function POST(request: NextRequest) {
  try {
    await getServerUser(request);
    return Response.json({
      ok: false,
      error: 'bulk student Zoom URL updates are retired; manage meetings from authorized shifts',
    }, { status: 410 });
  } catch (error) {
    return jsonError(error);
  }
}
