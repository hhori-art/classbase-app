import type { QueryDocumentSnapshot } from 'firebase-admin/firestore';
import { adminDb } from '@/lib/firebase-admin';

type ShiftCandidateDoc = {
  docSnap: QueryDocumentSnapshot;
  data: FirebaseFirestore.DocumentData;
};

export const normalizeMeetingId = (value: unknown) =>
  String(value || '')
    .normalize('NFKC')
    .replace(/[^\d]/g, '');

const normalizeEmail = (value: unknown) => String(value || '').trim().toLowerCase();

export const toJstDateKey = (value: unknown) => {
  const date = new Date(String(value || ''));
  if (Number.isNaN(date.getTime())) return '';
  const jst = new Date(date.getTime() + 9 * 60 * 60 * 1000);
  return jst.toISOString().slice(0, 10);
};

export const jstMinutesOfDay = (value: unknown) => {
  const date = new Date(String(value || ''));
  if (Number.isNaN(date.getTime())) return null;
  const jst = new Date(date.getTime() + 9 * 60 * 60 * 1000);
  return jst.getUTCHours() * 60 + jst.getUTCMinutes();
};

const periodFromValue = (value: unknown) => {
  const text = String(value || '').normalize('NFKC').trim();
  if (!text) return '';
  if (text === '1' || text.includes('1限') || text.includes('1時間') || text.includes('第1')) return '1限';
  if (text === '2' || text.includes('2限') || text.includes('2時間') || text.includes('第2')) return '2限';
  return '';
};

export const periodFromNote = (note: unknown) => periodFromValue(note);

const periodFromShift = (shift: FirebaseFirestore.DocumentData) => (
  periodFromValue(shift.period) ||
  periodFromValue(shift.target_period) ||
  periodFromValue(shift.time_period) ||
  periodFromValue(shift.class_period) ||
  periodFromValue(shift.period_number) ||
  periodFromValue(shift.lesson_period) ||
  periodFromValue(shift.slot) ||
  periodFromNote(shift.note)
);

const looseDateKey = (value: unknown) => {
  const text = String(value || '').normalize('NFKC').trim();
  if (!text) return '';
  const ymd = text.match(/(\d{4})[\/.\-年](\d{1,2})[\/.\-月](\d{1,2})/);
  if (ymd) {
    return `${ymd[1]}-${ymd[2].padStart(2, '0')}-${ymd[3].padStart(2, '0')}`;
  }
  if (/^\d{4}-\d{2}-\d{2}$/.test(text.slice(0, 10))) return text.slice(0, 10);
  return toJstDateKey(text);
};

const targetDateFromShift = (shift: FirebaseFirestore.DocumentData) => (
  looseDateKey(shift.target_date) ||
  looseDateKey(shift.date) ||
  looseDateKey(shift.lesson_date) ||
  looseDateKey(shift.targetDate)
);

const PERIOD_WINDOWS: Record<string, { start: number; end: number }> = {
  '1限': { start: 19 * 60 + 20, end: 20 * 60 + 25 },
  '2限': { start: 20 * 60 + 35, end: 21 * 60 + 40 },
};

const isWithinPeriod = (minutes: number | null, period: string, marginMinutes = 20) => {
  const window = PERIOD_WINDOWS[period];
  if (minutes == null || !window) return false;
  return minutes >= window.start - marginMinutes && minutes <= window.end + marginMinutes;
};

const periodDistance = (minutes: number | null, period: string) => {
  const window = PERIOD_WINDOWS[period];
  if (minutes == null || !window) return 9999;
  if (minutes < window.start) return window.start - minutes;
  if (minutes > window.end) return minutes - window.end;
  return 0;
};

const recordingTimeRange = (recording: any) => {
  const video = speakerViewFile(recording);
  const startValue = video?.recording_start || recording.start_time;
  const endValue = video?.recording_end || recording.end_time;
  const startMinutes = jstMinutesOfDay(startValue);
  const endMinutesFromValue = jstMinutesOfDay(endValue);
  const durationSeconds = recordingDurationSeconds(recording);
  const endMinutes = endMinutesFromValue ?? (
    startMinutes == null || !durationSeconds ? null : startMinutes + Math.round(durationSeconds / 60)
  );
  return { startMinutes, endMinutes, durationSeconds };
};

