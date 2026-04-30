import { NextResponse } from 'next/server';
import { getRequestOrigin, parseLineState, safeRedirectUrl, saveLineUserId } from '@/lib/line';

export async function GET(request: Request) {
  const { searchParams } = new URL(request.url);
  const code = searchParams.get('code');
  const state = searchParams.get('state');
  const error = searchParams.get('error');

  // ユーザーが連携をキャンセルした場合など
  if (error) {
    try {
      const parsed = state ? parseLineState(state) : null;
      const redirectUrl = parsed ? safeRedirectUrl(parsed.redirect, request) : new URL('/teacher/settings', getRequestOrigin(request));
      redirectUrl.searchParams.set('error', 'line_auth_failed');
      return NextResponse.redirect(redirectUrl);
    } catch {
      return NextResponse.redirect(new URL('/teacher/settings?error=line_auth_failed', getRequestOrigin(request)));
    }
  }

  if (!code || !state) {
    return new NextResponse('Missing code or state', { status: 400 });
  }

  try {
    // state を復元して、元の設定画面のURLを取り出す
    const decodedState = parseLineState(state);
    const redirectObj = safeRedirectUrl(decodedState.redirect, request);

    const clientId = process.env.LINE_LOGIN_CHANNEL_ID;
    const clientSecret = process.env.LINE_LOGIN_CHANNEL_SECRET;
    if (!clientId || !clientSecret) {
      redirectObj.searchParams.set('error', 'line_env_missing');
      return NextResponse.redirect(redirectObj);
    }

    const callbackUrl = `${getRequestOrigin(request)}/api/line/callback`;

    // 1. LINEから「アクセストークン」をもらう
    const tokenResponse = await fetch('https://api.line.me/oauth2/v2.1/token', {
      method: 'POST',
      headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
      body: new URLSearchParams({
        grant_type: 'authorization_code',
        code,
        redirect_uri: callbackUrl,
        client_id: clientId,
        client_secret: clientSecret,
      }),
    });

    const tokenData = await tokenResponse.json();

    if (!tokenResponse.ok) {
      console.error('Token Error:', tokenData);
      redirectObj.searchParams.set('error', 'token_failed');
      return NextResponse.redirect(redirectObj);
    }

    // 2. アクセストークンを使って「プロフィール（LINE ID）」をもらう
    const profileResponse = await fetch('https://api.line.me/v2/profile', {
      headers: { Authorization: `Bearer ${tokenData.access_token}` },
    });

    const profileData = await profileResponse.json();

    if (!profileResponse.ok) {
      console.error('Profile Error:', profileData);
      redirectObj.searchParams.set('error', 'profile_failed');
      return NextResponse.redirect(redirectObj);
    }

    // 取得できたLINE専用のユーザーID
    const lineUserId = profileData.userId;

    // 3. サーバー側でLINE IDを保存してから元の設定画面へ戻す
    await saveLineUserId(decodedState.uid, lineUserId);
    redirectObj.searchParams.set('line_linked', '1');

    return NextResponse.redirect(redirectObj.toString());

  } catch (err) {
    console.error('Callback Error:', err);
    return new NextResponse('Internal Server Error', { status: 500 });
  }
}
