import 'server-only';
import { FieldValue } from 'firebase-admin/firestore';
import { adminDb } from '@/lib/firebase-admin';
import { getZoomServerAccessToken } from '@/lib/zoom-meeting';
import { loadSchoolStaffRecipients, notifyStaff } from '@/lib/server/staff-recipients';
import {
  LANGUAGE_CATEGORY_LABELS,
  detectLanguage,
  effectiveLanguageRules,
  lessonTimeLabel,
  parseWebVtt,
  summarizeFindings,
  type LessonCue,
} from '@/lib/lesson-language';

/**
 * 授業の発言チェック（サーバー）。Zoom の録画の文字起こしを取り込み、言葉の一覧で確認して結果を残す。
 *  - 文字起こし全文：lesson_transcripts/{講師配置ID}（今後の授業評価に使う。サーバー専用）
 *  - チェック結果：lesson_transcript_checks/{講師配置ID}（見つかった発言・前後の発言・時刻。サーバー専用）
 * 重大な発言が見つかったら、マスターへ通知する。結果はマスターだけが管理画面で見る。
 */

export const TRANSCRIPTS_COLLECTION = 'lesson_transcripts';
export const CHECKS_COLLECTION = 'lesson_transcript_checks';
const RULES_DOCUMENT = 'lesson_language_rules';

const clean = (value: unknown) => String(value ?? '').trim();

/** 録画の区間に含まれる文字起こしのファイル（Zoom の audio_transcript）。 */
export function transcriptFileOf(recording: any) {
  const files = Array.isArray(recording?.recording_files) ? recording.recording_files : [];
  return files.find((file: any) => String(file?.file_type || '').toUpperCase() === 'TRANSCRIPT' && String(file?.status || 'completed').toLowerCase() === 'completed' && file?.download_url) || null;
}

export async function loadLanguageRuleSettings() {
  const snap = await adminDb().collection('settings').doc(RULES_DOCUMENT).get();
  return snap.exists ? snap.data() || {} : {};
}

/**
 * 文字起こしの時刻を、講師配置で再生する動画ファイルの時刻に合わせるずれ（秒）。
 * 同じ区間のファイルは開始がほぼ同じだが、数秒ずれることがあるので合わせておく。
 */
export function videoOffsetSeconds(shift: Record<string, any>, transcriptRecordingStart: unknown) {
  const files = Array.isArray(shift.zoom_recording_files) ? shift.zoom_recording_files : [];
  const videoId = clean(shift.target_recording_file_id);
  const video = files.find((file: any) => clean(file?.id) === videoId);
  const transcriptStart = Date.parse(clean(transcriptRecordingStart));
  const videoStart = Date.parse(clean(video?.recording_start));
  if (!Number.isFinite(transcriptStart) || !Number.isFinite(videoStart)) return 0;
  const offset = Math.round((transcriptStart - videoStart) / 1000);
  // 別の区間の動画に付け替わっているときは合わせられないので、ずれなしとする。
  return Math.abs(offset) <= 120 ? offset : 0;
}

async function downloadTranscript(downloadUrl: string) {
  const token = await getZoomServerAccessToken();
  const response = await fetch(downloadUrl, { headers: { Authorization: `Bearer ${token}` }, signal: AbortSignal.timeout(20_000) });
  if (!response.ok) throw new Error(`transcript-download-failed:${response.status}`);
  const text = await response.text();
  if (text.length > 2_000_000) throw new Error('transcript-too-large');
  return text;
}

