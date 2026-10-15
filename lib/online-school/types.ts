export const ONLINE_SCHOOL_SUBJECT_IDS = ['math', 'japanese'] as const;

export type OnlineSchoolSubjectId = typeof ONLINE_SCHOOL_SUBJECT_IDS[number];
export type ProblemType = 'multiple_choice' | 'number_input' | 'text_input';
export type SessionStatus = 'active' | 'completed';

export type OnlineSchoolSubject = {
  id: OnlineSchoolSubjectId;
  course: 'science' | 'humanities';
  name: string;
  shortName: string;
  description: string;
};

export type ProblemTemplate = {
  id: string;
  subjectId: OnlineSchoolSubjectId;
  categoryId: string;
  categoryName: string;
  levelMin: number;
  levelMax: number;
  problemType: ProblemType;
  generate: (level: number, random: () => number) => GeneratedProblem;
};

export type GeneratedProblem = {
  templateId: string;
  subjectId: OnlineSchoolSubjectId;
  categoryId: string;
  categoryName: string;
  level: number;
  difficulty: number;
  problemType: ProblemType;
  prompt: string;
  passage?: string;
  choices?: string[];
  correctAnswer: string;
  explanation: string;
  signature: string;
};

export type PublicProblem = Omit<GeneratedProblem, 'correctAnswer'> & {
  problemInstanceId: string;
};

export type CategoryProgress = {
  categoryId: string;
  categoryName: string;
  answeredCount: number;
  correctCount: number;
  accuracy: number;
};

export type RecentAnswer = {
  categoryId: string;
  templateId: string;
  signature: string;
  isCorrect: boolean;
};

export type StudentProgress = {
  userId: string;
  subjectId: OnlineSchoolSubjectId;
  currentLevel: number;
  levelXp: number;
  totalXp: number;
  totalAnswers: number;
  correctAnswers: number;
  totalStudySeconds: number;
  currentStreak: number;
  lastStudyDate: string | null;
};

export type LevelResult = {
  level: number;
  levelXp: number;
  leveledUp: boolean;
  reviewMode: boolean;
};

export type XpInput = {
  isCorrect: boolean;
  difficulty: number;
  consecutiveCorrect: number;
};

export type ManualProblemInput = {
  subjectId: OnlineSchoolSubjectId;
  categoryId: string;
  categoryName: string;
  level: number;
  problemType: ProblemType;
  prompt: string;
  passage?: string;
  choices?: string[];
  correctAnswer: string;
  explanation: string;
  published: boolean;
};
