import assert from 'node:assert/strict';
import test from 'node:test';
import { canIssueCourseRegistrationGrant } from '../lib/course-registration-window.ts';

test('対策講座は実施期間中でも受付期間外なら申込許可を発行しない', () => {
  assert.equal(canIssueCourseRegistrationGrant('test_prep', true, false), false);
  assert.equal(canIssueCourseRegistrationGrant('test_prep', true, true), true);
});

test('通常講座は従来どおり現行期または受付中なら申込許可を発行する', () => {
  assert.equal(canIssueCourseRegistrationGrant('regular', true, false), true);
  assert.equal(canIssueCourseRegistrationGrant('regular', false, true), true);
  assert.equal(canIssueCourseRegistrationGrant('regular', false, false), false);
});
