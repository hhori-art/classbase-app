import { NextResponse } from 'next/server';
import OpenAI from 'openai';

const openai = new OpenAI({
  apiKey: process.env.OPENAI_API_KEY,
});

const MAX_CONTEXT_CHARS = 12000;

function compactContent(value: unknown, maxChars = MAX_CONTEXT_CHARS) {
  const text = String(value || '').replace(/\n{3,}/g, '\n\n').trim();
  if (text.length <= maxChars) return text;

  const head = text.slice(0, Math.floor(maxChars * 0.45));
  const middleStart = Math.max(0, Math.floor(text.length / 2 - maxChars * 0.15));
  const middle = text.slice(middleStart, middleStart + Math.floor(maxChars * 0.25));
  const tail = text.slice(-Math.floor(maxChars * 0.25));
  return [
    head,
    '\n\n【中略: スライド本文が長いため、前半・中盤・後半を抜粋しています】\n\n',
    middle,
    '\n\n【後半抜粋】\n\n',
    tail,
  ].join('').slice(0, maxChars);
}

export async function POST(req: Request) {
  try {
    const { grade, subject, unitName, unitContent, questionCount } = await req.json();
    const count = Math.max(5, Math.min(60, Number(questionCount || 10)));

    if (!grade || !subject) {
      return NextResponse.json({ error: '学年または科目が指定されていません' }, { status: 400 });
    }

    // スライド内容がない場合のフォールバック（一般的な問題作成）
    const slideContext = compactContent(unitContent);

    // プロンプトの作成
    const systemPrompt = `
    あなたは中学校のベテラン教師です。
    生徒がゲーム感覚で学習内容を確認できるよう、指定された【学年】と【科目・分野】に基づいた4択クイズを${count}問作成してください。

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
      ? `以下の学習内容の抜粋に基づいて、${grade}の${subject}「${unitName || '指定単元'}」に関するクイズを${count}問作成してください。\n\n【学習内容】\n${slideContext}`
      : `${grade}の${subject}に関する重要単元のクイズを${count}問作成してください。`;

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
