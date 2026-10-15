import assert from 'node:assert/strict';
import test from 'node:test';
import { isValidShiftDate, normalizeShiftGrade, normalizeShiftIdentityText, normalizeShiftPeriod, normalizeShiftSubject, redirectedShiftDetailFromTeacher, shiftTeacherNameAfterChange, validateShiftSyncStructure } from '../lib/shift-sync-normalization.ts';

test('Google配置表の中3表記を登録用の学年と科目へ統一する', () => {
  assert.equal(normalizeShiftGrade('中３理科'), '中3');
  assert.equal(normalizeShiftGrade('中学3年'), '中3');
  assert.equal(normalizeShiftSubject('中３理科'), '理科');
  assert.equal(normalizeShiftSubject('中３社会'), '社会');
});

test('重複判定用の講座名は全角数字と空白を同一視する', () => {
  assert.equal(normalizeShiftIdentityText(' 公民③ '), normalizeShiftIdentityText('公民3'));
});

test('Google配置表の明示時限を全角表記を含めて読み取る', () => {
  assert.equal(normalizeShiftPeriod('１時間目\n19:30～20:30'), 1);
  assert.equal(normalizeShiftPeriod('【2限】第17週'), 2);
  assert.equal(normalizeShiftPeriod('授業後'), null);
});

test('講師欄の講座統合指示を講師名と誤認しない', () => {
  assert.equal(redirectedShiftDetailFromTeacher('公民③へ'), '公民3');
  assert.equal(redirectedShiftDetailFromTeacher('山田⇒ 公民③へ'), '公民3');
  assert.equal(redirectedShiftDetailFromTeacher('③へ', '公民②'), '公民3');
  assert.equal(redirectedShiftDetailFromTeacher('➀へ', '公民②'), '公民1');
  assert.equal(redirectedShiftDetailFromTeacher('山田'), '');
  assert.equal(shiftTeacherNameAfterChange('岩本 ⇒ 五郎丸'), '五郎丸');
  assert.equal(shiftTeacherNameAfterChange('岩本 ⇒'), '岩本');
});

test('同期前に実在しない日付・未知の役割・同期キー重複・主担当なしの日を拒否する', () => {
  assert.equal(isValidShiftDate('2026-02-28'), true);
  assert.equal(isValidShiftDate('2026-02-30'), false);
  const result = validateShiftSyncStructure([
    { sync_key: 'same', target_date: '2026-09-01', role_type: 'main', grade: '中3', subject: '理科' },
    { sync_key: 'same', target_date: '2026-09-01', role_type: 'sub', grade: '中3', subject: '理科' },
    { target_date: '2026-09-02', role_type: 'sub', grade: '中3', subject: '社会' },
    { target_date: '2026-02-30', role_type: 'unknown', grade: '', subject: '' },
  ]);
  assert.equal(result.valid, false);
  assert.ok(result.errors.some(error => error.includes('重複')));
  assert.ok(result.errors.some(error => error.includes('2026-09-02')));
  assert.ok(result.errors.some(error => error.includes('YYYY-MM-DD')));
  assert.ok(result.errors.some(error => error.includes('main、sub、general')));
});

test('主担当が揃った複数日の配置を受け付ける', () => {
  const result = validateShiftSyncStructure([
    { sync_key: 'day1-main', target_date: '2026-09-01', role_type: 'main', grade: '中3', subject: '理科' },
    { sync_key: 'day1-general', target_date: '2026-09-01', role_type: 'general' },
    { sync_key: 'day2-main', target_date: '2026-09-02', role_type: 'main', grade: '中2', subject: '社会' },
  ]);
  assert.deepEqual(result, { valid: true, errors: [] });
});

test('Google配置同期は過大なセルと不正な元行番号を保存前に拒否する', () => {
  const result = validateShiftSyncStructure([{
    sync_key: 'long-main', target_date: '2026-09-01', role_type: 'main', grade: '中3', subject: '理科',
    note: 'x'.repeat(2001), source_row: -1,
  }]);
  assert.equal(result.valid, false);
  assert.ok(result.errors.some(error => error.includes('備考は2000文字以内')));
  assert.ok(result.errors.some(error => error.includes('元行は0〜100000')));
});
