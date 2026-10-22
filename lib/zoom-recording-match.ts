import type { QueryDocumentSnapshot } from 'firebase-admin/firestore';
import { adminDb } from '@/lib/firebase-admin';
import { autoPublishShiftRecording } from '@/lib/server/recording-auto-publish';
import { checkTranscriptForAttachedRecording, transcriptFileOf } from '@/lib/server/lesson-transcript-check';
import { MIN_MEETING_MINUTES, MIN_RECORDING_MINUTES, meetingExcessMinutes, meetingTrimOptions } from '@/lib/recording-publish-rules';

const transcriptFileId = (recording: any) => String(transcriptFileOf(recording)?.id || '');

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

export const periodFromShift = (shift: FirebaseFirestore.DocumentData) => (
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
    meeting_id: recordingMeetingId(recording),
    meeting_uuid: String(recording.uuid || ''),
    file_id: String(selectedFile?.id || ''),
    recording_start: String(selectedFile?.recording_start || recording.start_time || ''),
  };
}

export function findBestShiftFromDocs(recording: any, docs: ShiftCandidateDoc[]) {
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

type AttachOptions = {
  role: 'primary' | 'candidate';
  meeting: 'before' | 'after' | null;
  isMeetingSegment: boolean;
  /** 集会の区間が、その講師配置の授業の前か後か（管理画面で「グループミーティング」として公開するときに使う）。 */
  meetingPosition?: 'before' | 'after';
};

async function attachRecordingWithMatch(
  recording: any,
  source: string,
  match: ReturnType<typeof findBestShiftFromDocs>,
  options: AttachOptions = { role: 'primary', meeting: null, isMeetingSegment: false },
) {
  const selectedFile = speakerViewFile(recording);
  const shareUrl = recordingShareUrl(recording);

  if (!shareUrl || !selectedFile || !match.best) {
    return { ...match, updated: false, reason: !shareUrl ? 'no-recording-url' : !selectedFile ? 'no-video-file' : 'no-matching-shift' };
  }

  const candidate = {
    ...recordingCandidatePayload(recording, source),
    ...(options.isMeetingSegment ? { kind: 'group_meeting', ...(options.meetingPosition ? { meeting_position: options.meetingPosition } : {}) } : {}),
  };
  const current = match.best.data || {};
  const currentDuration = Number(current.target_recording_duration_seconds || 0);
  const nextDuration = Number(candidate.duration_seconds || 0);
  // 集会（グループミーティング）の録画や、別の録画のほうが授業に合う区間は候補として残すだけにする。
  const shouldReplace = options.role !== 'primary' || current.recording_source === 'recording_replacement'
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
    recording_updated_at: new Date().toISOString(),
  };
  // 候補として残すだけの区間は、授業の録画の状態（公開・保留など）を変えない。
  if (options.role === 'primary') {
    Object.assign(patch, {
      recording_status: current.recording_status || 'pending_review',
      recording_last_match_score: match.best.score,
      recording_meeting_uuid: recording.uuid || current.recording_meeting_uuid || '',
    });
  }

  if (shouldReplace) {
    const period = match.best ? periodFromShift(match.best.data) : '';
    // 授業の前の集会が別の録画にあるときは授業が遅れて始まり遅れて終わるので、授業の録画は切り取らずに使う。
    const suggestedTrim = options.meeting === 'before'
      ? { start: 0, end: null as number | null }
      : period ? suggestedTrimForPeriod(recording, period) : { start: 0, end: null as number | null };
    const { startMinutes, endMinutes } = recordingTimeRange(recording);
    const trimOptions = period && !options.meeting && startMinutes != null && endMinutes != null && meetingExcessMinutes(startMinutes, endMinutes, period) > 0
      ? meetingTrimOptions(startMinutes, endMinutes, period)
      : null;
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
      recording_group_meeting: options.meeting,
      recording_meeting_trim_options: trimOptions,
    });
  }

  await match.best.docSnap.ref.set(patch, { merge: true });
  // 講師配置の主録画になったときだけ、不具合を確認して自動で生徒へ公開する。
  const autoPublish = shouldReplace
    ? await autoPublishShiftRecording({
      shiftRef: match.best.docSnap.ref,
      shift: { ...current, ...patch },
      period: periodFromShift(match.best.data),
      recording,
      meetingBefore: options.meeting === 'before',
    })
    : null;
  return { ...match, updated: true, replacedPrimary: shouldReplace, autoPublish, patch };
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

/**
 * Zoomでは1つの会議の録画に、1限・2限など録画を止めて再開した区間が別ファイルとして入る。
 * 区間（開始時刻がほぼ同じファイルの組）ごとに1つの録画として扱い、それぞれの時限の講師配置に照合する。
 */
