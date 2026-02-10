import { NextResponse } from 'next/server';
import { adminDb } from '@/lib/firebase-admin'; 

export async function POST(request: Request) {
  try {
    const { meetingId, userId } = await request.json(); // 生徒のIDと会議IDを受け取る

    if (!meetingId || !userId) {
      return NextResponse.json({ success: false, error: 'Parameters missing' }, { status: 400 });
    }

    // 1. Firebaseから生徒の正確な情報を取得
    const userDoc = await adminDb.collection('users').doc(userId).get();
    if (!userDoc.exists) {
      return NextResponse.json({ success: false, error: 'User not found' }, { status: 404 });
    }
    const userData = userDoc.data();
    
    // Zoomに登録する名前とメール (メールがなければダミーでも通りますが、ユニークなものが良いです)
    const firstName = userData?.student_name || '名無し';
    const email = userData?.email || `${userId}@example.com`; // ZoomAPIはemail必須のため

    // 2. Zoom Access Token 取得
    const accountId = process.env.ZOOM_ACCOUNT_ID;
    const clientId = process.env.ZOOM_CLIENT_ID;
    const clientSecret = process.env.ZOOM_CLIENT_SECRET;
    const authHeader = Buffer.from(`${clientId}:${clientSecret}`).toString('base64');
    
    const tokenRes = await fetch(`https://zoom.us/oauth/token?grant_type=account_credentials&account_id=${accountId}`, {
      method: 'POST',
      headers: { 'Authorization': `Basic ${authHeader}` },
      cache: 'no-store'
    });
    const tokenData = await tokenRes.json();
    const accessToken = tokenData.access_token;

    // 3. Zoomに「登録者」として追加 (ここが核心です)
    const registrantRes = await fetch(`https://api.zoom.us/v2/meetings/${meetingId}/registrants`, {
      method: 'POST',
      headers: {
        'Authorization': `Bearer ${accessToken}`,
        'Content-Type': 'application/json'
      },
      body: JSON.stringify({
        email: email,
        first_name: firstName,
        last_name: "", // 名前をフルネームでfirst_nameに入れる運用なら空でOK
        auto_approve: true // 自動承認
      })
    });

    // 既に登録済みの場合など、エラーでもjoin_urlが取れるケースがあるのでレスポンスを確認
    const registrantData = await registrantRes.json();

    // 成功時、または「既に登録済み」の場合、join_url が返ってきます
    if (registrantData.join_url) {
      return NextResponse.json({ 
        success: true, 
        join_url: registrantData.join_url // ★これが名前固定の魔法のURLです
      });
    } else {
       // エラーハンドリング (既に登録済みの場合はエラーコードが返るが、再度取得するロジックが必要かも)
       // 実践的には、409 Conflict (登録済み) なら GET /registrants してURLを取るなどの分岐が必要ですが、
       // Zoom APIは上書きでURLを返してくれることが多いです。
       console.error("Zoom Registration Error:", registrantData);
       return NextResponse.json({ success: false, error: 'Failed to register to Zoom' }, { status: 500 });
    }

  } catch (error: any) {
    console.error('API Error:', error);
    return NextResponse.json({ success: false, error: error.message }, { status: 500 });
  }
}