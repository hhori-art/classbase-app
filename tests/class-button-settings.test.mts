import test from 'node:test';
import assert from 'node:assert/strict';
import {
  canStudentSeeTestPrepGrade,
  isTestPrepShift,
  normalizeClassButtonSettings,
} from '../lib/class-button-settings.ts';

test('test-prep participation defaults share grades 1 and 2 but isolate grade 3', () => {
  const settings = normalizeClassButtonSettings({});
  assert.equal(canStudentSeeTestPrepGrade('中1', '中1', settings), true);
  assert.equal(canStudentSeeTestPrepGrade('中1', '中2', settings), true);
  assert.equal(canStudentSeeTestPrepGrade('中2', '中1', settings), true);
  assert.equal(canStudentSeeTestPrepGrade('中2', '中2', settings), true);
  assert.equal(canStudentSeeTestPrepGrade('中1', '中3', settings), false);
  assert.equal(canStudentSeeTestPrepGrade('中3', '中1', settings), false);
  assert.equal(canStudentSeeTestPrepGrade('中3', '中3', settings), true);
});

test('test-prep participation follows the administrator grade matrix', () => {
  const settings = normalizeClassButtonSettings({
    test_prep_grade_visibility: {
      中1: ['中1'],
      中2: ['中2'],
      中3: ['中2', '中3'],
    },
  });
  assert.equal(canStudentSeeTestPrepGrade('中1', '中2', settings), false);
  assert.equal(canStudentSeeTestPrepGrade('中3', '中2', settings), true);
});

test('test-prep shift detection recognizes imported bracket and legacy labels', () => {
  assert.equal(isTestPrepShift({ target_detail_subject: '【対策】物理' }), true);
  assert.equal(isTestPrepShift({ target_detail_subject: '対策公民' }), true);
  assert.equal(isTestPrepShift({ target_detail_subject: '物理', note: '定期テスト対策' }), true);
  assert.equal(isTestPrepShift({ target_detail_subject: '物理', note: '通常授業' }), false);
});

test('test-prep participation can be disabled globally', () => {
  const settings = normalizeClassButtonSettings({ test_prep_enabled: false });
  assert.equal(canStudentSeeTestPrepGrade('中1', '中1', settings), false);
});
