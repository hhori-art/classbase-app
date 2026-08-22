import { NextResponse } from 'next/server';
import { NextRequest } from 'next/server';
import { adminDb } from '@/lib/firebase-admin';
import { getServerUser, isAdminLike } from '@/lib/server-auth';

export const runtime = 'nodejs';

export async function POST(request: NextRequest) {
  try {
    const currentUser = await getServerUser(request);
    const { meetingId, userId } = await request.json();

    if (!meetingId || !userId) {
      return NextResponse.json({ success: false, error: 'Parameters missing' }, { status: 400 });
    }

    if (currentUser.uid !== userId && currentUser.role !== 'teacher' && !isAdminLike(currentUser)) {
      return NextResponse.json({ success: false, error: 'forbidden' }, { status: 403 });
    }

    const db = adminDb();

    // 1) Firebaseから生徒情報取得
    const userDoc = await db.collection('users').doc(userId).get();
    if (!userDoc.exists) {
      return NextResponse.json({ success: false, error: 'User not found' }, { status: 404 });
    }
    const userData = userDoc.data() || {};

    const firstName = userData.student_name || '名無し';
    const email = userData.email || `${userId}@example.com`;

    // 2) Zoom Access Token
    const accountId = process.env.ZOOM_ACCOUNT_ID;
    const clientId = process.env.ZOOM_CLIENT_ID;
    const clientSecret = process.env.ZOOM_CLIENT_SECRET;

    if (!accountId || !clientId || !clientSecret) {
      return NextResponse.json({ success: false, error: 'Zoom API Credentials missing' }, { status: 500 });
    }

    const authHeader = Buffer.from(`${clientId}:${clientSecret}`).toString('base64');

    const tokenRes = await fetch(
      `https://zoom.us/oauth/token?grant_type=account_credentials&account_id=${accountId}`,
      {
        method: 'POST',
        headers: { Authorization: `Basic ${authHeader}` },
        cache: 'no-store',
      }
    );

    if (!tokenRes.ok) {
      const t = await tokenRes.json().catch(() => ({}));
      return NextResponse.json({ success: false, error: `Failed to get Zoom token: ${t?.message || 'unknown'}` }, { status: 500 });
    }

    const tokenData = await tokenRes.json();
    const accessToken = tokenData.access_token;

    // 3) Zoomに登録者として追加
    const registrantRes = await fetch(`https://api.zoom.us/v2/meetings/${meetingId}/registrants`, {
      method: 'POST',
      headers: {
        Authorization: `Bearer ${accessToken}`,
        'Content-Type': 'application/json',
      },
      body: JSON.stringify({
        email,
        first_name: firstName,
        last_name: '',
        auto_approve: true,
      }),
      cache: 'no-store',
    });

    const registrantData = await registrantRes.json().catch(() => ({}));

    if (registrantData?.join_url) {
      return NextResponse.json({
        success: true,
        join_url: registrantData.join_url,
      });
    }

    console.error('Zoom Registration Error:', registrantData);
    return NextResponse.json(
      { success: false, error: registrantData?.message || 'Failed to register to Zoom' },
      { status: 500 }
    );
  } catch (error: any) {
    console.error('API Error:', error);
    return NextResponse.json({ success: false, error: error.message || String(error) }, { status: 500 });
  }
}
