import { NextRequest } from 'next/server';
import { getServerUser, jsonError, requireRole } from '@/lib/server-auth';
import { writeCoinTransaction, writeLearningEvent } from '@/lib/events';

export async function POST(request: NextRequest) {
  try {
    const user = await getServerUser(request);
    requireRole(user, ['teacher', 'admin', 'master']);

    const body = await request.json();
    const studentId = String(body.student_id || '');
    const amount = Math.max(1, Math.min(500, Number(body.amount || 0)));
    const reason = String(body.reason || '講師付与ポイント').slice(0, 120);
    if (!studentId || !amount) return Response.json({ ok: false, error: 'student_id/amount is required' }, { status: 400 });

    const eventId = await writeLearningEvent({
      actor_id: user.uid,
      actor_role: user.role,
      type: 'teacher_awarded_points',
      target_id: studentId,
      target_type: 'user',
      school: user.school,
      metadata: { amount, reason },
    });

    await writeCoinTransaction({
      user_id: studentId,
      amount,
      reason,
      actor_id: user.uid,
      source: 'teacher_award',
      event_id: eventId,
    });

    return Response.json({ ok: true, event_id: eventId });
  } catch (error) {
    return jsonError(error);
  }
}

