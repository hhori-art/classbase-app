import { NextRequest } from 'next/server';
import { adminDb } from '@/lib/firebase-admin';
import { getServerUser, jsonError, requireRole } from '@/lib/server-auth';
import { ONLINE_SCHOOL_SUBJECTS } from '@/lib/online-school/catalog';
import { categorySummary, progressFromData, progressId } from '@/lib/online-school/server';
import { xpRequiredForLevel } from '@/lib/online-school/config';
import { hasOnlineSchoolProgram } from '@/lib/online-school/access';

export async function GET(request: NextRequest) {
  try {
    const user = await getServerUser(request); requireRole(user, ['student']);
    if (!hasOnlineSchoolProgram(user.profile)) throw new Error('forbidden');
    const db = adminDb();
    const progresses = await Promise.all(ONLINE_SCHOOL_SUBJECTS.map(async subject => {
      const snap = await db.collection('online_school_student_progress').doc(progressId(user.uid, subject.id)).get();
      const value = progressFromData(user.uid, subject.id, snap.data());
      const categories = categorySummary(snap.data());
      return { ...value, nextLevelXp: xpRequiredForLevel(value.currentLevel), accuracy: value.totalAnswers ? value.correctAnswers / value.totalAnswers : 0, categories };
    }));
    const historySnap = await db.collection('online_school_learning_sessions').where('user_id', '==', user.uid).orderBy('started_at', 'desc').limit(30).get();
    const history = historySnap.docs.map(doc => {
      const data = doc.data();
      return {
        id: doc.id, subject_id: data.subject_id, startedAtMs: data.started_at?.toMillis?.() || data.started_at_ms || 0,
        duration_seconds: data.duration_seconds, answered_count: data.answered_count, correct_count: data.correct_count,
        xp_earned: data.xp_earned, current_level: data.current_level, starting_level: data.starting_level,
      };
    })
      .sort((a, b) => Number(b.startedAtMs) - Number(a.startedAtMs)).slice(0, 10).map(item => ({
        id: item.id, subjectId: item.subject_id, startedAtMs: item.startedAtMs, durationSeconds: Number(item.duration_seconds || 0),
        answeredCount: Number(item.answered_count || 0), correctCount: Number(item.correct_count || 0), xpEarned: Number(item.xp_earned || 0), level: Number(item.current_level || item.starting_level || 1),
      }));
    return Response.json({ ok: true, progresses, history });
  } catch (error) { return jsonError(error); }
}
