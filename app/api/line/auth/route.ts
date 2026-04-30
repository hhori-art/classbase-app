import { NextResponse } from 'next/server';
import { buildLineState, getRequestOrigin, safeRedirectUrl } from '@/lib/line';
import { getServerUser, jsonError } from '@/lib/server-auth';

export async function GET(request: Request) {
  try {
  const serverUser = await getServerUser(request as any);
  const { searchParams } = new URL(request.url);
  const redirectUrl = searchParams.get('redirect');
  const role = searchParams.get('role') || undefined;
  const mode = searchParams.get('mode');

  if (!redirectUrl) {
    return new NextResponse('Missing redirect url', { status: 400 });
  }

  const clientId = process.env.LINE_LOGIN_CHANNEL_ID;
  if (!clientId) {
    return new NextResponse('LINE_LOGIN_CHANNEL_ID is not configured', { status: 500 });
  }

  const origin = getRequestOrigin(request);
  const callbackUrl = `${origin}/api/line/callback`;
  const redirect = safeRedirectUrl(redirectUrl, request).toString();

  // 本番環境では NEXT_PUBLIC_BASE_URL 未設定で localhost になる事故を避けるため、
  // リクエスト元の origin を使って callback URL を組み立てる。
  const state = buildLineState({ uid: serverUser.uid, redirect, role: role || serverUser.role });

  // LINEのログイン（認可）ページURLを組み立て
  const lineAuthUrl = new URL('https://access.line.me/oauth2/v2.1/authorize');
  lineAuthUrl.searchParams.append('response_type', 'code');
  lineAuthUrl.searchParams.append('client_id', clientId);
  lineAuthUrl.searchParams.append('redirect_uri', callbackUrl);
  lineAuthUrl.searchParams.append('state', state);
  lineAuthUrl.searchParams.append('scope', 'profile openid');
  lineAuthUrl.searchParams.append('bot_prompt', 'normal'); // 友だち追加を促す設定

  if (mode === 'json') {
    return NextResponse.json({ ok: true, url: lineAuthUrl.toString() });
  }

  return NextResponse.redirect(lineAuthUrl.toString());
  } catch (error) {
    return jsonError(error);
  }
}
