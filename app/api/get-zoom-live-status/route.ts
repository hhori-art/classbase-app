import { NextResponse } from 'next/server';
import { adminDb } from '@/lib/firebase-admin'; 

// キャッシュ完全無効化
export const dynamic = 'force-dynamic'; 
export const fetchCache = 'force-no-store';

export async function POST(request: Request) {
  try {
    if (!adminDb || Object.keys(adminDb).length === 0) {
      return NextResponse.json({ success: false, error: 'Server Configuration Error' }, { status: 500 });
    }

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

    // 1. Zoom Access Token
    const authHeader = Buffer.from(`${clientId}:${clientSecret}`).toString('base64');
    const tokenRes = await fetch(`https://zoom.us/oauth/token?grant_type=account_credentials&account_id=${accountId}`, {
      method: 'POST',
      headers: { 'Authorization': `Basic ${authHeader}` },
      cache: 'no-store' 
    });

    if (!tokenRes.ok) throw new Error('Failed to get Zoom access token');
    const tokenData = await tokenRes.json();
    const accessToken = tokenData.access_token;

    // 2. Zoom Live Data (Metrics API)
    // 名前変更は反映されないが、カメラ情報と在室確認はこれが最も確実
    const metricsRes = await fetch(`https://api.zoom.us/v2/metrics/meetings/${meetingId}/participants?type=live&page_size=300&_t=${Date.now()}`, {
      method: 'GET',
      headers: { 'Authorization': `Bearer ${accessToken}` },
      cache: 'no-store'
    });

    if (metricsRes.status === 404) {
      return NextResponse.json({ success: false, error: '会議が見つかりません。' });
    }
    if (!metricsRes.ok) {
      const err = await metricsRes.json();
      return NextResponse.json({ success: false, error: `Zoom API Error: ${err.message}` });
    }

    const metricsData = await metricsRes.json();
    const rawParticipants = metricsData.participants || [];

    // ★重要: 「退出済み」のユーザーを除外するフィルタリング処理
    // leave_time が存在しない、かつ status が 'in_meeting' の人のみ残す
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    const participants = rawParticipants.filter((p: any) => {
      // 退出時刻が入っている = 既にいない
      if (p.leave_time) return false;
      // ステータスが明示的に 'left' 等になっている = 既にいない
      if (p.status && p.status !== 'in_meeting') return false;
      return true;
    });

    // 3. 名簿データ取得
    const students: any[] = [];
    try {
      const usersSnap = await adminDb.collection('users').where('role', '==', 'student').get();
      usersSnap.forEach(doc => {
        students.push({ id: doc.id, ...doc.data() });
      });
    } catch (dbError: any) {
      console.error("Firestore Admin Error:", dbError);
    }

    // 正規化関数
    const normalize = (str: string) => {
      if (!str) return "";
      return str
        .replace(/[\s　]+/g, '')
        .toLowerCase()
        .replace(/[０-９]/g, (s) => String.fromCharCode(s.charCodeAt(0) - 0xFEE0))
        .replace(/[Ａ-Ｚａ-ｚ]/g, (s) => String.fromCharCode(s.charCodeAt(0) - 0xFEE0));
    };

    const matchedStudentIds = new Set<string>();
    
    // シンプルなログに戻します
    console.log(`\n=== 🔍 判定ログ (在室: ${participants.length}名) ===`);

    const results = participants.map((p: any) => {
      const zoomName = p.user_name || 'Unknown';
      const nZoomName = normalize(zoomName);
      
      const rawCamera = p.camera;       
      const rawQuality = p.video_quality; 
      
      // カメラ判定 (厳格モード)
      const hasVideo = 
        (!!rawQuality && rawQuality !== '') || 
        (!!rawCamera && rawCamera.toLowerCase() !== 'off' && rawCamera.trim().length > 0);

      // --- マッチングロジック ---
      let matchedStudent: any = null;

      // 1. Email (これが最強: 名前が違っていてもメアドで特定可能)
      matchedStudent = students.find((s) => 
        !matchedStudentIds.has(s.id) && s.email && p.email && s.email.toLowerCase() === p.email.toLowerCase()
      );

      // 2. ID (名前の中にIDが含まれていればOK)
      if (!matchedStudent) {
        matchedStudent = students.find((s) => {
          if (matchedStudentIds.has(s.id)) return false;
          if (!s.lifetime_id) return false;
          const idStr = String(s.lifetime_id);
          return idStr.length >= 3 && nZoomName.includes(idStr);
        });
      }

      // 3. Name Exact
      if (!matchedStudent) {
        matchedStudent = students.find((s) => {
          if (matchedStudentIds.has(s.id)) return false;
          const nStudentName = normalize(s.student_name || '');
          return nStudentName && nZoomName === nStudentName;
        });
      }

      // 4. Name Partial
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
        // マッチしたログ
      } else {
        console.log(`❌ 未登録: "${zoomName}" (Email: ${p.email || 'なし'})`);
      }

      return {
        zoom_id: p.id,
        zoom_name: zoomName,
        matched_name: matchedStudent ? matchedStudent.student_name : null,
        matched_id: matchedStudent ? matchedStudent.id : null,
        video_on: hasVideo,
        audio_on: !!p.audio_quality,
        device: p.device_name || p.device,
        join_time: p.join_time
      };
    });
    
    console.log(`=================================================\n`);

    return NextResponse.json({ 
      success: true, 
      participants: results,
      total_count: results.length
    });

  } catch (error: any) {
    console.error('API Error:', error);
    return NextResponse.json({ success: false, error: error.message }, { status: 500 });
  }
}