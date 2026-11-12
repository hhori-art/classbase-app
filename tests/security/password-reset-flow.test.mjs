import assert from 'node:assert/strict';
import test from 'node:test';
import fs from 'node:fs';
import path from 'node:path';
import vm from 'node:vm';
import { createRequire } from 'node:module';
import ts from 'typescript';
import { NextRequest } from 'next/server.js';

// パスワード再設定（KDL診断 A.3.2・A.3.3）：リンクは10分・1回限り、ほかのリンクは取り消し、変更後は本人へ知らせる。
// Firestore と Firebase Auth は手元の偽物を使い、メールは送らずに mail_outbox への積み込みだけを確かめる。

const nodeRequire = createRequire(import.meta.url);
const root = process.cwd();
const GAS_SECRET = 'x'.repeat(40);

function harness(documents, { failEmail = false } = {}) {
  const data = new Map(Object.entries(documents));
  const authWrites = [];
  let seq = 0;
  const snapshot = key => ({ id: key.split('/').at(-1), exists: data.has(key), data: () => data.get(key), ref: reference(key) });
  function reference(key) {
    return {
      id: key.split('/').at(-1), get: async () => snapshot(key),
      set: async (value, options) => { data.set(key, options?.merge ? { ...data.get(key), ...value } : value); },
      create: async value => {
        if (failEmail && key.startsWith('mail_outbox/')) throw new Error('outbox down');
        if (data.has(key)) throw Object.assign(new Error('already-exists'), { code: 6 });
        data.set(key, value);
      },
      delete: async () => { data.delete(key); },
    };
  }
  function collection(name, filters = []) {
    return {
      doc: id => reference(`${name}/${id}`),
      add: async value => { const ref = reference(`${name}/new${++seq}`); await ref.set(value); return ref; },
      where: (field, op, value) => collection(name, [...filters, [field, value]]),
      limit() { return this; },
      get: async () => {
        const docs = [...data].filter(([key, value]) => key.startsWith(`${name}/`) && filters.every(([field, wanted]) => value[field] === wanted)).map(([key]) => snapshot(key));
        return { docs, empty: !docs.length, size: docs.length };
      },
    };
  }
  const db = {
    collection,
    batch: () => { const pending = []; return { set: (ref, value, options) => pending.push(() => ref.set(value, options)), commit: async () => { for (const write of pending) await write(); } }; },
    runTransaction: async fn => fn({ get: ref => ref.get(), set: (ref, value, options) => ref.set(value, options) }),
  };
  const auth = {
    updateUser: async (uid, value) => { authWrites.push({ uid, ...value }); },
    revokeRefreshTokens: async () => undefined,
  };
  const dependencies = {
    'server-only': {},
    '@/lib/firebase-admin': { adminAuth: () => auth, adminDb: () => db },
    'firebase-admin/firestore': { FieldValue: { serverTimestamp: () => 'now', delete: () => undefined, increment: value => value }, Timestamp: class {} },
    '@/lib/server-auth': {
      getServerUser: async () => ({ uid: 'actor', role: 'master' }),
      isAdminLike: () => true,
      jsonError: error => Response.json({ ok: false, error: error.message, code: error.message }, { status: 400 }),
    },
    '@/lib/server/account-credentials': { assertAccountTargetAllowed: () => undefined },
    '@/lib/server/password-recovery': { hashSecret: token => `hash:${token}`, newSecretToken: () => 'issued' },
  };
  const cache = new Map();
  function load(relative) {
    const filename = path.resolve(root, relative);
    if (cache.has(filename)) return cache.get(filename).exports;
    const loaded = { exports: {} }; cache.set(filename, loaded);
    const code = ts.transpileModule(fs.readFileSync(filename, 'utf8'), { compilerOptions: { module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2022, esModuleInterop: true } }).outputText;
    const require = specifier => {
      if (Object.hasOwn(dependencies, specifier)) return dependencies[specifier];
      if (specifier.startsWith('@/')) return load(fs.existsSync(path.resolve(root, `${specifier.slice(2)}.ts`)) ? `${specifier.slice(2)}.ts` : `${specifier.slice(2)}.tsx`);
      return nodeRequire(specifier);
    };
    vm.runInNewContext(code, { exports: loaded.exports, module: loaded, require, process: { env: { NODE_ENV: 'test', GAS_MAIL_SECRET: GAS_SECRET } }, console: { log() {}, warn() {}, error() {} }, Error, Date, Buffer, URL, Response, Headers, Intl }, { filename });
    return loaded.exports;
  }
  const route = load('app/api/auth/password-reset/route.ts');
  const patch = (token, password) => route.PATCH(new NextRequest('https://test.local/api/auth/password-reset', { method: 'PATCH', headers: { 'content-type': 'application/json' }, body: JSON.stringify({ token, password }) }));
  const post = userId => route.POST(new NextRequest('https://test.local/api/auth/password-reset', { method: 'POST', headers: { 'content-type': 'application/json', authorization: 'Bearer x' }, body: JSON.stringify({ user_id: userId }) }));
  return { data, authWrites, patch, post, outbox: () => [...data].filter(([key]) => key.startsWith('mail_outbox/')).map(([, value]) => value) };
}

