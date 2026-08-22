import { NextRequest } from 'next/server';
import { FieldValue } from 'firebase-admin/firestore';
import { adminDb } from '@/lib/firebase-admin';
import { getServerUser, jsonError, requireRole } from '@/lib/server-auth';
import { writeCoinTransaction, writeLearningEvent } from '@/lib/events';

const COMPLETION_REWARD = 10;

export async function POST(request: NextRequest) {
  try {
    const user = await getServerUser(request);
    requireRole(user, ['student']);

    const body = await request.json();
    const recordingId = String(body.recording_id || '');
    const eventType = String(body.event_type || 'start');
    const watchedSeconds = Number(body.watched_seconds || 0);
    const durationSeconds = Number(body.duration_seconds || 0);

    if (!recordingId) return Response.json({ ok: false, error: 'recording_id is required' }, { status: 400 });
    if (!['start', 'progress', 'complete'].includes(eventType)) {
      return Response.json({ ok: false, error: 'invalid event_type' }, { status: 400 });
    }

    const db = adminDb();
    const viewId = `${user.uid}_${recordingId}`;
    const eventId = await writeLearningEvent({
      actor_id: user.uid,
      actor_role: user.role,
      type: `recording_view_${eventType}`,
      target_id: recordingId,
      target_type: 'class_recording',
      school: user.school,
      metadata: { watched_seconds: watchedSeconds, duration_seconds: durationSeconds },
    });

    const viewRef = db.collection('recording_views').doc(viewId);
    const viewSnap = await viewRef.get();
    const alreadyCompleted = !!viewSnap.data()?.completed_at;

    await viewRef.set({
      user_id: user.uid,
      recording_id: recordingId,
      status: eventType === 'complete' ? 'completed' : 'watching',
      watched_seconds: Math.max(watchedSeconds, viewSnap.data()?.watched_seconds || 0),
      duration_seconds: durationSeconds || viewSnap.data()?.duration_seconds || null,
      last_event_id: eventId,
      started_at: viewSnap.exists ? viewSnap.data()?.started_at || FieldValue.serverTimestamp() : FieldValue.serverTimestamp(),
      updated_at: FieldValue.serverTimestamp(),
      ...(eventType === 'complete' ? { completed_at: FieldValue.serverTimestamp() } : {}),
    }, { merge: true });

    let rewarded = false;
    if (eventType === 'complete' && !alreadyCompleted) {
      await writeCoinTransaction({
        user_id: user.uid,
        amount: COMPLETION_REWARD,
        reason: '録画視聴完了',
        actor_id: user.uid,
        source: 'recording_view',
        event_id: eventId,
        metadata: { recording_id: recordingId },
      });
      await db.collection('users').doc(user.uid).set({
        last_recording_view_date: new Date().toISOString().split('T')[0],
        earned_badges: FieldValue.arrayUnion('badge_book'),
        updated_at: FieldValue.serverTimestamp(),
      }, { merge: true });
      rewarded = true;
    }

    return Response.json({ ok: true, event_id: eventId, rewarded });
  } catch (error) {
    return jsonError(error);
  }
}
