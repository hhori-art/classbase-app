import { NextRequest } from 'next/server';
import { FieldValue, Timestamp } from 'firebase-admin/firestore';
import { adminDb } from '@/lib/firebase-admin';
import { getServerUser, jsonError, requireScienceSocialStaff } from '@/lib/server-auth';
import { accessibleTeacherStudents, requireAccessibleStudent } from '@/lib/server/teacher-student-access';
import { getAllQueryDocuments } from '@/lib/server/firestore-pagination';
import { buildRecentParticipationWeeks } from '@/lib/student-weekly-participation';
import { attendanceState, learningCompleted, numericScore } from '@/lib/pf-analytics';
import { jstDateKey } from '@/lib/date-key';
import { normalizeCameraMonitorRule, type CameraLesson } from '@/lib/camera-time';
import {
  attentionBand, attentionScore, computeAttentionSignals, onboardingStatus, splitByResolution,
  type AttentionResolution, type AttentionSignalKey, type AttentionWeek,
} from '@/lib/student-attention';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

const STATE_COLLECTION = 'student_attention_state';
const ACTION_COLLECTION = 'student_attention_actions';
const INACTIVE_STATUSES = new Set(['withdrawn', 'archived', 'suspended', '解除', '退塾', '退会']);
const SIGNAL_KEYS = new Set<AttentionSignalKey>([
  'missed_streak', 'participation_drop', 'camera_off_streak', 'homework_low', 'monoxer_stalled',
  'quiz_low', 'quest_struggle', 'login_gap', 'ai_churn',
]);

const clean = (value: unknown) => String(value || '').normalize('NFKC').trim();
const chunk = <T,>(values: T[], size: number) => Array.from({ length: Math.ceil(values.length / size) }, (_, i) => values.slice(i * size, (i + 1) * size));
const toIso = (value: any): string | null => {
  if (!value) return null;
  if (typeof value?.toDate === 'function') return value.toDate().toISOString();
  const text = String(value);
  return text || null;
};
const dateOf = (value: any) => {
  if (typeof value?.toDate === 'function') return jstDateKey(value.toDate());
  return clean(value).slice(0, 10);
};
const isParticipation = (record: Record<string, any>) => {
  const status = clean(record.type || record.attendance_status || record.status).toLowerCase();
  return ['joined', 'present', '出席', '遅刻'].some(value => status.includes(value)) || attendanceState(record) === 'present' || attendanceState(record) === 'late';
};

