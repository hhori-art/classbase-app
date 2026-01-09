import { NextResponse } from 'next/server';
import OpenAI from 'openai';
import { db } from '@/lib/firebase';
import { collection, query, where, getDocs, orderBy, limit, doc, updateDoc, getDoc } from 'firebase/firestore';

const openai = new OpenAI({ apiKey: process.env.OPENAI_API_KEY });

// 安全圏の基準 (これを満たす生徒はAI分析をスキップしてコスト削減)
const SAFE_THRESHOLD = {
  attendance: 90, // 出席率90%以上
  score: 70       // 平均点70点以上
};

export async function POST(req: Request) {
  try {
    // フロントからは「何人処理するか」だけ受け取る（デフォルト5人）
    // ※3000人いる場合、これを定期的に叩くか、ボタン連打で消化します
    const { batchSize = 5 } = await req.json();

    // 1. 生徒一覧を取得
    // 本来は「最終分析日が古い順」でクエリしたいが、Firestoreの複合インデックスが必要になるため
    // ここでは全生徒(student)を取得して、コード側でフィルタリングする簡易実装にします
    // ※3000人の場合、本来は cursor を使ったページネーションが必要ですが、今回は簡略化します
    const usersQ = query(collection(db, 'users'), where('role', '==', 'student'));
    const usersSnap = await getDocs(usersQ);
    
    let processedCount = 0;
    const results = [];
    const now = new Date();

    // 更新が必要な生徒を抽出
    const candidates = usersSnap.docs.filter(doc => {
      const data = doc.data();
      // (A) 要注意フラグが立っている (チャットボットなどが検知)
      if (data.requires_attention) return true;
      
      // (B) まだ一度も分析していない
      if (!data.risk_analyzed_at) return true;

      // (C) 前回の分析から3日以上経過している
      const lastAnalyzed = new Date(data.risk_analyzed_at);
      const diffDays = (now.getTime() - lastAnalyzed.getTime()) / (1000 * 3600 * 24);
      return diffDays >= 3;
    });

    // 上限人数まで処理
    for (const userDoc of candidates.slice(0, batchSize)) {
      const studentId = userDoc.id;
      const userData = userDoc.data();

      // --- データ収集 ---
      
      // 小テスト平均
      const quizQ = query(collection(db, 'users', studentId, 'quiz_results'), orderBy('created_at', 'desc'), limit(10));
      const quizSnap = await getDocs(quizQ);
      const quizRecs = quizSnap.docs.map(d => d.data());
      const avgScore = quizRecs.length > 0 
        ? (quizRecs.filter((r:any) => r.isCorrect).length / quizRecs.length) * 100 : 0;

      // 出席率
      const pfQ = query(collection(db, 'pf_records'), where('student_id', '==', studentId), limit(20));
      const pfSnap = await getDocs(pfQ);
      const pfRecs = pfSnap.docs.map(d => d.data());
      const attendanceRate = pfRecs.length > 0
        ? (pfRecs.filter((r:any) => r.attendance_status === '出').length / pfRecs.length) * 100 : 100;

      // --- コスト削減ロジック (足切り) ---
      // 成績・出席が良く、かつ「要注意フラグ」が立っていないならAIスキップ
      if (!userData.requires_attention && attendanceRate >= SAFE_THRESHOLD.attendance && avgScore >= SAFE_THRESHOLD.score) {
        // 安全とみなして更新
        await updateDoc(doc(db, 'users', studentId), {
          churn_risk: 5, // 低リスク固定
          risk_reason: "出席率・成績ともに基準値以上で安定しています。",
          risk_action: "現状維持（褒めて伸ばす）",
          risk_analyzed_at: now.toISOString(),
          requires_attention: false // フラグ解除
        });
        results.push({ name: userData.student_name, status: 'skipped_safe' });
        processedCount++;
        continue;
      }

      // --- AI分析実行 (リスクが高い、またはデータ不足の生徒のみ) ---
      
      // チャット履歴取得
      const chatQ = query(collection(db, 'users', studentId, 'chats'), orderBy('created_at', 'desc'), limit(10));
      const chatSnap = await getDocs(chatQ);
      const chats = chatSnap.docs.map(d => d.data().text).reverse().join("\n");

      const systemPrompt = `
      学習塾の生徒の退塾リスク(0-100%)を判定してください。
      名前: ${userData.student_name}
      出席率: ${attendanceRate.toFixed(1)}%
      テスト正答率: ${avgScore.toFixed(1)}%
      チャット発言:
      ${chats || '(なし)'}
      
      出力JSON: { "risk_score": 数値, "reason": "理由", "action_plan": "対応策" }
      `;

      try {
        const completion = await openai.chat.completions.create({
          model: "gpt-4o-mini",
          messages: [{ role: "system", content: systemPrompt }],
          response_format: { type: "json_object" },
        });
        const aiRes = JSON.parse(completion.choices[0].message.content || '{}');

        await updateDoc(doc(db, 'users', studentId), {
          churn_risk: aiRes.risk_score,
          risk_reason: aiRes.reason,
          risk_action: aiRes.action_plan,
          risk_analyzed_at: now.toISOString(),
          requires_attention: false // 分析完了したらフラグを下ろす
        });
        results.push({ name: userData.student_name, status: 'analyzed', score: aiRes.risk_score });

      } catch (err) {
        console.error(err);
      }
      processedCount++;
    }

    return NextResponse.json({ 
      processed: processedCount, 
      remaining: Math.max(0, candidates.length - processedCount),
      details: results 
    });

  } catch (e: any) {
    console.error(e);
    return NextResponse.json({ error: e.message }, { status: 500 });
  }
}