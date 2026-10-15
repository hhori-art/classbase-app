import { NextRequest } from 'next/server';
import { getServerUser, jsonError, requireRole } from '@/lib/server-auth';
import { adminDb } from '@/lib/firebase-admin';
import { FieldValue } from 'firebase-admin/firestore';
import { consumeRateLimit } from '@/lib/server/password-recovery';
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
・生徒の気持ちを否定せず受け止め、安全を優先しながら学習を支援すること。

【禁止事項】
・自傷・他害や深刻な悩みが疑われる場合に、抱え込ませたり秘密を約束したりすること。保護者・先生など信頼できる大人への相談を促すこと。
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

export const runtime = 'nodejs';

function recentModelContext(messages: Array<{ role: 'user' | 'assistant'; content: string }>) {
  const selected: Array<{ role: 'user' | 'assistant'; content: string }> = [];
  let characters = 0;
  for (let index = messages.length - 1; index >= 0 && selected.length < 20; index--) {
    const message = messages[index];
    if (selected.length && characters + message.content.length > 16_000) break;
    selected.unshift(message);
    characters += message.content.length;
  }
  return selected;
}

export async function POST(req: NextRequest) {
  try {
    const user = await getServerUser(req);
    requireRole(user, ['student']);
    const { messages } = await req.json();
    if (!Array.isArray(messages) || !messages.length || messages.length > 100 ||
        messages.some(message => !message || !['user', 'assistant'].includes(message.role) ||
          typeof message.content !== 'string' || message.content.length > 8000) ||
        messages.reduce((total, message) => total + message.content.length, 0) > 100_000 ||
        messages.at(-1)?.role !== 'user' || !messages.at(-1)?.content.trim()) {
      return Response.json({ ok: false, error: 'invalid-messages' }, { status: 400 });
    }
    if (!(await consumeRateLimit(`chat_${user.uid}`, 6, 60 * 1000))) {
      return Response.json({ ok: false, error: 'rate-limit' }, { status: 429 });
    }
    if (!(await consumeRateLimit(`chat_hour_${user.uid}`, 40, 60 * 60 * 1000))) return Response.json({ ok: false, error: 'rate-limit' }, { status: 429 });
    const context = recentModelContext(messages.map(({ role, content }) => ({ role, content })));
    const lastUserMessage = context.at(-1)!;
    const serverRequestId = crypto.randomUUID();
    const result = await streamText({
      model: openai('gpt-3.5-turbo'), system: SYSTEM_PROMPT,
      messages: convertToCoreMessages(context),
      temperature: 0.7, maxTokens: 900,
      onFinish: async ({ text }) => {
        const batch = adminDb().batch();
        const history = adminDb().collection('users').doc(user.uid).collection('chat_history');
        batch.set(history.doc(`${serverRequestId}_user`), { role: 'user', content: String(lastUserMessage.content || '').slice(0, 8000), createdAt: FieldValue.serverTimestamp(), request_id: serverRequestId });
        batch.set(history.doc(`${serverRequestId}_assistant`), { role: 'assistant', content: String(text || '').slice(0, 8000), createdAt: FieldValue.serverTimestamp(), request_id: serverRequestId });
        await batch.commit();
      },
    });
    return result.toDataStreamResponse();
  } catch (error) {
    return jsonError(error);
  }
}
