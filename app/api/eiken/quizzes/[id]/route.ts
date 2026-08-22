import { NextRequest } from 'next/server';
import { adminDb } from '@/lib/firebase-admin';
import { requireStudentEnrollment } from '@/lib/eiken/access';
import { serializeFirestore } from '@/lib/eiken/data';
import { getServerUser, jsonError } from '@/lib/server-auth';

export const runtime = 'nodejs';

export async function GET(request: NextRequest, context: { params: { id: string } }) {
  try {
    const user = await getServerUser(request);
    const quizId = String(context.params.id || '');
    const quizSnap = await adminDb().collection('eiken_quizzes').doc(quizId).get();
    if (!quizSnap.exists || quizSnap.data()?.status !== 'published') throw new Error('quiz-not-found');
    const quiz = { id: quizSnap.id, ...serializeFirestore(quizSnap.data()) };
    await requireStudentEnrollment(user, String((quiz as any).course_id || ''));

    const questionsSnap = await adminDb()
      .collection('eiken_quiz_questions')
      .where('quiz_id', '==', quizId)
      .get();
    const questions = questionsSnap.docs
      .map(doc => {
        const data = serializeFirestore(doc.data());
        return {
          id: doc.id,
          question: data.question,
          question_type: data.question_type,
          options: data.options || [],
          sequence: Number(data.sequence || 0),
          skill_tag: data.skill_tag || '',
        };
      })
      .sort((a, b) => a.sequence - b.sequence);

    return Response.json({ ok: true, quiz, questions });
  } catch (error) {
    return jsonError(error);
  }
}

