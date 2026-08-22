import test from 'node:test';
import assert from 'node:assert/strict';
import { isDedicatedProfile, isSemiDedicatedProfile, normalizeEmploymentCategory } from '../lib/employment-category.ts';

test('employment category normalizes dedicated and semi-dedicated labels', () => {
  assert.equal(normalizeEmploymentCategory('専任', 'teacher'), 'dedicated');
  assert.equal(normalizeEmploymentCategory('社員', 'teacher'), 'dedicated');
  assert.equal(normalizeEmploymentCategory('準専任', 'teacher'), 'semi_dedicated');
  assert.equal(normalizeEmploymentCategory('アルバイト', 'teacher'), 'semi_dedicated');
});

test('existing teacher and attendance accounts default to semi-dedicated', () => {
  assert.equal(normalizeEmploymentCategory('', 'teacher'), 'semi_dedicated');
  assert.equal(normalizeEmploymentCategory('', 'attendance_admin'), 'semi_dedicated');
  assert.equal(normalizeEmploymentCategory('', 'student'), null);
  assert.equal(isSemiDedicatedProfile({ role: 'teacher' }), true);
  assert.equal(isDedicatedProfile({ role: 'teacher', employment_category: 'dedicated' }), true);
});
