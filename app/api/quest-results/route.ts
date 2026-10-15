import { NextRequest } from 'next/server';
import { FieldValue } from 'firebase-admin/firestore';
import { adminDb } from '@/lib/firebase-admin';
import { getServerUser, jsonError, requireRole } from '@/lib/server-auth';
import { writeLearningEvent } from '@/lib/events';

const POINTS_PER_CLEAR = 10;
const PASS_THRESHOLD = 80;

function safeDocId(value: string) {
  return Buffer.from(value).toString('base64url').slice(0, 140);
}

function japanDateKey() {
  return new Intl.DateTimeFormat('en-CA', {
    timeZone: 'Asia/Tokyo', year: 'numeric', month: '2-digit', day: '2-digit',
  }).format(new Date());
}

function unitStage(masteredCount: number, targetCount: number, attemptedCount: number) {
  if (targetCount > 0 && masteredCount >= targetCount) return { stage: 'completed', label: '全問定着' };
  const masteredRate = targetCount > 0 ? masteredCount / targetCount : 0;
  const attemptedRate = targetCount > 0 ? attemptedCount / targetCount : 0;
  if (masteredRate >= 0.6) return { stage: 'almost', label: '仕上げ' };
  if (attemptedRate >= 0.35 || masteredCount > 0) return { stage: 'training', label: '定着練習中' };
  return { stage: 'started', label: '学習開始' };
}

type GradedQuestion = {
  id: string; correct_answer: string; source_slide_id: string; learning_unit_id: string; unit_name: string;
  grade: string; subject: string; skill: string; difficulty: number;
  selected_answer: string; is_correct: boolean;
};

// 採点はクライアントの申告ではなく、/api/quest-sessions/answer で確定済みの回答から行う。
async function gradeSession(userId: string, sessionId: string) {
  const db = adminDb();
  const sessionRef = db.collection('quest_sessions').doc(sessionId);
  const session = await db.runTransaction(async tx => {
    const snap = await tx.get(sessionRef);
    const data = snap.data() || {};
    const expiresAt = data.expires_at?.toMillis?.() || 0;
    if (!snap.exists || data.student_id !== userId || data.used === true || expiresAt <= Date.now()) {
      throw new Error('invalid-or-used-quest-session');
    }
    const sessionQuestions = Array.isArray(data.questions) ? data.questions : [];
    // 未回答の問題が残っている間はセッションを消費しない。
    if (sessionQuestions.length === 0 || sessionQuestions.some((question: any) => !data.answers?.[String(question?.id || '')])) {
      throw new Error('quest-answers-incomplete');
    }
    tx.update(sessionRef, { used: true, used_at: FieldValue.serverTimestamp() });
    return data;
  });
  const questions: GradedQuestion[] = session.questions.map((question: any) => {
    const id = String(question.id || '');
    const answer = session.answers[id] || {};
    return {
      id, correct_answer: String(question.correct_answer || ''), source_slide_id: String(session.source_slide_id || ''),
      learning_unit_id: String(session.learning_unit_id || ''),
      unit_name: String(session.unit_name || ''), grade: String(session.grade || ''),
      subject: String(session.subject || ''), skill: String(question.skill || ''),
      difficulty: Math.max(1, Math.min(5, Number(question.difficulty || 3))),
      selected_answer: String(answer.selected_answer || ''), is_correct: answer.is_correct === true,
    };
  });
  return { questions, targetCount: questions.length, sessionId };
}

