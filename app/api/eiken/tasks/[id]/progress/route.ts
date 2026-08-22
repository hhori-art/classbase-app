import { NextRequest } from 'next/server';
import { FieldValue } from 'firebase-admin/firestore';
import { z } from 'zod';
import { adminDb } from '@/lib/firebase-admin';
import { requireStudentEnrollment } from '@/lib/eiken/access';
import { getServerUser, jsonError } from '@/lib/server-auth';

export const runtime = 'nodejs';

const requestSchema = z.object({
  action: z.enum(['start', 'complete', 'understanding']),
  understanding: z.enum(['good', 'uncertain', 'difficult']).optional(),
});

export async function POST(request: NextRequest, context: { params: { id: string } }) {
  try {
    const user = await getServerUser(request);
    const taskId = String(context.params.id || '');
    const taskSnap = await adminDb().collection('eiken_tasks').doc(taskId).get();
    if (!taskSnap.exists || taskSnap.data()?.status !== 'published') throw new Error('task-not-found');
    const task = taskSnap.data() || {};
    await requireStudentEnrollment(user, String(task.course_id || ''));

    const input = requestSchema.parse(await request.json());
    if (input.action === 'understanding' && !input.understanding) {
      return Response.json({ ok: false, error: 'understanding-required' }, { status: 400 });
    }

    const progressRef = adminDb().collection('eiken_task_progress').doc(`${user.uid}_${taskId}`);
    await adminDb().runTransaction(async transaction => {
      const progressSnap = await transaction.get(progressRef);
      const current = progressSnap.data() || {};
      const update: Record<string, unknown> = {
        student_id: user.uid,
        task_id: taskId,
        course_id: task.course_id,
        updated_at: FieldValue.serverTimestamp(),
      };

      if (!progressSnap.exists) update.created_at = FieldValue.serverTimestamp();
      if (input.action === 'start') {
        update.status = current.status === 'completed' ? 'completed' : 'in_progress';
        if (!current.started_at) update.started_at = FieldValue.serverTimestamp();
      }
      if (input.action === 'complete') {
        const prerequisites = Array.isArray(task.prerequisites) ? task.prerequisites.map(String) : [];
        if (prerequisites.length) {
          const prerequisiteRefs = prerequisites.map(id =>
            adminDb().collection('eiken_task_progress').doc(`${user.uid}_${id}`)
          );
          const prerequisiteSnaps = await transaction.getAll(...prerequisiteRefs);
          if (prerequisiteSnaps.some(snapshot => snapshot.data()?.status !== 'completed')) {
            throw new Error('task-locked');
          }
        }
        update.status = 'completed';
        update.completed_at = FieldValue.serverTimestamp();
        if (!current.started_at) update.started_at = FieldValue.serverTimestamp();
      }
      if (input.action === 'understanding') {
        update.understanding = input.understanding;
      }
      transaction.set(progressRef, update, { merge: true });
    });

    return Response.json({ ok: true });
  } catch (error) {
    if (error instanceof z.ZodError) {
      return Response.json({ ok: false, error: 'invalid-input', details: error.flatten() }, { status: 400 });
    }
    return jsonError(error);
  }
}