export function splitRecordingBySegment(recording: any): any[] {
  const files = Array.isArray(recording?.recording_files) ? recording.recording_files : [];
  const startOf = (file: any) => Date.parse(String(file?.recording_start || ''));
  const starts = Array.from(new Set(files.map(startOf).filter(Number.isFinite) as number[])).sort((a, b) => a - b);
  const clusters: number[] = [];
  starts.forEach(start => {
    if (clusters.length === 0 || start - clusters[clusters.length - 1] > 60 * 1000) clusters.push(start);
  });
  if (clusters.length <= 1) return [recording];
  return clusters.map((clusterStart, index) => {
    const next = clusters[index + 1] ?? Number.POSITIVE_INFINITY;
    const segmentFiles = files.filter((file: any) => {
      const start = startOf(file);
      return Number.isFinite(start) && start >= clusterStart && start < next;
    });
    const ends = segmentFiles.map((file: any) => Date.parse(String(file.recording_end || ''))).filter(Number.isFinite) as number[];
    const end = ends.length ? Math.max(...ends) : clusterStart;
    return {
      ...recording,
      start_time: new Date(clusterStart).toISOString(),
      end_time: new Date(end).toISOString(),
      duration: Math.round((end - clusterStart) / 60000),
      recording_files: segmentFiles,
    };
  });
}

const segmentMinutes = (segment: any) => {
  const { startMinutes, endMinutes } = recordingTimeRange(segment);
  return startMinutes == null || endMinutes == null ? 0 : Math.max(0, endMinutes - startMinutes);
};

/** 集会（グループミーティング）と授業の録画が分かれているときに、前後を判断する余裕（分）。 */
const MEETING_GAP_MINUTES = 15;

/**
 * 短い区間（3分以上・授業の録画の最短時間より短い）で、授業の長さの区間の直前・直後にあるものは
 * 集会（グループミーティング・20分程度）の録画とみなす。
 */
export function groupMeetingSegments(segments: any[]) {
  const ranges = segments.map(segment => ({ segment, ...recordingTimeRange(segment), minutes: segmentMinutes(segment) }));
  const lessons = ranges.filter(range => range.minutes >= MIN_RECORDING_MINUTES && range.startMinutes != null && range.endMinutes != null);
  return new Set(ranges.filter(range => range.minutes >= MIN_MEETING_MINUTES && range.minutes < MIN_RECORDING_MINUTES && range.startMinutes != null && range.endMinutes != null && lessons.some(lesson => (
    (range.endMinutes! <= lesson.startMinutes! + 2 && range.endMinutes! >= lesson.startMinutes! - MEETING_GAP_MINUTES) ||
    (range.startMinutes! >= lesson.endMinutes! - 2 && range.startMinutes! <= lesson.endMinutes! + MEETING_GAP_MINUTES)
  ))).map(range => range.segment));
}

type SegmentMatch = { segment: any; match: ReturnType<typeof findBestShiftFromDocs> };

/** 区間ごとに読み込むと同じ講師配置が別のオブジェクトになるため、ドキュメントのパスで同じ講師配置とみなす。 */
const shiftKey = (docSnap: any) => String(docSnap?.ref?.path || docSnap?.id || '');
export type RecordingAttachmentPlan = SegmentMatch & {
  candidate: ReturnType<typeof findBestShiftFromDocs>['candidates'][number] | null;
  options: AttachOptions;
};

/**
 * 1つの会議の録画（区間ごとに分けたもの）を、どの講師配置の授業の録画にするかを決める。
 * - 講師配置ごとに、時限と一番重なる区間（同じなら長い区間）を授業の録画にする。
 * - 集会（グループミーティング）の区間は授業の録画にせず候補として残す。
 * - 授業の録画の直前・直後に集会の区間があれば、その前後を記録する（前なら授業が遅れて始まる）。
 */
export function planRecordingAttachments(entries: SegmentMatch[]): RecordingAttachmentPlan[] {
  const meetings = groupMeetingSegments(entries.map(entry => entry.segment));
  const plans: RecordingAttachmentPlan[] = [];
  const byShift = new Map<string, RecordingAttachmentPlan[]>();
  entries.forEach(({ segment, match }) => {
    const isMeetingSegment = meetings.has(segment);
    if (!match.candidates.length) {
      plans.push({ segment, match, candidate: null, options: { role: 'candidate', meeting: null, isMeetingSegment } });
      return;
    }
    periodCandidates(segment, match).forEach(candidate => {
      const plan: RecordingAttachmentPlan = { segment, match, candidate, options: { role: 'candidate', meeting: null, isMeetingSegment } };
      plans.push(plan);
      byShift.set(shiftKey(candidate.docSnap), [...(byShift.get(shiftKey(candidate.docSnap)) || []), plan]);
    });
  });
  byShift.forEach(shiftPlans => {
    const period = periodFromShift(shiftPlans[0].candidate!.data);
    const lessonPlans = shiftPlans.filter(plan => !plan.options.isMeetingSegment);
    const ranked = [...lessonPlans].sort((a, b) => (
      (period ? periodOverlapMinutes(b.segment, period) - periodOverlapMinutes(a.segment, period) : 0) ||
      segmentMinutes(b.segment) - segmentMinutes(a.segment) ||
      b.candidate!.score - a.candidate!.score
    ));
    const main = ranked[0];
    if (!main) return;
    main.options.role = 'primary';
    const { startMinutes, endMinutes } = recordingTimeRange(main.segment);
    if (startMinutes == null || endMinutes == null) return;
    // この講師配置に付いた集会の区間に、授業の前か後かを付ける。
    shiftPlans.filter(plan => plan.options.isMeetingSegment).forEach(plan => {
      const range = recordingTimeRange(plan.segment);
      plan.options = { ...plan.options, meetingPosition: range.startMinutes != null && range.startMinutes < startMinutes ? 'before' : 'after' };
    });
    const meetingRanges = Array.from(meetings).map(segment => recordingTimeRange(segment));
    const before = meetingRanges.some(range => range.endMinutes != null && range.endMinutes <= startMinutes + 2 && range.endMinutes >= startMinutes - MEETING_GAP_MINUTES);
    const after = meetingRanges.some(range => range.startMinutes != null && range.startMinutes >= endMinutes - 2 && range.startMinutes <= endMinutes + MEETING_GAP_MINUTES);
    main.options.meeting = before ? 'before' : after ? 'after' : null;
  });
  return plans;
}

