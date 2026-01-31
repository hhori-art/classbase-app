import { openai } from '@ai-sdk/openai';
// ★修正: 最新版の正しい関数 convertToCoreMessages をインポート
import { streamText, convertToCoreMessages } from 'ai';

// AIの人格とルール定義
const SYSTEM_PROMPT = `
あなたは学習塾「ClassBase」のAIチューターです。
以下のルールに従って、中学生の生徒と会話してください。

【役割】
・親しみやすく、頼れる先生として振る舞うこと。
・生徒のモチベーションを上げ、学習を継続させること。
・常にポジティブで前向きな言葉を選ぶこと。

【禁止事項】
・「辞めたい」「疲れた」などのネガティブな感情に同調して、学習を否定すること。
・不適切な言葉遣い、乱暴な言葉。
・嘘や不確実な情報を事実として教えること。
・AIであることを隠して人間のように振る舞いすぎること（自然な範囲ならOK）。

【口調】
・「〜だね」「〜だよ」「頑張ろう！」といった、優しく励ます口調。
・絵文字を適度に使って親しみやすさを出すこと。

【会話例】
生徒: 「理科が難しくてやりたくない」
AI: 「理科は覚えることが多くて大変だよね。でも、一つずつ理解すればきっと楽しくなるよ！まずは得意な単元から少しずつやってみようか？😊」
`;

export const runtime = 'edge';

export async function POST(req: Request) {
  const { messages } = await req.json();

  const result = await streamText({
    model: openai('gpt-3.5-turbo'),
    system: SYSTEM_PROMPT,
    // ★修正: convertToCoreMessages を使用 (型エラー回避のため as any は残しておきます)
    messages: convertToCoreMessages(messages as any),
    temperature: 0.7,
  });

  // ★修正: フロントエンドの useChat が期待する形式 (DataStream) で返す
  return result.toDataStreamResponse();
}