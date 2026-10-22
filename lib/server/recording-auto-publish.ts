import 'server-only';

import { adminDb } from '@/lib/firebase-admin';
import { getRecordingYearScope, normalizeRecordingType, normalizeSchoolYear, recordingTypeLabel } from '@/lib/recordings';
import { inspectRecordingForShift, speakerViewFilesForPeriod, type RecordingIssue } from '@/lib/recording-publish-rules';

export type AutoPublishResult =
  | { published: true; recording_id: string }
  | { published: false; reason: 'stopped-by-admin' | 'issues' | 'kept-existing'; issues?: RecordingIssue[] };

const shiftTitle = (shift: FirebaseFirestore.DocumentData) =>
  `${shift.target_detail_subject || ''} ${shift.unit || ''}`.trim() || `${shift.target_subject || '授業'}の授業`;

/**
 * 講師配置に紐づいたZoom録画を、不具合がなければ自動で生徒へ公開する。
 * - 管理者が停止した講師配置（recording_publish_mode=stopped）は再公開しない。
 * - 不具合があれば公開せず、講師配置に recording_status=blocked と理由を残す。
 * - 手動承認・差し替え・停止中の公開データがある場合は上書きしない。
 */
export async function autoPublishShiftRecording(input: {
  shiftRef: FirebaseFirestore.DocumentReference;
  shift: FirebaseFirestore.DocumentData;
  period: string;
  recording: any;
  /** 授業の前の集会（グループミーティング）が別の録画にある。授業は遅れて始まる。 */
  meetingBefore?: boolean;
}): Promise<AutoPublishResult> {
  const { shiftRef, shift, period, recording } = input;
  const now = new Date().toISOString();
  if (shift.recording_publish_mode === 'stopped') return { published: false, reason: 'stopped-by-admin' };

  const issues = inspectRecordingForShift(recording, {
    period,
    shiftEmail: String(shift.target_signin_address || shift.signin_address || ''),
    meetingBefore: input.meetingBefore,
  });
  if (issues.length > 0) {
    await shiftRef.set({ recording_status: 'blocked', recording_issues: issues, recording_checked_at: now }, { merge: true });
    return { published: false, reason: 'issues', issues };
  }

  const db = adminDb();
  const existing = await db.collection('class_recordings').where('original_shift_id', '==', shiftRef.id).limit(10).get();
  const kept = existing.docs.find(snap => {
    const data = snap.data() || {};
    return data.source !== 'zoom_auto' || data.status === 'stopped' || data.is_replacement === true;
  });
  if (kept) {
    await shiftRef.set({
      recording_status: kept.data()?.status === 'stopped' ? 'stopped' : 'published',
      recording_issues: [],
      published_recording_id: kept.id,
      recording_checked_at: now,
    }, { merge: true });
    return { published: false, reason: 'kept-existing' };
  }

  const file = speakerViewFilesForPeriod(recording, period)[0];
  const ref = existing.docs[0]?.ref || db.collection('class_recordings').doc(`auto_${shiftRef.id}`);
  const targetDate = String(shift.target_date || '').slice(0, 10);
  const schoolYear = normalizeSchoolYear(targetDate);
  const recordingType = normalizeRecordingType(shift.recording_type || shift.lesson_type || shift.course_type || '');
  const startMs = Date.parse(String(file.recording_start || recording.start_time || ''));
  const endMs = Date.parse(String(file.recording_end || recording.end_time || ''));
  await ref.set({
    original_shift_id: shiftRef.id,
    target_date: targetDate,
    grade: shift.target_grade || 'その他',
    subject: shift.target_subject || '全科目',
    detail_subject: shift.target_detail_subject || '',
    unit: shift.unit || '',
    teacher_name: shift.teacher_name || '',
    title: shiftTitle(shift),
    period,
    video_url: String(file.play_url || recording.share_url || '').trim(),
    recording_type: recordingType,
    recording_type_label: recordingTypeLabel(recordingType),
    school_year: schoolYear,
    year_scope: getRecordingYearScope(schoolYear),
    zoom_recording_file_id: String(file.id || ''),
    target_recording_file_id: String(file.id || ''),
    target_recording_type: String(file.recording_type || ''),
    zoom_recording_files: Array.isArray(recording.recording_files) ? recording.recording_files : [],
    recording_meeting_id: String(shift.target_meeting_id || ''),
    recording_duration_seconds: Number.isFinite(startMs) && Number.isFinite(endMs) ? Math.max(0, Math.round((endMs - startMs) / 1000)) : 0,
    trim_start_seconds: Number(shift.target_recording_trim_start_seconds || 0),
    trim_end_seconds: shift.target_recording_trim_end_seconds ? Number(shift.target_recording_trim_end_seconds) : null,
    source: 'zoom_auto',
    status: 'published',
    auto_published_at: now,
    ...(existing.docs[0] ? {} : { created_at: now }),
    updated_at: now,
  }, { merge: true });
  await shiftRef.set({ recording_status: 'published', recording_issues: [], published_recording_id: ref.id, recording_checked_at: now }, { merge: true });
  return { published: true, recording_id: ref.id };
}