/** 区間の時間が講師配置の時限と15分以上重なる候補を優先する（別の時限の講師配置に付けないため）。 */
function periodCandidates(recording: any, match: ReturnType<typeof findBestShiftFromDocs>) {
  const overlapping = match.candidates.filter(candidate => {
    const period = periodFromShift(candidate.data);
    return period && periodOverlapMinutes(recording, period) >= 15;
  });
  return overlapping.length > 0 ? overlapping : match.candidates;
}

/** 一括の取り込み（日次同期・管理画面の取得）で1回に確認する文字起こしの上限。残りは次回の同期か Zoom の通知で確認する。 */
const TRANSCRIPT_CHECKS_PER_SYNC = 25;

async function attachPlans(plans: RecordingAttachmentPlan[], source: string, transcriptBudget?: { remaining: number }) {
  const results = [];
  // 授業の録画にする区間を先に処理し、候補だけの区間はそのあとに足す。
  const ordered = [...plans].sort((a, b) => Number(b.options.role === 'primary') - Number(a.options.role === 'primary'));
  // 同じ講師配置に続けて書くとき、前に書いた内容（候補の一覧など）を消さないよう最新の内容を使う。
  const latest = new Map<string, FirebaseFirestore.DocumentData>();
  for (const plan of ordered) {
    const best = plan.candidate ? { ...plan.candidate, data: latest.get(shiftKey(plan.candidate.docSnap)) || plan.candidate.data } : null;
    const match = best ? { ...plan.match, best } : plan.match;
    const result = await attachRecordingWithMatch(plan.segment, source, match, plan.options);
    if (best && 'patch' in result && result.patch) latest.set(shiftKey(best.docSnap), { ...best.data, ...result.patch });
    // 授業の録画にした区間に文字起こしがあれば、授業の発言チェックをする（失敗しても録画の処理は止めない）。
    if (best && plan.options.role === 'primary' && result.updated && (!transcriptBudget || transcriptBudget.remaining > 0)) {
      const transcript = await checkTranscriptForAttachedRecording({
        shiftRef: best.docSnap.ref,
        shift: latest.get(shiftKey(best.docSnap)) || best.data,
        recording: plan.segment,
      }).catch(error => {
        console.warn('[lesson-language] transcript check failed', best.docSnap.ref?.id, error?.message);
        return null;
      });
      if (transcript?.checked && transcriptBudget) transcriptBudget.remaining -= 1;
      if (transcript?.checked) latest.set(shiftKey(best.docSnap), { ...(latest.get(shiftKey(best.docSnap)) || best.data), transcript_check_file_id: String(transcriptFileId(plan.segment)) });
    }
    results.push(result);
  }
  return results;
}

export async function attachRecordingToBestShift(recording: any, source: string) {
  const entries: SegmentMatch[] = [];
  for (const segment of splitRecordingBySegment(recording)) {
    entries.push({ segment, match: await findBestShiftForRecording(segment) });
  }
  const results = await attachPlans(planRecordingAttachments(entries), source);
  return {
    ...(results.find(result => result.updated) || results[0]),
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
  const transcriptBudget = { remaining: TRANSCRIPT_CHECKS_PER_SYNC };
  for (const meeting of recordings) {
    const entries = splitRecordingBySegment(meeting).map(segment => {
      const meetingId = recordingMeetingId(segment);
      const targetDate = toJstDateKey(segment.start_time || speakerViewFile(segment)?.recording_start);
      const docs = meetingId && targetDate ? (shiftsByDateAndMeeting.get(`${targetDate}:${meetingId}`) || []) : [];
      return { segment, match: findBestShiftFromDocs(segment, docs) };
    });
    results.push(...await attachPlans(planRecordingAttachments(entries), source, transcriptBudget));
  }

  return {
    results,
    prefetched_dates: dates.length,
    prefetched_shift_keys: shiftsByDateAndMeeting.size,
  };
}
