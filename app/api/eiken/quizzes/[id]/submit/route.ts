import { NextRequest } from 'next/server';
import { FieldValue } from 'firebase-admin/firestore';
import { z } from 'zod';
import { adminDb } from '@/lib/firebase-admin';
import { requireStudentEnrollment } from '@/lib/eiken/access';
import { getServerUser, jsonError } from '@/lib/server-auth';

export const runtime = 'nodejs';

const answerSchema = z.object({
  answers: z.record(z.union([
    z.string().max(1000),
    z.array(z.string().max(500)).max(20),
  ])),
}).strict();

const normalizedArray = (value: unknown) =>
  (Array.isArray(value) ? value : [value])
    .map(item => String(item || '').normalize('NFKC').trim().toLowerCase())
    .filter(Boolean)
    .sort();

export async function POST(request: NextRequest, context: { params: Promise<{ id: string }> }) {
  try {
    const user = await getServerUser(request);
    const quizId = String((await context.params).id || '');
    const input = answerSchema.parse(await request.json());
    const quizSnap = await adminDb().collection('eiken_quizzes').doc(quizId).get();
    if (!quizSnap.exists || quizSnap.data()?.status !== 'published') throw new Error('quiz-not-found');
    const quiz = quizSnap.data() || {};
    await requireStudentEnrollment(user, String(quiz.course_id || ''));

    const maxAttempts = Math.max(1, Number(quiz.max_attempts || 1));

    const questionsSnap = await adminDb()
      .collection('eiken_quiz_questions')
      .where('quiz_id', '==', quizId)
      .get();
    const questions = questionsSnap.docs
      .map(doc => ({ id: doc.id, ...doc.data() } as Record<string, any>))
      .sort((a, b) => Number(a.sequence || 0) - Number(b.sequence || 0));
    if (!questions.length) throw new Error('quiz-has-no-questions');
    if (Object.keys(input.answers).length > questions.length) throw new Error('invalid-answers');
    const questionIds = new Set(questions.map(question => question.id));
    if (Object.keys(input.answers).some(questionId => !questionIds.has(questionId))) {
      throw new Error('invalid-answers');
    }

    let score = 0;
    const skillTotals = new Map<string, { correct: number; total: number }>();
    const grading = questions.map(question => {
      const submitted = normalizedArray(input.answers[question.id]);
      const expected = normalizedArray(question.correct_answers || question.correct_answer);
      const correct = submitted.length === expected.length && submitted.every((value, index) => value === expected[index]);
      if (correct) score += 1;
      const skill = String(question.skill_tag || 'general');
      const total = skillTotals.get(skill) || { correct: 0, total: 0 };
      total.total += 1;
      if (correct) total.correct += 1;
      skillTotals.set(skill, total);
      return {
        question_id: question.id,
        answer: input.answers[question.id] ?? null,
        correct,
        explanation: question.explanation || '',
      };
    });
    const skillScores = Object.fromEntries(
      Array.from(skillTotals.entries()).map(([skill, value]) => [
        skill,
        Math.round((value.correct / value.total) * 100),
      ]),
    );

    const db = adminDb();
    const previousQuery = db.collection('eiken_quiz_results').where('student_id', '==', user.uid);
    const result = await db.runTransaction(async transaction => {
      const previousSnap = await transaction.get(previousQuery);
      const previous = previousSnap.docs.filter(doc => doc.data().quiz_id === quizId);
      if (previous.length >= maxAttempts) throw new Error('quiz-attempt-limit');
      const attemptNo = previous.length + 1;
      const resultRef = db.collection('eiken_quiz_results').doc(`${user.uid}_${quizId}_${attemptNo}`);
      const existing = await transaction.get(resultRef);
      if (existing.exists) throw new Error('quiz-attempt-limit');
      transaction.create(resultRef, {
        student_id: user.uid,
        quiz_id: quizId,
        course_id: quiz.course_id,
        answers: input.answers,
        grading,
        score,
        max_score: questions.length,
        percentage: Math.round((score / questions.length) * 100),
        skill_scores: skillScores,
        attempt_no: attemptNo,
        started_at: FieldValue.serverTimestamp(),
        submitted_at: FieldValue.serverTimestamp(),
        created_at: FieldValue.serverTimestamp(),
      });
      return { resultId: resultRef.id, attemptNo };
    });

    return Response.json({
      ok: true,
      result_id: result.resultId,
      attempt_no: result.attemptNo,
      score,
      max_score: questions.length,
      percentage: Math.round((score / questions.length) * 100),
      skill_scores: skillScores,
      grading,
    });
  } catch (error) {
    if (error instanceof z.ZodError) {
      return Response.json({ ok: false, error: 'invalid-input', details: error.flatten() }, { status: 400 });
    }
    return jsonError(error);
  }
}
