import { NextResponse } from 'next/server';

export async function GET(request: Request) {
  const { searchParams } = new URL(request.url);
  const code = searchParams.get('code');
  const state = searchParams.get('state');
  const error = searchParams.get('error');

  // ユーザーが連携をキャンセルした場合など
  if (error) {
    return NextResponse.redirect(new URL('/teacher/settings?error=line_auth_failed', request.url));
  }

  if (!code || !state) {
    return new NextResponse('Missing code or state', { status: 400 });
  }

  try {
    // state を復元して、元の設定画面のURLを取り出す
    const decodedState = JSON.parse(Buffer.from(state, 'base64').toString('utf-8'));
    const { redirect } = decodedState;

    const clientId = process.env.LINE_LOGIN_CHANNEL_ID!;
    const clientSecret = process.env.LINE_LOGIN_CHANNEL_SECRET!;
    const baseUrl = process.env.NEXT_PUBLIC_BASE_URL || 'http://localhost:3000';
    const callbackUrl = `${baseUrl}/api/line/callback`;

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
      return NextResponse.redirect(new URL(`${redirect}?error=token_failed`, request.url));
    }

    // 2. アクセストークンを使って「プロフィール（LINE ID）」をもらう
    const profileResponse = await fetch('https://api.line.me/v2/profile', {
      headers: { Authorization: `Bearer ${tokenData.access_token}` },
    });

    const profileData = await profileResponse.json();

    if (!profileResponse.ok) {
      console.error('Profile Error:', profileData);
      return NextResponse.redirect(new URL(`${redirect}?error=profile_failed`, request.url));
    }

    // 取得できたLINE専用のユーザーID
    const lineUserId = profileData.userId;

    // 3. 元の設定画面に、取得したLINE IDをパラメータとしてくっつけて戻す
    const redirectObj = new URL(redirect);
    redirectObj.searchParams.append('line_id', lineUserId);

    return NextResponse.redirect(redirectObj.toString());

  } catch (err) {
    console.error('Callback Error:', err);
    return new NextResponse('Internal Server Error', { status: 500 });
  }
}