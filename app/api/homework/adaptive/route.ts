import { NextResponse } from 'next/server';
import OpenAI from 'openai';

const openai = new OpenAI({ apiKey: process.env.OPENAI_API_KEY });

export async function POST(req: Request) {
  try {
    const { recentResults, availableQuestions } = await req.json();

    const systemPrompt = `
    あなたは個別指導のプロフェッショナルです。
    生徒の直近の回答履歴を分析し、候補の中から「最も学習効果が高い次の1問」を選んでIDを返してください。
    
    【選定ロジック】
    - 正解が続いている -> 難易度を上げる
    - 間違えた -> 基礎問題に戻るか、類似問題を選ぶ
    
    出力フォーマット(JSON): { "next_question_id": "ID_STRING", "reason": "選定理由" }
    `;

    // 候補問題のデータ量を削減して送信（コスト節約）
    // 問題文全文ではなく、IDと難易度と冒頭部分だけでも判断可能なら削る手もあるが、
    // gpt-4o-miniは安いので一旦全文送っても大丈夫です。
    const questionPool = availableQuestions.map((q: any) => ({
      id: q.id,
      diff: q.difficulty,
      txt: q.question
    }));

    const completion = await openai.chat.completions.create({
      // ★ここを変更: コスト最適化
      model: "gpt-4o-mini",
      messages: [
        { role: "system", content: systemPrompt },
        { role: "user", content: JSON.stringify({ 
            history: recentResults, 
            pool: questionPool
          }) 
        }
      ],
      response_format: { type: "json_object" },
    });

    const content = completion.choices[0].message.content;
    const result = JSON.parse(content || '{}');
    
    return NextResponse.json(result);

  } catch (e: any) {
    console.error("Adaptive API Error:", e);
    return NextResponse.json({ error: e.message }, { status: 500 });
  }
}