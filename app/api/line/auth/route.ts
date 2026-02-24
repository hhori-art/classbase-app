import { NextResponse } from 'next/server';

export async function GET(request: Request) {
  const { searchParams } = new URL(request.url);
  const uid = searchParams.get('uid');
  const redirectUrl = searchParams.get('redirect');

  if (!uid || !redirectUrl) {
    return new NextResponse('Missing uid or redirect url', { status: 400 });
  }

  const clientId = process.env.LINE_LOGIN_CHANNEL_ID;
  const baseUrl = process.env.NEXT_PUBLIC_BASE_URL || 'http://localhost:3000';
  const callbackUrl = `${baseUrl}/api/line/callback`;

  // 元の画面に戻るための情報(URL)を state に一時保存 (Base64エンコード)
  const state = Buffer.from(JSON.stringify({ redirect: redirectUrl })).toString('base64');

  // LINEのログイン（認可）ページURLを組み立て
  const lineAuthUrl = new URL('https://access.line.me/oauth2/v2.1/authorize');
  lineAuthUrl.searchParams.append('response_type', 'code');
  lineAuthUrl.searchParams.append('client_id', clientId || '');
  lineAuthUrl.searchParams.append('redirect_uri', callbackUrl);
  lineAuthUrl.searchParams.append('state', state);
  lineAuthUrl.searchParams.append('scope', 'profile openid');
  lineAuthUrl.searchParams.append('bot_prompt', 'normal'); // 友だち追加を促す設定

  // LINEの画面へリダイレクト
  return NextResponse.redirect(lineAuthUrl.toString());
}