const periodOverlapMinutes = (recording: any, period: string) => {
  const window = PERIOD_WINDOWS[period];
  const { startMinutes, endMinutes } = recordingTimeRange(recording);
  if (!window || startMinutes == null || endMinutes == null) return 0;
  const overlapStart = Math.max(startMinutes, window.start);
  const overlapEnd = Math.min(endMinutes, window.end);
  return Math.max(0, overlapEnd - overlapStart);
};

const suggestedTrimForPeriod = (recording: any, period: string) => {
  const window = PERIOD_WINDOWS[period];
  const { startMinutes, durationSeconds } = recordingTimeRange(recording);
  if (!window || startMinutes == null) {
    return { start: 0, end: null as number | null };
  }

  const start = Math.max(0, Math.round((window.start - startMinutes) * 60));
  const endByWindow = Math.max(start, Math.round((window.end - startMinutes) * 60));
  const end = durationSeconds ? Math.min(durationSeconds, endByWindow) : endByWindow;
  return {
    start,
    end: end > start ? end : null,
  };
};

export function isMainShift(data: FirebaseFirestore.DocumentData) {
  const roleType = String(data.role_type || data.roleType || 'main').toLowerCase();
  if (roleType && !['main', 'teacher', 'primary'].includes(roleType)) return false;

  const teacherName = String(data.teacher_name || data.teacherName || '');
  const subject = String(data.target_subject || data.subject || '');
  const note = String(data.note || '');
  return !(
    teacherName.includes('サポート') ||
    teacherName.includes('チューター') ||
    subject === '学習サポート' ||
    note.includes('サポート')
  );
}

export function speakerViewFile(recording: any) {
  const files = Array.isArray(recording.recording_files) ? recording.recording_files : [];
  const completedMp4s = files.filter((file: any) => (
    String(file.status || 'completed').toLowerCase() === 'completed' &&
    (String(file.file_type || '').toUpperCase() === 'MP4' || String(file.file_extension || '').toUpperCase() === 'MP4')
  ));

  const typeOf = (file: any) => String(file.recording_type || '').toLowerCase();
  return (
    completedMp4s.find((file: any) => typeOf(file) === 'shared_screen_with_speaker_view') ||
    completedMp4s.find((file: any) => typeOf(file) === 'active_speaker') ||
    completedMp4s.find((file: any) => typeOf(file).includes('speaker_view')) ||
    completedMp4s.find((file: any) => typeOf(file).includes('shared_screen')) ||
    completedMp4s[0] ||
    null
  );
}

export function recordingShareUrl(recording: any) {
  const video = speakerViewFile(recording);
  return String(video?.play_url || recording.share_url || video?.download_url || '').trim();
}

export function recordingStartMinutes(recording: any) {
  const video = speakerViewFile(recording);
  return jstMinutesOfDay(video?.recording_start || recording.start_time);
}

function recordingMeetingId(recording: any) {
  return [
    recording.id,
    recording.meeting_id,
    recording.meetingId,
    recording.meetingID,
    recording.meeting_number,
    recording.meetingNumber,
  ].map(normalizeMeetingId).find(Boolean) || '';
}

function recordingDurationSeconds(recording: any) {
  const video = speakerViewFile(recording);
  const start = new Date(String(video?.recording_start || recording.start_time || ''));
  const end = new Date(String(video?.recording_end || recording.end_time || ''));
  if (!Number.isNaN(start.getTime()) && !Number.isNaN(end.getTime())) {
    return Math.max(0, Math.round((end.getTime() - start.getTime()) / 1000));
  }
  return Number(video?.duration || recording.duration || 0) || 0;
}