export async function POST(request: NextRequest) {
  try {
    const user = await getServerUser(request);
    requireRole(user, ['student']);
    const body = await request.json();
    const sessionId = String(body.session_id || '').trim().slice(0, 200);
    if (!sessionId) return Response.json({ ok: false, error: 'session_id is required' }, { status: 400 });

    const authoritative = await gradeSession(user.uid, sessionId);
    const questions = authoritative.questions;
    const canonicalUnit = questions[0].source_slide_id || questions[0].learning_unit_id || questions[0].unit_name;
    if (!canonicalUnit || questions.some(item =>
      !item.correct_answer ||
      (item.source_slide_id || item.learning_unit_id || item.unit_name) !== canonicalUnit ||
      item.grade !== questions[0].grade ||
      item.subject !== questions[0].subject
    )) {
      return Response.json({ ok: false, error: 'questions must belong to one authoritative unit' }, { status: 400 });
    }
    const correctCount = questions.filter(item => item.is_correct).length;
    const score = Math.round((correctCount / questions.length) * 100);
    const isPassed = score >= PASS_THRESHOLD;
    const first = questions[0];
    const learningUnitId = first.learning_unit_id.slice(0, 200);
    const sourceSlideId = first.source_slide_id.slice(0, 200);
    const unitName = (first.unit_name || '不明な単元').slice(0, 120);
    const grade = first.grade.slice(0, 20);
    const subject = first.subject.slice(0, 40);
    const db = adminDb();

    const resultRef = await db.collection('quest_results').add({
      student_id: user.uid, grade, subject, unit_name: unitName,
      learning_unit_id: learningUnitId, source_slide_id: sourceSlideId,
      session_id: authoritative.sessionId || null, score, is_passed: isPassed,
      correct_count: correctCount, question_count: questions.length,
      created_at: FieldValue.serverTimestamp(),
    });
    const attemptBatch = db.batch();
    questions.forEach(item => attemptBatch.set(db.collection('quest_question_attempts').doc(), {
      student_id: user.uid, result_id: resultRef.id, question_id: item.id,
      source_slide_id: item.source_slide_id || sourceSlideId, learning_unit_id: learningUnitId,
      grade, subject, unit_name: unitName, skill: item.skill, difficulty: item.difficulty,
      selected_answer: item.selected_answer, correct_answer: item.correct_answer,
      is_correct: item.is_correct, created_at: FieldValue.serverTimestamp(),
    }));
    await attemptBatch.commit();

    for (const item of questions) {
      const masteryRef = db.collection('quest_question_mastery').doc(safeDocId(`${user.uid}:${item.id}`));
      await db.runTransaction(async tx => {
        const snap = await tx.get(masteryRef);
        const current = snap.data() || {};
        const totalAttempts = Number(current.total_attempts || 0) + 1;
        const correct = Number(current.correct_count || 0) + (item.is_correct ? 1 : 0);
        const wrong = Number(current.wrong_count || 0) + (item.is_correct ? 0 : 1);
        const streak = item.is_correct ? Number(current.current_correct_streak || 0) + 1 : 0;
        const masteryScore = Math.round((correct / totalAttempts) * 100);
        const mastered = item.is_correct && ((streak >= 1 && wrong === 0) || correct >= 2 || masteryScore >= 67);
        tx.set(masteryRef, {
          student_id: user.uid, question_id: item.id, source_slide_id: item.source_slide_id || sourceSlideId,
          learning_unit_id: learningUnitId, grade, subject, unit_name: unitName,
          skill: item.skill, difficulty: item.difficulty, total_attempts: totalAttempts,
          correct_count: correct, wrong_count: wrong, current_correct_streak: streak,
          mastered, mastery_score: masteryScore, last_is_correct: item.is_correct,
          last_result_id: resultRef.id, last_answered_at: FieldValue.serverTimestamp(),
          updated_at: FieldValue.serverTimestamp(), created_at: current.created_at || FieldValue.serverTimestamp(),
        }, { merge: true });
      });
    }

    const masterySnap = await db.collection('quest_question_mastery').where('student_id', '==', user.uid).limit(500).get();
    const masteryDocs = masterySnap.docs.filter(doc => {
      const data = doc.data();
      if (sourceSlideId) return String(data.source_slide_id || '') === sourceSlideId;
      if (learningUnitId) return String(data.learning_unit_id || '') === learningUnitId;
      return String(data.unit_name || '') === unitName;
    });
    const attemptedQuestionCount = masteryDocs.length;
    const masteredQuestionCount = masteryDocs.filter(doc => doc.data().mastered).length;
    const targetQuestionCount = Math.max(authoritative.targetCount, attemptedQuestionCount);
    const stage = unitStage(masteredQuestionCount, targetQuestionCount, attemptedQuestionCount);
    const unitKey = sourceSlideId || learningUnitId || unitName;
    await db.collection('quest_unit_mastery').doc(safeDocId(`${user.uid}:${unitKey}`)).set({
      student_id: user.uid, grade, subject, unit_name: unitName, learning_unit_id: learningUnitId,
      source_slide_id: sourceSlideId, target_question_count: targetQuestionCount,
      attempted_question_count: attemptedQuestionCount, mastered_question_count: masteredQuestionCount,
      mastered_rate: targetQuestionCount ? Math.round((masteredQuestionCount / targetQuestionCount) * 100) : 0,
      stage: stage.stage, stage_label: stage.label, completed: stage.stage === 'completed',
      last_score: score, last_result_id: resultRef.id, last_studied_at: FieldValue.serverTimestamp(),
      updated_at: FieldValue.serverTimestamp(),
    }, { merge: true });

    const eventId = await writeLearningEvent({
      actor_id: user.uid, actor_role: user.role, type: isPassed ? 'quest_cleared' : 'quest_failed',
      target_id: resultRef.id, target_type: 'quest_result', school: user.school,
      metadata: { score, subject, unit_name: unitName },
    });
    let earnedPoints = 0;
    if (isPassed) {
      const rewardId = safeDocId(`${user.uid}:quest:${unitKey}:${japanDateKey()}`);
      await db.runTransaction(async tx => {
        const rewardRef = db.collection('coin_transactions').doc(rewardId);
        const rewardSnap = await tx.get(rewardRef);
        if (rewardSnap.exists) return;
        tx.set(rewardRef, {
          user_id: user.uid, amount: POINTS_PER_CLEAR, reason: 'AI学習クエストクリア',
          actor_id: user.uid, source: 'quest_result', source_id: unitKey,
          event_id: eventId, metadata: { result_id: resultRef.id }, created_at: FieldValue.serverTimestamp(),
        });
        tx.set(db.collection('users').doc(user.uid), {
          coins: FieldValue.increment(POINTS_PER_CLEAR), total_coins: FieldValue.increment(POINTS_PER_CLEAR),
          quest_clear_count: FieldValue.increment(1), updated_at: FieldValue.serverTimestamp(),
        }, { merge: true });
        earnedPoints = POINTS_PER_CLEAR;
      });
    }
    await resultRef.set({
      target_question_count: targetQuestionCount, mastered_question_count: masteredQuestionCount,
      unit_stage: stage.stage, unit_stage_label: stage.label, earned_points: earnedPoints,
    }, { merge: true });
    return Response.json({
      ok: true, result_id: resultRef.id, event_id: eventId, score, is_passed: isPassed, earned_points: earnedPoints,
      unit_mastery: {
        unit_name: unitName, learning_unit_id: learningUnitId, source_slide_id: sourceSlideId,
        target_question_count: targetQuestionCount, attempted_question_count: attemptedQuestionCount,
        mastered_question_count: masteredQuestionCount, stage: stage.stage,
        stage_label: stage.label, completed: stage.stage === 'completed',
      },
    });
  } catch (error) {
    return jsonError(error);
  }
}
