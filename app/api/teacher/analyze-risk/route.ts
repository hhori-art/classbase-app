import { NextResponse } from 'next/server';
import { NextRequest } from 'next/server';
import { adminDb } from '@/lib/firebase-admin';
import { getServerUser, isAdminLike, requireRole } from '@/lib/server-auth';
import OpenAI from 'openai';

const openai = new OpenAI({
  apiKey: process.env.OPENAI_API_KEY,
});

// ★足切りの基準値 (これより低いと詳細AI診断を実行)
const ATTENDANCE_BORDER = 90; // 出席率90%未満なら要診断
const HOMEWORK_BORDER = 70;   // 宿題提出率70%未満なら要診断

// 1回の実行で処理する人数
const DEFAULT_BATCH_SIZE = 10;

export async function POST(req: NextRequest) {
  try {
    const user = await getServerUser(req);
    if (!isAdminLike(user)) requireRole(user, ['teacher']);

    const { batchSize = DEFAULT_BATCH_SIZE } = await req.json();
    const db = adminDb();

    // 1. 分析対象の生徒を取得 (分析日時が古い順に取得してローテーションさせる)
    const usersRef = db.collection('users');
    const snapshot = await usersRef
      .where('role', '==', 'student')
      .orderBy('risk_analyzed_at', 'asc')
      .limit(Math.min(Number(batchSize) || DEFAULT_BATCH_SIZE, 50))
      .get();
    const students = snapshot.docs.map(d => ({ id: d.id, ...d.data() }));

    if (students.length === 0) {
      return NextResponse.json({ processed: 0, message: 'No students to analyze.' });
    }

    let processedCount = 0;
    let aiAnalyzedCount = 0; // 実際にAI診断した人数

    // 2. 生徒ごとに処理
    const analysisPromises = students.map(async (student: any) => {
      try {
        // --- A. PFデータ (出席・宿題) の取得と計算 ---
        const currentYear = new Date().getFullYear().toString();
        const pfSnap = await db.collection('pf_records')
          .where('student_id', '==', student.id)
          .where('year', '==', currentYear)
          .get();
        
        let totalClasses = 0;
        let absentCount = 0;
        let hwTotal = 0;
        let hwSubmitted = 0;

        pfSnap.forEach(doc => {
          const d = doc.data();
          if (d.attendance_status) {
            totalClasses++;
            if (d.attendance_status === '欠') absentCount++;
          }
          if ((d.social_hw) || (d.science_hw)) {
            hwTotal++;
            const isSocialDone = d.social_hw && d.social_hw !== '未';
            const isScienceDone = d.science_hw && d.science_hw !== '未';
            if (isSocialDone || isScienceDone) hwSubmitted++; 
          }
        });

        // データがない場合は100%扱いにしておく（または分析スキップ）
        const attendanceRate = totalClasses > 0 ? Math.round(((totalClasses - absentCount) / totalClasses) * 100) : 100;
        const homeworkRate = hwTotal > 0 ? Math.round((hwSubmitted / hwTotal) * 100) : 100;

        // --- B. 足切り判定 (スクリーニング) ---
        const isAttendanceGood = attendanceRate >= ATTENDANCE_BORDER;
        const isHomeworkGood = homeworkRate >= HOMEWORK_BORDER;

        // 両方クリアしている場合は「低リスク」として即時更新 (API節約)
        if (isAttendanceGood && isHomeworkGood) {
          await db.collection('users').doc(student.id).set({
            churn_risk: 5, // 最低レベルのリスク
            risk_reason: `出席・提出状況ともに良好です (出席:${attendanceRate}%, 提出:${homeworkRate}%)`,
            risk_action: "現状維持（定期的な承認・声掛け）",
            risk_analyzed_at: new Date().toISOString() // 更新日時を新しくして、次回の分析順位を下げる
          }, { merge: true });
          processedCount++;
          return; // ここで終了
        }

        // --- C. 要注意生徒のみ: チャット履歴取得 & 詳細AI分析 ---
        aiAnalyzedCount++;
        
        const chatSnap = await db.collection('chat_logs')
          .where('uid', '==', student.id)
          .orderBy('created_at', 'desc')
          .limit(15)
          .get();
        const chatHistory = chatSnap.docs
          .map(d => {
            const c = d.data();
            return `${c.role === 'user' ? '生徒' : 'AI/先生'}: ${c.message}`;
          })
          .reverse()
          .join('\n');

        const prompt = `
          あなたは学習塾のベテラン講師です。以下の「要注意生徒」のデータから退塾リスクを診断してください。
          
          【定量データ (警告値)】
          ・氏名: ${student.student_name}
          ・出席率: ${attendanceRate}% (基準 ${ATTENDANCE_BORDER}% 未満かも)
          ・宿題提出率: ${homeworkRate}% (基準 ${HOMEWORK_BORDER}% 未満かも)
          
          【定性データ (直近の会話)】
          ${chatHistory || '(履歴なし)'}

          【診断ルール】
          1. 数値が悪くても、チャットで「頑張る」「挽回したい」などの意欲が見えればリスクを少し下げる。
          2. 数値が悪く、かつチャットで「疲れた」「意味ない」「辞めたい」等の発言があればリスク最大(90%以上)。
          3. チャット履歴がない場合は、数値のみに基づいて厳しめに判定する。

          出力JSON形式:
          {
            "risk_score": number, // 0-100
            "reason": "string",   // 分析理由 (30文字程度。例: 出席率低下に加え、発言に疲労感が見られるため)
            "action": "string"    // 推奨アクション (30文字程度。例: 面談を設定し、学習ペースの見直しを提案する)
          }
        `;

        const completion = await openai.chat.completions.create({
          model: "gpt-3.5-turbo",
          messages: [{ role: "system", content: prompt }],
          temperature: 0.7,
          response_format: { type: "json_object" }
        });

        const resultStr = completion.choices[0].message.content;
        if (!resultStr) throw new Error("AI response empty");
        
        const result = JSON.parse(resultStr);

        // --- D. 結果保存 ---
        await db.collection('users').doc(student.id).set({
          churn_risk: result.risk_score,
          risk_reason: result.reason,
          risk_action: result.action,
          risk_analyzed_at: new Date().toISOString()
        }, { merge: true });

        processedCount++;

      } catch (err) {
        console.error(`Error analyzing student ${student.id}:`, err);
      }
    });

    await Promise.all(analysisPromises);

    // 残り人数チェック
    const remainingSnap = await usersRef
      .where('role', '==', 'student')
      .orderBy('risk_analyzed_at', 'asc')
      .limit(1)
      .get();
    const remaining = remainingSnap.empty ? 0 : 99;

    return NextResponse.json({ 
      processed: processedCount,
      ai_analyzed: aiAnalyzedCount, // 実際にAIを使った人数
      remaining: remaining > 0 ? 'あり' : 0,
      message: 'Analysis complete' 
    });

  } catch (error: any) {
    console.error('API Error:', error);
    return NextResponse.json({ error: error.message }, { status: 500 });
  }
}