function scoreShiftForRecording(shift: FirebaseFirestore.DocumentData, recording: any, meetingId: string, targetDate: string) {
  if (!isMainShift(shift)) return -9999;
  if (targetDateFromShift(shift) !== targetDate) return -9999;

  const shiftMeetingIds = shiftMeetingIdsFromShift(shift);
  if (!shiftMeetingIds.includes(meetingId)) return -9999;

  let score = 200;
  const shiftEmail = normalizeEmail(shift.target_signin_address || shift.signin_address);
  const recordingEmail = normalizeEmail(recording.host_email || recording.hostEmail);
  if (shiftEmail && recordingEmail) score += shiftEmail === recordingEmail ? 80 : -120;

  const period = periodFromShift(shift);
  const minutes = recordingStartMinutes(recording);
  if (period && minutes != null) {
    const overlap = periodOverlapMinutes(recording, period);
    if (overlap < 15 && !isWithinPeriod(minutes, period, 45)) return -9999;
    score += overlap >= 15 ? 120 + Math.min(80, overlap) : (isWithinPeriod(minutes, period, 20) ? 160 : 70);
    score -= Math.min(80, periodDistance(minutes, period));
  } else if (period) {
    score -= 40;
  }

  if (period) score -= Math.min(30, periodDistance(minutes, period) / 3);
  score += Math.min(30, recordingDurationSeconds(recording) / 180);
  return score;
}

function shiftMeetingIdsFromShift(shift: FirebaseFirestore.DocumentData) {
  return Array.from(new Set([
    shift.target_meeting_id,
    shift.meeting_id,
    shift.zoom_meeting_id,
    shift.meetingId,
    shift.meetingID,
    shift.zoomId,
    shift.zoom_id,
    shift.target_zoom_id,
    shift.targetZoomId,
    shift.target_meeting_url,
    shift.start_url,
    shift.join_url,
    shift.url,
    shift.target_url,
  ].map(normalizeMeetingId).filter(Boolean)));
}

function recordingIdentity(recording: any) {
  const selectedFile = speakerViewFile(recording);
  return {
    meeting_uuid: String(recording.uuid || ''),
    file_id: String(selectedFile?.id || ''),
    recording_start: String(selectedFile?.recording_start || recording.start_time || ''),
  };
}

function findBestShiftFromDocs(recording: any, docs: ShiftCandidateDoc[]) {
  const meetingId = recordingMeetingId(recording);
  const targetDate = toJstDateKey(recording.start_time || speakerViewFile(recording)?.recording_start);
  if (!meetingId || !targetDate) return { targetDate, meetingId, best: null, candidates: [] as any[] };

  const candidates = docs
    .map(({ docSnap, data }) => ({ docSnap, data, score: scoreShiftForRecording(data, recording, meetingId, targetDate) }))
    .filter(item => item.score > 0)
    .sort((a, b) => b.score - a.score);

  const best = candidates[0] || null;
  return { targetDate, meetingId, best, candidates };
}

async function attachRecordingWithMatch(recording: any, source: string, match: ReturnType<typeof findBestShiftFromDocs>) {
  const selectedFile = speakerViewFile(recording);
  const shareUrl = recordingShareUrl(recording);

  if (!shareUrl || !selectedFile || !match.best) {
    return { ...match, updated: false, reason: !shareUrl ? 'no-recording-url' : !selectedFile ? 'no-video-file' : 'no-matching-shift' };
  }

  const candidate = recordingCandidatePayload(recording, source);
  const current = match.best.data || {};
  const currentDuration = Number(current.target_recording_duration_seconds || 0);
  const nextDuration = Number(candidate.duration_seconds || 0);
  const shouldReplace = current.recording_source === 'recording_replacement'
    ? false
    : (
      !current.target_recording_url ||
      nextDuration > currentDuration ||
      String(current.target_recording_file_id || '') === String(candidate.file_id || '')
    );

  const patch: Record<string, any> = {
    zoom_recording_candidates: [candidate, ...(Array.isArray(current.zoom_recording_candidates) ? current.zoom_recording_candidates : [])]
      .filter((item, index, list) => list.findIndex(other => other.file_id === item.file_id && other.meeting_uuid === item.meeting_uuid && other.recording_start === item.recording_start) === index)
      .slice(0, 10),
    recording_status: current.recording_status || 'pending_review',
    recording_last_match_score: match.best.score,
    recording_meeting_uuid: recording.uuid || current.recording_meeting_uuid || '',
    recording_updated_at: new Date().toISOString(),
  };

  if (shouldReplace) {
    const period = match.best ? periodFromShift(match.best.data) : '';
    const suggestedTrim = period ? suggestedTrimForPeriod(recording, period) : { start: 0, end: null as number | null };
    Object.assign(patch, {
      target_recording_url: shareUrl,
      target_recording_type: selectedFile?.recording_type || '',
      target_recording_file_id: selectedFile?.id || '',
      target_recording_duration_seconds: nextDuration,
      target_recording_trim_start_seconds: suggestedTrim.start,
      target_recording_trim_end_seconds: suggestedTrim.end,
      zoom_recording_files: Array.isArray(recording.recording_files) ? recording.recording_files : [],
      recording_status: 'pending_review',
      recording_source: source,
    });
  }

  await match.best.docSnap.ref.set(patch, { merge: true });
  return { ...match, updated: true, replacedPrimary: shouldReplace };
}

