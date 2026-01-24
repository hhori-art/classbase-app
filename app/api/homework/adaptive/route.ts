import { NextResponse } from 'next/server';
import OpenAI from 'openai';

const openai = new OpenAI({
  apiKey: process.env.OPENAI_API_KEY,
});

export async function POST(req: Request) {
  try {
    const { grade, subject, unitName, unitContent } = await req.json();

    if (!grade || !subject) {
      return NextResponse.json({ error: '学年または科目が指定されていません' }, { status: 400 });
    }

    // スライド内容がない場合のフォールバック（一般的な問題作成）
    const slideContext = unitContent || ""; 

    // プロンプトの作成
    const systemPrompt = `
    あなたは中学校のベテラン教師です。
    生徒がゲーム感覚で学習内容を確認できるよう、指定された【学年】と【科目・分野】に基づいた4択クイズを10問作成してください。

    【制約事項】
    - 出力は必ず以下のJSON形式のみとしてください。余計な会話は不要です。
    - 難易度はその学年の標準レベルに合わせること。
    - 単なる用語の暗記だけでなく、理屈を問う問題や、事例問題などバリエーションを持たせること。
    - 「解説」は生徒を励ますような口調（「〜だよ！」「すごいね！」など）を含めてください。

    【JSON出力フォーマット】
    {
      "questions": [
        {
          "id": "一意のID文字列",
          "question": "問題文",
          "correct_answer": "正解の選択肢",
          "wrong_answers": ["不正解1", "不正解2", "不正解3"],
          "explanation": "解説文"
        }
      ]
    }
    `;

    const userPrompt = slideContext 
      ? `以下の学習内容に基づいて、${grade}の${subject}に関するクイズを10問作成してください。\n\n【学習内容】\n${slideContext}`
      : `${grade}の${subject}に関する重要単元のクイズを10問作成してください。`;

    const completion = await openai.chat.completions.create({
      model: "gpt-4o-mini",
      messages: [
        { role: "system", content: systemPrompt },
        { role: "user", content: userPrompt }
      ],
      response_format: { type: "json_object" },
      temperature: 0.8, // バリエーションを出すため少し温度を上げる
    });

    const responseContent = completion.choices[0].message.content;
    if (!responseContent) throw new Error('AIからの応答が空でした');

    const data = JSON.parse(responseContent);
    const questions = Array.isArray(data) ? data : (data.questions || data.quiz || []);

    return NextResponse.json({ questions });

  } catch (e: any) {
    console.error("AI Quest Gen Error:", e);
    return NextResponse.json({ error: e.message || '問題生成中にエラーが発生しました' }, { status: 500 });
  }
}