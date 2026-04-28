import { NextRequest } from 'next/server';
import { FieldValue } from 'firebase-admin/firestore';
import { adminDb } from '@/lib/firebase-admin';
import { getServerUser, jsonError, requireRole } from '@/lib/server-auth';
import { writeCoinTransaction, writeLearningEvent } from '@/lib/events';

const POINTS_PER_10_MIN = 5;

export async function POST(request: NextRequest) {
  try {
    const user = await getServerUser(request);
    requireRole(user, ['student', 'teacher', 'admin', 'master']);

    const body = await request.json();
    const studentId = user.role === 'student' ? user.uid : String(body.student_id || '');
    const classId = String(body.class_id || '');
    const cameraOnSeconds = Math.max(0, Number(body.camera_on_seconds || 0));
    const totalSeconds = Math.max(cameraOnSeconds, Number(body.total_seconds || 0));

    if (!studentId || !classId) return Response.json({ ok: false, error: 'student_id/class_id is required' }, { status: 400 });

    const db = adminDb();
    const summaryId = `${studentId}_${classId}`;
    const summaryRef = db.collection('camera_session_summaries').doc(summaryId);
    const existing = await summaryRef.get();
    const alreadyRewarded = !!existing.data()?.rewarded_at;
    const reward = Math.min(50, Math.floor(cameraOnSeconds / 600) * POINTS_PER_10_MIN);

    const eventId = await writeLearningEvent({
      actor_id: user.uid,
      actor_role: user.role,
      type: 'camera_session_summary_submitted',
      target_id: classId,
      target_type: 'class_session',
      school: user.school,
      metadata: { student_id: studentId, camera_on_seconds: cameraOnSeconds, total_seconds: totalSeconds, reward },
    });

    await summaryRef.set({
      student_id: studentId,
      class_id: classId,
      camera_on_seconds: cameraOnSeconds,
      total_seconds: totalSeconds,
      reward_points: reward,
      submitted_by: user.uid,
      last_event_id: eventId,
      updated_at: FieldValue.serverTimestamp(),
      created_at: existing.exists ? existing.data()?.created_at || FieldValue.serverTimestamp() : FieldValue.serverTimestamp(),
    }, { merge: true });

    if (reward > 0 && !alreadyRewarded) {
      await writeCoinTransaction({
        user_id: studentId,
        amount: reward,
        reason: 'カメラON参加ポイント',
        actor_id: user.uid,
        source: 'camera_session_summary',
        event_id: eventId,
        metadata: { class_id: classId, camera_on_seconds: cameraOnSeconds },
      });
      await summaryRef.set({ rewarded_at: FieldValue.serverTimestamp() }, { merge: true });
    }

    return Response.json({ ok: true, event_id: eventId, reward, rewarded: reward > 0 && !alreadyRewarded });
  } catch (error) {
    return jsonError(error);
  }
}