export function recordingCandidatePayload(recording: any, source: string) {
  const selectedFile = speakerViewFile(recording);
  const identity = recordingIdentity(recording);
  return {
    ...identity,
    url: recordingShareUrl(recording),
    recording_type: selectedFile?.recording_type || '',
    duration_seconds: recordingDurationSeconds(recording),
    source,
    received_at: new Date().toISOString(),
  };
}

export async function findBestShiftForRecording(recording: any) {
  const meetingId = recordingMeetingId(recording);
  const targetDate = toJstDateKey(recording.start_time || speakerViewFile(recording)?.recording_start);
  if (!meetingId || !targetDate) return { targetDate, meetingId, best: null, candidates: [] as any[] };

  const snap = await adminDb().collection('shift_assignments')
    .where('target_date', '==', targetDate)
    .limit(500)
    .get();

  return findBestShiftFromDocs(recording, snap.docs.map((docSnap: QueryDocumentSnapshot) => ({ docSnap, data: docSnap.data() })));
}

export async function attachRecordingToBestShift(recording: any, source: string) {
  const match = await findBestShiftForRecording(recording);
  if (!match.candidates.length) return attachRecordingWithMatch(recording, source, match);

  const results = [];
  for (const candidate of match.candidates) {
    results.push(await attachRecordingWithMatch(recording, source, {
      ...match,
      best: candidate,
      candidates: match.candidates,
    }));
  }
  return {
    ...results[0],
    updated_count: results.filter(result => result.updated).length,
  };
}

function uniqueDateKeys(recordings: any[]) {
  return Array.from(new Set(recordings
    .map(recording => toJstDateKey(recording.start_time || speakerViewFile(recording)?.recording_start))
    .filter(Boolean)));
}

function chunk<T>(items: T[], size: number) {
  const chunks: T[][] = [];
  for (let i = 0; i < items.length; i += size) chunks.push(items.slice(i, i + size));
  return chunks;
}

export async function attachRecordingsToBestShifts(recordings: any[], source: string) {
  const dates = uniqueDateKeys(recordings);
  const shiftsByDateAndMeeting = new Map<string, ShiftCandidateDoc[]>();

  for (const dateChunk of chunk(dates, 30)) {
    const snap = await adminDb().collection('shift_assignments')
      .where('target_date', 'in', dateChunk)
      .get();

    snap.docs.forEach((docSnap: QueryDocumentSnapshot) => {
      const data = docSnap.data();
      if (!isMainShift(data)) return;
      const date = targetDateFromShift(data);
      shiftMeetingIdsFromShift(data).forEach(meetingId => {
        const key = `${date}:${meetingId}`;
        const list = shiftsByDateAndMeeting.get(key) || [];
        list.push({ docSnap, data });
        shiftsByDateAndMeeting.set(key, list);
      });
    });
  }

  const results = [];
  for (const recording of recordings) {
    const meetingId = recordingMeetingId(recording);
    const targetDate = toJstDateKey(recording.start_time || speakerViewFile(recording)?.recording_start);
    const docs = meetingId && targetDate ? (shiftsByDateAndMeeting.get(`${targetDate}:${meetingId}`) || []) : [];
    const match = findBestShiftFromDocs(recording, docs);
    if (!match.candidates.length) {
      results.push(await attachRecordingWithMatch(recording, source, match));
      continue;
    }

    for (const candidate of match.candidates) {
      results.push(await attachRecordingWithMatch(recording, source, {
        ...match,
        best: candidate,
        candidates: match.candidates,
      }));
    }
  }

  return {
    results,
    prefetched_dates: dates.length,
    prefetched_shift_keys: shiftsByDateAndMeeting.size,
  };
}
