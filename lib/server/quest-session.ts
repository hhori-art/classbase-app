import { FieldValue, Timestamp } from 'firebase-admin/firestore';
import { adminDb } from '@/lib/firebase-admin';

// 正解は quest_sessions にだけ保存し、生徒には選択肢のみ返す。
// 正誤は /api/quest-sessions/answer で1問ずつ確定し、採点は記録済みの回答から行う。

export const QUEST_SESSION_SIZE = 10;
const SESSION_TTL_MS = 2 * 60 * 60 * 1000;
const MASTERED_STREAK_REQUIRED = 1;

export type SessionQuestion = {
  id: string;
  question: string;
  correct_answer: string;
  wrong_answers: string[];
  explanation: string;
  skill?: string;
  difficulty?: number;
};

export type SessionMeta = {
  grade: string;
  subject: string;
  unit_name: string;
  learning_unit_id: string;
  source_slide_id: string;
};

const shuffle = <T,>(items: T[]) => {
  const next = [...items];
  for (let i = next.length - 1; i > 0; i--) {
    const j = Math.floor(Math.random() * (i + 1));
    [next[i], next[j]] = [next[j], next[i]];
  }
  return next;
};

export function publicQuestion(question: SessionQuestion, sourceSlideId: string) {
  return {
    id: question.id,
    question: question.question,
    options: shuffle([question.correct_answer, ...question.wrong_answers]),
    source_slide_id: sourceSlideId,
    difficulty: question.difficulty,
    skill: question.skill,
  };
}

export async function createQuestSession(studentId: string, meta: SessionMeta, questions: SessionQuestion[]) {
  const ref = adminDb().collection('quest_sessions').doc();
  await ref.set({
    student_id: studentId,
    grade: meta.grade.slice(0, 20),
    subject: meta.subject.slice(0, 40),
    unit_name: (meta.unit_name || '指定単元').slice(0, 120),
    learning_unit_id: meta.learning_unit_id.slice(0, 200),
    source_slide_id: meta.source_slide_id.slice(0, 200),
    questions,
    answers: {},
    used: false,
    created_at: FieldValue.serverTimestamp(),
    expires_at: Timestamp.fromMillis(Date.now() + SESSION_TTL_MS),
  });
  return ref.id;
}

/** 作成済み問題（quizzes）から、未定着の問題を優先して最大10問を選ぶ。 */
export async function selectPrebuiltQuestions(studentId: string, unit: { source_slide_id: string; learning_unit_id: string; unit_name: string }) {
  const db = adminDb();
  let docs: FirebaseFirestore.QueryDocumentSnapshot[] = [];
  if (unit.source_slide_id) {
    docs = (await db.collection('quizzes').where('source_slide_id', '==', unit.source_slide_id).limit(80).get()).docs;
  }
  if (docs.length === 0 && unit.unit_name) {
    docs = (await db.collection('quizzes').where('unit_name', '==', unit.unit_name).limit(80).get()).docs;
  }
  const candidates = docs.map(doc => ({ id: doc.id, data: doc.data() }))
    .filter(({ data }) => data.question && data.correct_answer && Array.isArray(data.wrong_answers));
  if (candidates.length === 0) return null;

  const masterySnap = await db.collection('quest_question_mastery').where('student_id', '==', studentId).limit(500).get();
  const stats = new Map(masterySnap.docs.map(doc => [String(doc.data().question_id || ''), doc.data()]));
  const selected = candidates.map(candidate => {
    const stat = stats.get(candidate.id);
    const total = Number(stat?.total_attempts || 0);
    const wrong = Number(stat?.wrong_count || 0);
    const mastery = total > 0 ? Number(stat?.correct_count || 0) / total : 0;
    const masteredPenalty = stat?.mastered ? -60 : 0;
    const streakBonus = stat && Number(stat.current_correct_streak || 0) < MASTERED_STREAK_REQUIRED ? 20 : 0;
    const priority = total === 0
      ? 95 + Math.random() * 10
      : wrong * 28 + (1 - mastery) * 38 + streakBonus + masteredPenalty + Math.random() * 8;
    return { candidate, priority };
  }).sort((a, b) => b.priority - a.priority).slice(0, QUEST_SESSION_SIZE).map(item => item.candidate);

  const first = selected[0].data;
  const meta: SessionMeta = {
    grade: String(first.grade || ''),
    subject: String(first.subject || ''),
    unit_name: String(first.unit_name || unit.unit_name || ''),
    learning_unit_id: String(first.source_learning_unit_id || first.learning_unit_id || unit.learning_unit_id || ''),
    source_slide_id: String(first.source_slide_id || unit.source_slide_id || ''),
  };
  const questions: SessionQuestion[] = selected.map(({ id, data }) => ({
    id,
    question: String(data.question).slice(0, 1000),
    correct_answer: String(data.correct_answer).slice(0, 500),
    wrong_answers: data.wrong_answers.map((value: unknown) => String(value || '').slice(0, 500)).slice(0, 3),
    explanation: String(data.explanation || '').slice(0, 2000),
    skill: String(data.skill || ''),
    difficulty: Math.max(1, Math.min(5, Number(data.difficulty || 3))),
  }));
  return { meta, questions };
}
