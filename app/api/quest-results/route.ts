import { NextRequest } from 'next/server';
import { FieldValue } from 'firebase-admin/firestore';
import { adminDb } from '@/lib/firebase-admin';
import { getServerUser, jsonError, requireRole } from '@/lib/server-auth';
import { writeCoinTransaction, writeLearningEvent } from '@/lib/events';

const POINTS_PER_CLEAR = 10;

export async function POST(request: NextRequest) {
  try {
    const user = await getServerUser(request);
    requireRole(user, ['student']);

    const body = await request.json();
    const score = Math.max(0, Math.min(100, Number(body.score || 0)));
    const isPassed = !!body.is_passed;

    const resultRef = await adminDb().collection('quest_results').add({
      student_id: user.uid,
      grade: String(body.grade || ''),
      subject: String(body.subject || ''),
      unit_name: String(body.unit_name || '不明な単元'),
      score,
      is_passed: isPassed,
      created_at: FieldValue.serverTimestamp(),
    });

    const eventId = await writeLearningEvent({
      actor_id: user.uid,
      actor_role: user.role,
      type: isPassed ? 'quest_cleared' : 'quest_failed',
      target_id: resultRef.id,
      target_type: 'quest_result',
      school: user.school,
      metadata: { score, subject: body.subject, unit_name: body.unit_name },
    });

    if (isPassed) {
      await writeCoinTransaction({
        user_id: user.uid,
        amount: POINTS_PER_CLEAR,
        reason: 'AI学習クエストクリア',
        actor_id: user.uid,
        source: 'quest_result',
        event_id: eventId,
        metadata: { result_id: resultRef.id },
      });
      await adminDb().collection('users').doc(user.uid).set({
        quest_clear_count: FieldValue.increment(1),
      }, { merge: true });
    }

    return Response.json({ ok: true, result_id: resultRef.id, event_id: eventId, earned_points: isPassed ? POINTS_PER_CLEAR : 0 });
  } catch (error) {
    return jsonError(error);
  }
}

