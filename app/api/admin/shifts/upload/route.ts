import { NextResponse } from 'next/server';
import { db } from '@/lib/firebase';
import { collection, doc, writeBatch } from 'firebase/firestore';

export async function POST(request: Request) {
  try {
    const body = await request.json();
    const { shifts } = body; // フロントエンドから { shifts: [...] } という形で受け取る想定

    if (!Array.isArray(shifts) || shifts.length === 0) {
      return NextResponse.json({ error: 'シフトデータがありません' }, { status: 400 });
    }

    // FirestoreのBatch書き込みは一度に最大500件までという制限があります。
    // 安全のため、400件ごとに分割して処理します。
    const BATCH_SIZE = 400;
    const chunks = [];
    
    for (let i = 0; i < shifts.length; i += BATCH_SIZE) {
      chunks.push(shifts.slice(i, i + BATCH_SIZE));
    }

    let successCount = 0;

    // チャンクごとにバッチ処理を実行
    for (const chunk of chunks) {
      const batch = writeBatch(db);
      
      chunk.forEach((shift: any) => {
        // IDはFirestoreに自動生成させる
        const shiftRef = doc(collection(db, 'shift_assignments'));
        
        batch.set(shiftRef, {
          date: shift.date,             // 日付 (YYYY-MM-DD)
          time_period: shift.period,    // 時間帯 (1 or 2)
          teacher_name: shift.teacher,  // 講師名
          target_grade: shift.grade,    // 学年
          target_subject: shift.subject,// 科目
          role_type: 'main',            // 役割 (main/sub)
          created_at: new Date().toISOString()
        });
      });

      await batch.commit();
      successCount += chunk.length;
    }

    return NextResponse.json({ success: true, count: successCount });

  } catch (error: any) {
    console.error('Batch upload error:', error);
    return NextResponse.json({ error: error.message }, { status: 500 });
  }
}