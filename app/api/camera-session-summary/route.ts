import { NextRequest } from 'next/server';
import { getServerUser, jsonError } from '@/lib/server-auth';

/**
 * Retired: a client-declared camera duration is not trustworthy evidence for a
 * reward. The endpoint remains as an authenticated 410 for old clients.
 */
export async function POST(request: NextRequest) {
  try {
    await getServerUser(request);
    return Response.json({
      ok: false,
      error: 'camera session rewards are retired',
    }, { status: 410 });
  } catch (error) {
    return jsonError(error);
  }
}
