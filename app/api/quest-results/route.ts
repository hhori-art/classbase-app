import { NextRequest } from 'next/server';
import { FieldValue } from 'firebase-admin/firestore';
import { adminDb } from '@/lib/firebase-admin';
import { getServerUser, jsonError, requireRole } from '@/lib/server-auth';
import { writeCoinTransaction, writeLearningEvent } from '@/lib/events';

const POINTS_PER_CLEAR = 10;
const MASTERED_STREAK_REQUIRED = 1;

function safeDocId(value: string) {
  return Buffer.from(value).toString('base64url').slice(0, 140);
}

function unitStage(masteredCount: number, targetCount: number, attemptedCount: number) {
  if (targetCount > 0 && masteredCount >= targetCount) {
    return { stage: 'completed', label: '全問定着' };
  }
  const masteredRate = targetCount > 0 ? masteredCount / targetCount : 0;
  const attemptedRate = targetCount > 0 ? attemptedCount / targetCount : 0;
  if (masteredRate >= 0.6) return { stage: 'almost', label: '仕上げ' };
  if (attemptedRate >= 0.35 || masteredCount > 0) return { stage: 'training', label: '定着練習中' };
  return { stage: 'started', label: '学習開始' };
}

function isQuestionMastered(input: {
  isCorrect: boolean;
  correctCount: number;
  wrongCount: number;
  streak: number;
  masteryScore: number;
}) {
  if (!input.isCorrect) return false;
  if (input.streak >= MASTERED_STREAK_REQUIRED && input.wrongCount === 0) return true;
  return input.correctCount >= 2 || input.masteryScore >= 67;
}

async function resolveTargetQuestionCount(body: any, questionResults: any[]) {
  const db = adminDb();
  const sourceSlideId = String(body.source_slide_id || '').trim();
  const unitName = String(body.unit_name || '').trim();
  const explicitCount = Number(body.total_question_count || 0);

  if (sourceSlideId) {
    const snap = await db.collection('quizzes').where('source_slide_id', '==', sourceSlideId).limit(500).get();
    if (!snap.empty) return snap.size;
  }

  if (unitName) {
    const snap = await db.collection('quizzes').where('unit_name', '==', unitName).limit(500).get();
    if (!snap.empty) return snap.size;
  }

  return explicitCount > 0 ? explicitCount : new Set(questionResults.map((item: any) => String(item.question_id || '').trim()).filter(Boolean)).size;
}

