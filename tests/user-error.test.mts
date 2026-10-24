import assert from 'node:assert/strict';
import test from 'node:test';
import { userErrorMessage } from '../lib/user-error.ts';

test('API error codes are shown in Japanese', () => {
  assert.equal(userErrorMessage('forbidden'), 'この操作を行う権限がありません。');
  assert.equal(userErrorMessage(new Error('clocking is closed after 23:00')), '23時以降は出勤打刻できません。打刻を忘れた場合は打刻忘れを申請してください。');
  assert.equal(userErrorMessage('student not found'), '対象が見つかりません。画面を読み込み直してください。');
  assert.equal(userErrorMessage('講座がありません。'), '講座がありません。');
  assert.equal(userErrorMessage('', '保存できませんでした。'), '保存できませんでした。');
  assert.equal(userErrorMessage('zzz-weird-code', '保存できませんでした。'), '保存できませんでした。（zzz-weird-code）');
});
