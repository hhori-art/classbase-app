import { NextResponse } from 'next/server';
import OpenAI from 'openai';

const openai = new OpenAI({ apiKey: process.env.OPENAI_API_KEY });

export async function POST(req: Request) {
  try {
    const { message, history, studentName } = await req.json();

    // システムプロンプト: 先生のような振る舞い + 安全性チェック
    const systemPrompt = `
      あなたは親しみやすい塾のAIチューターです。
      相手の名前は「${studentName || '生徒'}」さんです。
      中学生に分かりやすく、励ましながら教えてください。
      
      【重要】
      もし生徒が「自殺」「死にたい」「犯罪」「いじめ」「性的」な話題を出した場合は、
      深入りせず、信頼できる大人や先生に相談するよう優しく促してください。
      また、その場合は回答の先頭に [ALERT] というタグをつけてください。
    `;

    const completion = await openai.chat.completions.create({
      model: "gpt-3.5-turbo",
      messages: [
        { role: "system", content: systemPrompt },
        ...history,
        { role: "user", content: message },
      ],
    });

    let reply = completion.choices[0].message.content;
    let isAlert = false;

    // AIがアラートと判断した場合
    if (reply?.includes('[ALERT]')) {
      isAlert = true;
      reply = reply.replace('[ALERT]', '').trim();
    }

    return NextResponse.json({ reply, isAlert });

  } catch (error) {
    console.error(error);
    return NextResponse.json({ error: 'Error processing request' }, { status: 500 });
  }
}