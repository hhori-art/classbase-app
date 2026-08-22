import { NextRequest } from 'next/server';
import { FieldValue } from 'firebase-admin/firestore';
import { adminBucket, adminDb } from '@/lib/firebase-admin';
import { getServerUser, isAdminLike, jsonError } from '@/lib/server-auth';
import { extractPptxText } from '@/lib/pptx';
import OpenAI from 'openai';

export const runtime = 'nodejs';

const PPTX_TYPE = 'application/vnd.openxmlformats-officedocument.presentationml.presentation';
const PREBUILT_QUESTION_COUNT = 60;
const QUESTION_CHUNK_CHARS = 9000;
const SUBJECTS = ['物理', '化学', '生物', '地学', '地理', '歴史', '公民', '漢字', '語句', '古文単語', '文法'];
const SUBJECT_ALIASES: Record<string, string[]> = {
  物理: ['物理', '力学', '電流', '電圧', '電気', '音', '光', '運動', '圧力'],
  化学: ['化学', '物質', '気体', '水溶液', '化合', '分解', '酸化', '還元', 'イオン', '原子', '分子'],
  生物: ['生物', '植物', '動物', '細胞', '遺伝', '生殖', '消化', '呼吸', '血液', '神経'],
  地学: ['地学', '天体', '地層', '火山', '地震', '岩石', '気象', '天気', '月', '太陽'],
  地理: ['地理', '地形', '気候', '農業', '工業', '貿易', '人口', '世界', '日本地理'],
  歴史: ['歴史', '古代', '中世', '近世', '近代', '現代', '縄文', '弥生', '江戸', '明治', '大正', '昭和'],
  公民: ['公民', '政治', '経済', '憲法', '人権', '国会', '内閣', '裁判所', '地方自治'],
  漢字: ['漢字'],
  語句: ['語句', '語彙', 'ことば'],
  古文単語: ['古文単語', '古文', '古典単語'],
  文法: ['文法', '品詞', '活用'],
};

function clean(value: FormDataEntryValue | null, fallback = '') {
  return String(value || fallback).trim();
}

function normalizeText(value: unknown) {
  return String(value || '')
    .normalize('NFKC')
    .toLowerCase()
    .replace(/\.[a-z0-9]+$/i, '')
    .replace(/[第（）()【】\[\]・_\-\s,，、.．:：/／]/g, '');
}

function categoryFromSubject(value: string) {
  if (['物理', '化学', '生物', '地学'].includes(value)) return 'science';
  if (['地理', '歴史', '公民'].includes(value)) return 'society';
  if (['漢字', '語句', '古文単語', '文法'].includes(value)) return 'japanese';
  return 'science';
}

