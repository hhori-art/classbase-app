import { NextRequest } from 'next/server';
import { canManageShifts, getServerUser, jsonError } from '@/lib/server-auth';

/**
 * Retired: the validated and idempotent /api/admin/shifts/sync flow replaces
 * this unvalidated append-only bulk upload endpoint.
 */
export async function POST(request: NextRequest) {
  try {
    const actor = await getServerUser(request);
    if (!canManageShifts(actor)) throw new Error('forbidden');
    return Response.json({
      ok: false,
      error: 'legacy shift upload is retired; use the validated shift sync flow',
    }, { status: 410 });
  } catch (error) {
    return jsonError(error);
  }
}
