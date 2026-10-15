import { randomUUID } from 'node:crypto';
import { NextRequest } from 'next/server';
import { FieldValue } from 'firebase-admin/firestore';
import { adminDb } from '@/lib/firebase-admin';
import { canViewSchoolStudents, getServerUser, isAdminLike, jsonError } from '@/lib/server-auth';
import { ONLINE_SCHOOL_SUBJECT_IDS, type ManualProblemInput } from '@/lib/online-school/types';
import { categorySummary, japanDate, progressFromData, progressId } from '@/lib/online-school/server';
import { unstable_cache } from 'next/cache';

const loadOnlineSchoolStudentRoster = unstable_cache(async () => {
  const snap = await adminDb().collection('users').where('role', '==', 'student').limit(4000).get();
  return snap.docs.map(doc => ({ id: doc.id, data: doc.data() }));
}, ['online-school-student-roster-v1'], { revalidate: 300, tags: ['users', 'online-school-roster'] });

function requireViewer(user: Awaited<ReturnType<typeof getServerUser>>) {
  if (!isAdminLike(user) && user.role !== 'teacher') throw new Error('forbidden');
}

function requireProblemEditor(user: Awaited<ReturnType<typeof getServerUser>>) {
  // 問題バンクは全校共通。校舎管理者の権限を越えるためマスターだけが編集する。
  if (user.role !== 'master') throw new Error('forbidden');
}

function allowedStudent(user: Awaited<ReturnType<typeof getServerUser>>, studentId: string, profile: FirebaseFirestore.DocumentData) {
  if (user.role === 'master') return true;
  if (user.role === 'teacher') {
    const assigned = Array.isArray(user.profile.assigned_student_ids) ? user.profile.assigned_student_ids.map(String) : [];
    if (assigned.includes(studentId)) return true;
  }
  const school = String(profile.school_id || profile.school_code || profile.school_name || profile.school || '');
  return canViewSchoolStudents(user, school);
}

const sessionView = (doc: FirebaseFirestore.QueryDocumentSnapshot) => {
  const data = doc.data();
  return {
    id: doc.id, userId: data.user_id, studentName: data.student_name || '', subjectId: data.subject_id,
    status: data.status, startedAtMs: data.started_at?.toMillis?.() || data.started_at_ms || 0,
    durationSeconds: Number(data.duration_seconds || 0), answeredCount: Number(data.answered_count || 0),
    correctCount: Number(data.correct_count || 0), xpEarned: Number(data.xp_earned || 0),
    level: Number(data.current_level || data.starting_level || 1), anomalyCount: Number(data.anomaly_count || 0),
  };
};

export async function GET(request: NextRequest) {
  try {
    const user = await getServerUser(request); requireViewer(user); const db = adminDb();
    const mode = request.nextUrl.searchParams.get('mode') || 'dashboard';
    if (mode === 'problems') {
      requireProblemEditor(user);
      const snap = await db.collection('online_school_problems').limit(500).get();
      return Response.json({ ok: true, problems: snap.docs.map(doc => ({ id: doc.id, ...doc.data() })) });
    }
    if (mode === 'student') {
      const studentId = String(request.nextUrl.searchParams.get('studentId') || ''); if (!studentId) throw new Error('student-required');
      const profileSnap = await db.collection('users').doc(studentId).get();
      if (!profileSnap.exists || !allowedStudent(user, profileSnap.id, profileSnap.data() || {})) throw new Error('forbidden');
      const progressSnaps = await Promise.all(ONLINE_SCHOOL_SUBJECT_IDS.map(subject => db.collection('online_school_student_progress').doc(progressId(studentId, subject)).get()));
      const progresses = progressSnaps.map((snap, index) => ({ ...progressFromData(studentId, ONLINE_SCHOOL_SUBJECT_IDS[index], snap.data()), categories: categorySummary(snap.data()) }));
      const historySnap = await db.collection('online_school_learning_sessions').where('user_id', '==', studentId).orderBy('started_at', 'desc').limit(100).get();
      return Response.json({ ok: true, student: { id: profileSnap.id, ...profileSnap.data(), progresses, history: historySnap.docs.map(sessionView).sort((a, b) => b.startedAtMs - a.startedAtMs) } });
    }

    const today = japanDate();
    const [sessionSnap, studentRows] = await Promise.all([
      db.collection('online_school_learning_sessions').where('started_date', '==', today).limit(4000).get(),
      loadOnlineSchoolStudentRoster(),
    ]);
    const students = studentRows.filter(row => (
      allowedStudent(user, row.id, row.data) &&
      Array.isArray(row.data.enabled_programs) &&
      row.data.enabled_programs.map(String).includes('online_school')
    )).map(row => ({
      id: row.id, name: row.data.student_name || row.data.name || row.data.login_id || '名称未設定',
      grade: row.data.grade || '', classroom: row.data.classroom || row.data.class || '',
      school: row.data.school_name || row.data.school || row.data.school_id || '',
    }));
    const allowedIds = new Set(students.map(student => student.id));
    const sessions = sessionSnap.docs.map(sessionView).filter(session => allowedIds.has(String(session.userId)));
    const participantIds = new Set(sessions.map(session => session.userId));
    const completed = sessions.filter(session => session.status === 'completed');
    const totals = completed.reduce((sum, session) => ({
      answers: sum.answers + session.answeredCount, correct: sum.correct + session.correctCount, seconds: sum.seconds + session.durationSeconds,
    }), { answers: 0, correct: 0, seconds: 0 });
    return Response.json({
      ok: true, today,
      metrics: {
        participants: participantIds.size, implementationRate: students.length ? participantIds.size / students.length : 0,
        averageAnswers: completed.length ? totals.answers / completed.length : 0,
        averageAccuracy: totals.answers ? totals.correct / totals.answers : 0,
        averageStudySeconds: completed.length ? totals.seconds / completed.length : 0,
        mathUsers: new Set(sessions.filter(item => item.subjectId === 'math').map(item => item.userId)).size,
        japaneseUsers: new Set(sessions.filter(item => item.subjectId === 'japanese').map(item => item.userId)).size,
      },
      sessions, students, notStarted: students.filter(student => !participantIds.has(student.id)),
    });
  } catch (error) { return jsonError(error); }
}

