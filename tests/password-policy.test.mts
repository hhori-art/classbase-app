import test from 'node:test';
import assert from 'node:assert/strict';
import { minPasswordLength, passwordPolicyError } from '../lib/password-policy';
import { initialPasswordHmac } from '../lib/initial-password-hash';

test('admin accounts need 15 characters, students/parents/teachers need 8 (KDL A.1.1)', () => {
  assert.equal(minPasswordLength('master'), 15);
  assert.equal(minPasswordLength('admin'), 15);
  assert.equal(minPasswordLength('attendance_admin'), 15);
  assert.equal(minPasswordLength('student'), 8);
  assert.equal(minPasswordLength('parent'), 8);
  assert.equal(minPasswordLength('teacher'), 8);
  assert.match(passwordPolicyError('Ab3xY7qZ', 'admin'), /15文字以上/);
  assert.equal(passwordPolicyError('Ab3xY7qZpL9mN2vR', 'admin'), '');
  assert.match(passwordPolicyError('Ab3xY7q', 'student'), /8文字以上/);
  assert.equal(passwordPolicyError('Ab3xY7qZ', 'student'), '');
});

test('common, sequential and ID-like passwords are refused', () => {
  for (const password of ['password', 'Password1', '12345678', 'abcdefgh', 'aaaaaaaa', '87654321', 'qwerty123']) {
    assert.match(passwordPolicyError(password, 'student'), /よく使われる/, password);
  }
  assert.match(passwordPolicyError('s1234567', 'student', ['S1234567']), /IDに近い/);
  assert.match(passwordPolicyError('s1234567890', 'student', ['s1234567']), /IDに近い/);
  assert.match(passwordPolicyError('has space1', 'student'), /空白/);
  assert.equal(passwordPolicyError('kq7Rm2xP', 'student', ['s1234567']), '');
});

test('initial password hash depends on secret and salt and never equals the plaintext', () => {
  const a = initialPasswordHmac('x'.repeat(32), 'salt-a', 'Init1234');
  assert.notEqual(a, 'Init1234');
  assert.equal(a, initialPasswordHmac('x'.repeat(32), 'salt-a', ' Init1234 '));
  assert.notEqual(a, initialPasswordHmac('x'.repeat(32), 'salt-b', 'Init1234'));
  assert.notEqual(a, initialPasswordHmac('y'.repeat(32), 'salt-a', 'Init1234'));
});
