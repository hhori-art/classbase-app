// app/api/webhook/zoom/route.ts
import { NextResponse } from 'next/server';
import { db } from '@/lib/firebase'; // firebase設定のパスに合わせてください
import { collection, query, where, getDocs, updateDoc, doc } from 'firebase/firestore';
import crypto from 'crypto';

export async function POST(request: Request) {
  try {
    const body = await request.json();
    
    // --- 1. Zoomの認証 (Secret Tokenの検証) ---
    // 本番環境では必須ですが、テスト時は一旦スキップも可能です
    // const signature = request.headers.get('x-zm-signature');
    // ...検証ロジック...

    // --- 2. URL確認イベントへの応答 (Zoomの仕様) ---
    if (body.event === 'endpoint.url_validation') {
      const hashForValidate = crypto
        .createHmac('sha256', process.env.ZOOM_WEBHOOK_SECRET || '')
        .update(body.payload.plainToken)
        .digest('hex');
      return NextResponse.json({
        plainToken: body.payload.plainToken,
        encryptedToken: hashForValidate
      });
    }

    // --- 3. 録画完了イベントの処理 ---
    if (body.event === 'recording.completed') {
      const payload = body.payload.object;
      const meetingId = String(payload.id); // ZoomのミーティングID
      const shareUrl = payload.share_url;   // 視聴用URL
      const startTime = new Date(payload.start_time);
      
      // JSTに変換して日付文字列を取得 (YYYY-MM-DD)
      // 授業日がずれないように日本時間で判定
      const jstDate = new Date(startTime.getTime() + 9 * 60 * 60 * 1000);
      const targetDateStr = jstDate.toISOString().split('T')[0];

      console.log(`🎥 録画受信: ID=${meetingId}, Date=${targetDateStr}`);

      // --- 4. Firestoreから該当するシフトを検索 ---
      // 条件:
      // A. ミーティングIDが一致
      // B. 日付が一致 (定期ミーティング等でのID使い回し対策)
      // C. 役割が 'main' (メイン講師のみ)
      const q = query(
        collection(db, 'shift_assignments'),
        where('target_meeting_id', '==', meetingId),
        where('target_date', '==', targetDateStr),
        where('role_type', '==', 'main') // ★重要: メイン講師のみに限定
      );

      const snapshot = await getDocs(q);

      if (snapshot.empty) {
        console.log('⚠️ 該当するメイン講師のシフトが見つかりません。');
        return NextResponse.json({ message: 'No matching shift found' });
      }

      // --- 5. 重複チェック (1時間に1つ / 1授業に1つ) ---
      // 複数のシフト(例えば1限と2限で同じID)がヒットする可能性があるので、
      // 時間で絞り込むか、最初に見つかった「URL未登録」のものを採用する
      
      let targetDoc = null;

      for (const docSnap of snapshot.docs) {
        const data = docSnap.data();
        
        // 既にURLが入っている場合はスキップ (＝同一IDでの重複登録を防ぐ)
        if (data.target_recording_url) {
          console.log(`⏭ 既に録画URLが存在するためスキップします: ${docSnap.id}`);
          continue;
        }

        // 授業時間帯の判定 (簡易的)
        // 録画開始時間が、その授業の想定時間に近いかを判定しても良いですが、
        // 「URLが空」かつ「IDと日付が一致」していれば、それが対象の授業である可能性が高いです。
        targetDoc = docSnap;
        break; // 1つ見つかったらループ終了 (＝1つだけ作成)
      }

      if (targetDoc) {
        // --- 6. URL保存 ---
        await updateDoc(doc(db, 'shift_assignments', targetDoc.id), {
          target_recording_url: shareUrl,
          recording_updated_at: new Date().toISOString()
        });
        console.log(`✅ 録画URLを保存しました: ${targetDoc.id}`);
      } else {
        console.log('⏭ 全ての該当シフトに既にURLが登録済みです。');
      }
    }

    return NextResponse.json({ success: true });

  } catch (error: any) {
    console.error('Webhook Error:', error);
    return NextResponse.json({ error: error.message }, { status: 500 });
  }
}