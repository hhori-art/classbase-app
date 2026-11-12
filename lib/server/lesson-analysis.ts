import 'server-only';
import { FieldValue } from 'firebase-admin/firestore';
import { adminDb } from '@/lib/firebase-admin';
import { jstDateKey } from '@/lib/date-key';
import { isCameraOffLesson, normalizeCameraMonitorRule } from '@/lib/camera-time';
import {
  analyzeTranscript, evaluateLesson, lessonEvents, normalizeLessonAnalysisRules, normalizeRubric, overallScore,
  type AnalysisCue, type LessonCameraInput,
} from '@/lib/lesson-analysis';
import { CHECKS_COLLECTION, TRANSCRIPTS_COLLECTION } from '@/lib/server/lesson-transcript-check';

/**
 * 授業の振り返り（サーバー）。保存済みの文字起こし（lesson_transcripts）と、授業のカメラON率（camera_session_summaries）から作り、
 * lesson_analyses/{講師配置ID} に置く。AI は使わない。見られるのは理社講座の管理者（API 経由）。
 * 毎晩、カメラの記録（22:50）のあとに、その日の授業を作り直す（Vercel Cron）。管理画面からも作り直せる。
 */

export const ANALYSES_COLLECTION = 'lesson_analyses';
export const ANALYSIS_SETTINGS_DOCUMENT = 'lesson_analysis';
const clean = (value: unknown) => String(value ?? '').trim();

export async function loadLessonAnalysisSettings() {
  const snap = await adminDb().collection('settings').doc(ANALYSIS_SETTINGS_DOCUMENT).get();
  const data = snap.exists ? snap.data() || {} : {};
  return {
    rules: normalizeLessonAnalysisRules(data.rules),
    rubric: normalizeRubric(data.rubric),
    disabled_teacher_ids: Array.isArray(data.disabled_teacher_ids) ? data.disabled_teacher_ids.map(clean).filter(Boolean) : [] as string[],
  };
}

type Settings = Awaited<ReturnType<typeof loadLessonAnalysisSettings>>;

export async function analyzeShiftLesson(shiftId: string, options: { settings?: Settings; cameraRule?: ReturnType<typeof normalizeCameraMonitorRule> } = {}) {
  const db = adminDb();
  const settings = options.settings || await loadLessonAnalysisSettings();
  const [shiftSnap, transcriptSnap, checkSnap, cameraSnap, missionSnap] = await Promise.all([
    db.collection('shift_assignments').doc(shiftId).get(),
    db.collection(TRANSCRIPTS_COLLECTION).doc(shiftId).get(),
    db.collection(CHECKS_COLLECTION).doc(shiftId).get(),
    db.collection('camera_session_summaries').where('shift_id', '==', shiftId).limit(300).get(),
    options.cameraRule ? Promise.resolve(null) : db.collection('settings').doc('mission_control').get(),
  ]);
  const shift = shiftSnap.data() || {};
  const ref = db.collection(ANALYSES_COLLECTION).doc(shiftId);
  const base = {
    shift_id: shiftId,
    target_date: clean(shift.target_date || transcriptSnap.data()?.target_date),
    period: clean(shift.period || shift.target_period || checkSnap.data()?.period).slice(0, 20),
    teacher_id: clean(shift.user_id || shift.teacher_id),
    teacher_name: clean(shift.teacher_name),
    grade: clean(shift.target_grade),
    subject: clean(shift.target_subject),
    detail_subject: clean(shift.target_detail_subject),
    unit: clean(shift.unit),
    video_offset_seconds: Number(checkSnap.data()?.video_offset_seconds || 0),
    analyzed_at: FieldValue.serverTimestamp(),
  };
  if (base.teacher_id && settings.disabled_teacher_ids.includes(base.teacher_id)) {
    await ref.set({ ...base, status: 'skipped', reason: 'teacher-disabled' }, { merge: false });
    return { shiftId, status: 'skipped' as const };
  }
  const cues: AnalysisCue[] = (Array.isArray(transcriptSnap.data()?.cues) ? transcriptSnap.data()!.cues : [])
    .map((cue: any) => ({ start: Number(cue?.s), end: Number(cue?.e), speaker: clean(cue?.sp), text: clean(cue?.t) }))
    .filter((cue: AnalysisCue) => Number.isFinite(cue.start) && cue.text);
  if (!cues.length) {
    await ref.set({ ...base, status: 'skipped', reason: 'no-transcript' }, { merge: false });
    return { shiftId, status: 'skipped' as const };
  }
  try {
    const cameraRule = options.cameraRule || normalizeCameraMonitorRule(missionSnap?.data()?.camera_monitor);
    const records = cameraSnap.docs.map(doc => doc.data() || {}).map(data => ({
      date: clean(data.target_date), camera_minutes: Number(data.camera_minutes || 0), present_minutes: Number(data.present_minutes || 0),
    })).filter(record => record.present_minutes >= cameraRule.min_present_minutes);
    const camera: LessonCameraInput | null = records.length ? {
      students: records.length,
      camera_minutes: records.reduce((sum, record) => sum + Math.min(record.camera_minutes, record.present_minutes), 0),
      present_minutes: records.reduce((sum, record) => sum + record.present_minutes, 0),
      off_students: records.filter(record => isCameraOffLesson(record, cameraRule)).length,
    } : null;
    const duration = Number(shift.target_recording_duration_seconds || 0) || undefined;
    const transcript = analyzeTranscript({ cues, rules: settings.rules, teacherNames: [base.teacher_name].filter(Boolean), durationSec: duration });
    const evaluation = evaluateLesson({ transcript, camera, rules: settings.rules, rubric: settings.rubric });
    await ref.set({
      ...base,
      status: 'done',
      reason: '',
      duration_sec: transcript.duration_sec,
      teacher_detection: transcript.teacher_detection,
      speaker_count: transcript.speaker_count,
      student_count: transcript.student_aliases.length,
      metrics: transcript.summary,
      camera: camera ? { ...camera, rate: camera.present_minutes ? Math.round((camera.camera_minutes / camera.present_minutes) * 100) : null } : null,
      series: transcript.series,
      events: lessonEvents(transcript).slice(0, 300),
      evaluation,
      levels: Object.fromEntries(evaluation.scores.map(score => [score.criterion, score.level])),
      overall_score: overallScore(Object.fromEntries(evaluation.scores.map(score => [score.criterion, score.level]))),
    }, { merge: false });
    return { shiftId, status: 'done' as const };
  } catch (error) {
    // 本文や名前は残さず、理由だけ残す
    await ref.set({ ...base, status: 'failed', reason: clean((error as Error)?.message).slice(0, 120) || 'failed' }, { merge: false });
    return { shiftId, status: 'failed' as const };
  }
}

/** その日に文字起こしがある授業を、まとめて作り直す。 */
export async function runLessonAnalyses(options: { date?: string } = {}) {
  const date = options.date || jstDateKey();
  const db = adminDb();
  const [snap, settings, missionSnap] = await Promise.all([
    db.collection(TRANSCRIPTS_COLLECTION).where('target_date', '==', date).select('target_date').limit(200).get(),
    loadLessonAnalysisSettings(),
    db.collection('settings').doc('mission_control').get(),
  ]);
  const cameraRule = normalizeCameraMonitorRule(missionSnap.data()?.camera_monitor);
  const counts = { done: 0, skipped: 0, failed: 0 };
  for (const doc of snap.docs) {
    const result = await analyzeShiftLesson(doc.id, { settings, cameraRule });
    counts[result.status] += 1;
  }
  return { date, lessons: snap.size, ...counts };
}
