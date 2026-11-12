import assert from 'node:assert/strict';
import test from 'node:test';
import { jsonError, preparedMessageOr, UserFacingError } from '../lib/api-error.ts';

// 内部エラーのログをテストの出力に出さず、中身だけ確かめる。
const captureErrors = async (run: () => Promise<void>) => {
  const logged: string[] = [];
  const original = console.error;
  console.error = (...args: unknown[]) => { logged.push(args.map(String).join(' ')); };
  try {
    await run();
  } finally {
    console.error = original;
  }
  return logged;
};

test('こちらで用意した日本語の文言はそのまま返す', async () => {
  const response = jsonError(new Error('講座がありません。'));
  assert.equal(response.status, 400);
  assert.deepEqual(await response.json(), { ok: false, error: '講座がありません。' });
});

test('UserFacingError は文言と状態コードをそのまま使う', async () => {
  const response = jsonError(new UserFacingError('この日は締め切りました。', { status: 409, code: 'period-ended' }));
  assert.equal(response.status, 409);
  assert.deepEqual(await response.json(), { ok: false, error: 'この日は締め切りました。', code: 'period-ended' });
});

test('Firebase などの英語のエラーは隠し、受付番号を返して中身はログへ出す', async () => {
  let response: Response | undefined;
  const firestoreError = Object.assign(new Error('5 NOT_FOUND: No document to update: projects/demo/databases/(default)/documents/users/abc'), { code: 5 });
  const logged = await captureErrors(async () => { response = jsonError(firestoreError); });
  assert.equal(response!.status, 500);
  const body = await response!.json();
  assert.equal(body.code, 'internal-error');
  assert.match(body.ref, /^[0-9A-F]{8}$/);
  assert.equal(body.error, `内部エラーが発生しました（受付番号: ${body.ref}）`);
  assert.doesNotMatch(JSON.stringify(body), /NOT_FOUND|projects\//);
  assert.equal(logged.length, 1);
  const entry = JSON.parse(logged[0]);
  assert.equal(entry.ref, body.ref);
  assert.match(entry.message, /NOT_FOUND/);
  assert.equal(entry.code, '5');
  assert.ok(entry.stack);
});

test('ライブラリの英語の文・型エラー・外部の文言を含むコードも隠す', async () => {
  await captureErrors(async () => {
    for (const error of [
      new TypeError("Cannot read properties of undefined (reading 'x')"),
      new Error('Missing env: NEXT_PUBLIC_FIREBASE_PROJECT_ID'),
      new Error('zoom-token-failed:invalid_client'),
      Object.assign(new Error('There is no user record corresponding to this identifier.'), { code: 'auth/user-not-found' }),
      Object.assign(new Error('権限がありません projects/demo/databases/x'), {}),
    ]) {
      const response = jsonError(error);
      assert.equal(response.status, 500, error.message);
      const body = await response.json();
      assert.equal(body.code, 'internal-error');
      assert.doesNotMatch(body.error, /Cannot|Missing|zoom-token|no user record|projects/);
    }
  });
});

test('こちらで決めたコードはそのまま返す（画面側の対応表が見ている）', async () => {
  const kebab = jsonError(new Error('too-many-attempts'));
  assert.equal(kebab.status, 400);
  assert.deepEqual(await kebab.json(), { ok: false, error: 'too-many-attempts', code: 'too-many-attempts' });
  const sentence = jsonError(new Error('work record not found'));
  assert.equal(sentence.status, 400);
  assert.deepEqual(await sentence.json(), { ok: false, error: 'work record not found' });
});

test('forbidden・profile-not-found は 403、missing-token・失効は 401', async () => {
  const forbidden = jsonError(new Error('forbidden'));
  assert.equal(forbidden.status, 403);
  assert.deepEqual(await forbidden.json(), { ok: false, error: 'この操作を行う権限がありません。', code: 'forbidden' });
  const missingProfile = jsonError(new Error('profile-not-found'));
  assert.equal(missingProfile.status, 403);
  assert.equal((await missingProfile.json()).code, 'profile-not-found');

  const missingToken = jsonError(new Error('missing-token'));
  assert.equal(missingToken.status, 401);
  assert.equal((await missingToken.json()).code, 'reauth-required');
  const expired = jsonError(Object.assign(new Error('Firebase ID token has expired.'), { code: 'auth/id-token-expired' }));
  assert.equal(expired.status, 401);
  const body = await expired.json();
  assert.equal(body.code, 'reauth-required');
  assert.match(body.error, /再度ログイン/);
  assert.doesNotMatch(body.error, /Firebase/);
});

test('preparedMessageOr は日本語の文言だけを通す', () => {
  assert.equal(preparedMessageOr(new Error('画像の形式を確認してください'), '保存できませんでした'), '画像の形式を確認してください');
  assert.equal(preparedMessageOr(new Error('Bucket not found'), '保存できませんでした'), '保存できませんでした');
});
