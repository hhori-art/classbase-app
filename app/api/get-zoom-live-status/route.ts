import { NextResponse } from 'next/server';
import { NextRequest } from 'next/server';
import { adminDb } from '@/lib/firebase-admin';
import { getServerUser, isAdminLike, requireRole } from '@/lib/server-auth';

export const runtime = 'nodejs';

// キャッシュ完全無効化（必要なら残す）
export const dynamic = 'force-dynamic';
export const fetchCache = 'force-no-store';

export async function POST(request: NextRequest) {
  try {
    const user = await getServerUser(request);
    if (!isAdminLike(user)) requireRole(user, ['teacher']);

    const { meetingId } = await request.json();

    if (!meetingId) {
      return NextResponse.json({ success: false, error: 'Meeting ID is required' }, { status: 400 });
    }

    const accountId = process.env.ZOOM_ACCOUNT_ID;
    const clientId = process.env.ZOOM_CLIENT_ID;
    const clientSecret = process.env.ZOOM_CLIENT_SECRET;

    if (!accountId || !clientId || !clientSecret) {
      return NextResponse.json({ success: false, error: 'Zoom API Credentials missing' }, { status: 500 });
    }

    // 1) Zoom Access Token
    const authHeader = Buffer.from(`${clientId}:${clientSecret}`).toString('base64');
    const tokenRes = await fetch(
      `https://zoom.us/oauth/token?grant_type=account_credentials&account_id=${accountId}`,
      {
        method: 'POST',
        headers: { Authorization: `Basic ${authHeader}` },
        cache: 'no-store',
      }
    );

    if (!tokenRes.ok) throw new Error('Failed to get Zoom access token');

    const tokenData = await tokenRes.json();
    const accessToken = tokenData.access_token;

    // 2) Zoom Live Data (Metrics API)
    const metricsRes = await fetch(
      `https://api.zoom.us/v2/metrics/meetings/${meetingId}/participants?type=live&page_size=300&_t=${Date.now()}`,
      {
        method: 'GET',
        headers: { Authorization: `Bearer ${accessToken}` },
        cache: 'no-store',
      }
    );

    if (metricsRes.status === 404) {
      return NextResponse.json({ success: false, error: '会議が見つかりません。' });
    }
    if (!metricsRes.ok) {
      const err = await metricsRes.json().catch(() => ({}));
      return NextResponse.json({ success: false, error: `Zoom API Error: ${err.message || 'unknown'}` });
    }

    const metricsData = await metricsRes.json();
    const rawParticipants = metricsData.participants || [];

    // 退出済み除外
    const participants = rawParticipants.filter((p: any) => {
      if (p.leave_time) return false;
      if (p.status && p.status !== 'in_meeting') return false;
      return true;
    });

    // 3) 名簿データ取得（Admin Firestore）
    const students: any[] = [];
    try {
      const db = adminDb();
      const usersSnap = await db.collection('users').where('role', '==', 'student').get();
      usersSnap.forEach((doc) => {
        students.push({ id: doc.id, ...doc.data() });
      });
    } catch (dbError: any) {
      console.error('Firestore Admin Error:', dbError);
    }

    // 正規化関数
    const normalize = (str: string) => {
      if (!str) return '';
      return str
        .replace(/[\s　]+/g, '')
        .toLowerCase()
        .replace(/[０-９]/g, (s) => String.fromCharCode(s.charCodeAt(0) - 0xfee0))
        .replace(/[Ａ-Ｚａ-ｚ]/g, (s) => String.fromCharCode(s.charCodeAt(0) - 0xfee0));
    };

    const matchedStudentIds = new Set<string>();

    const results = participants.map((p: any) => {
      const zoomName = p.user_name || 'Unknown';
      const nZoomName = normalize(zoomName);

      const rawCamera = p.camera;
      const rawQuality = p.video_quality;

      // カメラ判定（厳格）
      const hasVideo =
        (!!rawQuality && rawQuality !== '') ||
        (!!rawCamera && String(rawCamera).toLowerCase() !== 'off' && String(rawCamera).trim().length > 0);

      let matchedStudent: any = null;

      // 1) Email
      matchedStudent = students.find(
        (s) =>
          !matchedStudentIds.has(s.id) &&
          s.email &&
          p.email &&
          String(s.email).toLowerCase() === String(p.email).toLowerCase()
      );

      // 2) lifetime_id が名前に含まれる
      if (!matchedStudent) {
        matchedStudent = students.find((s) => {
          if (matchedStudentIds.has(s.id)) return false;
          if (!s.lifetime_id) return false;
          const idStr = String(s.lifetime_id);
          return idStr.length >= 3 && nZoomName.includes(idStr);
        });
      }

      // 3) Name exact
      if (!matchedStudent) {
        matchedStudent = students.find((s) => {
          if (matchedStudentIds.has(s.id)) return false;
          const nStudentName = normalize(s.student_name || '');
          return nStudentName && nZoomName === nStudentName;
        });
      }

      // 4) Name partial
      if (!matchedStudent) {
        matchedStudent = students.find((s) => {
          if (matchedStudentIds.has(s.id)) return false;
          const nStudentName = normalize(s.student_name || '');
          if (!nStudentName || nStudentName.length < 2) return false;
          return nZoomName.includes(nStudentName) || nStudentName.includes(nZoomName);
        });
      }

      if (matchedStudent) {
        matchedStudentIds.add(matchedStudent.id);
      }

      return {
        zoom_id: p.id,
        zoom_name: zoomName,
        matched_name: matchedStudent ? matchedStudent.student_name : null,
        matched_id: matchedStudent ? matchedStudent.id : null,
        video_on: hasVideo,
        audio_on: !!p.audio_quality,
        device: p.device_name || p.device,
        join_time: p.join_time,
      };
    });

    return NextResponse.json({
      success: true,
      participants: results,
      total_count: results.length,
    });
  } catch (error: any) {
    console.error('API Error:', error);
    return NextResponse.json({ success: false, error: error.message || String(error) }, { status: 500 });
  }
}
