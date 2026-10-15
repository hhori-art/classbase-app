import { NextRequest } from 'next/server';
import { getServerUser, jsonError } from '@/lib/server-auth';

/**
 * Retired: course changes now require a server-signed visible option through
 * the authorized course-registration APIs.
 */
export async function POST(request: NextRequest) {
  try {
    await getServerUser(request);
    return Response.json({
      ok: false,
      error: 'direct course settings are retired; use the authorized course registration flow',
    }, { status: 410 });
  } catch (error) {
    return jsonError(error);
  }
}
