import { NextRequest } from 'next/server';
import OpenAI from 'openai';
import { getServerUser, jsonError, requireRole } from '@/lib/server-auth';
import { consumeRateLimit } from '@/lib/server/password-recovery';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

const MAX_IMAGE_BASE64_CHARS = 10_500_000;
const MAX_OCR_CHARS_FOR_GENERATION = 6000;
const MAX_QUESTION_COUNT = 8;

type GeneratedQuestion = {
  id: string;
  question: string;
  correct_answer: string;
  wrong_answers: string[];
  explanation: string;
};

function getOpenAIClient() {
  const apiKey = process.env.OPENAI_API_KEY;
  if (!apiKey) throw new Error('OPENAI_API_KEYが設定されていません');
  return new OpenAI({ apiKey });
}

function parseAllowedImage(value: unknown) {
  const text = String(value || '');
  const match = text.match(/^data:image\/(png|jpe?g|webp);base64,([A-Za-z0-9+/=]+)$/i);
  if (!match) return null;
  let bytes: Buffer;
  try {
    bytes = Buffer.from(match[2], 'base64');
  } catch {
    return null;
  }
  if (bytes.length === 0 || bytes.length > 7 * 1024 * 1024) return null;
  const mime = match[1].toLowerCase();
  const isPng = mime === 'png' && bytes.length >= 8 && bytes.subarray(0, 8).equals(Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]));
  const isJpeg = (mime === 'jpg' || mime === 'jpeg') && bytes.length >= 3 && bytes[0] === 0xff && bytes[1] === 0xd8 && bytes[2] === 0xff;
  const isWebp = mime === 'webp' && bytes.length >= 12 && bytes.subarray(0, 4).toString('ascii') === 'RIFF' && bytes.subarray(8, 12).toString('ascii') === 'WEBP';
  return isPng || isJpeg || isWebp ? text : null;
}

function compactText(value: unknown) {
  return String(value || '')
    .replace(/\s+\n/g, '\n')
    .replace(/\n{3,}/g, '\n\n')
    .trim()
    .slice(0, MAX_OCR_CHARS_FOR_GENERATION);
}

function sanitizeQuestions(value: unknown): GeneratedQuestion[] {
  const raw = Array.isArray(value) ? value : [];
  return raw.slice(0, MAX_QUESTION_COUNT).map((item: any, index) => ({
    id: String(item?.id || `ocr-private-${Date.now()}-${index}`),
    question: String(item?.question || '').trim(),
    correct_answer: String(item?.correct_answer || '').trim(),
    wrong_answers: Array.isArray(item?.wrong_answers)
      ? item.wrong_answers.map((answer: unknown) => String(answer || '').trim()).filter(Boolean).slice(0, 3)
      : [],
    explanation: String(item?.explanation || '').trim(),
  })).filter(item =>
    item.question &&
    item.correct_answer &&
    item.wrong_answers.length === 3 &&
    item.explanation
  );
}

function noStoreJson(body: unknown, init?: ResponseInit) {
  return Response.json(body, {
    ...init,
    headers: {
      'Cache-Control': 'no-store, max-age=0',
      'Pragma': 'no-cache',
      'X-Content-Type-Options': 'nosniff',
      ...(init?.headers || {}),
    },
  });
}

