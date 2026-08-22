import { NextRequest } from 'next/server';
import crypto from 'crypto';
import { getServerUser, jsonError } from '@/lib/server-auth';

export const runtime = 'nodejs';

const b64url = (value: string) => Buffer.from(value)
  .toString('base64')
  .replace(/=/g, '')
  .replace(/\+/g, '-')
  .replace(/\//g, '_');

const sign = (header: Record<string, unknown>, payload: Record<string, unknown>, secret: string) => {
  const encodedHeader = b64url(JSON.stringify(header));
  const encodedPayload = b64url(JSON.stringify(payload));
  const signature = crypto
    .createHmac('sha256', secret)
    .update(`${encodedHeader}.${encodedPayload}`)
    .digest('base64')
    .replace(/=/g, '')
    .replace(/\+/g, '-')
    .replace(/\//g, '_');
  return `${encodedHeader}.${encodedPayload}.${signature}`;
};

export async function POST(request: NextRequest) {
  try {
    const user = await getServerUser(request);
    const body = await request.json();
    const meetingNumber = String(body.meetingNumber || body.meeting_number || '').replace(/[\s-]/g, '');
    const requestedRole = Number(body.role || 0);
    const role = requestedRole === 1 && ['teacher', 'master', 'admin'].includes(user.role) ? 1 : 0;
    const sdkKey = process.env.ZOOM_MEETING_SDK_KEY || process.env.ZOOM_MEETING_SDK_CLIENT_ID || '';
    const sdkSecret = process.env.ZOOM_MEETING_SDK_SECRET || process.env.ZOOM_MEETING_SDK_CLIENT_SECRET || '';

    if (!sdkKey || !sdkSecret) {
      return Response.json({ ok: false, error: 'zoom-meeting-sdk-env-missing' }, { status: 500 });
    }
    if (!meetingNumber) {
      return Response.json({ ok: false, error: 'meetingNumber is required' }, { status: 400 });
    }

    const iat = Math.floor(Date.now() / 1000) - 30;
    const exp = iat + 60 * 60 * 2;
    const signature = sign(
      { alg: 'HS256', typ: 'JWT' },
      {
        sdkKey,
        appKey: sdkKey,
        mn: meetingNumber,
        role,
        iat,
        exp,
        tokenExp: exp,
      },
      sdkSecret,
    );

    return Response.json({ ok: true, signature, sdkKey, role });
  } catch (error) {
    return jsonError(error);
  }
}
