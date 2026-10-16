import { NextRequest } from 'next/server';
import { FieldValue } from 'firebase-admin/firestore';
import { adminDb } from '@/lib/firebase-admin';
import { getServerUser, jsonError, requireRole } from '@/lib/server-auth';
import { canAccessClassRecording } from '@/lib/server/recording-access';

const COMPLETION_REWARD = 10;
const MINIMUM_COMPLETION_SECONDS = 15 * 60;

export async function POST(request: NextRequest) {
  try {
    const user = await getServerUser(request);
    requireRole(user, ['student']);

    const body = await request.json();
    const recordingId = String(body.recording_id || '');
    const eventType = String(body.event_type || 'start');
    const watchedSeconds = Number(body.watched_seconds || 0);
    const durationSeconds = Number(body.duration_seconds || 0);
    const sessionId = String(body.session_id || '').trim();

    if (!recordingId) return Response.json({ ok: false, error: 'recording_id is required' }, { status: 400 });
    if (!['start', 'progress', 'complete'].includes(eventType)) {
      return Response.json({ ok: false, error: 'invalid event_type' }, { status: 400 });
    }

    const db = adminDb();
    const recordingSnap = await db.collection('class_recordings').doc(recordingId).get();
    if (!recordingSnap.exists) {
      return Response.json({ ok: false, error: 'recording-not-found' }, { status: 404 });
    }
    if (!canAccessClassRecording(user, recordingSnap.data() || {})) throw new Error('forbidden');
    const viewId = `${user.uid}_${recordingId}`;
    const viewRef = db.collection('recording_views').doc(viewId);
    const eventRef = db.collection('learning_events').doc();
    const rewardRef = db.collection('coin_transactions').doc(`${user.uid}_recording_view_${recordingId}`.replace(/[\/\s#?]/g, '_'));
    const userRef = db.collection('users').doc(user.uid);
    const nowMs = Date.now();
    const rewarded = await db.runTransaction(async transaction => {
      const [viewSnapshot, rewardSnapshot] = await transaction.getAll(viewRef, rewardRef);
      const previous = viewSnapshot.data() || {};
      const sessionStartedAtMs = Number(previous.session_started_at_ms || 0);
      const elapsedSeconds = sessionStartedAtMs > 0 ? Math.max(0, Math.floor((nowMs - sessionStartedAtMs) / 1000)) : 0;
      if (eventType === 'complete' && (
        !viewSnapshot.exists || !sessionId || sessionId !== String(previous.active_session_id || '') ||
        elapsedSeconds < MINIMUM_COMPLETION_SECONDS || elapsedSeconds > 4 * 60 * 60
      )) {
        throw new Error('watch-duration-not-met');
      }
      const safeWatchedSeconds = Math.max(0, Math.min(Number.isFinite(watchedSeconds) ? watchedSeconds : 0, elapsedSeconds || 0));
      transaction.set(eventRef, {
        actor_id: user.uid,
        actor_role: user.role,
        type: `recording_view_${eventType}`,
        target_id: recordingId,
        target_type: 'class_recording',
        school: user.school || '',
        metadata: { watched_seconds: safeWatchedSeconds, duration_seconds: Math.max(0, durationSeconds) },
        created_at: FieldValue.serverTimestamp(),
      });
      transaction.set(viewRef, {
        user_id: user.uid,
        recording_id: recordingId,
        status: eventType === 'complete' ? 'completed' : 'watching',
        watched_seconds: Math.max(safeWatchedSeconds, Number(previous.watched_seconds || 0)),
        duration_seconds: durationSeconds > 0 ? durationSeconds : previous.duration_seconds || null,
        last_event_id: eventRef.id,
        started_at: viewSnapshot.exists ? previous.started_at || FieldValue.serverTimestamp() : FieldValue.serverTimestamp(),
        started_at_ms: Number(previous.started_at_ms || 0) || nowMs,
        active_session_id: eventType === 'start' ? eventRef.id : null,
        session_started_at_ms: eventType === 'start' ? nowMs : null,
        updated_at: FieldValue.serverTimestamp(),
        ...(eventType === 'complete' ? { completed_at: FieldValue.serverTimestamp() } : {}),
      }, { merge: true });
      if (eventType === 'complete' && !rewardSnapshot.exists) {
        transaction.set(rewardRef, {
          user_id: user.uid,
          amount: COMPLETION_REWARD,
          reason: '録画視聴完了',
          actor_id: user.uid,
          source: 'recording_view',
          source_id: recordingId,
          event_id: eventRef.id,
          metadata: { recording_id: recordingId },
          created_at: FieldValue.serverTimestamp(),
        });
        transaction.set(userRef, {
          coins: FieldValue.increment(COMPLETION_REWARD),
          total_coins: FieldValue.increment(COMPLETION_REWARD),
          last_recording_view_date: new Date().toISOString().split('T')[0],
          recording_complete_count: FieldValue.increment(1),
          earned_badges: FieldValue.arrayUnion('badge_book'),
          updated_at: FieldValue.serverTimestamp(),
        }, { merge: true });
      }
      return eventType === 'complete' && !rewardSnapshot.exists;
    });

    return Response.json({ ok: true, event_id: eventRef.id, session_id: eventType === 'start' ? eventRef.id : null, rewarded });
  } catch (error) {
    return jsonError(error);
  }
}
