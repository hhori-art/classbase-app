import { NextRequest } from 'next/server';
import { FieldValue } from 'firebase-admin/firestore';
import { adminDb } from '@/lib/firebase-admin';
import { getServerUser, jsonError, requireRole } from '@/lib/server-auth';
import { ONLINE_SCHOOL_CONFIG } from '@/lib/online-school/config';
import { calculateNextLevel, calculateXP, isCorrectAnswer, nextStudyStreak } from '@/lib/online-school/engine';
import { categoryProgressId, createProblemInstance, japanDate, progressFromData, progressId, publicProblem } from '@/lib/online-school/server';
import { hasOnlineSchoolProgram } from '@/lib/online-school/access';

export async function POST(request: NextRequest) {
  try {
    const user = await getServerUser(request); requireRole(user, ['student']);
    if (!hasOnlineSchoolProgram(user.profile)) throw new Error('forbidden');
    const body = await request.json();
    const sessionId = String(body.sessionId || ''); const instanceId = String(body.problemInstanceId || '');
    const answerId = String(body.answerId || '').replace(/[^a-zA-Z0-9_-]/g, '').slice(0, 100);
    const userAnswer = String(body.answer ?? '').slice(0, 500);
    if (!sessionId || !instanceId || !answerId || !userAnswer.trim()) throw new Error('invalid-answer');
    const db = adminDb(); const sessionRef = db.collection('online_school_learning_sessions').doc(sessionId);
    const answerRef = db.collection('online_school_answers').doc(`${user.uid}_${sessionId}_${answerId}`);

    const result = await db.runTransaction(async transaction => {
      const duplicate = await transaction.get(answerRef);
      if (duplicate.exists) {
        const duplicateData = duplicate.data() || {};
        if (duplicateData.session_id !== sessionId || duplicateData.problem_instance_id !== instanceId) {
          throw new Error('answer-id-conflict');
        }
        return duplicateData.response;
      }
      const sessionSnap = await transaction.get(sessionRef); if (!sessionSnap.exists) throw new Error('session-not-found');
      const session = sessionSnap.data()!; if (session.user_id !== user.uid || session.status !== 'active') throw new Error('session-closed');
      if (Number(session.answered_count || 0) >= 100) throw new Error('session-answer-limit');
      const problem = session.current_problem; if (!problem || problem.problemInstanceId !== instanceId) throw new Error('stale-problem');
      const subjectId = session.subject_id;
      const progressRef = db.collection('online_school_student_progress').doc(progressId(user.uid, subjectId));
      const progressSnap = await transaction.get(progressRef); const progress = progressFromData(user.uid, subjectId, progressSnap.data());
      const categoryRef = db.collection('online_school_category_progress').doc(categoryProgressId(user.uid, subjectId, problem.categoryId));
      const categorySnap = await transaction.get(categoryRef); const category = categorySnap.data() || {};
      const responseMs = Math.max(0, Date.now() - Number(problem.presentedAtMs || Date.now()));
      const isCorrect = isCorrectAnswer(userAnswer, problem.correctAnswer);
      const previousResults = Array.isArray(progressSnap.data()?.recent_results) ? progressSnap.data()!.recent_results.map(Boolean) : [];
      const sessionResults = Array.isArray(session.recent_results) ? session.recent_results.map(Boolean) : [];
      const consecutive = isCorrect ? [...sessionResults].reverse().findIndex(value => !value) + 1 || sessionResults.length + 1 : 0;
      const xp = calculateXP({ isCorrect, difficulty: Number(problem.difficulty || 1), consecutiveCorrect: consecutive });
      const recentResults = [...previousResults, isCorrect].slice(-ONLINE_SCHOOL_CONFIG.recentAccuracyWindow);
      const levelResult = calculateNextLevel(progress.currentLevel, progress.levelXp, xp, recentResults);
      const today = japanDate(); const streak = nextStudyStreak(progress.lastStudyDate, progress.currentStreak, today);
      const oldAnswered = Number(category.answered_count || 0); const oldCorrect = Number(category.correct_count || 0);
      const newAnswered = oldAnswered + 1; const newCorrect = oldCorrect + (isCorrect ? 1 : 0);
      const categoryData = { category_name: problem.categoryName, answered_count: newAnswered, correct_count: newCorrect, accuracy: newCorrect / newAnswered };
      const sessionAnswers = Number(session.answered_count || 0) + 1; const sessionCorrect = Number(session.correct_count || 0) + (isCorrect ? 1 : 0);
      const sessionXp = Number(session.xp_earned || 0) + xp;
      const timeExpired = Date.now() >= Number(session.ends_at_ms || 0);
      const nextProblem = timeExpired ? null : createProblemInstance(subjectId, levelResult.level, {
        ...progressSnap.data(),
        category_summary: { ...(progressSnap.data()?.category_summary || {}), [problem.categoryId]: categoryData },
        recent_answers: [...(progressSnap.data()?.recent_answers || []), { categoryId: problem.categoryId, templateId: problem.templateId, signature: problem.signature, isCorrect }].slice(-10),
      }, Array.isArray(session.manual_problem_pool) ? session.manual_problem_pool : []);
      const recentUserAnswers = [...(session.recent_user_answers || []), userAnswer].slice(-5);
      const flags = [responseMs < ONLINE_SCHOOL_CONFIG.minimumResponseMsForFlag ? 'very_fast_answer' : '', recentUserAnswers.length >= 4 && new Set(recentUserAnswers.slice(-4)).size === 1 ? 'repeated_same_answer' : ''].filter(Boolean);
      const response = {
        isCorrect, correctAnswer: String(problem.correctAnswer), explanation: String(problem.explanation), xpEarned: xp,
        leveledUp: levelResult.leveledUp, currentLevel: levelResult.level, levelXp: levelResult.levelXp,
        reviewMode: levelResult.reviewMode, timeExpired, nextProblem: publicProblem(nextProblem), answeredCount: sessionAnswers,
      };
      transaction.set(answerRef, {
        answer_id: answerId, user_id: user.uid, session_id: sessionId, problem_instance_id: instanceId,
        problem_id: problem.templateId, subject_id: subjectId, category_id: problem.categoryId, level: problem.level,
        user_answer: userAnswer, correct_answer: problem.correctAnswer, is_correct: isCorrect, response_time_ms: responseMs,
        anomaly_flags: flags, answered_at: FieldValue.serverTimestamp(), response,
      });
      transaction.set(categoryRef, { user_id: user.uid, subject_id: subjectId, category_id: problem.categoryId, ...categoryData, last_answered_at: FieldValue.serverTimestamp(), updated_at: FieldValue.serverTimestamp() }, { merge: true });
      transaction.set(progressRef, {
        user_id: user.uid, subject_id: subjectId, current_level: levelResult.level, level_xp: levelResult.levelXp,
        total_xp: FieldValue.increment(xp), total_answers: FieldValue.increment(1), correct_answers: FieldValue.increment(isCorrect ? 1 : 0),
        current_streak: streak, last_study_date: today, review_mode: levelResult.reviewMode,
        recent_results: recentResults,
        recent_answers: [...(Array.isArray(progressSnap.data()?.recent_answers) ? progressSnap.data()!.recent_answers : []), { categoryId: problem.categoryId, templateId: problem.templateId, signature: problem.signature, isCorrect }].slice(-10),
        [`category_summary.${problem.categoryId}`]: categoryData, updated_at: FieldValue.serverTimestamp(),
      }, { merge: true });
      transaction.update(sessionRef, {
        current_level: levelResult.level, answered_count: sessionAnswers, correct_count: sessionCorrect, xp_earned: sessionXp,
        current_problem: nextProblem, recent_results: [...sessionResults, isCorrect].slice(-15), recent_user_answers: recentUserAnswers,
        anomaly_count: FieldValue.increment(flags.length ? 1 : 0), updated_at: FieldValue.serverTimestamp(),
      });
      return response;
    });
    return Response.json({ ok: true, result });
  } catch (error) { return jsonError(error); }
}
