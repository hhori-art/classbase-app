export type NormalizedSlideQuestion = {
  question: string;
  correct_answer: string;
  wrong_answers: string[];
  explanation: string;
  difficulty: number;
  skill: string;
};

function limitedText(value: unknown, max: number) {
  return String(value || '').normalize('NFKC').trim().slice(0, max);
}

export function normalizeGeneratedSlideQuestion(value: unknown): NormalizedSlideQuestion | null {
  if (!value || typeof value !== 'object') return null;
  const raw = value as Record<string, unknown>;
  const question = limitedText(raw.question, 500);
  const correctAnswer = limitedText(raw.correct_answer, 300);
  if (!question || !correctAnswer || !Array.isArray(raw.wrong_answers)) return null;

  const correctKey = correctAnswer.toLocaleLowerCase('ja-JP');
  const seen = new Set<string>();
  const wrongAnswers = raw.wrong_answers
    .map(answer => limitedText(answer, 300))
    .filter(answer => {
      const key = answer.toLocaleLowerCase('ja-JP');
      if (!answer || key === correctKey || seen.has(key)) return false;
      seen.add(key);
      return true;
    })
    .slice(0, 3);
  if (wrongAnswers.length !== 3) return null;

  const rawDifficulty = Number(raw.difficulty);
  const difficulty = Number.isFinite(rawDifficulty)
    ? Math.max(1, Math.min(5, Math.round(rawDifficulty)))
    : 3;
  return {
    question,
    correct_answer: correctAnswer,
    wrong_answers: wrongAnswers,
    explanation: limitedText(raw.explanation, 1000),
    difficulty,
    skill: limitedText(raw.skill, 100),
  };
}