const soon = () => new Date(Date.now() + 5 * 60_000);
const student = { role: 'student', lifetime_id: '20231234', email: '20231234@classbase.local', recovery_email: 'owner@example.test', recovery_email_verified_at: 'verified' };
const token = (extra = {}) => ({ user_id: 'target', token_hash: 'hash:link', purpose: 'self_service', expires_at: soon(), used_at: null, ...extra });

test('reset links last 10 minutes for both self-service and admin-issued links', () => {
  const rules = fs.readFileSync(path.resolve(root, 'lib/password-reset-rules.ts'), 'utf8');
  assert.match(rules, /PASSWORD_RESET_TTL_MS = 10 \* 60 \* 1000/);
  assert.match(fs.readFileSync(path.resolve(root, 'lib/server/password-recovery.ts'), 'utf8'), /export \{ PASSWORD_RESET_TTL_LABEL, PASSWORD_RESET_TTL_MS \} from '@\/lib\/password-reset-rules'/);
  assert.doesNotMatch(fs.readFileSync(path.resolve(root, 'app/api/auth/password-reset/request/route.ts'), 'utf8'), /30分/);
});

test('admin-issued link expires in 10 minutes and revokes the earlier open links of the account', async () => {
  const h = harness({ 'users/target': student, 'password_reset_tokens/old': token(), 'password_reset_tokens/other': token({ user_id: 'someone' }) });
  const started = Date.now();
  const response = await h.post('target');
  assert.equal(response.status, 200);
  const body = await response.json();
  const ttl = new Date(body.expires_at).getTime() - started;
  assert.ok(ttl > 9.9 * 60_000 && ttl <= 10 * 60_000 + 1000, `ttl ${ttl}`);
  assert.equal(h.data.get('password_reset_tokens/old').revoked_reason, 'reissued');
  assert.equal(h.data.get('password_reset_tokens/other').revoked_at, undefined);
});

test('a successful reset applies the password policy, revokes other links, and notifies the owner without the password or link', async () => {
  const h = harness({ 'users/target': student, 'password_reset_tokens/link': token(), 'password_reset_tokens/second': token({ token_hash: 'hash:second' }) });

  // きまりに合わないパスワード（短い・IDに近い）は、何も書かずに理由を返す。
  for (const weak of ['short1', '20231234a']) {
    const rejected = await h.patch('link', weak);
    assert.equal(rejected.status, 400);
    const body = await rejected.json();
    assert.equal(body.error, 'password-policy');
    assert.ok(body.message);
  }
  assert.equal(h.authWrites.length, 0);
  assert.equal(h.data.get('password_reset_tokens/link').processing_at, undefined);

  const ok = await h.patch('link', 'blue-sky-river');
  assert.equal(ok.status, 200);
  assert.deepEqual(h.authWrites, [{ uid: 'target', password: 'blue-sky-river' }]);
  assert.equal(h.data.get('password_reset_tokens/link').used_at, 'now');
  assert.equal(h.data.get('password_reset_tokens/second').revoked_reason, 'password_changed');

  const notice = h.data.get('user_notifications/password_changed_link');
  assert.equal(notice.user_id, 'target');
  assert.equal(notice.kind, 'security');
  assert.match(notice.message, /\d{4}年\d{1,2}月\d{1,2}日 \d{2}:\d{2}（日本時間）/);
  assert.match(notice.message, /078-321-4123/);
  const mails = h.outbox();
  assert.equal(mails.length, 1);
  assert.equal(mails[0].to, 'owner@example.test');
  for (const text of [notice.message, mails[0].text]) {
    assert.doesNotMatch(text, /blue-sky-river|password-reset\/confirm|token/);
  }

  // 同じリンク・取り消されたリンクは使えない。
  assert.equal((await (await h.patch('link', 'another-river')).json()).error, 'token-used');
  assert.equal((await (await h.patch('second', 'another-river')).json()).error, 'token-revoked');
});

test('expired links are rejected and a failed notice does not undo the reset', async () => {
  const expired = harness({ 'users/target': student, 'password_reset_tokens/link': token({ expires_at: new Date(Date.now() - 1) }) });
  assert.equal((await (await expired.patch('link', 'blue-sky-river')).json()).error, 'token-expired');

  const h = harness({ 'users/target': student, 'password_reset_tokens/link': token() }, { failEmail: true });
  const response = await h.patch('link', 'blue-sky-river');
  assert.equal(response.status, 200);
  assert.equal(h.authWrites.length, 1);
  assert.equal(h.outbox().length, 0);
  assert.ok(h.data.get('user_notifications/password_changed_link'));
});

test('no notice email goes to an unverified or login-only address', async () => {
  for (const profile of [{ ...student, recovery_email_verified_at: null }, { ...student, recovery_email: '20231234@classbase.local' }]) {
    const h = harness({ 'users/target': profile, 'password_reset_tokens/link': token() });
    assert.equal((await h.patch('link', 'blue-sky-river')).status, 200);
    assert.equal(h.outbox().length, 0);
  }
});
