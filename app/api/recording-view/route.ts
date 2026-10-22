import { NextRequest } from 'next/server';
import { FieldValue } from 'firebase-admin/firestore';
import { adminDb } from '@/lib/firebase-admin';
import { jstDateKey } from '@/lib/date-key';
import { getServerUser, jsonError, requireRole } from '@/lib/server-auth';
import { canAccessClassRecording } from '@/lib/server/recording-access';
import { recordingRewardRequirement, creditHeartbeat, RECORDING_BUCKET_SECONDS } from '@/lib/recording-watch';
import { normalizeRecordingType } from '@/lib/recordings';

const COMPLETION_REWARD = 10;
const MAX_SESSION_SECONDS = 4 * 60 * 60;

/**
 * 録画の視聴記録とコイン付与。
 * コインは「実際に再生していた時間」で判定する：
 *  - 再生中（一時停止・タブ非表示ではない）の間だけ、画面から約30秒ごとに progress が届く
 *  - サーバーは前回からの経過時間と再生位置の進み方が合うときだけ視聴時間として数える（早送り・放置は数えない）
 *  - 数えた時間と、見た範囲（1分区切り）の両方が基準を超えたらコインを付与する
 */
export async function POST(request: NextRequest) {
  try {
    const user = await getServerUser(request);
    requireRole(user, ['student']);

    const body = await request.json();
    const recordingId = String(body.recording_id || '');
    const eventType = String(body.event_type || 'start');
    const sessionId = String(body.session_id || '').trim();
    const position = Number(body.position_seconds);
    const reportedDuration = Number(body.duration_seconds);

    if (!recordingId) return Response.json({ ok: false, error: 'recording_id is required' }, { status: 400 });
    if (!['start', 'progress', 'complete'].includes(eventType)) {
      return Response.json({ ok: false, error: 'invalid event_type' }, { status: 400 });
    }

    const db = adminDb();
    const recordingSnap = await db.collection('class_recordings').doc(recordingId).get();
    if (!recordingSnap.exists) {
      return Response.json({ ok: false, error: 'recording-not-found' }, { status: 404 });
    }
    const recording = recordingSnap.data() || {};
    if (!canAccessClassRecording(user, recording)) throw new Error('forbidden');
    const viewId = `${user.uid}_${recordingId}`;
    const viewRef = db.collection('recording_views').doc(viewId);
    const eventRef = db.collection('learning_events').doc();
    const rewardRef = db.collection('coin_transactions').doc(`${user.uid}_recording_view_${recordingId}`.replace(/[\/\s#?]/g, '_'));
    const userRef = db.collection('users').doc(user.uid);
    const nowMs = Date.now();

    const result = await db.runTransaction(async transaction => {
      const [viewSnapshot, rewardSnapshot, userSnapshot] = await transaction.getAll(viewRef, rewardRef, userRef);
      const previous = viewSnapshot.data() || {};
      const profile = userSnapshot.data() || {};
      const alreadyRewarded = rewardSnapshot.exists;

      // 録画の長さ：管理画面のトリミング・録画情報を優先。無いときだけ最初に再生画面が報告した長さを使う（あとから短くはできない）。
      const storedReported = Number(previous.reported_duration_seconds || 0);
      const nextReported = storedReported > 0
        ? storedReported
        : (Number.isFinite(reportedDuration) && reportedDuration > 0 ? Math.min(Math.round(reportedDuration), MAX_SESSION_SECONDS) : 0);
      const requirement = recordingRewardRequirement(recording, nextReported);

      let credited = Math.max(0, Number(previous.credited_seconds || 0));
      let buckets: number[] = Array.isArray(previous.watched_buckets) ? previous.watched_buckets.map(Number).filter(Number.isFinite) : [];
      let session = {
        id: String(previous.active_session_id || ''),
        startedAtMs: Number(previous.session_started_at_ms || 0),
        lastBeatMs: Number(previous.session_last_beat_ms || 0),
        lastPosition: previous.session_last_position === null || previous.session_last_position === undefined ? null : Number(previous.session_last_position),
        credited: Math.max(0, Number(previous.session_credited_seconds || 0)),
      };
      // 同時に別の録画を再生して稼げないよう、利用者ごとに有効な視聴は1つだけ。
      const userActiveSession = String(profile.active_recording_session_id || '');

      if (eventType === 'start') {
        session = { id: eventRef.id, startedAtMs: nowMs, lastBeatMs: nowMs, lastPosition: Number.isFinite(position) && position >= 0 ? position : null, credited: 0 };
      } else {
        const sessionValid = viewSnapshot.exists && sessionId && sessionId === session.id && userActiveSession === sessionId
          && session.startedAtMs > 0 && nowMs - session.startedAtMs <= MAX_SESSION_SECONDS * 1000;
        if (sessionValid) {
          const beat = creditHeartbeat({
            nowMs, lastBeatMs: session.lastBeatMs, lastPosition: session.lastPosition,
            position: Number.isFinite(position) && position >= 0 ? position : null,
          });
          credited += beat.creditedSeconds;
          session.credited += beat.creditedSeconds;
          if (beat.buckets.length) buckets = Array.from(new Set([...buckets, ...beat.buckets])).sort((a, b) => a - b).slice(0, 1000);
          session.lastBeatMs = nowMs;
          if (beat.position !== null) session.lastPosition = beat.position;
        }
      }

      const coveredSeconds = buckets.length * RECORDING_BUCKET_SECONDS;
      const qualified = credited >= requirement.requiredSeconds && coveredSeconds >= requirement.requiredCoverageSeconds;
      // グループミーティング（授業の前後の集会）の録画は、視聴記録だけ残してコイン・デイリーミッションの対象にしない。
      const rewardable = normalizeRecordingType(recording.recording_type || recording.recording_type_label) !== 'group_meeting';
      const reward = rewardable && qualified && !alreadyRewarded;
      const ending = eventType === 'complete';
      const nextStatus = qualified || previous.status === 'completed' ? 'completed' : 'watching';

      transaction.set(eventRef, {
        actor_id: user.uid,
        actor_role: user.role,
        type: `recording_view_${eventType}`,
        target_id: recordingId,
        target_type: 'class_recording',
        school: user.school || '',
        metadata: { credited_seconds: credited, covered_seconds: coveredSeconds, position_seconds: Number.isFinite(position) ? position : null },
        created_at: FieldValue.serverTimestamp(),
      });
      transaction.set(viewRef, {
        user_id: user.uid,
        recording_id: recordingId,
        status: nextStatus,
        // 保護者画面などで使う「見た時間」は、実際に再生していたと確認できた時間。
        watched_seconds: Math.max(credited, 0),
        credited_seconds: credited,
        watched_buckets: buckets,
        duration_seconds: requirement.durationSeconds || null,
        reported_duration_seconds: nextReported || null,
        required_seconds: requirement.requiredSeconds,
        last_event_id: eventRef.id,
        started_at: viewSnapshot.exists ? previous.started_at || FieldValue.serverTimestamp() : FieldValue.serverTimestamp(),
        started_at_ms: Number(previous.started_at_ms || 0) || nowMs,
        active_session_id: ending ? null : session.id || null,
        session_started_at_ms: ending ? null : session.startedAtMs || null,
        session_last_beat_ms: ending ? null : session.lastBeatMs || null,
        session_last_position: ending ? null : session.lastPosition,
        session_credited_seconds: ending ? 0 : session.credited,
        updated_at: FieldValue.serverTimestamp(),
        ...(qualified && previous.status !== 'completed' ? { completed_at: FieldValue.serverTimestamp() } : {}),
      }, { merge: true });

      const userUpdate: Record<string, unknown> = {};
      if (eventType === 'start') userUpdate.active_recording_session_id = eventRef.id;
      else if (ending && userActiveSession === sessionId) userUpdate.active_recording_session_id = null;
      // デイリーミッション用：今回の視聴で基準の時間を見たら、日本時間の日付で記録する（見直しの視聴でも）。
      if (rewardable && (reward || (qualified && session.credited >= requirement.requiredSeconds))) userUpdate.last_recording_view_date = jstDateKey();
      if (reward) {
        transaction.set(rewardRef, {
          user_id: user.uid,
          amount: COMPLETION_REWARD,
          reason: '録画視聴完了',
          actor_id: user.uid,
          source: 'recording_view',
          source_id: recordingId,
          event_id: eventRef.id,
          metadata: { recording_id: recordingId, credited_seconds: credited, covered_seconds: coveredSeconds, required_seconds: requirement.requiredSeconds },
          created_at: FieldValue.serverTimestamp(),
        });
        Object.assign(userUpdate, {
          coins: FieldValue.increment(COMPLETION_REWARD),
          total_coins: FieldValue.increment(COMPLETION_REWARD),
          recording_complete_count: FieldValue.increment(1),
          earned_badges: FieldValue.arrayUnion('badge_book'),
        });
      }
      if (Object.keys(userUpdate).length) transaction.set(userRef, { ...userUpdate, updated_at: FieldValue.serverTimestamp() }, { merge: true });

      return {
        rewarded: reward,
        already_rewarded: alreadyRewarded,
        // 必要な時間・残り時間は返さない（画面や通信から基準が分かると、そこで視聴をやめてしまうため）。
        session_id: eventType === 'start' ? eventRef.id : null,
      };
    });

    return Response.json({ ok: true, event_id: eventRef.id, ...result });
  } catch (error) {
    return jsonError(error);
  }
}