/** 文字起こしを確認して結果を保存する。cues を渡したとき（再チェック）はダウンロードしない。 */
export async function checkLessonTranscript(input: {
  shiftId: string;
  shift: Record<string, any>;
  file?: any;
  cues?: LessonCue[];
  /** cues を渡すとき、その文字起こしの録画開始時刻（動画の時刻に合わせるため）。 */
  transcriptRecordingStart?: unknown;
  rulesSettings?: Record<string, any>;
  notify?: boolean;
}) {
  const db = adminDb();
  let cues = input.cues;
  let transcriptRecordingStart: unknown = input.transcriptRecordingStart;
  if (!cues) {
    if (!input.file?.download_url) return { checked: false, reason: 'no-transcript' as const };
    cues = parseWebVtt(await downloadTranscript(String(input.file.download_url)));
    transcriptRecordingStart = input.file.recording_start;
    await db.collection(TRANSCRIPTS_COLLECTION).doc(input.shiftId).set({
      shift_id: input.shiftId,
      target_date: clean(input.shift.target_date),
      file_id: clean(input.file.id),
      recording_start: clean(input.file.recording_start),
      cues: cues.map(cue => ({ s: Math.round(cue.start), e: Math.round(cue.end), sp: cue.speaker.slice(0, 60), t: cue.text.slice(0, 500) })),
      updated_at: FieldValue.serverTimestamp(),
      // 文字起こしは授業評価のために1年残す（Firestore の TTL を expires_at に設定すると消える）。
      expires_at: new Date(Date.now() + 365 * 24 * 60 * 60 * 1000),
    });
  }
  const rules = effectiveLanguageRules(input.rulesSettings ?? await loadLanguageRuleSettings());
  const findings = detectLanguage(cues, rules).slice(0, 200);
  const summary = summarizeFindings(findings);
  const shift = input.shift;
  await db.collection(CHECKS_COLLECTION).doc(input.shiftId).set({
    shift_id: input.shiftId,
    target_date: clean(shift.target_date),
    period: clean(shift.period || shift.target_period || shift.note).slice(0, 20),
    teacher_id: clean(shift.user_id || shift.teacher_id),
    teacher_name: clean(shift.teacher_name),
    grade: clean(shift.target_grade),
    subject: clean(shift.target_subject),
    detail_subject: clean(shift.target_detail_subject),
    unit: clean(shift.unit),
    cue_count: cues.length,
    // 録画で発言の時刻へ飛ぶときに足す秒数（文字起こしと動画ファイルの開始のずれ）。
    video_offset_seconds: videoOffsetSeconds(shift, transcriptRecordingStart),
    findings,
    ...summary,
    checked_at: FieldValue.serverTimestamp(),
    // 確認済みの印は再チェックでも消さない（review_status は管理画面で付ける）。
  }, { merge: true });

  // 重大な発言が見つかったら、マスターへ知らせる（同じ授業では1回だけ。IDを固定）。
  const high = findings.filter(finding => finding.severity === 'high');
  if (input.notify !== false && high.length) {
    const masters = (await loadSchoolStaffRecipients(null)).filter(item => item.isMaster);
    const classLabel = [shift.target_grade, shift.target_subject, shift.target_detail_subject].map(clean).filter(Boolean).join(' ');
    await notifyStaff(masters, {
      idPrefix: `lesson_language_${input.shiftId}`,
      title: `授業の発言チェック：重大 ${high.length}件（${clean(shift.teacher_name) || '講師'}）`,
      message: [
        `${clean(shift.target_date)} ${classLabel} の授業の文字起こしで、保護者が聞くと問題になりうる発言が見つかりました。録画で前後を確認してください。`,
        ...high.slice(0, 5).map(finding => `・${lessonTimeLabel(finding.time)} ${LANGUAGE_CATEGORY_LABELS[finding.category]}「${finding.label}」：${finding.text.slice(0, 60)}`),
      ].join('\n'),
      kind: 'lesson_language',
      masterLink: `/master/lesson-language?shift=${encodeURIComponent(input.shiftId)}`,
      pushBody: '授業の発言チェックで、確認が必要な発言が見つかりました。',
    });
  }
  return { checked: true, findings: findings.length, high: high.length };
}

/** 録画を講師配置に付けたときに呼ぶ。同じ文字起こしファイルは二度確認しない。失敗しても録画の処理は止めない。 */
export async function checkTranscriptForAttachedRecording(input: { shiftRef: FirebaseFirestore.DocumentReference; shift: Record<string, any>; recording: any }) {
  const file = transcriptFileOf(input.recording);
  if (!file) return { checked: false, reason: 'no-transcript' as const };
  if (clean(input.shift.transcript_check_file_id) === clean(file.id)) return { checked: false, reason: 'already-checked' as const };
  const result = await checkLessonTranscript({ shiftId: input.shiftRef.id, shift: input.shift, file });
  await input.shiftRef.set({ transcript_check_file_id: clean(file.id), transcript_checked_at: FieldValue.serverTimestamp() }, { merge: true });
  return result;
}
