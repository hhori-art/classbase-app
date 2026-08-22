import { NextRequest } from 'next/server';
import { adminDb } from '@/lib/firebase-admin';
import { requireStudentEnrollment } from '@/lib/eiken/access';
import { serializeFirestore } from '@/lib/eiken/data';
import { getServerUser, jsonError } from '@/lib/server-auth';

export const runtime = 'nodejs';

export async function GET(request: NextRequest, context: { params: { id: string } }) {
  try {
    const user = await getServerUser(request);
    const taskId = String(context.params.id || '');
    const taskSnap = await adminDb().collection('eiken_tasks').doc(taskId).get();
    if (!taskSnap.exists || taskSnap.data()?.status !== 'published') throw new Error('task-not-found');
    const task = { id: taskSnap.id, ...serializeFirestore(taskSnap.data()) };
    await requireStudentEnrollment(user, String((task as any).course_id || ''));
    const [progressSnap, writingSnap, quizResultsSnap] = await Promise.all([
      adminDb().collection('eiken_task_progress').doc(`${user.uid}_${taskId}`).get(),
      (task as any).task_type === 'ai_writing'
        ? adminDb().collection('eiken_writing_submissions').doc(`${user.uid}_${taskId}`).get()
        : Promise.resolve(null),
      (task as any).task_type === 'quiz' && (task as any).details?.quiz_id
        ? adminDb().collection('eiken_quiz_results').where('student_id', '==', user.uid).get()
        : Promise.resolve(null),
    ]);
    const quizId = String((task as any).details?.quiz_id || '');
    const latestQuizResult = quizResultsSnap
      ? quizResultsSnap.docs
          .map(doc => ({ id: doc.id, ...serializeFirestore(doc.data()) }))
          .filter(item => String(item.quiz_id || '') === quizId)
          .sort((a, b) => String(b.submitted_at || '').localeCompare(String(a.submitted_at || '')))[0] || null
      : null;
    return Response.json({
      ok: true,
      task,
      progress: progressSnap.exists
        ? { id: progressSnap.id, ...serializeFirestore(progressSnap.data()) }
        : null,
      writing_submission: writingSnap?.exists
        ? { id: writingSnap.id, ...serializeFirestore(writingSnap.data()) }
        : null,
      latest_quiz_result: latestQuizResult,
    });
  } catch (error) {
    return jsonError(error);
  }
}