export async function GET(request: NextRequest) {
  try {
    const user = await getServerUser(request);
    requireScienceSocialStaff(user);
    const db = adminDb();
    const today = jstDateKey();
    // 出欠は16週さかのぼって見る（長く来ていない生徒も拾うため）。画面には直近8週だけ出す。
    const weeks = buildRecentParticipationWeeks(today, 16);
    const fourWeeksAgo = weeks[weeks.length - 5].start_date;
    const questSince = Timestamp.fromMillis(Date.now() - 14 * 24 * 60 * 60 * 1000);

    const students = (await accessibleTeacherStudents(user)).filter(student => (
      !INACTIVE_STATUSES.has(clean(student.account_status).toLowerCase()) && student.is_active !== false
    ));
    const ids = students.map(student => student.id);
    const idSet = new Set(ids);

    // 授業のカメラは直近8週の記録を見る（続けてオフの判定）。
    const cameraSince = weeks[weeks.length - 9].start_date;
    const [attendanceDocs, learningDocs, questDocs, progressSnaps, stateSnaps, settingsSnap, cameraDocs, missionSnap] = await Promise.all([
      getAllQueryDocuments(db.collection('attendance').where('target_date', '>=', weeks[0].start_date)),
      getAllQueryDocuments(db.collection('pf_learning_records').where('date', '>=', fourWeeksAgo)),
      getAllQueryDocuments(db.collection('quest_question_attempts').where('created_at', '>=', questSince)),
      Promise.all(chunk(ids, 300).map(group => group.length ? db.getAll(...group.map(id => db.collection('pf_study_progress').doc(id))) : Promise.resolve([]))).then(groups => groups.flat()),
      Promise.all(chunk(ids, 300).map(group => group.length ? db.getAll(...group.map(id => db.collection(STATE_COLLECTION).doc(id))) : Promise.resolve([]))).then(groups => groups.flat()),
      db.collection('settings').doc('global').get(),
      getAllQueryDocuments(db.collection('camera_session_summaries').where('target_date', '>=', cameraSince)),
      db.collection('settings').doc('mission_control').get(),
    ]);
    const cameraRule = normalizeCameraMonitorRule(missionSnap.data()?.camera_monitor);
    // 旧システムからの移行が終わるまでは移行期間として判定する（settings/global.attention_transition を false にすると通常の判定）。
    const transition = settingsSnap.data()?.attention_transition !== false;

    // 週ごとの参加。学年のだれかが参加した週を「授業があった週」とする（休講週で誤って出さない）。
    const gradeOf = new Map(students.map(student => [student.id, clean(student.grade)]));
    const attendedWeeks = new Map<string, Set<string>>();
    const gradeWeeks = new Map<string, Set<string>>();
    const weekOf = (date: string) => weeks.find(week => date >= week.start_date && date <= week.end_date)?.key;
    attendanceDocs.forEach(doc => {
      const data = doc.data() || {};
      if (!isParticipation(data)) return;
      const studentId = clean(data.student_id || data.user_id);
      const week = weekOf(clean(data.target_date || data.date).slice(0, 10));
      if (!week) return;
      const grade = gradeOf.get(studentId);
      if (grade) {
        if (!gradeWeeks.has(grade)) gradeWeeks.set(grade, new Set());
        gradeWeeks.get(grade)!.add(week);
      }
      if (!idSet.has(studentId)) return;
      if (!attendedWeeks.has(studentId)) attendedWeeks.set(studentId, new Set());
      attendedWeeks.get(studentId)!.add(week);
    });

    const learningByStudent = new Map<string, any[]>();
    learningDocs.forEach(doc => {
      const data = doc.data() || {};
      const studentId = clean(data.student_id || data.user_id);
      if (!idSet.has(studentId)) return;
      if (!learningByStudent.has(studentId)) learningByStudent.set(studentId, []);
      learningByStudent.get(studentId)!.push(data);
    });

    const questByStudent = new Map<string, Array<{ unitId: string; unitName: string; correct: boolean; date: string; at: number }>>();
    questDocs.forEach(doc => {
      const data = doc.data() || {};
      const studentId = clean(data.student_id);
      if (!idSet.has(studentId)) return;
      if (!questByStudent.has(studentId)) questByStudent.set(studentId, []);
      questByStudent.get(studentId)!.push({
        unitId: clean(data.learning_unit_id),
        unitName: clean(data.unit_name),
        correct: data.is_correct === true,
        date: dateOf(data.created_at),
        at: typeof data.created_at?.toMillis === 'function' ? data.created_at.toMillis() : 0,
      });
    });

    const cameraByStudent = new Map<string, CameraLesson[]>();
    cameraDocs.forEach(doc => {
      const data = doc.data() || {};
      const studentId = clean(data.student_id);
      if (!idSet.has(studentId)) return;
      if (!cameraByStudent.has(studentId)) cameraByStudent.set(studentId, []);
      cameraByStudent.get(studentId)!.push({
        date: `${clean(data.target_date)}_${String(data.period ?? '')}`,
        camera_minutes: Number(data.camera_minutes || 0),
        present_minutes: Number(data.present_minutes || 0),
      });
    });
    cameraByStudent.forEach(lessons => lessons.sort((a, b) => a.date.localeCompare(b.date)));

    const progressById = new Map(progressSnaps.filter(snap => snap.exists).map(snap => [snap.id, snap.data() || {}]));
    const stateById = new Map(stateSnaps.filter(snap => snap.exists).map(snap => [snap.id, snap.data() || {}]));

    const all = students.map(student => {
      const grade = clean(student.grade);
      const activeFrom = student.course_start_month ? `${String(student.course_start_month).slice(0, 7)}-01` : '';
      const attended = attendedWeeks.get(student.id) || new Set<string>();
      const lessonWeeks = gradeWeeks.get(grade) || new Set<string>();
      const studentWeeks: AttentionWeek[] = weeks.map(week => ({
        start: week.start_date,
        end: week.end_date,
        current: week.is_current,
        attended: attended.has(week.key),
        expected: lessonWeeks.has(week.key) && (!activeFrom || week.end_date >= activeFrom),
      }));
      const learning = learningByStudent.get(student.id) || [];
      const progress = progressById.get(student.id);
      const state = stateById.get(student.id) || {};
      const signals = computeAttentionSignals({
        todayKey: today,
        weeks: studentWeeks,
        unreadQuestions: Number(student.teacher_chat_unread_count || 0) + Number(student.teacher_inquiry_unread_count || 0),
        homework: learning.filter(record => record.kind === 'homework').map(record => ({
          date: clean(record.date), completed: record.completed === true || learningCompleted(record.status),
        })),
        quizzes: learning.filter(record => record.kind === 'quiz').map(record => ({
          date: clean(record.date), completed: record.completed === true || learningCompleted(record.status), score: numericScore(record.score),
        })),
        monoxerHistory: (Array.isArray(progress?.history) ? progress!.history : [])
          .map((entry: any) => ({ date: clean(entry?.date), gained: entry?.gained === null || entry?.gained === undefined ? null : Number(entry.gained) }))
          .filter((entry: { date: string }) => entry.date)
          .sort((a: { date: string }, b: { date: string }) => a.date.localeCompare(b.date)),
        questAttempts: (questByStudent.get(student.id) || []).sort((a, b) => a.at - b.at),
        lastLogin: student.last_login ? toIso(student.last_login) : null,
        cameraLessons: (cameraByStudent.get(student.id) || []).map(lesson => ({ ...lesson, date: lesson.date.slice(0, 10) })),
        cameraRule,
        churnRisk: typeof student.churn_risk === 'number' ? student.churn_risk : null,
        riskAnalyzedAt: student.risk_analyzed_at ? String(student.risk_analyzed_at) : null,
        transition,
      });
      const resolutions = (state.resolutions || {}) as Partial<Record<AttentionSignalKey, AttentionResolution>>;
      const { open, handled } = splitByResolution(signals, resolutions);
      const lastAction = state.last_action ? {
        status: clean(state.last_action.status),
        note: clean(state.last_action.note),
        actor_name: clean(state.last_action.actor_name),
        at: toIso(state.last_action.at),
      } : null;
      return {
        id: student.id,
        student_name: clean(student.student_name || student.name) || '氏名未設定',
        grade,
        classroom: clean(student.classroom || student.school || student.school_id),
        band: attentionBand(open),
        score: attentionScore(open),
        signals: open,
        handled: handled.map(signal => ({
          key: signal.key, label: signal.label,
          status: signal.resolution.status, note: signal.resolution.note || '', actor_name: signal.resolution.actor_name || '', at: signal.resolution.at || null,
        })),
        weeks: studentWeeks.slice(-9).map(week => ({ start: week.start, current: week.current, expected: week.expected, attended: week.attended })),
        last_login: student.last_login ? toIso(student.last_login) : null,
        last_action: lastAction,
        onboarding: transition ? onboardingStatus(student.last_login ? toIso(student.last_login) : null, today) : null,
        ai: typeof student.churn_risk === 'number' ? { risk: student.churn_risk, reason: clean(student.risk_reason), action: clean(student.risk_action) } : null,
      };
    });
    const onboarding = all
      .filter(item => item.onboarding)
      .map(item => ({ id: item.id, student_name: item.student_name, grade: item.grade, classroom: item.classroom, status: item.onboarding, last_login: item.last_login }))
      .sort((a, b) => `${a.classroom}_${a.grade}_${a.student_name}`.localeCompare(`${b.classroom}_${b.grade}_${b.student_name}`, 'ja', { numeric: true }));
    const items = all.filter(item => item.band || item.handled.length)
      .sort((a, b) => b.score - a.score || a.student_name.localeCompare(b.student_name, 'ja'));

    return Response.json({ ok: true, today, transition, items, onboarding, student_count: students.length }, { headers: { 'Cache-Control': 'private, no-store' } });
  } catch (error) {
    return jsonError(error);
  }
}

