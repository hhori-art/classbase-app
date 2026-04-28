import { NextResponse } from 'next/server';
import { NextRequest } from 'next/server';
import { FieldValue } from 'firebase-admin/firestore';
import { adminDb } from '@/lib/firebase-admin';
import { getServerUser, isAdminLike, jsonError } from '@/lib/server-auth';

export const runtime = 'nodejs';

export async function POST(request: NextRequest) {
  try {
    const actor = await getServerUser(request);
    if (!isAdminLike(actor)) throw new Error('forbidden');

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
    const db = adminDb();

    // チャンクごとにバッチ処理を実行
    for (const chunk of chunks) {
      const batch = db.batch();
      
      chunk.forEach((shift: any) => {
        // IDはFirestoreに自動生成させる
        const shiftRef = db.collection('shift_assignments').doc();
        
        batch.set(shiftRef, {
          date: shift.date,             // 日付 (YYYY-MM-DD)
          target_date: shift.target_date || shift.date,
          time_period: shift.period,    // 時間帯 (1 or 2)
          note: shift.note || `【${shift.period || 1}限】`,
          teacher_name: shift.teacher,  // 講師名
          target_grade: shift.grade,    // 学年
          target_subject: shift.subject,// 科目
          target_detail_subject: shift.detail_subject || shift.course_name || shift.class || '',
          unit: shift.unit || '',
          role_type: 'main',            // 役割 (main/sub)
          uploaded_by: actor.uid,
          created_at: FieldValue.serverTimestamp(),
          updated_at: FieldValue.serverTimestamp(),
        });
      });

      await batch.commit();
      successCount += chunk.length;
    }

    return NextResponse.json({ success: true, count: successCount });

  } catch (error: any) {
    console.error('Batch upload error:', error);
    return jsonError(error);
  }
}
