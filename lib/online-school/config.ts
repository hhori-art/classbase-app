export const ONLINE_SCHOOL_CONFIG = {
  sessionSeconds: 10 * 60,
  recentAccuracyWindow: 15,
  levelUpMinimumAnswers: 10,
  levelUpAccuracy: 0.8,
  reviewModeAccuracy: 0.6,
  selectionWeights: {
    currentLevel: 0.6,
    weakCategory: 0.25,
    review: 0.15,
  },
  xp: {
    correct: 10,
    hardProblem: 5,
    hardProblemFromDifficulty: 4,
    streakEvery: 3,
    streakBonus: 2,
    maximumStreakBonus: 5,
  },
  minimumResponseMsForFlag: 650,
} as const;

export function xpRequiredForLevel(level: number) {
  return 100 + Math.max(1, level) * 20;
}
