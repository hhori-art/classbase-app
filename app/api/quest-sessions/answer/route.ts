import { NextRequest } from 'next/server';
import { adminDb } from '@/lib/firebase-admin';
import { getServerUser, jsonError, requireRole } from '@/lib/server-auth';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

// 1問ごとに回答を確定し、正誤と正解を返す。同じ問題への再回答はできない。
export async function POST(request: NextRequest) {
  try {
    const user = await getServerUser(request);
    requireRole(user, ['student']);
    const body = await request.json().catch(() => ({}));
    const sessionId = String(body.session_id || '').trim().slice(0, 200);
    const questionId = String(body.question_id || '').trim().slice(0, 200);
    const selectedAnswer = String(body.selected_answer || '').trim().slice(0, 500);
    if (!sessionId || !questionId || !selectedAnswer) {
      return Response.json({ ok: false, error: 'session_id, question_id and selected_answer are required' }, { status: 400 });
    }

    const db = adminDb();
    const ref = db.collection('quest_sessions').doc(sessionId);
    const result = await db.runTransaction(async tx => {
      const snap = await tx.get(ref);
      const data = snap.data() || {};
      const expiresAt = data.expires_at?.toMillis?.() || 0;
      if (!snap.exists || data.student_id !== user.uid || data.used === true || expiresAt <= Date.now()) {
        throw new Error('invalid-or-used-quest-session');
      }
      const question = (Array.isArray(data.questions) ? data.questions : [])
        .find((item: any) => String(item?.id || '') === questionId);
      if (!question) throw new Error('question-not-in-session');
      if (data.answers?.[questionId]) throw new Error('question-already-answered');
      const correctAnswer = String(question.correct_answer || '');
      const isCorrect = selectedAnswer === correctAnswer;
      // トランザクション内で読んだ answers に追記するため、同時回答でも取りこぼさない。
      tx.update(ref, {
        answers: {
          ...(data.answers || {}),
          [questionId]: { selected_answer: selectedAnswer, is_correct: isCorrect, answered_at: new Date().toISOString() },
        },
      });
      return { is_correct: isCorrect, correct_answer: correctAnswer, explanation: String(question.explanation || '') };
    });
    return Response.json({ ok: true, ...result }, { headers: { 'Cache-Control': 'private, no-store' } });
  } catch (error) {
    return jsonError(error);
  }
}