export async function POST(request: NextRequest) {
  try {
    const user = await getServerUser(request);
    requireRole(user, ['student']);

    const body = await request.json();
    const score = Math.max(0, Math.min(100, Number(body.score || 0)));
    const isPassed = !!body.is_passed;
    const questionResults = Array.isArray(body.question_results) ? body.question_results : [];
    const learningUnitId = String(body.learning_unit_id || '');
    const sourceSlideId = String(body.source_slide_id || '');
    const unitName = String(body.unit_name || '不明な単元');

    const resultRef = await adminDb().collection('quest_results').add({
      student_id: user.uid,
      grade: String(body.grade || ''),
      subject: String(body.subject || ''),
      unit_name: unitName,
      learning_unit_id: learningUnitId,
      source_slide_id: sourceSlideId,
      score,
      is_passed: isPassed,
      question_count: questionResults.length,
      created_at: FieldValue.serverTimestamp(),
    });

    if (questionResults.length > 0) {
      const db = adminDb();
      let batch = db.batch();
      let count = 0;
      questionResults.slice(0, 50).forEach((item: any) => {
        const questionId = String(item.question_id || '').trim();
        if (!questionId) return;
        const ref = db.collection('quest_question_attempts').doc();
        batch.set(ref, {
          student_id: user.uid,
          result_id: resultRef.id,
          question_id: questionId,
          source_slide_id: String(item.source_slide_id || sourceSlideId || ''),
          learning_unit_id: learningUnitId,
          grade: String(body.grade || ''),
          subject: String(body.subject || ''),
          unit_name: unitName,
          skill: String(item.skill || ''),
          difficulty: Number(item.difficulty || 3),
          selected_answer: String(item.selected_answer || ''),
          correct_answer: String(item.correct_answer || ''),
          is_correct: !!item.is_correct,
          created_at: FieldValue.serverTimestamp(),
        });
        count++;
      });
      if (count > 0) await batch.commit();
    }

    const db = adminDb();
    const targetQuestionCount = await resolveTargetQuestionCount(body, questionResults);
    const uniqueResults = questionResults
      .map((item: any) => ({ ...item, question_id: String(item.question_id || '').trim() }))
      .filter((item: any) => item.question_id);

    for (const item of uniqueResults) {
      const masteryId = safeDocId(`${user.uid}:${item.question_id}`);
      const masteryRef = db.collection('quest_question_mastery').doc(masteryId);
      const snap = await masteryRef.get();
      const current = snap.exists ? snap.data() || {} : {};
      const previousTotal = Number(current.total_attempts || 0);
      const previousCorrect = Number(current.correct_count || 0);
      const previousWrong = Number(current.wrong_count || 0);
      const previousStreak = Number(current.current_correct_streak || 0);
      const isCorrect = !!item.is_correct;
      const totalAttempts = previousTotal + 1;
      const correctCount = previousCorrect + (isCorrect ? 1 : 0);
      const wrongCount = previousWrong + (isCorrect ? 0 : 1);
      const streak = isCorrect ? previousStreak + 1 : 0;
      const masteryScore = Math.round((correctCount / Math.max(1, totalAttempts)) * 100);
      const mastered = isQuestionMastered({ isCorrect, correctCount, wrongCount, streak, masteryScore });

      await masteryRef.set({
        student_id: user.uid,
        question_id: item.question_id,
        source_slide_id: String(item.source_slide_id || sourceSlideId || ''),
        learning_unit_id: learningUnitId,
        grade: String(body.grade || ''),
        subject: String(body.subject || ''),
        unit_name: unitName,
        skill: String(item.skill || ''),
        difficulty: Number(item.difficulty || 3),
        total_attempts: totalAttempts,
        correct_count: correctCount,
        wrong_count: wrongCount,
        current_correct_streak: streak,
        mastered,
        mastery_score: masteryScore,
        last_is_correct: isCorrect,
        last_result_id: resultRef.id,
        last_answered_at: FieldValue.serverTimestamp(),
        updated_at: FieldValue.serverTimestamp(),
        created_at: current.created_at || FieldValue.serverTimestamp(),
      }, { merge: true });
    }

    const masterySnap = await db.collection('quest_question_mastery')
      .where('student_id', '==', user.uid)
      .limit(500)
      .get()
      .catch(() => null);

    const masteryDocs = (masterySnap?.docs || []).filter(doc => {
      const data = doc.data();
      if (sourceSlideId) return String(data.source_slide_id || '') === sourceSlideId;
      if (learningUnitId) return String(data.learning_unit_id || '') === learningUnitId;
      return String(data.unit_name || '') === unitName;
    });
    const attemptedQuestionCount = masteryDocs.length;
    const masteredQuestionCount = masteryDocs.filter(doc => doc.data().mastered).length;
    const stage = unitStage(masteredQuestionCount, targetQuestionCount, attemptedQuestionCount);
    const unitMasteryId = safeDocId(`${user.uid}:${sourceSlideId || learningUnitId || unitName}`);

    await db.collection('quest_unit_mastery').doc(unitMasteryId).set({
      student_id: user.uid,
      grade: String(body.grade || ''),
      subject: String(body.subject || ''),
      unit_name: unitName,
      learning_unit_id: learningUnitId,
      source_slide_id: sourceSlideId,
      target_question_count: targetQuestionCount,
      attempted_question_count: attemptedQuestionCount,
      mastered_question_count: masteredQuestionCount,
      mastered_rate: targetQuestionCount > 0 ? Math.round((masteredQuestionCount / targetQuestionCount) * 100) : 0,
      stage: stage.stage,
      stage_label: stage.label,
      completed: stage.stage === 'completed',
      last_score: score,
      last_result_id: resultRef.id,
      last_studied_at: FieldValue.serverTimestamp(),
      updated_at: FieldValue.serverTimestamp(),
    }, { merge: true });

    await resultRef.set({
      target_question_count: targetQuestionCount,
      mastered_question_count: masteredQuestionCount,
      unit_stage: stage.stage,
      unit_stage_label: stage.label,
    }, { merge: true });

    const eventId = await writeLearningEvent({
      actor_id: user.uid,
      actor_role: user.role,
      type: isPassed ? 'quest_cleared' : 'quest_failed',
      target_id: resultRef.id,
      target_type: 'quest_result',
      school: user.school,
      metadata: { score, subject: body.subject, unit_name: body.unit_name },
    });

    if (isPassed) {
      await writeCoinTransaction({
        user_id: user.uid,
        amount: POINTS_PER_CLEAR,
        reason: 'AI学習クエストクリア',
        actor_id: user.uid,
        source: 'quest_result',
        event_id: eventId,
        metadata: { result_id: resultRef.id },
      });
      await adminDb().collection('users').doc(user.uid).set({
        quest_clear_count: FieldValue.increment(1),
      }, { merge: true });
    }

    return Response.json({
      ok: true,
      result_id: resultRef.id,
      event_id: eventId,
      earned_points: isPassed ? POINTS_PER_CLEAR : 0,
      unit_mastery: {
        unit_name: unitName,
        learning_unit_id: learningUnitId,
        source_slide_id: sourceSlideId,
        target_question_count: targetQuestionCount,
        attempted_question_count: attemptedQuestionCount,
        mastered_question_count: masteredQuestionCount,
        stage: stage.stage,
        stage_label: stage.label,
        completed: stage.stage === 'completed',
      },
    });
  } catch (error) {
    return jsonError(error);
  }
}
