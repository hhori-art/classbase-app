import { NextResponse } from 'next/server';

export async function POST(request: Request) {
  try {
    const { email } = await request.json();

    const accountId = process.env.ZOOM_ACCOUNT_ID;
    const clientId = process.env.ZOOM_CLIENT_ID;
    const clientSecret = process.env.ZOOM_CLIENT_SECRET;

    if (!accountId || !clientId || !clientSecret) {
      return NextResponse.json({ success: false, error: 'API Credentials missing' }, { status: 500 });
    }

    if (!email) {
      return NextResponse.json({ success: false, error: 'Email is required' }, { status: 400 });
    }

    // 1. アクセストークン取得
    const authHeader = Buffer.from(`${clientId}:${clientSecret}`).toString('base64');
    const tokenRes = await fetch(`https://zoom.us/oauth/token?grant_type=account_credentials&account_id=${accountId}`, {
      method: 'POST',
      headers: { 'Authorization': `Basic ${authHeader}` },
    });

    if (!tokenRes.ok) throw new Error('Failed to get access token');
    const tokenData = await tokenRes.json();
    const accessToken = tokenData.access_token;

    // 2. ユーザー情報を取得してPMIを特定
    const userRes = await fetch(`https://api.zoom.us/v2/users/${email}`, {
      method: 'GET',
      headers: { 'Authorization': `Bearer ${accessToken}` },
    });

    if (!userRes.ok) {
      return NextResponse.json({ success: false, error: 'User not found.' });
    }

    const userData = await userRes.json();
    const pmi = userData.pmi;

    if (!pmi) {
      return NextResponse.json({ success: false, error: 'PMI not enabled for this user.' });
    }

    // 3. ZAKトークンを取得
    const zakRes = await fetch(`https://api.zoom.us/v2/users/${email}/token?type=zak`, {
      method: 'GET',
      headers: { 'Authorization': `Bearer ${accessToken}` },
    });

    if (!zakRes.ok) throw new Error('Failed to get ZAK token');
    const zakData = await zakRes.json();

    return NextResponse.json({ 
      success: true, 
      pmi: String(pmi),
      zak: zakData.token 
    });

  } catch (error: any) {
    console.error('API Error:', error);
    return NextResponse.json({ success: false, error: error.message }, { status: 500 });
  }
}