export async function POST(request: NextRequest) {
  let imageDataUrl: string | null = null;
  let extractedText: string | null = null;
  let generationContext: string | null = null;

  try {
    const user = await getServerUser(request);
    requireRole(user, ['student']);

    const [shortWindowAllowed, hourlyAllowed] = await Promise.all([
      consumeRateLimit(`ocr_quiz_minute_${user.uid}`, 2, 60 * 1000),
      consumeRateLimit(`ocr_quiz_hour_${user.uid}`, 6, 60 * 60 * 1000),
    ]);
    if (!shortWindowAllowed || !hourlyAllowed) {
      return noStoreJson({ ok: false, error: 'rate-limit' }, { status: 429 });
    }

    const body = await request.json();
    if (body?.legalConsent !== true || body?.privateUseOnly !== true) {
      return noStoreJson({ ok: false, error: 'legal-consent-required' }, { status: 400 });
    }

    imageDataUrl = parseAllowedImage(body?.imageDataUrl);
    if (!imageDataUrl) {
      return noStoreJson({ ok: false, error: 'invalid-image-data' }, { status: 400 });
    }
    if (imageDataUrl.length > MAX_IMAGE_BASE64_CHARS) {
      return noStoreJson({ ok: false, error: 'image-too-large' }, { status: 413 });
    }

    const questionCount = Math.max(3, Math.min(MAX_QUESTION_COUNT, Number(body?.questionCount || 5)));
    const grade = String(body?.grade || user.profile?.grade || '').slice(0, 20);
    const subject = String(body?.subject || '').slice(0, 30);

    if (process.env.SECURITY_DIAGNOSIS_MODE === 'true' && !process.env.OPENAI_API_KEY) {
      const questions = Array.from({ length: questionCount }, (_, index) => ({
        id: `diagnosis-ocr-${index + 1}`,
        question: `【診断用OCR問題 ${index + 1}】アップロード処理と問題表示を確認する設問です。`,
        correct_answer: '診断用の正解',
        wrong_answers: ['診断用の誤答A', '診断用の誤答B', '診断用の誤答C'],
        explanation: '診断環境では画像を保存せず、外部AIへも送らずに匿名の固定問題を返します。',
      }));
      return noStoreJson({
        ok: true,
        questions,
        diagnosis_mock: true,
        policy: { storage: 'not_persisted_server_side', sharing: 'disabled', sourceTextReturned: false },
      });
    }

    const openai = getOpenAIClient();
    const ocrResult = await openai.chat.completions.create({
      model: process.env.OCR_QUIZ_VISION_MODEL || 'gpt-4o-mini',
      store: false,
      messages: [
        {
          role: 'system',
          content: [
            'You are an OCR and educational-topic extraction engine.',
            'Extract only the minimum educational facts, themes, formulas, vocabulary, and difficulty signals needed to create similar practice questions.',
            'Do not preserve layout, wording, paragraph order, decorative text, or long passages.',
            'Return concise Japanese notes. Do not return markdown.',
          ].join('\n'),
        },
        {
          role: 'user',
          content: [
            { type: 'text', text: 'この画像から、類題作成に必要な学習テーマ・知識・難易度だけを短く抽出してください。元の表現を保持しないでください。' },
            { type: 'image_url', image_url: { url: imageDataUrl } },
          ],
        },
      ],
      temperature: 0,
    });

    extractedText = compactText(ocrResult.choices[0]?.message?.content);
    if (!extractedText) {
      return noStoreJson({ ok: false, error: 'ocr-empty' }, { status: 422 });
    }

    generationContext = [
      grade ? `学年: ${grade}` : '',
      subject ? `分野: ${subject}` : '',
      `参考情報: ${extractedText}`,
    ].filter(Boolean).join('\n');

    const generation = await openai.chat.completions.create({
      model: process.env.OCR_QUIZ_LLM_MODEL || 'gpt-4o-mini',
      store: false,
      response_format: { type: 'json_object' },
      messages: [
        {
          role: 'system',
          content: [
            'あなたは中学生向けの教材作成者です。',
            '入力されたテキスト（OCRデータ）は、出題すべき「知識・テーマ・難易度」の参考情報（ソース）としてのみ利用してください。',
            '元の文章の「表現（テキスト）」をそのままコピー・流用することは著作権侵害となるため厳禁とします。',
            '元データと同じテーマ・難易度の、完全にオリジナルの類題（新しい文章）を1から生成してください。',
            '固有名詞・例文・設問の言い回し・選択肢の並びが元資料に依存しすぎないよう、場面設定と文章を必ず作り替えてください。',
            '出力はJSONのみです。OCRテキスト、引用、出典、元画像の内容説明は出力しないでください。',
            'JSON形式: {"questions":[{"id":"...","question":"...","correct_answer":"...","wrong_answers":["...","...","..."],"explanation":"..."}]}',
          ].join('\n'),
        },
        {
          role: 'user',
          content: `${generationContext}\n\n上の参考情報から、私的学習用の完全オリジナル4択問題を${questionCount}問作成してください。`,
        },
      ],
      temperature: 0.85,
    });

    const content = generation.choices[0]?.message?.content || '{}';
    const parsed = JSON.parse(content);
    const questions = sanitizeQuestions(parsed.questions);
    if (questions.length === 0) {
      return noStoreJson({ ok: false, error: 'question-generation-empty' }, { status: 422 });
    }

    return noStoreJson({
      ok: true,
      questions,
      policy: {
        storage: 'not_persisted_server_side',
        sharing: 'disabled',
        sourceTextReturned: false,
      },
    });
  } catch (error) {
    return jsonError(error);
  } finally {
    imageDataUrl = null;
    extractedText = null;
    generationContext = null;
  }
}
