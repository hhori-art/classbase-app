import { NextRequest } from 'next/server';
import { FieldValue } from 'firebase-admin/firestore';
import { adminDb } from '@/lib/firebase-admin';
import { getServerUser, jsonError, requireRole } from '@/lib/server-auth';
import { writeLearningEvent } from '@/lib/events';

export async function POST(request: NextRequest) {
  try {
    const user = await getServerUser(request);
    requireRole(user, ['student']);

    const body = await request.json();
    const today = new Date().toISOString().split('T')[0];
    const targetDate = String(body.target_date || today);
    const classId = body.class_id ? String(body.class_id) : `${user.uid}_${targetDate}`;

    const db = adminDb();
    const eventId = await writeLearningEvent({
      actor_id: user.uid,
      actor_role: user.role,
      type: 'class_join_clicked',
      target_id: classId,
      target_type: 'class_session',
      school: user.school,
      metadata: {
        target_date: targetDate,
        source: 'zoom_button',
      },
    });

    await db.collection('attendance').doc(`${user.uid}_${targetDate}`).set({
      user_id: user.uid,
      target_date: targetDate,
      type: 'joined',
      contacted_by: 'student',
      reason: 'Zoom参加ボタンより参加ログを記録',
      participation_event_id: eventId,
      updated_at: FieldValue.serverTimestamp(),
      created_at: FieldValue.serverTimestamp(),
    }, { merge: true });

    return Response.json({ ok: true, event_id: eventId });
  } catch (error) {
    return jsonError(error);
  }
}

