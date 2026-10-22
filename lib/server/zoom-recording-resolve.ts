import 'server-only';

import { adminDb } from '@/lib/firebase-admin';
import { recordingStartMillis } from '@/lib/annual-recording-urls';
import { locateZoomRecordingFile } from '@/lib/zoom-recording-locate';
import { normalizeMeetingId, periodFromShift } from '@/lib/zoom-recording-match';
import { listAccountRecordings, zoomApiAccessToken } from '@/lib/server/zoom-api';

const jstDateKey = (ms: number) => new Date(ms + 9 * 60 * 60 * 1000).toISOString().slice(0, 10);
const shiftDateKey = (millis: number, offsetDays: number) => jstDateKey(millis + offsetDays * 24 * 60 * 60 * 1000);

export type ZoomResolveSummary = {
  resolved: number;
  linked_shifts: number;
  unresolved: { id: string; reason: string }[];
};

/**
 * 録画一覧（CSV）から取り込んだ class_recordings を、Zoom APIの録画ファイルに結びつける。
 * 結びついた録画はアプリ内のプレイヤーで再生でき、録画パスコードの入力は要らない。
 * 同じ授業の講師配置（会議ID・日付・時限が一致）があれば original_shift_id でつなぐ。
 */
export async function resolveCsvRecordingsWithZoom(ids: string[]): Promise<ZoomResolveSummary> {
  const db = adminDb();
  const uniqueIds = [...new Set(ids.map(id => String(id || '').trim()).filter(Boolean))].slice(0, 200);
  const summary: ZoomResolveSummary = { resolved: 0, linked_shifts: 0, unresolved: [] };
  if (uniqueIds.length === 0) return summary;

  const snaps = await db.getAll(...uniqueIds.map(id => db.collection('class_recordings').doc(id)));
  const accessToken = await zoomApiAccessToken();
  const meetingsByDay = new Map<string, Promise<any[]>>();
  const meetingsAround = (startMs: number) => {
    // Zoomの日付指定はUTC基準のため、前後1日を含めて取得する。
    const key = jstDateKey(startMs);
    if (!meetingsByDay.has(key)) {
      meetingsByDay.set(key, listAccountRecordings(accessToken, shiftDateKey(startMs, -1), shiftDateKey(startMs, 1)));
    }
    return meetingsByDay.get(key)!;
  };
  const shiftsByDate = new Map<string, Promise<FirebaseFirestore.QueryDocumentSnapshot[]>>();
  const shiftsOn = (date: string) => {
    if (!shiftsByDate.has(date)) {
      shiftsByDate.set(date, db.collection('shift_assignments').where('target_date', '==', date).get().then(snap => snap.docs));
    }
    return shiftsByDate.get(date)!;
  };
  const now = new Date().toISOString();

  for (const snap of snaps) {
    if (!snap.exists) {
      summary.unresolved.push({ id: snap.id, reason: 'not-found' });
      continue;
    }
    const data = snap.data() || {};
    const startMs = Number(data.recording_start_ms) || recordingStartMillis(data.video_url);
    if (!startMs) {
      summary.unresolved.push({ id: snap.id, reason: 'no-start-time' });
      await snap.ref.set({ zoom_resolve_error: 'URLに録画の開始時刻（startTime）がありません', updated_at: now }, { merge: true });
      continue;
    }

    const located = locateZoomRecordingFile(await meetingsAround(startMs), startMs, String(data.recording_host_email || ''));
    if (!located) {
      summary.unresolved.push({ id: snap.id, reason: 'zoom-recording-not-found' });
      await snap.ref.set({ zoom_resolve_error: 'Zoomのクラウド録画が見つかりません（削除済みの可能性があります）', updated_at: now }, { merge: true });
      continue;
    }

    const { meeting, file } = located;
    const meetingId = normalizeMeetingId(meeting.id);
    const fileStart = Date.parse(String(file.recording_start || ''));
    const fileEnd = Date.parse(String(file.recording_end || ''));
    const patch: Record<string, unknown> = {
      recording_meeting_id: meetingId,
      zoom_meeting_uuid: String(meeting.uuid || ''),
      zoom_recording_file_id: String(file.id || ''),
      target_recording_file_id: String(file.id || ''),
      target_recording_type: String(file.recording_type || ''),
      zoom_recording_files: Array.isArray(meeting.recording_files) ? meeting.recording_files : [],
      recording_host_email: String(meeting.host_email || data.recording_host_email || '').toLowerCase(),
      recording_duration_seconds: Number.isFinite(fileStart) && Number.isFinite(fileEnd) ? Math.max(0, Math.round((fileEnd - fileStart) / 1000)) : 0,
      zoom_resolved_at: now,
      zoom_resolve_error: '',
      updated_at: now,
    };

    const targetDate = String(data.target_date || '').slice(0, 10);
    const period = String(data.period || '');
    if (!data.original_shift_id && /^\d{4}-\d{2}-\d{2}$/.test(targetDate) && period) {
      // 差し替え録画は別の日の会議なので、会議IDではなく録画一覧のアカウントで講師配置を探す。
      const host = String(data.recording_host_email || '').toLowerCase();
      const shift = (await shiftsOn(targetDate)).find(doc => {
        const shiftData = doc.data() || {};
        if (periodFromShift(shiftData) !== period) return false;
        if (data.is_replacement === true) {
          return Boolean(host) && String(shiftData.target_signin_address || shiftData.signin_address || '').trim().toLowerCase() === host;
        }
        return normalizeMeetingId(shiftData.target_meeting_id) === meetingId;
      });
      if (shift) {
        patch.original_shift_id = shift.id;
        const shiftData = shift.data() || {};
        const previousId = String(shiftData.published_recording_id || '');
        if (previousId && previousId !== snap.id && previousId.startsWith('auto_')) {
          // 自動アップ済みの録画があれば、録画一覧の指定を優先して重複を消す。
          await db.collection('class_recordings').doc(previousId).set({ status: 'archived', stopped_reason: '録画一覧の取込で置き換え', updated_at: now }, { merge: true });
        }
        if (data.recording_part !== 'HR' || !previousId) {
          await shift.ref.set({ recording_status: 'published', recording_issues: [], published_recording_id: snap.id, recording_checked_at: now }, { merge: true });
        }
        summary.linked_shifts += 1;
      }
    }

    await snap.ref.set(patch, { merge: true });
    summary.resolved += 1;
  }
  return summary;
}
