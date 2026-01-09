import { NextResponse } from 'next/server';
import OpenAI from 'openai';

const openai = new OpenAI({
  apiKey: process.env.OPENAI_API_KEY,
});

export async function POST(req: Request) {
  try {
    const { message, history } = await req.json();

    const systemPrompt = `
    あなたは学習塾の親切なチューターAIです。
    生徒を励ますトーンで話してください。
    契約や深刻な悩みなど、AIで判断できない場合は「needs_teacher: true」にしてください。
    
    出力フォーマット（JSON）:
    {
      "reply": "AIの返答",
      "needs_teacher": true/false,
      "churn_risk": 0-100
    }
    `;

    const completion = await openai.chat.completions.create({
      // ★ここを変更: 高性能かつ激安なモデル
      model: "gpt-4o-mini", 
      messages: [
        { role: "system", content: systemPrompt },
        // 会話履歴は直近5件に絞って送信（コスト節約）
        ...history.slice(-5),
        { role: "user", content: message }
      ],
      // JSON形式で確実に返してもらう設定
      response_format: { type: "json_object" },
    });

    const content = completion.choices[0].message.content;
    if (!content) throw new Error("No content received from OpenAI");

    const aiResponse = JSON.parse(content);
    return NextResponse.json(aiResponse);

  } catch (error: any) {
    console.error("OpenAI API Error:", error);
    
    // エラーが起きてもアプリをクラッシュさせず、メッセージを返す
    return NextResponse.json({
      reply: "申し訳ありません。現在システムが混み合っているため応答できません。時間を置いて試すか、先生に直接連絡してください。",
      needs_teacher: true,
      churn_risk: 0
    });
  }
}