function inferSubjectFromLeadingText(...sources: unknown[]) {
  const chunks = sources
    .flatMap(source => String(source || '').normalize('NFKC').split(/\n|__+|--+|[|｜]/))
    .map(chunk => chunk.replace(/\.pptx$/i, '').replace(/[_-]+/g, ' ').trim())
    .filter(Boolean)
    .slice(0, 12);

  for (const chunk of chunks) {
    const compact = chunk.replace(/^[\s　\d０-９年月日回講限.．、,/_-]+/, '').trim();
    const leading = compact.slice(0, 40);
    const direct = leading.match(/^(?:理科|社会|国語)?\s*(物理|化学|生物|地学|地理|歴史|公民|漢字|語句|古文単語|文法)(?=$|[\s　:：/／_\-（(【\[])/);
    if (direct?.[1]) return direct[1];

    const normalizedLeading = normalizeText(leading);
    const exact = SUBJECTS.find(subject => normalizedLeading.startsWith(normalizeText(subject)));
    if (exact) return exact;
  }

  const firstText = normalizeText(chunks.join(' ').slice(0, 120));
  let best = { subject: '', score: 0 };
  Object.entries(SUBJECT_ALIASES).forEach(([subjectName, aliases]) => {
    aliases.forEach(alias => {
      const normalizedAlias = normalizeText(alias);
      if (!normalizedAlias || !firstText.includes(normalizedAlias)) return;
      const score = normalizedAlias.length + (subjectName === alias ? 4 : 0);
      if (score > best.score) best = { subject: subjectName, score };
    });
  });
  return best.subject;
}

function safeFileName(value: string) {
  return value
    .normalize('NFKC')
    .replace(/[\\/:*?"<>|#%{}^~[\]`]/g, '_')
    .replace(/\s+/g, '_')
    .slice(0, 120) || 'lesson-slide.pptx';
}

function splitForQuestionGeneration(text: string) {
  const normalized = text.replace(/\n{3,}/g, '\n\n').trim();
  if (normalized.length <= QUESTION_CHUNK_CHARS) return [normalized];

  const chunks: string[] = [];
  for (let i = 0; i < normalized.length && chunks.length < 4; i += QUESTION_CHUNK_CHARS) {
    chunks.push(normalized.slice(i, i + QUESTION_CHUNK_CHARS));
  }
  return chunks;
}

async function generatePrebuiltQuestions(params: {
  grade: string;
  subject: string;
  unitName: string;
  unitContent: string;
}) {
  if (!process.env.OPENAI_API_KEY) return [];

  const openai = new OpenAI({ apiKey: process.env.OPENAI_API_KEY });
  const chunks = splitForQuestionGeneration(params.unitContent);
  const perChunk = Math.max(8, Math.ceil(PREBUILT_QUESTION_COUNT / chunks.length));
  const allQuestions: any[] = [];

  for (const chunk of chunks) {
    const completion = await openai.chat.completions.create({
      model: 'gpt-4o-mini',
      messages: [
        {
          role: 'system',
          content: `
あなたは中学生向け理社講座の教材作成担当です。
授業スライド本文から、復習用の4択問題を作成してください。

制約:
- JSONのみ返してください。
- questions配列に${perChunk}問を入れてください。
- 用語確認、理由説明、因果関係、資料読解に近い問題を混ぜてください。
- 正解1つ、不正解3つにしてください。
- explanationは短く、次に何を覚えるべきかが分かる文にしてください。
- difficultyは1から5の整数にしてください。

形式:
{
  "questions": [
    {
      "question": "問題文",
      "correct_answer": "正解",
      "wrong_answers": ["誤答1", "誤答2", "誤答3"],
      "explanation": "解説",
      "difficulty": 3,
      "skill": "用語確認"
    }
  ]
}
        `.trim(),
        },
        {
          role: 'user',
          content: `学年: ${params.grade}\n科目: ${params.subject}\n単元: ${params.unitName}\n\n授業スライド本文の一部:\n${chunk}`,
        },
      ],
      response_format: { type: 'json_object' },
      temperature: 0.65,
    });

    const content = completion.choices[0]?.message?.content || '';
    const parsed = JSON.parse(content);
    const questions = Array.isArray(parsed) ? parsed : parsed.questions;
    if (Array.isArray(questions)) allQuestions.push(...questions);
    if (allQuestions.length >= PREBUILT_QUESTION_COUNT) break;
  }

  return allQuestions.slice(0, PREBUILT_QUESTION_COUNT);
}

export async function POST(request: NextRequest) {
  try {
    const user = await getServerUser(request);
    if (!isAdminLike(user)) throw new Error('forbidden');

    const form = await request.formData();
    const file = form.get('file');
    if (!(file instanceof File)) {
      return Response.json({ ok: false, error: 'pptx file is required' }, { status: 400 });
    }
    if (!file.name.toLowerCase().endsWith('.pptx')) {
      return Response.json({ ok: false, error: 'PPTX形式のファイルを選択してください' }, { status: 400 });
    }

    const grade = clean(form.get('grade'), '中1');
    const submittedSubject = clean(form.get('subject'), '理科');
    const submittedCategory = clean(form.get('category'), 'science');
    const unitName = clean(form.get('unit_name'), file.name.replace(/\.pptx$/i, ''));
    const term = clean(form.get('term'));
    const year = clean(form.get('year'), String(new Date().getFullYear()));
    const month = clean(form.get('month'));
    const tags = clean(form.get('tags')).split(/[,\s、]+/).map(v => v.trim()).filter(Boolean);
    const shouldGenerateQuestions = clean(form.get('generate_questions'), 'true') !== 'false';

    const buffer = await file.arrayBuffer();
    const extracted = await extractPptxText(buffer);
    if (!extracted.text) {
      return Response.json({ ok: false, error: 'PPTXから文字情報を読み取れませんでした' }, { status: 400 });
    }

    const inferredSubject = inferSubjectFromLeadingText(file.name, extracted.slides[0]?.text, extracted.text.slice(0, 800));
    const subject = inferredSubject || submittedSubject;
    const category = inferredSubject ? categoryFromSubject(inferredSubject) : submittedCategory;

    const db = adminDb();
    const slideRef = db.collection('lesson_slides').doc();
    const filePath = `lesson_slides/${year}/${slideRef.id}_${safeFileName(file.name)}`;

    await adminBucket().file(filePath).save(Buffer.from(buffer), {
      metadata: {
        contentType: file.type || PPTX_TYPE,
        metadata: {
          originalName: file.name,
          uploadedBy: user.uid,
        },
      },
      resumable: false,
    });

    const unitRef = db.collection('learning_units').doc();
    const now = FieldValue.serverTimestamp();
    const shared = {
      grade,
      subject,
      category,
      unit_name: unitName,
      content: extracted.text,
      term: term || null,
      year,
      month: month || null,
      tags,
      source_type: 'pptx',
      source_slide_id: slideRef.id,
      updated_at: now,
    };

    await db.runTransaction(async tx => {
      tx.set(slideRef, {
        ...shared,
        file_name: file.name,
        file_path: filePath,
        file_size: file.size,
        mime_type: file.type || PPTX_TYPE,
        slide_count: extracted.slide_count,
        extracted_slides: extracted.slides.slice(0, 80),
        learning_unit_id: unitRef.id,
        created_by: user.uid,
        created_by_role: user.role,
        created_at: now,
      });
      tx.set(unitRef, {
        ...shared,
        created_at: now,
      });
    });

    let prebuiltQuestionCount = 0;
    if (shouldGenerateQuestions) {
      try {
        const generated = await generatePrebuiltQuestions({
          grade,
          subject,
          unitName,
          unitContent: extracted.text,
        });

        const validQuestions = generated
          .filter((q: any) => q?.question && q?.correct_answer && Array.isArray(q?.wrong_answers))
          .slice(0, PREBUILT_QUESTION_COUNT);

        if (validQuestions.length > 0) {
          let batch = db.batch();
          let batchCount = 0;
          validQuestions.forEach((q: any, index: number) => {
            const quizRef = db.collection('quizzes').doc();
            batch.set(quizRef, {
              question: String(q.question || '').trim(),
              correct_answer: String(q.correct_answer || '').trim(),
              wrong_answers: q.wrong_answers.map((ans: unknown) => String(ans || '').trim()).filter(Boolean).slice(0, 3),
              explanation: String(q.explanation || '').trim(),
              difficulty: Math.max(1, Math.min(5, Number(q.difficulty || 3))),
              skill: String(q.skill || '').trim(),
              grade,
              subject,
              unit_name: unitName,
              source_slide_id: slideRef.id,
              source_learning_unit_id: unitRef.id,
              source_type: 'pptx_prebuilt',
              question_order: index + 1,
              created_at: FieldValue.serverTimestamp(),
            });
            batchCount++;
          });
          batch.update(slideRef, {
            prebuilt_question_count: validQuestions.length,
            prebuilt_questions_generated_at: FieldValue.serverTimestamp(),
          });
          batch.update(unitRef, {
            prebuilt_question_count: validQuestions.length,
            prebuilt_questions_generated_at: FieldValue.serverTimestamp(),
          });
          batchCount += 2;
          if (batchCount > 0) await batch.commit();
          prebuiltQuestionCount = validQuestions.length;
        }
      } catch (questionError) {
        await slideRef.set({
          prebuilt_question_error: questionError instanceof Error ? questionError.message : String(questionError),
          prebuilt_questions_generated_at: FieldValue.serverTimestamp(),
        }, { merge: true });
      }
    } else {
      await slideRef.set({
        prebuilt_question_count: 0,
        prebuilt_question_status: 'skipped_for_bulk_upload',
      }, { merge: true });
    }

    return Response.json({
      ok: true,
      slide_id: slideRef.id,
      learning_unit_id: unitRef.id,
      extracted_text_length: extracted.text.length,
      slide_count: extracted.slide_count,
      prebuilt_question_count: prebuiltQuestionCount,
      prebuilt_question_skipped: !shouldGenerateQuestions,
    });
  } catch (error) {
    return jsonError(error);
  }
}
