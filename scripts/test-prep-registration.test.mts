import test from 'node:test';
import assert from 'node:assert/strict';
import {
  buildTestPrepRegistrationOptions,
  normalizeTestPrepDefinition,
  shouldUseTestPrepVisibilityFallback,
} from '../lib/test-prep-registration.ts';

test('対策単元は通常カリキュラムではなく専用設定から登録候補を作る', () => {
  const definition = normalizeTestPrepDefinition('sep-physics', {
    year: 2026,
    title: '9月定期テスト対策',
    grade: '中3',
    subject: '理科',
    course_name: '物理',
    units: ['力の合成・分解'],
    start_date: '2026-09-20',
    end_date: '2026-09-30',
    allowed_student_grades: ['中3'],
    is_active: true,
  });
  const options = buildTestPrepRegistrationOptions([definition], [{
    id: 'shift-1', target_date: '2026-09-24', period: 1, role_type: 'main',
    target_grade: '中3', target_subject: '理科', target_detail_subject: '【対策】物理', unit: '講師配置側の単元',
  }], '中3');
  assert.equal(options.length, 1);
  assert.equal(options[0].registration_type, 'test_prep');
  assert.equal(options[0].resolved_unit, '力の合成・分解');
  assert.deepEqual(options[0].matched_shift_ids, ['shift-1']);
});

test('登録対象外の学年には対策講座を出さない', () => {
  const definition = normalizeTestPrepDefinition('j3', {
    year: 2026, title: '対策', grade: '中3', subject: '社会', course_name: '公民', units: ['憲法'],
    start_date: '2026-09-01', end_date: '2026-09-30', allowed_student_grades: ['中3'], is_active: true,
  });
  const options = buildTestPrepRegistrationOptions([definition], [{
    id: 'shift-2', target_date: '2026-09-24', period: 2, role_type: 'main', target_grade: '中3', target_subject: '社会', target_detail_subject: '対策公民',
  }], '中2');
  assert.deepEqual(options, []);
});

test('専用設定がない社会は従来の公開設定へフォールバックする', () => {
  const science = normalizeTestPrepDefinition('j3-science', {
    year: 2026, title: '対策', grade: '中3', subject: '理科', course_name: '物理', units: ['力'],
    start_date: '2026-09-01', end_date: '2026-09-30', allowed_student_grades: ['中3'], is_active: true,
  });
  const socialShift = {
    id: 'social-shift', target_date: '2026-09-25', period: 2, role_type: 'main',
    target_grade: '中3', target_subject: '社会', target_detail_subject: '【対策】公民(2)',
  };
  assert.equal(shouldUseTestPrepVisibilityFallback([science], socialShift, '中3'), true);
});

test('専用設定済みの社会は枝番が違っても登録制として照合する', () => {
  const social = normalizeTestPrepDefinition('j3-social', {
    year: 2026, title: '対策', grade: '中3', subject: '社会', course_name: '公民', units: ['憲法'],
    start_date: '2026-09-01', end_date: '2026-09-30', allowed_student_grades: ['中3'], is_active: true,
  });
  const socialShift = {
    id: 'social-shift', target_date: '2026-09-25', period: 2, role_type: 'main',
    target_grade: '中3', target_subject: '社会', target_detail_subject: '【対策】公民(2)',
  };
  assert.equal(shouldUseTestPrepVisibilityFallback([social], socialShift, '中3'), false);
  assert.equal(buildTestPrepRegistrationOptions([social], [socialShift], '中3').length, 1);
});
