import test from 'node:test';
import assert from 'node:assert/strict';
import {
  PROBLEM_TEMPLATES,
  availableTemplates,
  calculateNextLevel,
  calculateXP,
  idempotencyKey,
  isCorrectAnswer,
  selectNextProblem,
  weakestCategories,
} from '../lib/online-school/engine.ts';
import { xpRequiredForLevel } from '../lib/online-school/config.ts';
import { hasOnlineSchoolProgram } from '../lib/online-school/access.ts';

test('online school access is granted only when linked to the student profile', () => {
  assert.equal(hasOnlineSchoolProgram({ enabled_programs: ['online_school'] }), true);
  assert.equal(hasOnlineSchoolProgram({ enabled_programs: ['science_social'] }), false);
  assert.equal(hasOnlineSchoolProgram({}), false);
});

test('math and Japanese generators cover levels 1 through 100', () => {
  for (const subjectId of ['math', 'japanese'] as const) {
    for (let level = 1; level <= 100; level += 1) {
      const problem = selectNextProblem({ subjectId, studentLevel: level, random: () => 0.42 });
      assert.equal(problem.subjectId, subjectId);
      assert.ok(problem.prompt.length > 0);
      assert.ok(problem.correctAnswer.length > 0);
      assert.ok(problem.explanation.length > 0);
    }
  }
  assert.ok(PROBLEM_TEMPLATES.length >= 25);
});

test('level 100 uses the advanced problem categories', () => {
  const mathCategories = availableTemplates('math', 100).map(template => template.categoryId);
  const japaneseCategories = availableTemplates('japanese', 100).map(template => template.categoryId);
  assert.ok(mathCategories.includes('probability'));
  assert.ok(mathCategories.includes('statistics'));
  assert.deepEqual(japaneseCategories, ['advanced_reading']);
});

test('levels above configured range safely use the highest template', () => {
  assert.ok(availableTemplates('math', 500).length > 0);
  assert.ok(selectNextProblem({ subjectId: 'math', studentLevel: 500, random: () => 0.5 }).prompt);
});

test('answer grading normalizes full-width numbers and whitespace', () => {
  assert.equal(isCorrectAnswer(' １２ ', '12'), true);
  assert.equal(isCorrectAnswer('ネコ', 'ネコ'), true);
  assert.equal(isCorrectAnswer('', '12'), false);
});

test('XP includes difficulty and streak bonuses only for correct answers', () => {
  assert.equal(calculateXP({ isCorrect: false, difficulty: 5, consecutiveCorrect: 9 }), 0);
  assert.equal(calculateXP({ isCorrect: true, difficulty: 1, consecutiveCorrect: 1 }), 10);
  assert.ok(calculateXP({ isCorrect: true, difficulty: 5, consecutiveCorrect: 6 }) > 10);
});

test('level-up requires XP and at least 80 percent recent accuracy', () => {
  const required = xpRequiredForLevel(1);
  const success = calculateNextLevel(1, required - 10, 10, Array(10).fill(true));
  assert.equal(success.level, 2);
  assert.equal(success.leveledUp, true);
  const lowAccuracy = calculateNextLevel(1, required, 0, [true, false, false, false, true, false, false, true, false, false]);
  assert.equal(lowAccuracy.level, 1);
  assert.equal(lowAccuracy.reviewMode, true);
});

test('weakness detection sorts sufficiently attempted categories', () => {
  const weak = weakestCategories([
    { categoryId: 'a', categoryName: 'A', answeredCount: 10, correctCount: 9, accuracy: .9 },
    { categoryId: 'b', categoryName: 'B', answeredCount: 8, correctCount: 3, accuracy: .375 },
    { categoryId: 'c', categoryName: 'C', answeredCount: 1, correctCount: 0, accuracy: 0 },
  ]);
  assert.equal(weak[0].categoryId, 'b');
});

test('adaptive selector can choose the weak category without repeating recent template', () => {
  const problem = selectNextProblem({
    subjectId: 'math', studentLevel: 18, random: () => 0.7,
    categoryProgress: [{ categoryId: 'fraction', categoryName: '分数', answeredCount: 10, correctCount: 3, accuracy: .3 }],
    recentAnswers: [],
  });
  assert.equal(problem.categoryId, 'fraction');
});

test('idempotency key changes for each answer identity', () => {
  assert.equal(idempotencyKey('s1', 'p1', 'a1'), idempotencyKey('s1', 'p1', 'a1'));
  assert.notEqual(idempotencyKey('s1', 'p1', 'a1'), idempotencyKey('s1', 'p1', 'a2'));
});
