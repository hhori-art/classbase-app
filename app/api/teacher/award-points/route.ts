import { NextRequest } from 'next/server';
import { getServerUser, jsonError } from '@/lib/server-auth';

/**
 * Retired: arbitrary teacher-awarded coins bypassed the authoritative homework,
 * recording and reward workflows. Keep a 410 response for old clients while
 * guaranteeing that this compatibility route cannot mutate balances.
 */
export async function POST(request: NextRequest) {
  try {
    await getServerUser(request);
    return Response.json({
      ok: false,
      error: 'teacher point awards are retired; use an authoritative learning or reward workflow',
    }, { status: 410 });
  } catch (error) {
    return jsonError(error);
  }
}
