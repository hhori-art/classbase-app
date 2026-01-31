import { NextRequest, NextResponse } from 'next/server';
import { db } from '@/lib/firebase';
import { collection, query, where, getDocs, writeBatch } from 'firebase/firestore';
import crypto from 'crypto';

export async function POST(req: NextRequest) {
  try {
    const body = await req.json();

    // 1. Zoomの認証 (URL Validation)
    // Zoomが「このURLは生きてるか？」を確認しに来るイベントです
    if (body.event === 'endpoint.url_validation') {
      const plainToken = body.payload.plainToken;
      const secret = process.env.ZOOM_SECRET_TOKEN || ''; // .envに設定します
      
      const hash = crypto.createHmac('sha256', secret)
                         .update(plainToken)
                         .digest('hex');

      return NextResponse.json({
        plainToken: plainToken,
        encryptedToken: hash
      }, { status: 200 });
    }

    // 2. 録画完了イベントの処理
    if (body.event === 'recording.completed') {
      const payload = body.payload.object;
      const meetingIdRaw = String(payload.id); // Zoom上のミーティングID (数字のみ)
      const recordingUrl = payload.share_url;  // 視聴用URL
      const startTime = new Date(payload.start_time); 

      // 日本時間に変換して日付を取得 (例: 2025-12-01)
      // サーバー時刻がUTCの場合を考慮して9時間足す
      const jstDate = new Date(startTime.getTime() + 9 * 60 * 60 * 1000);
      const targetDate = jstDate.toISOString().split('T')[0];

      console.log(`[Zoom Webhook] 録画検知: ID=${meetingIdRaw}, Date=${targetDate}`);

      // Firestoreから授業を検索
      // CSV取り込みデータは "123 456 7890" のようにスペースが入っている可能性があるため
      // いくつかのパターンで検索をかけます。
      const possibleIds = [
        meetingIdRaw, // 12345678901
        meetingIdRaw.replace(/(\d{3})(\d{4})(\d{4})/, '$1 $2 $3'), // 123 4567 8901 (11桁)
        meetingIdRaw.replace(/(\d{3})(\d{3})(\d{4})/, '$1 $2 $3'), // 123 456 7890 (10桁)
      ];

      const shiftsRef = collection(db, 'shift_assignments');
      const q = query(
        shiftsRef,
        where('target_date', '==', targetDate),
        where('target_meeting_id', 'in', possibleIds)
      );
      
      const snap = await getDocs(q);

      if (snap.empty) {
        console.log('[Zoom Webhook] 該当する授業データが見つかりませんでした。');
        return NextResponse.json({ message: 'No matching shift found' }, { status: 200 });
      }

      // 該当するすべての授業データに録画URLを書き込む
      const batch = writeBatch(db);
      snap.forEach((doc) => {
        batch.update(doc.ref, { 
          target_recording_url: recordingUrl,
          updated_at: new Date().toISOString()
        });
      });
      await batch.commit();

      console.log(`[Zoom Webhook] ${snap.size}件の授業に録画URLを登録しました。`);
    }

    return NextResponse.json({ status: 'ok' }, { status: 200 });

  } catch (error) {
    console.error('[Zoom Webhook Error]', error);
    return NextResponse.json({ error: 'Internal Server Error' }, { status: 500 });
  }
}
// ... コードの末尾など ...

// Vercel再デプロイ用コメント: Zoomログ確認