function parseProblem(body: Record<string, unknown>): ManualProblemInput {
  const subjectId = String(body.subjectId || ''); const problemType = String(body.problemType || '');
  if (!ONLINE_SCHOOL_SUBJECT_IDS.includes(subjectId as ManualProblemInput['subjectId'])) throw new Error('invalid-subject');
  if (!['multiple_choice', 'number_input', 'text_input'].includes(problemType)) throw new Error('invalid-problem-type');
  const value: ManualProblemInput = {
    subjectId: subjectId as ManualProblemInput['subjectId'], categoryId: String(body.categoryId || '').replace(/[^a-zA-Z0-9_-]/g, '').slice(0, 80),
    categoryName: String(body.categoryName || '').slice(0, 80), level: Math.max(1, Number(body.level || 1)),
    problemType: problemType as ManualProblemInput['problemType'], prompt: String(body.prompt || '').slice(0, 1000),
    passage: String(body.passage || '').slice(0, 5000), choices: Array.isArray(body.choices) ? body.choices.map(String).slice(0, 8) : [],
    correctAnswer: String(body.correctAnswer || '').slice(0, 500), explanation: String(body.explanation || '').slice(0, 2000), published: body.published === true,
  };
  if (!value.categoryId || !value.prompt || !value.correctAnswer || !value.explanation) throw new Error('missing-fields');
  return value;
}

export async function POST(request: NextRequest) {
  try {
    const user = await getServerUser(request); requireProblemEditor(user); const value = parseProblem(await request.json());
    const id = randomUUID(); await adminDb().collection('online_school_problems').doc(id).set({
      subject_id: value.subjectId, category_id: value.categoryId, category_name: value.categoryName,
      level: value.level, problem_type: value.problemType, prompt: value.prompt, passage: value.passage || '',
      choices: value.choices || [], correct_answer: value.correctAnswer, explanation: value.explanation,
      published: value.published, created_by: user.uid, created_at: FieldValue.serverTimestamp(), updated_at: FieldValue.serverTimestamp(),
    });
    return Response.json({ ok: true, id });
  } catch (error) { return jsonError(error); }
}

export async function PATCH(request: NextRequest) {
  try {
    const user = await getServerUser(request); requireProblemEditor(user); const body = await request.json();
    const id = String(body.id || ''); if (!id) throw new Error('id-required'); const value = parseProblem(body);
    await adminDb().collection('online_school_problems').doc(id).set({
      subject_id: value.subjectId, category_id: value.categoryId, category_name: value.categoryName,
      level: value.level, problem_type: value.problemType, prompt: value.prompt, passage: value.passage || '', choices: value.choices || [],
      correct_answer: value.correctAnswer, explanation: value.explanation, published: value.published,
      updated_by: user.uid, updated_at: FieldValue.serverTimestamp(),
    }, { merge: true });
    return Response.json({ ok: true });
  } catch (error) { return jsonError(error); }
}

export async function DELETE(request: NextRequest) {
  try {
    const user = await getServerUser(request); requireProblemEditor(user); const id = String(request.nextUrl.searchParams.get('id') || '');
    if (!id) throw new Error('id-required'); await adminDb().collection('online_school_problems').doc(id).delete();
    return Response.json({ ok: true });
  } catch (error) { return jsonError(error); }
}
