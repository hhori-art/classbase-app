import { NextResponse } from 'next/server';
import OpenAI from 'openai';
import { NextRequest } from 'next/server';
import { getServerUser, isAdminLike, jsonError, requireRole } from '@/lib/server-auth';
import { consumeRateLimit } from '@/lib/server/password-recovery';
import { adminDb } from '@/lib/firebase-admin';
import { FieldValue } from 'firebase-admin/firestore';
import { createQuestSession, publicQuestion, type SessionQuestion } from '@/lib/server/quest-session';

const MAX_CONTEXT_CHARS = 12000;
const MAX_REQUEST_BYTES = 32 * 1024;
const SAFE_DOCUMENT_ID = /^[^/\u0000-\u001f]{1,200}$/;

function getOpenAIClient() {
  const apiKey = process.env.OPENAI_API_KEY;
  if (!apiKey) throw new Error('OPENAI_API_KEYが設定されていません');
  return new OpenAI({ apiKey, timeout: 25_000, maxRetries: 0 });
}

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

export async function POST(req: NextRequest) {
  try {
    const user = await getServerUser(req);
    requireRole(user, ['student', 'admin', 'master']);
    if (user.role === 'admin' && !isAdminLike(user)) throw new Error('forbidden');
    const contentLength = Number(req.headers.get('content-length') || 0);
    if (Number.isFinite(contentLength) && contentLength > MAX_REQUEST_BYTES) {
      return NextResponse.json({ error: 'リクエストが大きすぎます' }, { status: 413 });
    }
    const db = adminDb();
    let body: Record<string, unknown>;
    try {
      const parsed = await req.json();
      if (!parsed || typeof parsed !== 'object' || Array.isArray(parsed)) throw new Error('invalid-body');
      body = parsed as Record<string, unknown>;
    } catch {
      return NextResponse.json({ error: '入力内容を確認してください' }, { status: 400 });
    }
    let grade = String(body.grade || '');
    let subject = String(body.subject || '');
    let unitName = String(body.unitName || '');
    let unitContent = String(body.unitContent || '');
    let learningUnitId = String(body.learningUnitId || '');
    let sourceSlideId = String(body.sourceSlideId || '');
    const persistForSlide = body.persistForSlide === true;
    const questionCount = body.questionCount;
    if (persistForSlide) {
      if (!isAdminLike(user)) throw new Error('forbidden');
      if (!SAFE_DOCUMENT_ID.test(sourceSlideId)) {
        return NextResponse.json({ error: '教材IDを確認してください' }, { status: 400 });
      }
      const [slideSnap] = await db.getAll(db.collection('lesson_slides').doc(sourceSlideId));
      if (!slideSnap.exists) return NextResponse.json({ error: 'lesson slide not found' }, { status: 404 });
      const slide = slideSnap.data() || {};
      grade = String(slide.grade || '');
      subject = String(slide.subject || '');
      unitName = String(slide.unit_name || '指定単元');
      unitContent = String(slide.content || '');
      learningUnitId = String(slide.learning_unit_id || '');
    } else if (user.role === 'student') {
      if (!SAFE_DOCUMENT_ID.test(learningUnitId)) {
        return NextResponse.json({ error: '学習単元IDを確認してください' }, { status: 400 });
      }
      const [unitSnap] = await db.getAll(db.collection('learning_units').doc(learningUnitId));
      if (!unitSnap.exists) return NextResponse.json({ error: 'learning unit not found' }, { status: 404 });
      const unit = unitSnap.data() || {};
      grade = String(unit.grade || '');
      subject = String(unit.subject || '');
      unitName = String(unit.unit_name || unit.name || '指定単元');
      unitContent = String(unit.content || '');
      sourceSlideId = String(unit.source_slide_id || '');
    }
    const requestedCount = Number(questionCount || 10);
    const count = user.role === 'student'
      ? 10
      : Math.max(5, Math.min(60, Number.isFinite(requestedCount) ? Math.floor(requestedCount) : 10));

    if (!grade || !subject) {
      return NextResponse.json({ error: '学年または科目が指定されていません' }, { status: 400 });
    }

    const [withinMinute, withinHour] = await Promise.all([
      consumeRateLimit(`adaptive_homework_minute_${user.uid}`, 2, 60 * 1000),
      consumeRateLimit(`adaptive_homework_hour_${user.uid}`, user.role === 'student' ? 12 : 6, 60 * 60 * 1000),
    ]);
    if (!withinMinute || !withinHour) {
      return NextResponse.json({ error: '短時間に利用が集中しています。しばらく待ってから再度お試しください' }, { status: 429 });
    }

    let rawQuestions: any[];
    if (process.env.SECURITY_DIAGNOSIS_MODE === 'true' && !process.env.OPENAI_API_KEY) {
      const topic = String(unitName || subject).slice(0, 80);
      rawQuestions = Array.from({ length: count }, (_, index) => ({
          id: `diagnosis-adaptive-${index + 1}`,
          question: `【診断用問題 ${index + 1}】${grade}「${topic}」の学習内容を確認する設問です。正しい選択肢を選んでください。`,
          correct_answer: '診断用の正解',
          wrong_answers: ['診断用の誤答A', '診断用の誤答B', '診断用の誤答C'],
          explanation: '診断環境では、認証・通信・回答処理を確認するため匿名の固定問題を返します。',
        }));
    } else {
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

      const completion = await getOpenAIClient().chat.completions.create({
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
      rawQuestions = Array.isArray(data) ? data : (data.questions || data.quiz || []);
    }
    const questionIdPrefix = db.collection('quest_sessions').doc().id;
    const questions = rawQuestions.slice(0, count).map((item: any, index: number) => ({
      id: `${questionIdPrefix}-${index + 1}`,
      question: String(item?.question || '').trim().slice(0, 1000),
      correct_answer: String(item?.correct_answer || '').trim().slice(0, 500),
      wrong_answers: Array.isArray(item?.wrong_answers)
        ? item.wrong_answers.map((value: unknown) => String(value || '').trim().slice(0, 500)).filter(Boolean).slice(0, 3)
        : [],
      explanation: String(item?.explanation || '').trim().slice(0, 2000),
    })).filter((item: any) => item.question && item.correct_answer && item.wrong_answers.length === 3);
    if (questions.length < 5) throw new Error('有効な問題を十分に生成できませんでした');

    if (persistForSlide) {
      const batch = db.batch();
      questions.forEach((item: any, index: number) => {
        const quizRef = db.collection('quizzes').doc();
        batch.set(quizRef, {
          question: item.question,
          correct_answer: item.correct_answer,
          wrong_answers: item.wrong_answers,
          explanation: item.explanation,
          difficulty: 3,
          grade: String(grade).slice(0, 20),
          subject: String(subject).slice(0, 40),
          unit_name: String(unitName).slice(0, 120),
          source_slide_id: sourceSlideId,
          source_learning_unit_id: learningUnitId,
          source_type: 'pptx_ai',
          question_order: index + 1,
          created_by: user.uid,
          created_at: FieldValue.serverTimestamp(),
        });
      });
      batch.update(db.collection('lesson_slides').doc(sourceSlideId), {
        ai_question_count: FieldValue.increment(questions.length),
        ai_questions_generated_at: FieldValue.serverTimestamp(),
      });
      batch.set(db.collection('admin_audit_logs').doc(), {
        action: 'lesson_slide.questions.generate',
        target_type: 'lesson_slide',
        target_id: sourceSlideId,
        actor_uid: user.uid,
        actor_role: user.role,
        generated_question_count: questions.length,
        created_at: FieldValue.serverTimestamp(),
      });
      await batch.commit();
      return NextResponse.json({ ok: true, saved_count: questions.length });
    }

    const sessionId = await createQuestSession(user.uid, {
      grade: String(grade),
      subject: String(subject),
      unit_name: String(unitName || '指定単元'),
      learning_unit_id: String(learningUnitId || ''),
      source_slide_id: String(sourceSlideId || ''),
    }, questions);

    // 正解・解説はセッションにのみ保存し、回答ごとに /api/quest-sessions/answer で返す。
    return NextResponse.json({
      questions: questions.map((item: SessionQuestion) => publicQuestion(item, String(sourceSlideId || ''))),
      session_id: sessionId,
    });

  } catch (e: any) {
    console.error("AI Quest Gen Error:", e);
    if (['missing-token', 'forbidden', 'profile-not-found'].includes(String(e?.message || '')) ||
        String(e?.code || '').startsWith('auth/')) return jsonError(e);
    return NextResponse.json({ error: '問題生成中にエラーが発生しました。しばらく待ってから再度お試しください' }, { status: 500 });
  }
}
