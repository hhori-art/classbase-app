import { NextRequest } from 'next/server';
import { FieldValue } from 'firebase-admin/firestore';
import { z } from 'zod';
import { adminDb } from '@/lib/firebase-admin';
import { requireStudentEnrollment } from '@/lib/eiken/access';
import { getEikenWritingEvaluationService } from '@/lib/eiken/writing-evaluation';
import { getServerUser, jsonError } from '@/lib/server-auth';

export const runtime = 'nodejs';

const submitSchema = z.object({
  answer: z.string().trim().min(10).max(6000),
});

export async function POST(request: NextRequest, context: { params: { id: string } }) {
  const taskId = String(context.params.id || '');
  let submissionRef: FirebaseFirestore.DocumentReference | null = null;
  let processingStarted = false;
  try {
    const user = await getServerUser(request);
    const input = submitSchema.parse(await request.json());
    const taskSnap = await adminDb().collection('eiken_tasks').doc(taskId).get();
    if (!taskSnap.exists || taskSnap.data()?.task_type !== 'ai_writing' || taskSnap.data()?.status !== 'published') {
      throw new Error('writing-task-not-found');
    }
    const task = taskSnap.data() || {};
    const enrollment = await requireStudentEnrollment(user, String(task.course_id || ''));
    const courseSnap = await adminDb().collection('eiken_courses').doc(String(task.course_id || '')).get();
    const details = task.details || {};
    const assignmentType = details.assignment_type === 'summary' ? 'summary' : 'opinion';
    submissionRef = adminDb().collection('eiken_writing_submissions').doc(`${user.uid}_${taskId}`);

    await adminDb().runTransaction(async transaction => {
      const existing = await transaction.get(submissionRef!);
      const status = existing.data()?.evaluation_status;
      if (status === 'processing' || status === 'completed') throw new Error('writing-already-submitted');
      transaction.set(submissionRef!, {
        submission_id: submissionRef!.id,
        student_id: user.uid,
        course_id: task.course_id,
        task_id: taskId,
        assignment_type: assignmentType,
        original_answer: input.answer,
        word_count: input.answer.split(/\s+/).filter(Boolean).length,
        evaluation_status: 'processing',
        prompt_version: 'eiken-writing-v1',
        submitted_at: FieldValue.serverTimestamp(),
        created_at: existing.exists ? existing.data()?.created_at || FieldValue.serverTimestamp() : FieldValue.serverTimestamp(),
        updated_at: FieldValue.serverTimestamp(),
      }, { merge: true });
    });
    processingStarted = true;

    const service = getEikenWritingEvaluationService();
    const evaluation = await service.evaluate({
      assignmentType,
      level: String(courseSnap.data()?.level || (enrollment as Record<string, any>).level || ''),
      prompt: String(details.prompt || task.description || task.title || ''),
      sourceText: String(details.source_text || ''),
      answer: input.answer,
    });

    await submissionRef.set({
      evaluation_status: 'completed',
      ...evaluation,
      model: process.env.OPENAI_API_KEY && process.env.EIKEN_AI_MODE !== 'mock'
        ? process.env.EIKEN_AI_MODEL || 'gpt-4o-mini'
        : 'mock',
      evaluated_at: FieldValue.serverTimestamp(),
      updated_at: FieldValue.serverTimestamp(),
      error_message: null,
    }, { merge: true });

    return Response.json({ ok: true, submission_id: submissionRef.id, evaluation });
  } catch (error) {
    if (submissionRef && processingStarted) {
      await submissionRef.set({
        evaluation_status: 'failed',
        error_message: error instanceof Error ? error.message.slice(0, 300) : 'evaluation-failed',
        updated_at: FieldValue.serverTimestamp(),
      }, { merge: true }).catch(() => undefined);
    }
    if (error instanceof z.ZodError) {
      return Response.json({ ok: false, error: 'invalid-input', details: error.flatten() }, { status: 400 });
    }
    return jsonError(error);
  }
}
