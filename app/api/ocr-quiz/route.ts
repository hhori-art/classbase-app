import { NextRequest } from 'next/server';
import OpenAI from 'openai';
import { getServerUser, jsonError, requireRole } from '@/lib/server-auth';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

const MAX_IMAGE_BASE64_CHARS = 10_500_000;
const MAX_OCR_CHARS_FOR_GENERATION = 6000;
const MAX_QUESTION_COUNT = 8;

const openai = new OpenAI({
  apiKey: process.env.OPENAI_API_KEY,
});

type GeneratedQuestion = {
  id: string;
  question: string;
  correct_answer: string;
  wrong_answers: string[];
  explanation: string;
};

function isAllowedDataUrl(value: unknown) {
  const text = String(value || '');
  return /^data:image\/(png|jpe?g|webp);base64,[A-Za-z0-9+/=]+$/i.test(text);
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

    const body = await request.json();
    if (body?.legalConsent !== true || body?.privateUseOnly !== true) {
      return noStoreJson({ ok: false, error: 'legal-consent-required' }, { status: 400 });
    }

    imageDataUrl = String(body?.imageDataUrl || '');
    if (!isAllowedDataUrl(imageDataUrl)) {
      return noStoreJson({ ok: false, error: 'invalid-image-data' }, { status: 400 });
    }
    if (imageDataUrl.length > MAX_IMAGE_BASE64_CHARS) {
      return noStoreJson({ ok: false, error: 'image-too-large' }, { status: 413 });
    }

    const questionCount = Math.max(3, Math.min(MAX_QUESTION_COUNT, Number(body?.questionCount || 5)));
    const grade = String(body?.grade || user.profile?.grade || '').slice(0, 20);
    const subject = String(body?.subject || '').slice(0, 30);

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