/** 理由ごとに「声かけ済み」「様子を見る」を記録する。根拠が変わると、その理由は再び一覧に出る。 */
export async function POST(request: NextRequest) {
  try {
    const user = await getServerUser(request);
    requireScienceSocialStaff(user);
    const body = await request.json().catch(() => ({}));
    const studentId = clean(body.student_id);
    const status = body.status === 'watch' ? 'watch' : body.status === 'contacted' ? 'contacted' : '';
    const note = String(body.note || '').trim().slice(0, 500);
    const signals = (Array.isArray(body.signals) ? body.signals : [])
      .map((item: any) => ({ key: clean(item?.key) as AttentionSignalKey, fingerprint: clean(item?.fingerprint).slice(0, 300) }))
      .filter((item: { key: AttentionSignalKey; fingerprint: string }) => SIGNAL_KEYS.has(item.key) && item.fingerprint)
      .slice(0, 12);
    if (!studentId || !status || !signals.length) {
      return Response.json({ ok: false, error: 'student_id, status and signals are required' }, { status: 400 });
    }
    const student = await requireAccessibleStudent(user, studentId);

    const db = adminDb();
    const actorName = clean(user.profile.name || user.profile.display_name || user.profile.teacher_name);
    const now = new Date().toISOString();
    const resolutions: Record<string, AttentionResolution> = {};
    signals.forEach((signal: { key: AttentionSignalKey; fingerprint: string }) => {
      resolutions[signal.key] = { fingerprint: signal.fingerprint, status, note, actor_name: actorName, at: now };
    });
    const batch = db.batch();
    batch.set(db.collection(STATE_COLLECTION).doc(student.id), {
      student_id: student.id,
      resolutions,
      last_action: { status, note, actor_id: user.uid, actor_name: actorName, at: now, signals: signals.map((signal: { key: string }) => signal.key) },
      updated_at: FieldValue.serverTimestamp(),
    }, { merge: true });
    batch.set(db.collection(ACTION_COLLECTION).doc(), {
      student_id: student.id,
      status,
      note,
      signals,
      actor_id: user.uid,
      actor_role: user.role,
      actor_name: actorName,
      created_at: FieldValue.serverTimestamp(),
    });
    await batch.commit();
    return Response.json({ ok: true });
  } catch (error) {
    return jsonError(error);
  }
}
