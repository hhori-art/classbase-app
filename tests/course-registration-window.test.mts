import assert from 'node:assert/strict';
import test from 'node:test';
import { canIssueCourseRegistrationGrant, canIssueCourseRegistrationGrantForContext } from '../lib/course-registration-window.ts';

test('対策講座は実施期間中でも受付期間外なら申込許可を発行しない', () => {
  assert.equal(canIssueCourseRegistrationGrant('test_prep', true, false), false);
  assert.equal(canIssueCourseRegistrationGrant('test_prep', true, true), true);
});

test('通常講座は従来どおり現行期または受付中なら申込許可を発行する', () => {
  assert.equal(canIssueCourseRegistrationGrant('regular', true, false), true);
  assert.equal(canIssueCourseRegistrationGrant('regular', false, true), true);
  assert.equal(canIssueCourseRegistrationGrant('regular', false, false), false);
});

test('現在登録している通常講座は期や受付期間がずれていても変更許可を発行する', () => {
  assert.equal(canIssueCourseRegistrationGrantForContext('regular', false, false, true, false), true);
  assert.equal(canIssueCourseRegistrationGrantForContext('regular', false, false, false, false), false);
  assert.equal(canIssueCourseRegistrationGrantForContext('test_prep', false, false, true, false), false);
});

test('権限確認後の管理者は対象期を問わず手動登録の許可を取得できる', () => {
  assert.equal(canIssueCourseRegistrationGrantForContext('regular', false, false, false, true), true);
  assert.equal(canIssueCourseRegistrationGrantForContext('test_prep', false, false, false, true), true);
});
