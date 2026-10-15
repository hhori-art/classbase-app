import assert from 'node:assert/strict';
import test from 'node:test';

import { canStudentRegisterCourseOption, canStudentUseTransferOption, isThirdCourseTerm } from '../lib/course-registration-rules.ts';

test('原則として当該学年の講座だけを選択できる', () => {
  assert.equal(canStudentRegisterCourseOption('中2', { grade: '中2', subject: '理科' }), true);
  assert.equal(canStudentRegisterCourseOption('中2', { grade: '中1', subject: '理科' }), false);
  assert.equal(canStudentRegisterCourseOption('中1', { grade: '中3', subject: '社会' }), false);
  assert.equal(canStudentRegisterCourseOption('中3', { grade: '中1', subject: '理科' }), false);
});

test('中1社会と中2社会だけは全学年から相互に選択できる', () => {
  assert.equal(canStudentRegisterCourseOption('中1', { grade: '中2', subject: '社会' }), true);
  assert.equal(canStudentRegisterCourseOption('中2', { grade: '中1', subject: '社会' }), true);
  assert.equal(canStudentRegisterCourseOption('中3', { grade: '中1', subject: '社会' }), true);
  assert.equal(canStudentRegisterCourseOption('中3', { grade: '中2', subject: '社会' }), true);
  assert.equal(canStudentRegisterCourseOption('中2', { grade: '中3', subject: '社会' }), false);
});

test('第III期の中3登録は中3講座だけを表示する', () => {
  assert.equal(isThirdCourseTerm({ term: 'term3' }), true);
  assert.equal(isThirdCourseTerm({ term_label: '第Ⅲ期' }), true);
  assert.equal(canStudentRegisterCourseOption('中3', { grade: '中3', subject: '理科', term: 'term3' }), true);
  assert.equal(canStudentRegisterCourseOption('中3', { grade: '中1', subject: '社会', term: 'term3' }), false);
  assert.equal(canStudentRegisterCourseOption('中3', { grade: '中2', subject: '社会', term_label: '第III期' }), false);
  assert.equal(canStudentRegisterCourseOption('中3', { grade: '中1', subject: '社会', term: 'term4' }), true);
});

test('振替は中3が中3のみ、中1・中2は社会だけ相互に選べる', () => {
  assert.equal(canStudentUseTransferOption('中3', { grade: '中3', subject: '理科' }), true);
  assert.equal(canStudentUseTransferOption('中3', { grade: '中1', subject: '社会' }), false);
  assert.equal(canStudentUseTransferOption('中3', { grade: '中2', subject: '社会' }), false);
  assert.equal(canStudentUseTransferOption('中1', { grade: '中2', subject: '社会' }), true);
  assert.equal(canStudentUseTransferOption('中2', { grade: '中1', subject: '社会' }), true);
  assert.equal(canStudentUseTransferOption('中1', { grade: '中2', subject: '理科' }), false);
});
