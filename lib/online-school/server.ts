import 'server-only';
import { randomUUID } from 'node:crypto';
import type { DocumentData } from 'firebase-admin/firestore';
import { ONLINE_SCHOOL_CONFIG } from './config';
import { selectNextProblem } from './engine';
import type { CategoryProgress, GeneratedProblem, OnlineSchoolSubjectId, PublicProblem, StudentProgress } from './types';

export const japanDate = (date = new Date()) => new Intl.DateTimeFormat('sv-SE', {
  timeZone: 'Asia/Tokyo', year: 'numeric', month: '2-digit', day: '2-digit',
}).format(date);

export const progressId = (uid: string, subjectId: string) => `${uid}_${subjectId}`;
export const categoryProgressId = (uid: string, subjectId: string, categoryId: string) => `${uid}_${subjectId}_${categoryId}`;
export const activeSessionId = (uid: string, subjectId: string) => `${uid}_${subjectId}`;

export function defaultProgress(uid: string, subjectId: OnlineSchoolSubjectId): StudentProgress {
  return {
    userId: uid, subjectId, currentLevel: 1, levelXp: 0, totalXp: 0,
    totalAnswers: 0, correctAnswers: 0, totalStudySeconds: 0,
    currentStreak: 0, lastStudyDate: null,
  };
}

export function progressFromData(uid: string, subjectId: OnlineSchoolSubjectId, data?: DocumentData): StudentProgress {
  const fallback = defaultProgress(uid, subjectId);
  return {
    ...fallback,
    currentLevel: Number(data?.current_level || fallback.currentLevel),
    levelXp: Number(data?.level_xp || 0), totalXp: Number(data?.total_xp || 0),
    totalAnswers: Number(data?.total_answers || 0), correctAnswers: Number(data?.correct_answers || 0),
    totalStudySeconds: Number(data?.total_study_seconds || 0), currentStreak: Number(data?.current_streak || 0),
    lastStudyDate: data?.last_study_date ? String(data.last_study_date) : null,
  };
}

export function categorySummary(data?: DocumentData): CategoryProgress[] {
  const source = data?.category_summary;
  if (!source || typeof source !== 'object' || Array.isArray(source)) return [];
  return Object.entries(source).map(([categoryId, raw]) => {
    const item = raw && typeof raw === 'object' ? raw as Record<string, unknown> : {};
    return {
      categoryId, categoryName: String(item.category_name || categoryId),
      answeredCount: Number(item.answered_count || 0), correctCount: Number(item.correct_count || 0),
      accuracy: Number(item.accuracy || 0),
    };
  });
}

export function createProblemInstance(subjectId: OnlineSchoolSubjectId, level: number, progress?: DocumentData, manualPool: DocumentData[] = []) {
  const matchingManual = manualPool.filter(item => item.published === true && Number(item.level || 1) <= level + 2);
  if (matchingManual.length && Math.random() < 0.35) {
    const item = matchingManual[Math.floor(Math.random() * matchingManual.length)];
    return {
      templateId: String(item.id || 'manual'), subjectId, categoryId: String(item.category_id || 'custom'),
      categoryName: String(item.category_name || '追加問題'), level: Number(item.level || level),
      difficulty: Math.max(1, Math.ceil(Number(item.level || level) / 6)), problemType: item.problem_type,
      prompt: String(item.prompt || ''), passage: item.passage ? String(item.passage) : undefined,
      choices: Array.isArray(item.choices) ? item.choices.map(String) : undefined,
      correctAnswer: String(item.correct_answer || ''), explanation: String(item.explanation || ''),
      signature: `manual:${String(item.id || '')}`, problemInstanceId: randomUUID(), presentedAtMs: Date.now(),
    };
  }
  const problem = selectNextProblem({
    subjectId, studentLevel: level, categoryProgress: categorySummary(progress),
    recentAnswers: Array.isArray(progress?.recent_answers) ? progress.recent_answers : [],
  });
  return { ...problem, problemInstanceId: randomUUID(), presentedAtMs: Date.now() };
}

export function publicProblem(problem: (GeneratedProblem & { problemInstanceId: string }) | null | undefined): PublicProblem | null {
  if (!problem) return null;
  const { correctAnswer: _hidden, ...safe } = problem;
  return safe;
}

export function sessionResponse(id: string, data: DocumentData) {
  const startedMs = data.started_at?.toMillis?.() || Number(data.started_at_ms || Date.now());
  return {
    id,
    subjectId: data.subject_id,
    status: data.status,
    startedAtMs: startedMs,
    endsAtMs: Number(data.ends_at_ms || startedMs + ONLINE_SCHOOL_CONFIG.sessionSeconds * 1000),
    startingLevel: Number(data.starting_level || 1),
    currentLevel: Number(data.current_level || data.starting_level || 1),
    answeredCount: Number(data.answered_count || 0), correctCount: Number(data.correct_count || 0),
    xpEarned: Number(data.xp_earned || 0),
    currentProblem: publicProblem(data.current_problem),
    result: data.result || null,
  };
}
