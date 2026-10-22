import { after, type NextRequest } from 'next/server';
import { getServerUser, jsonError, requireRole } from '@/lib/server-auth';
import { adminDb } from '@/lib/firebase-admin';
import { FieldValue } from 'firebase-admin/firestore';
import { consumeRateLimit } from '@/lib/server/password-recovery';
import { runStudentSafetyCheck } from '@/lib/server/student-safety';
import { openai } from '@ai-sdk/openai';
import { streamText } from 'ai';

// AIの人格とルール定義
const SYSTEM_PROMPT = `
あなたは学習塾「ClassBase」のAIチューターです。
以下のルールに従って、中学生の生徒と会話してください。

【役割】
・親しみやすく、頼れる先生として振る舞うこと。
・生徒のモチベーションを上げ、学習を継続させること。
・生徒の気持ちを否定せず受け止め、安全を優先しながら学習を支援すること。

【心配な話題への対応（最優先）】
・「死にたい」「消えたい」など自分を傷つける気持ちが見られたら、勉強の話より先に気持ちを受け止め、「話してくれてありがとう」と伝えること。
・その場合は、家族や学校・塾の先生など信頼できる大人に今の気持ちを話すよう、やさしく勧めること。
・自分を傷つけたい気持ちがあるときは「24時間子供SOSダイヤル（0120-0-78310・なやみいおう）」に今すぐ電話できることを必ず伝えること。命の危険が迫っているときは110番・119番を勧めること。
・家での暴力・いじめ・知らない人からの誘い（写真を送って、会おうなど）の相談には、本人は悪くないと伝え、保護者や先生に相談するよう勧めること。写真を送ったり会いに行ったりしないよう伝えること。
・他の人を傷つけたい気持ちが見られたら、否定せずに気持ちを受け止めたうえで、行動に移さず信頼できる大人に話すよう伝えること。
・秘密にすることを約束しないこと。診断や治療のような専門的な判断はしないこと。

【禁止事項】
・自傷・他害や深刻な悩みが疑われる場合に、抱え込ませたり秘密を約束したりすること。
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

type ChatMessage = { role: 'user' | 'assistant'; content: string };

/** 画面から送られる履歴は直近だけを見る（長い会話でも 400 にならないよう、古い分は読み捨てる）。 */
const INCOMING_WINDOW = 40;
const MAX_MESSAGE_CHARS = 8000;

function recentModelContext(messages: ChatMessage[]) {
  const selected: ChatMessage[] = [];
  let characters = 0;
  for (let index = messages.length - 1; index >= 0 && selected.length < 20; index--) {
    const message = messages[index];
    if (selected.length && characters + message.content.length > 16_000) break;
    selected.unshift(message);
    characters += message.content.length;
  }
  return selected;
}

/** 直近の窓だけを検証する。最後は生徒の質問（8000文字以内）であること。古い発言は長すぎれば切り詰める。 */
function normalizeIncomingMessages(raw: unknown): ChatMessage[] | null {
  if (!Array.isArray(raw) || !raw.length) return null;
  const window = raw.slice(-INCOMING_WINDOW);
  const normalized: ChatMessage[] = [];
  for (const message of window) {
    if (!message || typeof message !== 'object') return null;
    const { role, content } = message as { role?: unknown; content?: unknown };
    if ((role !== 'user' && role !== 'assistant') || typeof content !== 'string') return null;
    normalized.push({ role, content });
  }
  const last = normalized.at(-1)!;
  if (last.role !== 'user' || !last.content.trim() || last.content.length > MAX_MESSAGE_CHARS) return null;
  return normalized.map(message => ({ ...message, content: message.content.slice(0, MAX_MESSAGE_CHARS) }));
}

/** 応答後もサーバーで安全確認を完了させる。リクエスト外（テストなど）では待ってから返す。 */
async function runAfterResponse(task: Promise<unknown>) {
  try {
    after(() => task);
  } catch {
    await task;
  }
}

export async function POST(req: NextRequest) {
  try {
    const user = await getServerUser(req);
    requireRole(user, ['student']);
    const body = await req.json().catch(() => ({}));
    const messages = normalizeIncomingMessages(body?.messages);
    if (!messages) {
      return Response.json({ ok: false, error: 'invalid-messages' }, { status: 400 });
    }
    if (!(await consumeRateLimit(`chat_${user.uid}`, 6, 60 * 1000))) {
      return Response.json({ ok: false, error: 'rate-limit' }, { status: 429 });
    }
    if (!(await consumeRateLimit(`chat_hour_${user.uid}`, 40, 60 * 60 * 1000))) return Response.json({ ok: false, error: 'rate-limit' }, { status: 429 });
    const context = recentModelContext(messages);
    const lastUserMessage = context.at(-1)!;
    const question = lastUserMessage.content.slice(0, MAX_MESSAGE_CHARS);
    const serverRequestId = crypto.randomUUID();
    const history = adminDb().collection('users').doc(user.uid).collection('chat_history');

    // 質問は返信の成否に関わらず先に保存する（通信切断・生成失敗でも保護者の履歴と安全確認に残す）。
    await history.doc(`${serverRequestId}_user`).set({
      role: 'user', content: question, createdAt: FieldValue.serverTimestamp(),
      created_at_ms: Date.now(), seq: 0, request_id: serverRequestId,
    });

    // 危険な内容の検知は返信と並行して行い、失敗しても返信は止めない。
    const safetyTask = runStudentSafetyCheck({ studentId: user.uid, student: user.profile, text: question, requestId: serverRequestId })
      .catch(error => console.error('AIチャットの安全確認に失敗しました', error));

    try {
      // context は { role: 'user' | 'assistant', content: string } だけなので、そのままモデルへ渡せる。
      const result = streamText({
        // 以前と同じ Chat Completions API を使う（新しい既定の Responses API は会話をOpenAI側に保存する設定が既定のため使わない）。
        model: openai.chat('gpt-4o-mini'), system: SYSTEM_PROMPT,
        messages: context,
        temperature: 0.7, maxOutputTokens: 900,
        onFinish: async ({ text }) => {
          await history.doc(`${serverRequestId}_assistant`).set({
            role: 'assistant', content: String(text || '').slice(0, MAX_MESSAGE_CHARS), createdAt: FieldValue.serverTimestamp(),
            created_at_ms: Date.now(), seq: 1, request_id: serverRequestId,
          });
        },
      });
      return result.toUIMessageStreamResponse();
    } finally {
      await runAfterResponse(safetyTask);
    }
  } catch (error) {
    return jsonError(error);
  }
}
