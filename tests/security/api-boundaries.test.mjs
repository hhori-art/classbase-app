import assert from 'node:assert/strict';
import test from 'node:test';
import fs from 'node:fs';
import path from 'node:path';
import vm from 'node:vm';
import { createHash, createHmac } from 'node:crypto';
import { createRequire } from 'node:module';
import ts from 'typescript';
import { NextRequest } from 'next/server.js';

const nodeRequire = createRequire(import.meta.url);
const sourceRoot = process.env.SECURITY_SOURCE_ROOT || process.cwd();
const teacher = { role: 'teacher', school: '112', school_id: '112', name: 'Teacher One' };
const admin = { role: 'admin', school: '112', school_id: '112', school_ids: ['112'], admin_permissions: { science_social: true, attendance: false } };
const student = { role: 'student', school: '112', school_id: '112', lifetime_id: 'student', email: 'student@classbase.local' };
const master = { role: 'master', school: '999', email: 'master@example.test' };

function harness({ profiles = {}, documents = {}, identity = { uid: 'actor', email: 'actor@example.test' }, env = {}, authUsers = {}, fetch: fetchImpl, overrides = {}, now } = {}) {
  const data = new Map(Object.entries({ ...Object.fromEntries(Object.entries(profiles).map(([id, value]) => [`users/${id}`, value])), ...documents }));
  const storageBlobs = new Map();
  const writes = []; const authWrites = []; const verifications = []; const calls = []; const rateLimitReleases = [];
  const snapshot = key => ({ id: key.split('/').at(-1), exists: data.has(key), data: () => data.get(key), ref: reference(key) });
  function reference(key) {
    return {
      id: key.split('/').at(-1), get: async () => snapshot(key),
      collection: name => collection(`${key}/${name}`),
      set: async (value, options) => { writes.push(key); data.set(key, options?.merge ? { ...data.get(key), ...value } : value); },
      update: async value => { if (!data.has(key)) throw Object.assign(new Error('not-found'), { code: 5 }); writes.push(key); data.set(key, { ...data.get(key), ...value }); },
      create: async value => { if (data.has(key)) throw Object.assign(new Error('already-exists'), { code: 6 }); writes.push(key); data.set(key, value); },
      delete: async () => { writes.push(key); data.delete(key); },
    };
  }
  function collection(name, filters = []) {
    return {
      doc: id => reference(`${name}/${id || 'generated'}`),
      add: async value => { const ref = reference(`${name}/generated`); await ref.set(value); return ref; },
      where: (field, op, value) => collection(name, [...filters, [field, op, value]]),
      limit() { return this; }, orderBy() { return this; }, select() { return this; }, startAfter() { return this; },
      get: async () => {
        const docs = [...data].filter(([key, value]) => key.startsWith(`${name}/`) && filters.every(([field, op, wanted]) => {
          if (field === '__name__') { const id = key.split('/').at(-1); return op === '>=' ? id >= wanted : op === '<=' ? id <= wanted : id === wanted; }
          if (op === '==') return value[field] === wanted;
          if (op === 'in') return wanted.includes(value[field]);
          if (op === '>=') return value[field] >= wanted;
          if (op === '<=') return value[field] <= wanted;
          return false;
        })).map(([key]) => snapshot(key));
        return { docs, empty: !docs.length, size: docs.length };
      },
    };
  }
  const db = { collection, doc: key => reference(key), getAll: async (...refs) => Promise.all(refs.map(ref => ref.get())),
    batch: () => { const pending = []; return {
      set: (ref, value, options) => pending.push(() => ref.set(value, options)),
      update: (ref, value) => pending.push(() => ref.update(value)),
      create: (ref, value) => pending.push(() => ref.create(value)),
      delete: ref => pending.push(() => ref.delete()),
      commit: async () => { for (const write of pending) await write(); },
    }; },
    runTransaction: async fn => fn({
      get: ref => ref.get(),
      getAll: (...refs) => Promise.all(refs.map(ref => ref.get())),
      set: (ref, value, options) => ref.set(value, options),
      update: (ref, value) => ref.update(value),
      create: (ref, value) => ref.create(value),
      delete: ref => ref.delete(),
    }),
  };
  const auth = {
    verifyIdToken: async (token, revoked) => { verifications.push(revoked); if (token !== 'valid') throw new Error('invalid-token'); return identity; },
    getUser: async uid => { if (!authUsers[uid]) throw Object.assign(new Error('missing'), { code: 'auth/user-not-found' }); return { uid, ...authUsers[uid] }; },
    getUserByEmail: async email => { const found = Object.entries(authUsers).find(([, data]) => data.email === email); if (!found) throw Object.assign(new Error('missing'), { code: 'auth/user-not-found' }); return { uid: found[0], ...found[1] }; },
    updateUser: async (uid, value) => { authWrites.push({ uid, ...value }); return { uid, ...authUsers[uid], ...value }; },
    createUser: async value => { authWrites.push({ uid: 'created', ...value }); return { uid: 'created', ...value }; },
    revokeRefreshTokens: async uid => { calls.push(`revoke:${uid}`); },
  };
  const dependencies = {
    'server-only': {},
    '@/lib/firebase-admin': { adminAuth: () => auth, adminDb: () => db, adminBucket: () => ({
      name: 'test-bucket',
      file: filePath => ({
        save: async bytes => { storageBlobs.set(filePath, Buffer.from(bytes)); calls.push(`upload:${filePath}`); },
        download: async () => [storageBlobs.get(filePath) || Buffer.alloc(0)],
        getMetadata: async () => [{ size: storageBlobs.get(filePath)?.length || 0 }],
        getSignedUrl: async () => { calls.push(`signed:${filePath}`); return [`https://signed.example/${encodeURIComponent(filePath)}`]; },
        delete: async () => { storageBlobs.delete(filePath); calls.push(`delete:${filePath}`); },
      }),
    }) },
    'firebase-admin/firestore': { FieldValue: { serverTimestamp: () => 'now', delete: () => 'deleted', arrayUnion: (...values) => values, increment: value => ({ increment: value }) }, Timestamp: { now: () => 'now', fromDate: value => value, fromMillis: value => ({ toMillis: () => value }) }, FieldPath: { documentId: () => '__name__' } },
    '@/lib/server/password-recovery': {
      newSecretToken: () => 'fixture-token',
      hashSecret: token => `hash:${token}`,
      requestFingerprint: parts => `fingerprint:${parts.join('|')}`,
      getClientIp: () => '203.0.113.10',
      consumeRateLimit: async () => true,
      releaseRateLimit: async key => { rateLimitReleases.push(key); },
    },
    '@ai-sdk/openai': { openai: Object.assign(model => model, { chat: model => model }) },
    ai: { convertToCoreMessages: messages => messages, streamText: input => { calls.push(input); return { toDataStreamResponse: () => new Response('stream'), toUIMessageStreamResponse: () => new Response('stream') }; } },
    'next/cache': { unstable_cache: fn => fn, revalidateTag: tag => calls.push(`revalidate:${tag}`) },
    ...overrides,
  };
  const cache = new Map();
  function load(relative) {
    const filename = path.resolve(sourceRoot, relative);
    if (cache.has(filename)) return cache.get(filename).exports;
    const module = { exports: {} }; cache.set(filename, module);
    const code = ts.transpileModule(fs.readFileSync(filename, 'utf8'), { compilerOptions: { module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2022, esModuleInterop: true } }).outputText;
    const require = specifier => {
      if (Object.hasOwn(dependencies, specifier)) return dependencies[specifier];
      if (specifier.startsWith('@/')) return load(`${specifier.slice(2)}.ts`);
      if (specifier.startsWith('.')) {
        const localSpecifier = specifier.endsWith('.ts') ? specifier : `${specifier}.ts`;
        return load(path.relative(sourceRoot, path.resolve(path.dirname(filename), localSpecifier)));
      }
      return nodeRequire(specifier);
    };
    const ContextDate = now ? class extends Date {
      constructor(...args) { super(args.length ? args[0] : now); }
      static now() { return new Date(now).getTime(); }
    } : Date;
    const context = { exports: module.exports, module, require, process: { env: { NODE_ENV: 'test', ...env } }, console: { log() {}, warn() {}, error() {} }, Error, Date: ContextDate, Buffer, URL, URLSearchParams, Request, Response, Headers, File, Blob, FormData, AbortSignal, AbortController, crypto: globalThis.crypto, setTimeout, clearTimeout, fetch: fetchImpl || (async () => { throw new Error('Unexpected network request'); }) };
    vm.runInNewContext(code, context, { filename });
    return module.exports;
  }
  return { load, data, writes, authWrites, calls, verifications, auth, db, rateLimitReleases };
}
const request = (url, body, token = 'valid', method = 'POST') => new NextRequest(`https://security.test${url}`, { method, headers: { 'content-type': 'application/json', ...(token ? { authorization: `Bearer ${token}` } : {}) }, ...(method === 'GET' ? {} : { body: JSON.stringify(body) }) });
const actor = { uid: 'actor', ...admin, profile: admin };

test('bootstrap rejects domain-only and unverified allowlisted email identities', async () => {
  for (const [email, email_verified, allowlist] of [['stranger@sozogakuen.co.jp', true, ''], ['allowed@example.test', false, 'allowed@example.test']]) {
    const h = harness({ identity: { uid: 'actor', email, email_verified }, env: { ADMIN_BOOTSTRAP_EMAILS: allowlist } });
    assert.equal((await h.load('app/api/admin/bootstrap-profile/route.ts').POST(request('/api/admin/bootstrap-profile', {}))).status, 403);
    assert.equal(h.writes.length, 0);
  }
});
test('bootstrap retains exact verified allowlist and leaves existing profile unchanged', async () => {
  for (const existing of [false, true]) {
    const h = harness({ profiles: existing ? { actor: student } : {}, identity: { uid: 'actor', email: 'allowed@example.test', email_verified: true }, env: { ADMIN_BOOTSTRAP_EMAILS: 'allowed@example.test' } });
    assert.equal((await h.load('app/api/admin/bootstrap-profile/route.ts').POST(request('/api/admin/bootstrap-profile', {}))).status, 200);
    assert.equal(h.data.get('users/actor').role, existing ? 'student' : 'master');
  }
});
test('profile repair rejects victim local-part and conflicting UID aliases', async () => {
  for (const victim of [{ role: 'master', lifetime_id: 'victim' }, { role: 'master', uid: 'actor', id: 'other' }]) {
    const h = harness({ profiles: { victim }, identity: { uid: 'actor', email: 'victim@attacker.test' } });
    const result = await h.load('lib/account-repair.ts').repairUserProfileForAuth('actor', 'victim@attacker.test');
    assert.equal(result.ok, false); assert.equal(h.writes.length, 0); assert.ok(h.data.has('users/victim'));
  }
});
test('profile repair retains existing UID and explicitly bound legacy migration', async () => {
  for (const id of ['actor', 'legacy']) {
    const h = harness({ profiles: { [id]: { ...student, uid: 'actor', id: 'actor' } } });
    assert.equal((await h.load('lib/account-repair.ts').repairUserProfileForAuth('actor', student.email)).ok, true);
    assert.equal(h.data.get('users/actor').role, 'student');
  }
});
test('reset issuance rejects master and foreign school, retains same-school student', async () => {
  for (const [target, status] of [[master, 403], [{ ...student, school_id: '999' }, 403], [student, 200]]) {
    const h = harness({ profiles: { actor: admin, target } });
    assert.equal((await h.load('app/api/auth/password-reset/route.ts').POST(request('/api/auth/password-reset', { user_id: 'target' }))).status, status);
    assert.equal(h.writes.length, status === 200 ? 1 : 0);
  }
});
test('password reset token is single-use, expires, and rechecks the current target role', async () => {
  const usable = harness({
    profiles: { target: { ...student, isFirstLogin: true, initial_password: 'temporary' } },
    documents: { 'password_reset_tokens/reset': { user_id: 'target', token_hash: 'hash:fixture', purpose: 'self_service', expires_at: new Date(Date.now() + 60_000), used_at: null } },
  });
  const changed = await usable.load('app/api/auth/password-reset/route.ts').PATCH(request('/api/auth/password-reset', { token: 'fixture', password: 'new-password' }, ''));
  assert.equal(changed.status, 200);
  assert.deepEqual(usable.authWrites, [{ uid: 'target', password: 'new-password' }]);
  assert.ok(usable.calls.includes('revoke:target'));
  assert.equal(usable.data.get('users/target').isFirstLogin, false);
  assert.equal(usable.data.get('password_reset_tokens/reset').used_at, 'now');

  const cases = [
    { token: { user_id: 'target', token_hash: 'hash:fixture', expires_at: new Date(Date.now() - 1), used_at: null }, profile: student, error: 'token-expired' },
    { token: { user_id: 'target', token_hash: 'hash:fixture', expires_at: new Date(Date.now() + 60_000), used_at: 'already-used' }, profile: student, error: 'token-used' },
    { token: { user_id: 'target', token_hash: 'hash:fixture', expires_at: new Date(Date.now() + 60_000), used_at: null }, profile: master, error: 'reset-target-not-allowed' },
  ];
  for (const item of cases) {
    const h = harness({ profiles: { target: item.profile }, documents: { 'password_reset_tokens/reset': item.token } });
    const response = await h.load('app/api/auth/password-reset/route.ts').PATCH(request('/api/auth/password-reset', { token: 'fixture', password: 'new-password' }, ''));
    assert.equal(response.status, 400);
    assert.equal((await response.json()).error, item.error);
    assert.equal(h.authWrites.length, 0);
  }
});
test('password recovery supports imported login IDs and a Firebase-managed delivery fallback', () => {
  const requestSource = fs.readFileSync(path.resolve(sourceRoot, 'app/api/auth/password-reset/request/route.ts'), 'utf8');
  const deliverySource = fs.readFileSync(path.resolve(sourceRoot, 'lib/server/password-recovery.ts'), 'utf8');
  assert.match(requestSource, /['"]login_id['"]/);
  assert.match(deliverySource, /if \(!collectionName\)[\s\S]+sendFirebaseManagedVerificationEmail/);
});
test('student transfer prompt can be dismissed when no transfer candidates exist', () => {
  const source = fs.readFileSync(path.resolve(sourceRoot, 'app/student/page.tsx'), 'utf8');
  assert.match(source, /requiredTransfer\.options\.length === 0/);
  assert.match(source, /aria-label="振替先選択を閉じる"/);
  assert.match(source, /閉じて後で選択する/);
});
test('credential sync authorizes every alias before any Auth password write', async () => {
  const h = harness({ profiles: { student, master }, authUsers: { student: { email: student.email }, master: { email: master.email } } });
  await assert.rejects(() => h.load('lib/server/account-credentials.ts').syncAuthAccountCredentials({ actor, loginId: 'student', email: master.email, preferredUid: 'student', password: 'safe-password', displayName: 'Student' }), /forbidden/);
  assert.equal(h.authWrites.length, 0);
});
test('new account login email follows the login ID even when a contact email is supplied', () => {
  const { accountEmailCandidates } = harness().load('lib/server/account-credentials.ts');
  assert.deepEqual(Array.from(accountEmailCandidates('KDLVULSERVICE2811', 'service2811@proactivedefense.jp')), [
    'kdlvulservice2811@classbase.local',
    'kdlvulservice2811@sozogakuen.co.jp',
    'service2811@proactivedefense.jp',
  ]);
  assert.equal(accountEmailCandidates('staff@example.test', 'contact@example.test')[0], 'staff@example.test');
});
test('credential sync rejects unknown Auth owner and keeps legitimate account update', async () => {
  for (const present of [false, true]) {
    const h = harness({ profiles: present ? { student } : {}, authUsers: { student: { email: student.email } } });
    const call = () => h.load('lib/server/account-credentials.ts').syncAuthAccountCredentials({ actor, loginId: 'student', password: 'safe-password', displayName: 'Student' });
    if (!present) { await assert.rejects(call, /forbidden/); assert.equal(h.authWrites.length, 0); }
    else { assert.equal((await call()).uid, 'student'); assert.equal(h.authWrites.length, 1); assert.ok(h.calls.includes('revoke:student')); }
  }
});
test('profile-only account updates do not reset passwords or revoke active sessions', async () => {
  const profile = { ...student, initial_password: 'safe-password', raw_password: 'safe-password' };
  const h = harness({
    profiles: { student: profile },
    authUsers: { student: { email: student.email, displayName: 'Old Name', disabled: false } },
  });
  const result = await h.load('lib/server/account-credentials.ts').syncAuthAccountCredentials({
    actor, loginId: 'student', password: '', displayName: 'New Name', disabled: false,
  });
  assert.equal(result.uid, 'student');
  assert.deepEqual(h.authWrites, [{ uid: 'student', displayName: 'New Name' }]);
  assert.equal(h.calls.includes('revoke:student'), false);
  assert.equal(result.reauth_required, false);
});
test('editing the active account reports reauthentication only when credentials changed', async () => {
  const h = harness({
    profiles: { actor: { ...master, initial_password: 'old-password' } },
    authUsers: { actor: { email: master.email, displayName: 'Master', disabled: false } },
  });
  const result = await h.load('lib/server/account-credentials.ts').syncAuthAccountCredentials({
    actor: { uid: 'actor', role: 'master', school: '999', school_ids: ['999'], profile: master },
    loginId: master.email, password: 'new-password', displayName: 'Master', disabled: false, preferredUid: 'actor',
  });
  assert.equal(result.reauth_required, true);
  assert.ok(h.calls.includes('revoke:actor'));
});
test('account creation preflights parent alias before mutating primary account', async () => {
  const h = harness({ profiles: { actor: admin, student, master }, authUsers: { student: { email: student.email }, master: { email: master.email } } });
  const response = await h.load('app/api/admin/accounts/create/route.ts').POST(request('/api/admin/accounts/create', {
    role: 'student', login_id: 'student', user_id: 'student', display_name: 'Student', school_id: '112', password: 'safe-password', parent_email: master.email,
  }));
  assert.equal(response.status, 403); assert.equal(h.authWrites.length, 0); assert.equal(h.writes.length, 0);
});
test('school admins cannot change staff passwords; master changes after first login are not stored', async () => {
  const target = { ...teacher, isFirstLogin: false, initial_password: 'old-secret', raw_password: 'old-secret' };
  const denied = harness({ profiles: { actor: admin, target } });
  const deniedResponse = await denied.load('app/api/admin/accounts/password/route.ts').POST(request('/api/admin/accounts/password', {
    user_id: 'target', password: 'new-secret',
  }));
  assert.equal(deniedResponse.status, 403);
  assert.equal(denied.authWrites.length, 0);

  const allowed = harness({ profiles: { actor: master, target } });
  const response = await allowed.load('app/api/admin/accounts/password/route.ts').POST(request('/api/admin/accounts/password', {
    user_id: 'target', password: 'new-secret',
  }));
  assert.equal(response.status, 200);
  assert.deepEqual(allowed.authWrites, [{ uid: 'target', password: 'new-secret' }]);
  assert.ok(allowed.calls.includes('revoke:target'));
  assert.equal(allowed.data.get('users/target').initial_password, 'deleted');
  assert.equal(allowed.data.get('users/target').raw_password, 'deleted');
  assert.equal((await response.json()).reauth_required, false);
});
test('school admins can change passwords only for students and parents of their own school', async () => {
  const route = 'app/api/admin/accounts/password/route.ts';
  const ownStudent = { ...student, isFirstLogin: false };
  const ownParent = { role: 'parent', school_id: '112', school: '112', isFirstLogin: true };
  const otherStudent = { ...student, school: '113', school_id: '113' };
  const noSchoolParent = { role: 'parent' };
  const otherAdmin = { ...admin };
  const h = harness({ profiles: { actor: admin, ownStudent, ownParent, otherStudent, noSchoolParent, otherAdmin } });
  for (const userId of ['otherStudent', 'noSchoolParent', 'otherAdmin']) {
    const denied = await h.load(route).POST(request('/api/admin/accounts/password', { user_id: userId, password: 'new-secret' }));
    assert.equal(denied.status, 403, userId);
  }
  assert.equal(h.authWrites.length, 0);

  const changed = await h.load(route).POST(request('/api/admin/accounts/password', { user_id: 'ownStudent', password: 'abc123' }));
  assert.equal(changed.status, 200);
  assert.equal(h.data.get('users/ownStudent').initial_password, 'deleted');
  const parentChanged = await h.load(route).POST(request('/api/admin/accounts/password', { user_id: 'ownParent', password: 'parent1' }));
  assert.equal(parentChanged.status, 200);
  assert.equal(h.data.get('users/ownParent').initial_password, 'parent1');
  assert.deepEqual(h.authWrites.map(write => write.uid), ['ownStudent', 'ownParent']);
  assert.ok(h.calls.includes('revoke:ownStudent'));
});
test('admin account passwords changed by master must meet the 10-character policy', async () => {
  const target = { ...admin, isFirstLogin: false };
  const h = harness({ profiles: { actor: master, target } });
  const short = await h.load('app/api/admin/accounts/password/route.ts').POST(request('/api/admin/accounts/password', { user_id: 'target', password: 'short12' }));
  assert.equal(short.status, 400);
  assert.equal(h.authWrites.length, 0);
});
test('master password change keeps a temporary password only until first login', async () => {
  const target = { ...teacher, isFirstLogin: true, initial_password: 'old-secret' };
  const h = harness({ profiles: { actor: master, target } });
  const response = await h.load('app/api/admin/accounts/password/route.ts').POST(request('/api/admin/accounts/password', {
    user_id: 'target', password: 'new-secret',
  }));
  assert.equal(response.status, 200);
  assert.equal(h.data.get('users/target').initial_password, 'new-secret');
  assert.equal(h.data.get('users/target').raw_password, 'new-secret');
});
test('demoted users cannot retain stored admin app permissions', () => {
  const h = harness(); const policy = h.load('lib/admin-app-permissions.ts');
  for (const role of ['student', 'teacher', 'parent', 'not_an_admin']) assert.equal(policy.hasAdminAppPermission(role, { admin_permissions: { attendance: true } }, 'attendance'), false);
  assert.equal(policy.hasAdminAppPermission('admin', { admin_permissions: { attendance: true } }, 'attendance'), true);
  assert.equal(policy.adminAppForPath('/master/attendance-approvals'), 'attendance');
  assert.equal(policy.adminAppForPath('/master/shifts'), 'science_social');
});

test('shift management is editable by masters and dedicated attendance approvers, while school admins are read-only', () => {
  const source = fs.readFileSync(path.resolve(sourceRoot, 'app/master/layout.tsx'), 'utf8');
  assert.match(source, /const canUseShifts = Boolean/);
  assert.match(source, /hasAdminAppPermission\(effectiveProfile\.role, effectiveProfile, 'science_social'\)/);
  assert.match(source, /isDedicatedAttendanceApproverProfile\(effectiveProfile\)/);
  // メニューの表示判定は共通のメニュー定義に移した。
  const menu = fs.readFileSync(path.resolve(sourceRoot, 'app/components/master/admin-menu.ts'), 'utf8');
  assert.match(menu, /item\.key === 'shifts' && !viewer\.canUseShifts/);
  const auth = fs.readFileSync(path.resolve(sourceRoot, 'lib/server-auth.ts'), 'utf8');
  assert.match(auth, /export function canManageShifts/);
  for (const route of [
    'app/api/admin/shifts/relink/route.ts',
    'app/api/admin/shifts/unassigned-notifications/route.ts',
    'app/api/admin/shifts/[shiftId]/passcode/route.ts',
    'app/api/admin/shifts/sync/route.ts',
  ]) assert.match(fs.readFileSync(path.resolve(sourceRoot, route), 'utf8'), /canManageShifts/);

  const h = harness();
  const policy = h.load('lib/server-auth.ts');
  const asUser = (profile) => ({ uid: 'actor', role: profile.role, school: '112', school_ids: ['112'], profile });
  assert.equal(policy.canManageShifts(asUser(master)), true);
  assert.equal(policy.canManageShifts(asUser(admin)), false);
  assert.equal(policy.canManageShifts(asUser({ ...admin, admin_permissions: { science_social: false, attendance: true } })), false);
  assert.equal(policy.canManageShifts(asUser({ ...teacher, employment_category: 'dedicated', attendance_school_manager: true })), true);
  assert.equal(policy.canManageShifts(asUser({ ...teacher, employment_category: 'dedicated', attendance_school_manager: false })), false);
  assert.equal(policy.canManageShifts(asUser({ ...teacher, employment_category: 'semi_dedicated', attendance_school_manager: true })), false);
});

test('attendance approval center rejects science-only admins and keeps attendance admins', async () => {
  const scienceOnly = harness({ profiles: { actor: admin } });
  const denied = await scienceOnly.load('app/api/attendance-detail-approvals/route.ts').GET(
    request('/api/attendance-detail-approvals?month=2026-09', null, 'valid', 'GET')
  );
  assert.equal(denied.status, 403);

  const attendanceAdmin = { ...admin, admin_permissions: { science_social: false, attendance: true } };
  const attendance = harness({ profiles: { actor: attendanceAdmin, target: teacher }, documents: {
    'work_records/record': {
      teacher_id: 'target', teacher_name: 'Teacher One', date: '2026-09-05',
      start_time: '2026-09-05T09:00:00+09:00', end_time: '2026-09-05T10:00:00+09:00',
      work_segments: [{ id: 'segment', type: 'lesson', program: 'science_social', start: '09:00', end: '10:00' }],
    },
  } });
  const allowed = await attendance.load('app/api/attendance-detail-approvals/route.ts').GET(
    request('/api/attendance-detail-approvals?month=2026-09', null, 'valid', 'GET')
  );
  assert.equal(allowed.status, 200);
  const body = await allowed.json();
  assert.equal(body.records[0].work_segments[0].school_id, '112');
  assert.equal(body.records[0].work_segments[0].school_name, '創造学園 オンライン校');
  assert.equal(body.records[0].work_segments[0].can_review, true);
  const approval = await attendance.load('app/api/attendance-detail-approvals/route.ts').POST(request('/api/attendance-detail-approvals', {
    work_record_id: 'record', segment_id: 'segment', status: 'approved',
  }));
  assert.equal(approval.status, 200);
  assert.equal(attendance.data.get('work_records/record').work_segments[0].approval_status, 'approved');
});

test('attendance approval center keeps clock-only records without an end time visible', async () => {
  const attendanceAdmin = { ...admin, admin_permissions: { science_social: false, attendance: true } };
  const h = harness({ profiles: { actor: attendanceAdmin, target: teacher }, documents: {
    'work_records/kakimoto': {
      teacher_id: 'target', teacher_name: '柿本　美紘', date: '2026-10-01', school_id: '112', status: 'pending',
      start_time: '2026-10-01T07:40:19.741Z', end_time: null, work_segments: [],
    },
  } });
  const response = await h.load('app/api/attendance-detail-approvals/route.ts').GET(
    request('/api/attendance-detail-approvals?month=2026-10', null, 'valid', 'GET')
  );
  assert.equal(response.status, 200);
  const body = await response.json();
  const record = body.records.find(item => item.id === 'kakimoto');
  assert.ok(record, '退勤時刻がない打刻でも一覧から消してはならない');
  assert.equal(record.detail_missing, true);
  assert.equal(record.can_edit_clock, true);
});

test('attendance-only managers can list same-school staff and create a clock-only work record', async () => {
  const attendanceOnly = {
    role: 'attendance_only', school: '112', school_id: '112', school_ids: ['112'], name: 'Attendance Manager',
  };
  const target = { ...teacher, employment_category: 'semi_dedicated' };
  const h = harness({ profiles: { actor: attendanceOnly, target } });

  const listing = await h.load('app/api/attendance-detail-approvals/route.ts').GET(
    request('/api/attendance-detail-approvals?staff_only=1', null, 'valid', 'GET')
  );
  assert.equal(listing.status, 200);
  assert.ok((await listing.json()).staff.some(item => item.id === 'target'));

  const creation = await h.load('app/api/attendance-detail-approvals/route.ts').POST(request('/api/attendance-detail-approvals', {
    action: 'create_record', teacher_id: 'target', date: '2026-10-08',
    start: '16:50', end: '22:00', school_id: '112', clock_only: true,
  }));
  assert.equal(creation.status, 200, JSON.stringify(await creation.clone().json()));
  const record = h.data.get('work_records/generated');
  assert.equal(record.teacher_id, 'target');
  assert.equal(record.school_id, '112');
  assert.equal(record.work_segments.length, 0);
  assert.equal(record.creation_source, 'manager_clock_only');
});

test('attendance managers can create and revise transportation with an audit trail', async () => {
  const attendanceOnly = {
    role: 'attendance_only', school: '112', school_id: '112', school_ids: ['112'], name: 'Attendance Manager',
  };
  const target = { ...teacher, employment_category: 'semi_dedicated' };
  const h = harness({ profiles: { actor: attendanceOnly, target } });
  const route = h.load('app/api/attendance-detail-approvals/route.ts');
  const creation = await route.POST(request('/api/attendance-detail-approvals', {
    action: 'create_record', teacher_id: 'target', date: '2026-10-08', start: '16:50', end: '22:00',
    school_id: '112', clock_only: true,
    transportation: [{ transport_type: 'train', route_line: '地下鉄', from: '西神中央', to: '元町', trip_type: 'round_trip', cost: 840 }],
    transportation_status: 'entered',
  }));
  assert.equal(creation.status, 200);
  assert.equal(h.data.get('work_records/generated').transportation[0].cost, 840);

  const existing = {
    teacher_id: 'target', teacher_name: 'Teacher One', date: '2026-10-09', school_id: '112', status: 'pending',
    start_time: '2026-10-09T07:50:00.000Z', end_time: '2026-10-09T09:00:00.000Z', work_segments: [],
    transportation: [{ transport_type: 'train', from: '西神中央', to: '元町', trip_type: 'round_trip', cost: 840 }], transportation_status: 'entered',
  };
  const updateHarness = harness({ profiles: { actor: attendanceOnly, target }, documents: { 'work_records/existing': existing } });
  const update = await updateHarness.load('app/api/attendance-detail-approvals/route.ts').POST(request('/api/attendance-detail-approvals', {
    action: 'save_transportation', work_record_id: 'existing',
    transportation: [{ transport_type: 'bus', from: '元町', to: '本部', trip_type: 'one_way', cost: 230 }],
    transportation_status: 'entered',
  }));
  assert.equal(update.status, 200, JSON.stringify(await update.clone().json()));
  assert.equal(updateHarness.data.get('work_records/existing').transportation[0].transport_type, 'bus');
  assert.equal(updateHarness.data.get('work_records/existing').transportation_status, 'entered');
  assert.ok(updateHarness.writes.some(path => path.startsWith('attendance_record_edits/')));
});

test('attendance managers can revise breaks only when the full shift remains covered', async () => {
  const attendanceOnly = {
    role: 'attendance_only', school: '112', school_id: '112', school_ids: ['112'], name: 'Attendance Manager',
  };
  const record = {
    teacher_id: 'target', teacher_name: 'Teacher One', date: '2026-10-08', school_id: '112', status: 'pending',
    start_time: '2026-10-08T00:00:00.000Z', end_time: '2026-10-08T09:00:00.000Z',
    work_segments: [
      { id: 'work-one', type: 'office', office_task: 'lesson_preparation', program: 'normal', school_id: '112', start: '09:00', end: '12:00' },
      { id: 'break', type: 'break', program: 'normal', start: '12:00', end: '13:00', note: '休憩（自動）' },
      { id: 'work-two', type: 'office', office_task: 'lesson_preparation', program: 'normal', school_id: '112', start: '13:00', end: '18:00' },
    ],
  };
  const h = harness({ profiles: { actor: attendanceOnly, target: { ...teacher, employment_category: 'semi_dedicated' } }, documents: { 'work_records/record': record } });
  const response = await h.load('app/api/attendance-detail-approvals/route.ts').POST(request('/api/attendance-detail-approvals', {
    action: 'save_segments', work_record_id: 'record', segments: record.work_segments,
  }));
  assert.equal(response.status, 200, JSON.stringify(await response.clone().json()));
  assert.equal(h.data.get('work_records/record').work_segments.find(item => item.id === 'break').type, 'break');
});

test('teacher clock-in accepts any registered workplace regardless of profile school', async () => {
  const h = harness({ profiles: { actor: { ...teacher, school: '112', school_id: '112' } }, now: '2026-10-09T10:00:00.000Z' });
  const response = await h.load('app/api/teacher/attendance-clock/route.ts').POST(request('/api/teacher/attendance-clock', {
    action: 'clock_in', school_id: '178',
  }));
  assert.equal(response.status, 200);
  assert.equal(h.data.get('work_records/generated').teacher_id, 'actor');
  assert.equal(h.data.get('work_records/generated').school_id, '178');
  assert.equal(h.data.get('work_records/generated').school_name, '創造学園 元町校');

  const invalid = harness({ profiles: { actor: teacher }, now: '2026-10-09T10:00:00.000Z' });
  assert.equal((await invalid.load('app/api/teacher/attendance-clock/route.ts').POST(request('/api/teacher/attendance-clock', {
    action: 'clock_in', school_id: 'not-a-school',
  }))).status, 400);
  assert.equal(invalid.writes.length, 0);
});

test('teacher saves four attendance details at once without an individual grade', async () => {
  const h = harness({
    profiles: { actor: { ...teacher, school_id: '112' } },
    documents: {
      'work_records/work': {
        teacher_id: 'actor', date: '2026-10-04', status: 'pending',
        start_time: '2026-10-04T07:40:00.000Z', end_time: '2026-10-04T10:20:00.000Z',
        work_segments: [], transportation: [],
      },
    },
  });
  const workSegments = [
    { start: '16:40', end: '16:50', type: 'office', program: 'normal', school_id: '178', office_task: 'other', note: '事務前半' },
    { start: '16:50', end: '18:00', type: 'individual', program: 'normal', school_id: '178', individual_level: 'standard', individual_ratio: '1:2', note: '個別1' },
    { start: '18:00', end: '18:10', type: 'office', program: 'normal', school_id: '178', office_task: 'other', note: '事務後半' },
    { start: '18:10', end: '19:20', type: 'individual', program: 'normal', school_id: '178', individual_level: 'advanced', individual_ratio: '1:3', note: '個別2' },
  ];
  const response = await h.load('app/api/teacher/attendance-details/route.ts').POST(request('/api/teacher/attendance-details', {
    work_record_id: 'work', work_segments: workSegments, transportation: [{ from: '誤入力', to: '誤入力', cost: 500 }], transportation_status: 'none',
  }));
  assert.equal(response.status, 200);
  assert.equal((await response.json()).segment_count, 4);
  const saved = h.data.get('work_records/work');
  assert.equal(saved.work_segments.length, 4);
  assert.equal(saved.work_segments[1].grade, undefined);
  assert.equal(saved.work_segments[1].payroll_tier, 'individual_2');
  assert.equal(saved.work_segments[3].payroll_tier, 'individual_6');
  assert.equal(saved.transportation_status, 'none');
  assert.equal(saved.transportation.length, 0);
});

test('attendance correction approval updates the pending request and matching work record together', async () => {
  const attendanceAdmin = { ...admin, admin_permissions: { science_social: false, attendance: true } };
  const h = harness({
    profiles: { actor: attendanceAdmin, target: teacher },
    documents: {
      'work_records/work': {
        teacher_id: 'target', teacher_name: 'Teacher One', date: '2026-07-31', status: 'pending',
        start_time: '2026-07-31T09:00:00.000Z', end_time: '2026-07-31T10:00:00.000Z',
      },
      'attendance_correction_requests/correction': {
        teacher_id: 'target', school_id: '112', target_date: '2026-07-31', status: 'pending',
        request_type: 'time_correction', work_record_id: 'work',
        requested_start_time: '2026-07-30T23:30:00.000Z', requested_end_time: '2026-07-31T01:00:00.000Z',
      },
    },
    overrides: { '@/lib/events': { writeLearningEvent: async () => 'event' } },
  });
  const response = await h.load('app/api/attendance-corrections/route.ts').POST(request('/api/attendance-corrections', {
    action: 'review', request_id: 'correction', status: 'approved',
  }));
  assert.equal(response.status, 200);
  assert.equal(h.data.get('attendance_correction_requests/correction').status, 'approved');
  assert.equal(h.data.get('work_records/work').start_time, '2026-07-30T23:30:00.000Z');
  assert.equal(h.data.get('work_records/work').end_time, '2026-07-31T01:00:00.000Z');
});

test('attendance correction approval normalizes legacy seconds to the previous five-minute mark', async () => {
  const attendanceAdmin = { ...admin, admin_permissions: { science_social: false, attendance: true } };
  const h = harness({
    profiles: { actor: attendanceAdmin, target: teacher },
    documents: {
      'work_records/work': {
        teacher_id: 'target', teacher_name: 'Teacher One', school_id: '112', date: '2026-10-01', status: 'pending',
        start_time: '2026-10-01T00:00:12.000Z', end_time: '2026-10-01T01:00:49.000Z',
      },
      'attendance_correction_requests/correction': {
        teacher_id: 'target', school_id: '112', target_date: '2026-10-01', status: 'pending',
        request_type: 'time_correction', work_record_id: 'work',
        requested_start_time: '2026-10-01T00:02:12.000Z', requested_end_time: '2026-10-01T01:08:49.000Z',
      },
    },
    overrides: { '@/lib/events': { writeLearningEvent: async () => 'event' } },
  });
  const response = await h.load('app/api/attendance-corrections/route.ts').POST(request('/api/attendance-corrections', {
    action: 'review', request_id: 'correction', status: 'approved',
  }));
  assert.equal(response.status, 200);
  assert.equal(h.data.get('work_records/work').start_time, '2026-10-01T00:00:00.000Z');
  assert.equal(h.data.get('work_records/work').end_time, '2026-10-01T01:05:00.000Z');
});

test('approved attendance can be corrected only through a reviewed correction request', async () => {
  const teacherHarness = harness({
    profiles: { actor: { ...teacher, school_id: '112' } },
    documents: {
      'work_records/work': {
        teacher_id: 'actor', teacher_name: 'Teacher One', school_id: '112', date: '2026-10-01', status: 'approved',
        start_time: '2026-10-01T00:00:00.000Z', end_time: '2026-10-01T01:00:00.000Z',
      },
    },
    overrides: { '@/lib/events': { writeLearningEvent: async () => 'event' } },
  });
  const requested = await teacherHarness.load('app/api/attendance-corrections/route.ts').POST(request('/api/attendance-corrections', {
    action: 'request', work_record_id: 'work',
    requested_start_time: '2026-10-01T00:05:00.000Z', requested_end_time: '2026-10-01T01:05:00.000Z',
    reason: '承認後に打刻誤りが判明',
  }));
  assert.equal(requested.status, 200, JSON.stringify(await requested.clone().json()));
  assert.equal(teacherHarness.data.get('work_records/work').start_time, '2026-10-01T00:00:00.000Z');
  assert.equal(teacherHarness.data.get('attendance_correction_requests/generated').status, 'pending');

  const attendanceAdmin = { ...admin, admin_permissions: { science_social: false, attendance: true } };
  const adminHarness = harness({
    profiles: { actor: attendanceAdmin, target: teacher },
    documents: {
      'work_records/work': {
        teacher_id: 'target', teacher_name: 'Teacher One', school_id: '112', date: '2026-10-01', status: 'approved',
        start_time: '2026-10-01T00:00:00.000Z', end_time: '2026-10-01T01:00:00.000Z',
      },
      'attendance_correction_requests/correction': {
        teacher_id: 'target', school_id: '112', target_date: '2026-10-01', status: 'pending',
        request_type: 'time_correction', work_record_id: 'work',
        requested_start_time: '2026-10-01T00:05:00.000Z', requested_end_time: '2026-10-01T01:05:00.000Z',
      },
    },
    overrides: { '@/lib/events': { writeLearningEvent: async () => 'event' } },
  });
  const approved = await adminHarness.load('app/api/attendance-corrections/route.ts').POST(request('/api/attendance-corrections', {
    action: 'review', request_id: 'correction', status: 'approved',
  }));
  assert.equal(approved.status, 200, JSON.stringify(await approved.clone().json()));
  assert.equal(adminHarness.data.get('attendance_correction_requests/correction').status, 'approved');
  assert.equal(adminHarness.data.get('work_records/work').status, 'approved');
  assert.equal(adminHarness.data.get('work_records/work').start_time, '2026-10-01T00:05:00.000Z');
  assert.equal(adminHarness.data.get('work_records/work').end_time, '2026-10-01T01:05:00.000Z');
});

test('attendance approval center owns pending corrections and displays the workplace', () => {
  const source = fs.readFileSync(path.resolve(sourceRoot, 'app/components/AttendanceApprovalsWorkspace.tsx'), 'utf8');
  assert.match(source, /attendance-corrections\?scope=admin&status=pending&month=/);
  assert.match(source, /勤務校舎: \$\{item\.school_name/);
  assert.match(source, /item\.school_id/);
  assert.match(source, /勤務区分: 理社講座/);
  assert.match(source, /選択した\{selectedCount\}件を一括承認/);
  assert.match(source, /visibleCorrections/);
  assert.match(source, /profile\?\.role === 'master' && reconciliationAlerts\.length/);
  assert.match(source, /officeTask: 'lesson_preparation'/);
  assert.match(source, /office_task: 'lesson_preparation'/);
  const teacherPage = fs.readFileSync(path.resolve(sourceRoot, 'app/teacher/attendance/page.tsx'), 'utf8');
  assert.match(teacherPage, /current\.office_task = current\.office_task \|\| 'lesson_preparation'/);
  assert.match(teacherPage, /editingRecord\.start_time/);
  assert.match(teacherPage, /editingRecord\.end_time/);
  const timePicker = fs.readFileSync(path.resolve(sourceRoot, 'app/components/FiveMinuteTimePicker.tsx'), 'utf8');
  assert.match(timePicker, /length: 24/);
  assert.match(timePicker, /length: 12/);
  const workDetail = harness().load('lib/attendance-work-detail.ts');
  assert.equal(workDetail.OFFICE_TASK_OPTIONS[0].value, 'lesson_preparation');
  assert.ok(workDetail.OFFICE_TASK_OPTIONS.some(option => option.value === 'instruction_report'));
  const attendancePage = fs.readFileSync(path.resolve(sourceRoot, 'app/master/attendance/page.tsx'), 'utf8');
  assert.doesNotMatch(attendancePage, /\/api\/attendance-corrections/);
  assert.doesNotMatch(attendancePage, /collection\(db,\s*['"]attendance_correction_requests['"]\)/);
  assert.equal(fs.existsSync(path.resolve(sourceRoot, 'app/master/attendance-corrections/page.tsx')), false);
  assert.equal(fs.existsSync(path.resolve(sourceRoot, 'app/components/AttendanceApprovalsClient.tsx')), false);
});

test('attendance correction identifies a science-social clock-in as its workplace', async () => {
  const h = harness({
    profiles: { actor: master, target: teacher },
    documents: {
      'work_records/science': {
        teacher_id: 'target', teacher_name: 'Science Teacher', date: '2026-10-06', status: 'pending',
        school_id: null, school_name: '理社講座', workplace_type: 'science_social', default_program: 'science_social',
        start_time: '2026-10-06T10:00:00.000Z', end_time: '2026-10-06T11:00:00.000Z', work_segments: [],
      },
      'attendance_correction_requests/science-request': {
        work_record_id: 'science', teacher_id: 'target', school_id: '112', target_date: '2026-10-06', status: 'pending',
        requested_start_time: '2026-10-06T10:05:00.000Z', requested_end_time: '2026-10-06T11:05:00.000Z',
      },
    },
  });
  const response = await h.load('app/api/attendance-corrections/route.ts').GET(
    request('/api/attendance-corrections?scope=admin&month=2026-10', null, 'valid', 'GET')
  );
  assert.equal(response.status, 200);
  const items = (await response.json()).requests;
  assert.equal(items.length, 1);
  assert.equal(items[0].school_id, 'science_social');
  assert.equal(items[0].school_name, '理社講座');
});

test('teacher attendance history remains visible while the composite index is unavailable', () => {
  const source = fs.readFileSync(path.resolve(sourceRoot, 'app/teacher/attendance/page.tsx'), 'utf8');
  assert.match(source, /error\?\.code[^\n]+failed-precondition/);
  assert.match(source, /where\(['"]teacher_id['"],\s*['"]==['"],\s*user\.uid\)/);
  assert.match(source, /setHistoryError\(['"]勤務履歴を読み込めませんでした/);

  const indexes = JSON.parse(fs.readFileSync(path.resolve(sourceRoot, 'firestore.indexes.json'), 'utf8'));
  const historyIndex = indexes.indexes.find(index => index.collectionGroup === 'work_records'
    && index.fields.map(field => field.fieldPath).join(',') === 'teacher_id,date,created_at');
  assert.ok(historyIndex, 'work_records monthly history index must be deployed');
  // 合計勤務時間は休憩以外の全区分（個別・その他を含む）を合算する
  assert.match(source, /calcSegmentsMinutes\(segments, seg => seg\.type !== ['"]break['"]\)/);
});

test('attendance corrections route legacy requests to the workplace approver instead of the affiliation approver', async () => {
  const approver = schoolId => ({
    role: 'teacher', school_id: schoolId, school_ids: [schoolId], employment_category: 'dedicated',
    attendance_school_manager: true, name: `Approver ${schoolId}`,
  });
  const documents = {
    'work_records/record': {
      teacher_id: 'target', teacher_name: 'Transferred Teacher', school_id: '161', date: '2026-09-25', status: 'pending',
      start_time: '2026-09-25T07:50:00.000Z', end_time: '2026-09-25T09:00:00.000Z', work_segments: [],
    },
    // 旧データは所属校興112で保存されていた。勤務実績の161を正とする。
    'attendance_correction_requests/request': {
      work_record_id: 'record', teacher_id: 'target', school_id: '112', target_date: '2026-09-25', status: 'pending',
      requested_start_time: '2026-09-25T08:00:00.000Z', requested_end_time: '2026-09-25T09:10:00.000Z',
    },
  };
  const workplace = harness({ profiles: { actor: approver('161'), target: teacher }, documents });
  const workplaceList = await workplace.load('app/api/attendance-corrections/route.ts').GET(
    request('/api/attendance-corrections?scope=admin&month=2026-09', null, 'valid', 'GET')
  );
  assert.equal(workplaceList.status, 200);
  const workplaceItems = (await workplaceList.json()).requests;
  assert.equal(workplaceItems.length, 1);
  assert.equal(workplaceItems[0].school_id, '161');
  assert.equal(workplaceItems[0].work_record_date, '2026-09-25');
  assert.equal(workplaceItems[0].current_start_time, '2026-09-25T07:50:00.000Z');
  const approval = await workplace.load('app/api/attendance-corrections/route.ts').POST(request('/api/attendance-corrections', {
    action: 'review', request_id: 'request', status: 'approved',
  }));
  assert.equal(approval.status, 200);
  assert.equal(workplace.data.get('work_records/record').start_time, '2026-09-25T08:00:00.000Z');

  const affiliation = harness({ profiles: { actor: approver('112'), target: teacher }, documents });
  const affiliationList = await affiliation.load('app/api/attendance-corrections/route.ts').GET(
    request('/api/attendance-corrections?scope=admin&month=2026-09', null, 'valid', 'GET')
  );
  assert.equal((await affiliationList.json()).requests.length, 0);
  const denied = await affiliation.load('app/api/attendance-corrections/route.ts').POST(request('/api/attendance-corrections', {
    action: 'review', request_id: 'request', status: 'approved',
  }));
  assert.equal(denied.status, 403);
});

test('attendance correction requests require a workplace and five-minute input', async () => {
  const base = {
    action: 'request', target_date: '2026-09-25',
    requested_start_time: '2026-09-25T07:50:00.000Z', requested_end_time: '2026-09-25T09:00:00.000Z', reason: '打刻忘れ',
  };
  const h = harness({ profiles: { actor: teacher } });
  const missingSchool = await h.load('app/api/attendance-corrections/route.ts').POST(request('/api/attendance-corrections', base));
  assert.equal(missingSchool.status, 400);
  assert.equal((await missingSchool.json()).error, 'work school is required');

  const offGrid = await h.load('app/api/attendance-corrections/route.ts').POST(request('/api/attendance-corrections', {
    ...base, school_id: '112', requested_start_time: '2026-09-25T07:52:00.000Z',
  }));
  assert.equal(offGrid.status, 400);
  assert.equal((await offGrid.json()).error, 'requested time must be in 5 minute increments');
});

test('payroll no longer loads or displays correction requests', () => {
  const apiSource = fs.readFileSync(path.resolve(sourceRoot, 'app/api/attendance-payroll/route.ts'), 'utf8');
  const pageSource = fs.readFileSync(path.resolve(sourceRoot, 'app/master/attendance/payroll/page.tsx'), 'utf8');
  assert.doesNotMatch(apiSource, /attendance_correction_requests/);
  assert.doesNotMatch(apiSource, /correction_requests/);
  assert.doesNotMatch(pageSource, /全校舎の打刻修正依頼/);
  assert.doesNotMatch(pageSource, /correctionSchoolFilter/);
  assert.doesNotMatch(pageSource, /attendance-corrections/);
});

test('regular attendance xlsx uses the authenticated chunk API instead of direct Firebase Storage', () => {
  const pageSource = fs.readFileSync(path.resolve(sourceRoot, 'app/master/attendance/payroll/page.tsx'), 'utf8');
  const apiSource = fs.readFileSync(path.resolve(sourceRoot, 'app/api/attendance-payroll/route.ts'), 'utf8');
  assert.doesNotMatch(pageSource, /firebase\/storage/);
  assert.doesNotMatch(pageSource, /temporaryStoragePath|uploadBytes\(/);
  assert.match(pageSource, /const usesChunkUpload = isXlsx \|\| chunkedLegacyXls/);
  assert.match(pageSource, /action: isXlsx \? 'import_regular_attendance'/);
  assert.match(apiSource, /'import_allowance_query', 'import_regular_attendance'/);
  assert.match(apiSource, /xlsxBuffer = combined/);
  assert.match(apiSource, /勤怠Excelは6MB以下/);
  assert.match(apiSource, /export const maxDuration = 180/);
  assert.match(apiSource, /\.select\(\)/);
  assert.match(pageSource, /setMonth\(importedMonth\)/);
  assert.match(pageSource, /画面を.*の集計へ切り替えます/);
});

test('regular attendance xlsx chunks are reassembled and imported by the authenticated server API', async () => {
  const h = harness({
    profiles: { actor: master },
    overrides: {
      '@/lib/attendance-xlsx': {
        parseRegularAttendanceXlsx: async buffer => {
          assert.deepEqual([...buffer], [80, 75, 3, 4, 9, 8]);
          return { errors: [], warnings: [], data: [{
            person_code: '1', person_name: 'Test Teacher', normalized_name: 'testteacher',
            date: '2026-10-01', start_time: '09:00', end_time: '10:00', actual_minutes: 60,
          }] };
        },
      },
    },
  });
  const uploadId = '255311d7-e984-449a-a13e-d9d72645994a';
  for (const [index, bytes] of [[0, [80, 75, 3, 4]], [1, [9, 8]]]) {
    const response = await h.load('app/api/attendance-payroll/route.ts').POST(new NextRequest('https://security.test/api/attendance-payroll', {
      method: 'POST',
      headers: {
        authorization: 'Bearer valid', 'content-type': 'application/octet-stream',
        'x-attendance-upload-id': uploadId, 'x-attendance-chunk-index': String(index), 'x-attendance-chunk-count': '2',
      },
      body: new Uint8Array(bytes),
    }));
    assert.equal(response.status, 200);
  }
  const imported = await h.load('app/api/attendance-payroll/route.ts').POST(request('/api/attendance-payroll', {
    action: 'import_regular_attendance', source_name: 'attendance.xlsx',
    chunk_upload_id: uploadId, chunk_count: 2, replace_month: true,
  }));
  assert.equal(imported.status, 200);
  assert.equal((await imported.json()).imported, 1);
  assert.ok(h.calls.includes(`delete:attendance_imports/actor/chunks/${uploadId}/0`));
  assert.ok(h.calls.includes(`delete:attendance_imports/actor/chunks/${uploadId}/1`));
});

test('attendance correction approval keeps the request pending when its work record does not match', async () => {
  const attendanceAdmin = { ...admin, admin_permissions: { science_social: false, attendance: true } };
  for (const workRecord of [
    { teacher_id: 'other', date: '2026-07-31' },
    { teacher_id: 'target', date: '2026-08-01' },
  ]) {
    const h = harness({
      profiles: { actor: attendanceAdmin, target: teacher },
      documents: {
        'work_records/work': {
          ...workRecord, status: 'pending', start_time: '2026-07-31T00:00:00.000Z', end_time: '2026-07-31T01:00:00.000Z',
        },
        'attendance_correction_requests/correction': {
          teacher_id: 'target', school_id: '112', target_date: '2026-07-31', status: 'pending',
          request_type: 'time_correction', work_record_id: 'work',
          requested_start_time: '2026-07-31T00:30:00.000Z', requested_end_time: '2026-07-31T01:30:00.000Z',
        },
      },
    });
    const response = await h.load('app/api/attendance-corrections/route.ts').POST(request('/api/attendance-corrections', {
      action: 'review', request_id: 'correction', status: 'approved',
    }));
    assert.equal(response.status, 400);
    assert.equal(h.data.get('attendance_correction_requests/correction').status, 'pending');
    assert.equal(h.data.get('work_records/work').start_time, '2026-07-31T00:00:00.000Z');
  }
});

test('missing-clock approval does not mark the request approved when a same-day record already exists', async () => {
  const attendanceAdmin = { ...admin, admin_permissions: { science_social: false, attendance: true } };
  const h = harness({
    profiles: { actor: attendanceAdmin, target: teacher },
    documents: {
      'work_records/existing': { teacher_id: 'target', date: '2026-07-31', status: 'pending' },
      'attendance_correction_requests/correction': {
        teacher_id: 'target', teacher_name: 'Teacher One', school_id: '112', target_date: '2026-07-31', status: 'pending',
        request_type: 'missing_clock', work_record_id: null,
        requested_start_time: '2026-07-31T00:00:00.000Z', requested_end_time: '2026-07-31T01:00:00.000Z',
      },
    },
  });
  const response = await h.load('app/api/attendance-corrections/route.ts').POST(request('/api/attendance-corrections', {
    action: 'review', request_id: 'correction', status: 'approved',
  }));
  assert.equal(response.status, 400);
  assert.equal(h.data.get('attendance_correction_requests/correction').status, 'pending');
  assert.equal([...h.data.keys()].filter(key => key.startsWith('work_records/')).length, 1);
});

test('missing-clock approval rejects a target date that differs from the submitted clock date', async () => {
  const attendanceAdmin = { ...admin, admin_permissions: { science_social: false, attendance: true } };
  const h = harness({
    profiles: { actor: attendanceAdmin, target: teacher },
    documents: {
      'attendance_correction_requests/correction': {
        teacher_id: 'target', teacher_name: '山田 拓斗', school_id: '112',
        target_date: '2026-10-01', status: 'pending', request_type: 'missing_clock', work_record_id: null,
        requested_start_time: '2026-09-25T09:50:00.000Z', requested_end_time: '2026-09-25T12:55:00.000Z',
      },
    },
  });
  const response = await h.load('app/api/attendance-corrections/route.ts').POST(request('/api/attendance-corrections', {
    action: 'review', request_id: 'correction', status: 'approved',
  }));
  assert.equal(response.status, 400);
  assert.equal((await response.json()).error, 'requested time must be on target date');
  assert.equal(h.data.get('attendance_correction_requests/correction').status, 'pending');
  assert.equal([...h.data.keys()].filter(key => key.startsWith('work_records/')).length, 0);
});

test('campus attendance approvers cannot approve or edit science-social work', async () => {
  const attendanceApprover = {
    role: 'teacher', school_id: '112', school_ids: ['112'], employment_category: 'dedicated',
    attendance_school_manager: true, name: 'Campus Approver',
  };
  const record = {
    teacher_id: 'target', teacher_name: 'Science Teacher', date: '2026-09-05',
    start_time: '2026-09-05T00:00:00.000Z', end_time: '2026-09-05T01:00:00.000Z',
    work_segments: [{ id: 'science', type: 'office', office_task: 'meeting', program: 'science_social', start: '09:00', end: '10:00', approval_status: 'pending' }],
  };
  const h = harness({ profiles: { actor: attendanceApprover, target: teacher }, documents: { 'work_records/record': record } });
  const listing = await h.load('app/api/attendance-detail-approvals/route.ts').GET(
    request('/api/attendance-detail-approvals?month=2026-09', null, 'valid', 'GET')
  );
  assert.equal(listing.status, 200);
  assert.equal((await listing.json()).records[0].work_segments[0].can_review, false);

  const requests = [
    { work_record_id: 'record', segment_id: 'science', status: 'approved' },
    { action: 'approve_selected', items: [{ work_record_id: 'record', segment_id: 'science' }] },
    { action: 'edit_segment', work_record_id: 'record', segment_id: 'science', segment: { type: 'office', office_task: 'training', program: 'science_social', start: '09:00', end: '10:00' } },
    { action: 'save_segments', work_record_id: 'record', segments: [{ id: 'science', type: 'office', office_task: 'training', program: 'normal', school_id: '112', start: '09:00', end: '10:00' }] },
    { action: 'edit_clock', work_record_id: 'record', start_time: '2026-09-05T09:15:00+09:00', end_time: '2026-09-05T10:15:00+09:00' },
    { action: 'delete_record', work_record_id: 'record' },
  ];
  for (const body of requests) {
    const response = await h.load('app/api/attendance-detail-approvals/route.ts').POST(request('/api/attendance-detail-approvals', body));
    assert.equal(response.status, 403, `${String(body.action || 'review')}: ${JSON.stringify(await response.clone().json())}`);
  }
  assert.equal(h.data.get('work_records/record').work_segments[0].approval_status, 'pending');
  assert.equal(h.writes.length, 0);

  const normalRecord = { ...record, work_segments: [{ ...record.work_segments[0], program: 'normal', school_id: '112' }] };
  const conversion = harness({ profiles: { actor: attendanceApprover, target: teacher }, documents: { 'work_records/record': normalRecord } });
  const conversionResponse = await conversion.load('app/api/attendance-detail-approvals/route.ts').POST(request('/api/attendance-detail-approvals', {
    action: 'edit_segment', work_record_id: 'record', segment_id: 'science',
    segment: { type: 'office', office_task: 'training', program: 'science_social', start: '09:00', end: '10:00' },
  }));
  assert.equal(conversionResponse.status, 403);
  assert.equal(conversion.data.get('work_records/record').work_segments[0].program, 'normal');
});

test('science-social reconciliation deduplicates a day and distinguishes missing detail from wrong program', async () => {
  const shifts = {
    'shift_assignments/first': { user_id: 'target', teacher_name: 'Science Teacher', target_date: '2026-09-05', target_subject: '理科', period: '1限' },
    'shift_assignments/second': { user_id: 'target', teacher_name: 'Science Teacher', target_date: '2026-09-05', target_subject: '社会', period: '2限' },
  };
  const baseRecord = {
    teacher_id: 'target', teacher_name: 'Science Teacher', date: '2026-09-05', status: 'pending',
    start_time: '2026-09-05T00:00:00.000Z', end_time: '2026-09-05T13:00:00.000Z',
  };
  const cases = [
    {
      segments: [{ id: 'unrelated', type: 'office', program: 'normal', school_id: '112', start: '10:00', end: '11:00' }],
      expectedCode: 'missing_science_social_detail', expectedCount: 1,
    },
    {
      segments: [{ id: 'wrong', type: 'office', program: 'normal', school_id: '112', start: '19:20', end: '21:40' }],
      expectedCode: 'wrong_program', expectedCount: 1,
    },
    {
      segments: [
        { id: 'science-1', type: 'lesson', program: 'science_social', start: '19:20', end: '20:25' },
        { id: 'science-2', type: 'lesson', program: 'science_social', start: '20:35', end: '21:40' },
      ],
      expectedCode: '', expectedCount: 0,
    },
  ];
  for (const item of cases) {
    const h = harness({
      profiles: { actor: master, target: teacher },
      documents: { ...shifts, 'work_records/record': { ...baseRecord, work_segments: item.segments } },
    });
    const response = await h.load('app/api/attendance-detail-approvals/route.ts').GET(
      request('/api/attendance-detail-approvals?month=2026-09', null, 'valid', 'GET')
    );
    assert.equal(response.status, 200);
    const alerts = (await response.json()).reconciliation_alerts;
    assert.equal(alerts.length, item.expectedCount);
    if (item.expectedCount) {
      assert.equal(alerts[0].code, item.expectedCode);
      assert.equal(alerts[0].record_id, 'record');
    }
  }
});

test('science-social reconciliation is returned only to master', async () => {
  const attendanceAdmin = { ...admin, admin_permissions: { science_social: false, attendance: true } };
  const h = harness({
    profiles: { actor: attendanceAdmin, target: teacher },
    documents: {
      'shift_assignments/shift': { user_id: 'target', teacher_name: 'Science Teacher', target_date: '2026-09-05', target_subject: '理科', period: '1限' },
      'work_records/record': {
        teacher_id: 'target', teacher_name: 'Science Teacher', date: '2026-09-05', school_id: '112', status: 'pending',
        start_time: '2026-09-05T10:00:00.000Z', end_time: '2026-09-05T11:00:00.000Z', work_segments: [],
      },
    },
  });
  const response = await h.load('app/api/attendance-detail-approvals/route.ts').GET(
    request('/api/attendance-detail-approvals?month=2026-09', null, 'valid', 'GET')
  );
  assert.equal(response.status, 200);
  assert.deepEqual((await response.json()).reconciliation_alerts, []);
});

test('attendance shift mismatch diagnostics are returned only to master', async () => {
  const attendanceAdmin = { ...admin, admin_permissions: { science_social: false, attendance: true } };
  const documents = {
    'shift_assignments/shift': { user_id: 'different-user', teacher_name: 'Teacher One', target_date: '2026-10-01' },
    'work_records/record': {
      teacher_id: 'target', teacher_name: 'Teacher One', date: '2026-10-01', school_id: '112', status: 'pending',
      start_time: '2026-10-01T09:00:00+09:00', end_time: null, work_segments: [],
    },
  };
  const attendance = harness({ profiles: { actor: attendanceAdmin, target: teacher }, documents });
  const attendanceResponse = await attendance.load('app/api/attendance-diagnostics/route.ts').GET(
    request('/api/attendance-diagnostics?scope=admin&month=2026-10', null, 'valid', 'GET')
  );
  assert.equal(attendanceResponse.status, 200);
  assert.equal((await attendanceResponse.json()).diagnostics.some(item =>
    item.warnings.some(warning => warning.code === 'shift_user_mismatch' || warning.code === 'shift_name_mismatch')
  ), false);

  const masterHarness = harness({ profiles: { actor: master, target: teacher }, documents });
  const masterResponse = await masterHarness.load('app/api/attendance-diagnostics/route.ts').GET(
    request('/api/attendance-diagnostics?scope=admin&month=2026-10', null, 'valid', 'GET')
  );
  assert.equal(masterResponse.status, 200);
  assert.equal((await masterResponse.json()).diagnostics.some(item =>
    item.warnings.some(warning => warning.code === 'shift_user_mismatch')
  ), true);
});

test('dedicated attendance approver edits clocks only for semi-dedicated staff in an assigned school', async () => {
  const attendanceApprover = {
    role: 'teacher', school_id: '112', school_ids: ['112'], employment_category: 'dedicated',
    attendance_school_manager: true, name: 'Approver',
  };
  const baseRecord = {
    teacher_id: 'target', teacher_name: 'Semi Dedicated', date: '2026-09-05',
    start_time: '2026-09-05T00:00:00.000Z', end_time: '2026-09-05T01:00:00.000Z',
    work_segments: [],
  };
  const allowed = harness({
    profiles: { actor: attendanceApprover, target: { ...teacher, employment_category: 'semi_dedicated' } },
    documents: { 'work_records/record': baseRecord },
  });
  const listing = await allowed.load('app/api/attendance-detail-approvals/route.ts').GET(
    request('/api/attendance-detail-approvals?month=2026-09', null, 'valid', 'GET')
  );
  assert.equal(listing.status, 200);
  const listingBody = await listing.json();
  assert.equal(listingBody.records[0].can_edit_clock, true);
  assert.equal(listingBody.records[0].school_name, '創造学園 オンライン校');
  assert.equal(listingBody.records[0].detail_missing, true);
  assert.equal(listingBody.records[0].detail_approval_status, 'pending');
  const response = await allowed.load('app/api/attendance-detail-approvals/route.ts').POST(request('/api/attendance-detail-approvals', {
    action: 'edit_clock', work_record_id: 'record',
    start_time: '2026-09-05T09:30:00+09:00', end_time: '2026-09-05T18:15:00+09:00',
  }));
  assert.equal(response.status, 200);
  assert.equal(allowed.data.get('work_records/record').start_time, '2026-09-05T00:30:00.000Z');
  assert.equal(allowed.data.get('work_records/record').end_time, '2026-09-05T09:15:00.000Z');
  assert.equal(allowed.data.get('attendance_record_edits/generated').school_id, '112');

  for (const target of [
    { ...teacher, employment_category: 'dedicated' },
    { ...teacher, school_id: '161', school: '161', employment_category: 'semi_dedicated' },
  ]) {
    const denied = harness({ profiles: { actor: attendanceApprover, target }, documents: { 'work_records/record': baseRecord } });
    const deniedResponse = await denied.load('app/api/attendance-detail-approvals/route.ts').POST(request('/api/attendance-detail-approvals', {
      action: 'edit_clock', work_record_id: 'record',
      start_time: '2026-09-05T09:30:00+09:00', end_time: '2026-09-05T18:15:00+09:00',
    }));
    assert.equal(deniedResponse.status, 403);
    assert.equal(denied.data.get('work_records/record').start_time, baseRecord.start_time);
  }
});

test('only masters can reject work results after a campus attendance approver reviews them', async () => {
  const attendanceApprover = {
    role: 'teacher', school_id: '112', school_ids: ['112'], employment_category: 'dedicated',
    attendance_school_manager: true, name: 'Approver',
  };
  const record = {
    teacher_id: 'target', teacher_name: 'Transferred Teacher', date: '2026-09-05',
    start_time: '2026-09-05T00:00:00.000Z', end_time: '2026-09-05T01:00:00.000Z',
    work_segments: [{ id: 'segment', type: 'lesson', school_id: '112', start: '09:00', end: '10:00', approval_status: 'pending' }],
  };
  const denied = harness({ profiles: { actor: attendanceApprover, target: teacher }, documents: { 'work_records/record': record } });
  const deniedResponse = await denied.load('app/api/attendance-detail-approvals/route.ts').POST(request('/api/attendance-detail-approvals', {
    work_record_id: 'record', segment_id: 'segment', status: 'rejected', review_note: '差し戻し',
  }));
  assert.equal(deniedResponse.status, 403);
  assert.equal(denied.data.get('work_records/record').work_segments[0].approval_status, 'pending');

  const allowed = harness({ profiles: { actor: master, target: teacher }, documents: { 'work_records/record': record } });
  const allowedResponse = await allowed.load('app/api/attendance-detail-approvals/route.ts').POST(request('/api/attendance-detail-approvals', {
    work_record_id: 'record', segment_id: 'segment', status: 'rejected', review_note: '内容を確認してください',
  }));
  assert.equal(allowedResponse.status, 200);
  assert.equal(allowed.data.get('work_records/record').work_segments[0].approval_status, 'rejected');
});

test('course registration accepts signed visible options and derives profile settings from them', async () => {
  const h = harness({ profiles: { actor: { ...student, grade: '中3' } }, env: { COURSE_REGISTRATION_TOKEN_SECRET: 'fixture-secret' } });
  const issue = h.load('lib/server/course-registration-token.ts').issueCourseRegistrationToken;
  const token = issue({
    actor_id: 'actor', grade: '中3', option_id: 'physics-monday', stable_key: 'physics', year: 2026,
    term: 'term03', registration_type: 'regular', request_id: '', day: '月', slot: '1時間目', course_text: '中3 理科 物理',
  });
  const response = await h.load('app/api/parent/course-registrations/route.ts').POST(request('/api/parent/course-registrations', {
    student_id: 'actor', year: 2026, term: 'term03', registration_type: 'regular',
    selected_course_ids: ['physics-monday'], registration_tokens: [token],
    course_settings: { day_of_week: '改ざん', subject_science: '改ざん' },
  }));
  assert.equal(response.status, 200);
  const registrationPath = h.writes.find(path => path.startsWith('course_registrations/'));
  assert.ok(registrationPath);
  assert.equal(h.data.get(registrationPath).selected_course_ids.length, 1);
  assert.equal(h.data.get(registrationPath).selected_course_ids[0], 'physics-monday');
  assert.equal(h.data.get('users/actor').day_of_week, '月');
  assert.equal(h.data.get('users/actor').subject_science, '物理');
});

test('student can clear the current course registration without a course token', async () => {
  const h = harness({
    profiles: { actor: { ...student, grade: '中3', active_course_registration_id: 'current', selected_course_ids: ['physics-monday'] } },
    documents: {
      'course_registrations/current': { student_id: 'actor', registration_type: 'regular', is_current: true, current: true, selected_course_ids: ['physics-monday'] },
    },
  });
  const response = await h.load('app/api/parent/course-registrations/route.ts').POST(request('/api/parent/course-registrations', {
    student_id: 'actor', year: 2026, term: 'term03', registration_type: 'regular',
    selected_course_ids: [], registration_tokens: [],
  }));
  assert.equal(response.status, 200);
  assert.equal(h.data.get('users/actor').selected_course_ids.length, 0);
  assert.equal(h.data.get('course_registrations/current').is_current, false);
  const currentPath = h.writes.find(path => path.startsWith('course_registrations/registration_'));
  assert.ok(currentPath);
  assert.equal(h.data.get(currentPath).selected_course_ids.length, 0);
  assert.equal(h.data.get(currentPath).is_current, true);
});

test('course registration keeps schedule-specific siblings separate and honors explicit second period', () => {
  const h = harness();
  const selection = h.load('lib/course-registration-selection.ts');
  const matching = h.load('lib/course-registration-match.ts');
  const siblings = [
    { id: 'chemistry-period-1', parent_course_option_id: 'chemistry-base', grade: '中3', subject: '理科', course_name: '化学', resolved_day: '木', resolved_slot: '1時間目' },
    { id: 'chemistry-period-2', parent_course_option_id: 'chemistry-base', grade: '中3', subject: '理科', course_name: '化学', resolved_day: '木', resolved_slot: '2時間目' },
  ];
  assert.deepEqual(Array.from(selection.resolveSelectedCourseOptionIds(siblings, ['chemistry-period-2'])), ['chemistry-period-2']);
  assert.equal(selection.courseOptionMatchesSelection(siblings[0], ['chemistry-period-2']), false);
  assert.equal(selection.courseOptionMatchesSelection(siblings[1], ['chemistry-period-2']), true);
  assert.deepEqual(Array.from(selection.resolveSelectedCourseOptionIds(siblings, ['chemistry-base'])), []);

  const options = matching.enrichCourseOptionsWithShifts([], [], [
    { id: 'civics', target_date: '2026-10-15', target_grade: '中3', target_subject: '社会', target_detail_subject: '公民3', period: 2, role_type: 'main' },
    { id: 'chemistry', target_date: '2026-10-15', target_grade: '中3', target_subject: '理科', target_detail_subject: '化学', period: 2, role_type: 'main' },
  ]);
  assert.equal(options.length, 2);
  assert.ok(options.every(option => option.resolved_slot === '2時間目'));
});

test('course registration rejects unsigned, foreign-grade, expired, mixed-term, and conflicting-slot selections', async () => {
  const makeHarness = () => harness({ profiles: { actor: { ...student, grade: '中3' } }, env: { COURSE_REGISTRATION_TOKEN_SECRET: 'fixture-secret' } });
  const cases = [
    h => ({ ids: ['arbitrary'], tokens: [] }),
    h => ({ ids: ['foreign'], tokens: [h.load('lib/server/course-registration-token.ts').issueCourseRegistrationToken({ actor_id: 'actor', grade: '中2', option_id: 'foreign', stable_key: 'foreign', year: 2026, term: 'term03', registration_type: 'regular', request_id: '', day: '月', slot: '1時間目', course_text: '社会' })] }),
    h => ({ ids: ['expired'], tokens: [h.load('lib/server/course-registration-token.ts').issueCourseRegistrationToken({ actor_id: 'actor', grade: '中3', option_id: 'expired', stable_key: 'expired', year: 2026, term: 'term03', registration_type: 'regular', request_id: '', day: '月', slot: '1時間目', course_text: '理科' }, Date.now() - 31 * 60 * 1000)] }),
    h => {
      const issue = h.load('lib/server/course-registration-token.ts').issueCourseRegistrationToken;
      return { ids: ['one', 'two'], tokens: [
        issue({ actor_id: 'actor', grade: '中3', option_id: 'one', stable_key: 'one', year: 2026, term: 'term03', registration_type: 'regular', request_id: '', day: '月', slot: '1時間目', course_text: '理科' }),
        issue({ actor_id: 'actor', grade: '中3', option_id: 'two', stable_key: 'two', year: 2026, term: 'term04', registration_type: 'regular', request_id: '', day: '火', slot: '1時間目', course_text: '社会' }),
      ] };
    },
    h => {
      const issue = h.load('lib/server/course-registration-token.ts').issueCourseRegistrationToken;
      return { ids: ['one', 'two'], tokens: [
        issue({ actor_id: 'actor', grade: '中3', option_id: 'one', stable_key: 'physics', year: 2026, term: 'term03', registration_type: 'regular', request_id: '', day: '月', slot: '1時間目', course_text: '物理' }),
        issue({ actor_id: 'actor', grade: '中3', option_id: 'two', stable_key: 'chemistry', year: 2026, term: 'term03', registration_type: 'regular', request_id: '', day: '月', slot: '1時間目', course_text: '化学' }),
      ] };
    },
    h => {
      const issue = h.load('lib/server/course-registration-token.ts').issueCourseRegistrationToken;
      return { ids: ['physics-mon', 'physics-thu'], tokens: [
        issue({ actor_id: 'actor', grade: '中3', option_id: 'physics-mon', stable_key: 'course_中3_理科_物理_月_1限', course_key: '中3__理科__物理', year: 2026, term: 'term03', registration_type: 'regular', request_id: '', day: '月', slot: '1限', course_text: '理科 物理' }),
        issue({ actor_id: 'actor', grade: '中3', option_id: 'physics-thu', stable_key: 'course_中3_理科_物理_木_2限', course_key: '中3__理科__物理', year: 2026, term: 'term03', registration_type: 'regular', request_id: '', day: '木', slot: '2限', course_text: '理科 物理' }),
      ] };
    },
  ];
  for (const build of cases) {
    const h = makeHarness();
    const item = build(h);
    const response = await h.load('app/api/parent/course-registrations/route.ts').POST(request('/api/parent/course-registrations', {
      student_id: 'actor', selected_course_ids: item.ids, registration_tokens: item.tokens,
    }));
    assert.ok(response.status >= 400);
    assert.equal(h.writes.some(path => path.startsWith('course_registrations/')), false);
  }
});

test('test-prep course settings are master-only, validate dates and archive instead of deleting', async () => {
  const makeHarness = profile => harness({ profiles: { actor: profile }, overrides: { 'next/cache': { revalidateTag() {} } } });
  const validBody = {
    year: 2026, title: '期末対策', grade: '中3', subject: '理科', course_name: '物理', units: ['電流'],
    start_date: '2026-11-01', end_date: '2026-11-30', registration_open_date: '2026-10-01', registration_close_date: '2026-10-25',
    allowed_student_grades: ['中3'], is_active: true,
  };
  const masterHarness = makeHarness(master);
  const route = masterHarness.load('app/api/admin/test-prep-courses/route.ts');
  const saved = await route.POST(request('/api/admin/test-prep-courses', validBody));
  assert.equal(saved.status, 200);
  assert.equal(masterHarness.data.get('test_prep_course_options/generated').registration_close_date, '2026-10-25');
  const archived = await route.DELETE(request('/api/admin/test-prep-courses?id=generated', null, 'valid', 'DELETE'));
  assert.equal(archived.status, 200);
  assert.equal(masterHarness.data.get('test_prep_course_options/generated').is_active, false);

  const adminHarness = makeHarness({ ...admin, admin_permissions: { science_social: true } });
  const denied = await adminHarness.load('app/api/admin/test-prep-courses/route.ts').POST(request('/api/admin/test-prep-courses', validBody));
  assert.equal(denied.status, 403);
  const invalidHarness = makeHarness(master);
  const invalidRoute = invalidHarness.load('app/api/admin/test-prep-courses/route.ts');
  for (const invalid of [
    { ...validBody, start_date: '2026-02-31' },
    { ...validBody, registration_close_date: '2026-12-01' },
    { ...validBody, grade: '高校生' },
  ]) {
    const response = await invalidRoute.POST(request('/api/admin/test-prep-courses', invalid));
    assert.equal(response.status, 400);
  }
});

test('test-prep registration grant expires no later than the Japanese deadline', () => {
  const h = harness({ env: { COURSE_REGISTRATION_TOKEN_SECRET: 'fixture-secret' } });
  const tokens = h.load('lib/server/course-registration-token.ts');
  const now = Date.parse('2026-10-25T14:55:00.000Z');
  const token = tokens.issueCourseRegistrationToken({
    actor_id: 'actor', grade: '中3', option_id: 'prep', stable_key: 'prep', year: 2026, term: 'test_prep_one',
    registration_type: 'test_prep', request_id: '', day: '日', slot: '1時間目', course_text: '物理 電流',
    registration_closes_at: '2026-10-25',
  }, now);
  assert.doesNotThrow(() => tokens.verifyCourseRegistrationToken(token, 'actor', '中3', now));
  assert.throws(() => tokens.verifyCourseRegistrationToken(token, 'actor', '中3', Date.parse('2026-10-25T15:00:01.000Z')));
});

test('school administrators cannot create test-prep events', async () => {
  for (const target of [
    { ...student, role: 'student', school_id: '999' },
    { ...teacher, role: 'teacher', school_id: '112' },
  ]) {
    const h = harness({ profiles: { actor: { ...admin, admin_permissions: { science_social: true }, school_ids: ['112'] }, target } });
    const response = await h.load('app/api/admin/test-prep-events/route.ts').POST(request('/api/admin/test-prep-events', {
      school_id: '112', title: '期末対策', event_date: '2026-11-01', target_student_ids: ['target'],
    }));
    assert.equal(response.status, 403);
    assert.equal(h.writes.some(path => path.startsWith('test_prep_events/')), false);
  }
});

test('school administrators update regular-course registrations only for their own school', async () => {
  const manager = { ...admin, admin_permissions: { science_social: true }, school_ids: ['112'] };
  for (const [schoolId, expectedStatus] of [['112', 200], ['999', 403]]) {
    const h = harness({
      profiles: { actor: manager, target: { ...student, role: 'student', school_id: schoolId, parent_uid: 'parent', grade: '中3' } },
      documents: {
        'course_registrations/regular-old': { student_id: 'target', registration_type: 'regular', is_current: true, current: true },
        'course_registrations/prep-current': { student_id: 'target', registration_type: 'test_prep', is_current: true, current: true },
      },
      env: { COURSE_REGISTRATION_TOKEN_SECRET: 'fixture-secret' },
    });
    const issue = h.load('lib/server/course-registration-token.ts').issueCourseRegistrationToken;
    const registrationToken = issue({
      actor_id: 'actor', grade: '中3', option_id: 'regular-new', stable_key: 'course_中3_理科_物理_月_1限', course_key: '中3__理科__物理',
      year: 2026, term: 'term03', registration_type: 'regular', request_id: '', day: '月', slot: '1限', course_text: '理科 物理',
    });
    const response = await h.load('app/api/admin/course-registrations/route.ts').POST(request('/api/admin/course-registrations', {
      student_id: 'target', year: 2026, term: 'term03', selected_course_ids: ['regular-new'], selected_course_labels: ['物理'], registration_tokens: [registrationToken],
    }));
    assert.equal(response.status, expectedStatus);
    if (expectedStatus === 200) {
      assert.equal(h.data.get('course_registrations/regular-old').is_current, false);
      assert.equal(h.data.get('course_registrations/prep-current').is_current, true);
      assert.equal(h.data.get('course_registrations/admin_target_2026_term03').selected_course_ids.join(','), 'regular-new');
    } else {
      assert.equal(h.writes.length, 0);
    }
  }
});

test('master course registration rejects duplicate courses and can clear an existing registration', async () => {
  const documents = {
    'course_registrations/regular-old': { student_id: 'target', registration_type: 'regular', is_current: true, current: true },
  };
  const rejected = harness({ profiles: { actor: master, target: { ...student, school_id: '112', grade: '中3' } }, documents, env: { COURSE_REGISTRATION_TOKEN_SECRET: 'fixture-secret' } });
  const issue = rejected.load('lib/server/course-registration-token.ts').issueCourseRegistrationToken;
  const duplicateTokens = [
    issue({ actor_id: 'actor', grade: '中3', option_id: 'physics-mon', stable_key: 'course_中3_理科_物理_月_1限', course_key: '中3__理科__物理', year: 2026, term: 'term03', registration_type: 'regular', request_id: '', day: '月', slot: '1限', course_text: '理科 物理' }),
    issue({ actor_id: 'actor', grade: '中3', option_id: 'physics-thu', stable_key: 'course_中3_理科_物理_木_2限', course_key: '中3__理科__物理', year: 2026, term: 'term03', registration_type: 'regular', request_id: '', day: '木', slot: '2限', course_text: '理科 物理' }),
  ];
  const rejectedResponse = await rejected.load('app/api/admin/course-registrations/route.ts').POST(request('/api/admin/course-registrations', {
    student_id: 'target', year: 2026, term: 'term03', selected_course_ids: ['physics-mon', 'physics-thu'], registration_tokens: duplicateTokens,
  }));
  assert.equal(rejectedResponse.status, 400);
  assert.equal(rejected.data.has('course_registrations/admin_target_2026_term03'), false);

  const cleared = harness({ profiles: { actor: master, target: { ...student, school_id: '112', grade: '中3', selected_course_ids: ['physics-mon'] } }, documents, env: { COURSE_REGISTRATION_TOKEN_SECRET: 'fixture-secret' } });
  const clearedResponse = await cleared.load('app/api/admin/course-registrations/route.ts').POST(request('/api/admin/course-registrations', {
    student_id: 'target', year: 2026, term: 'term03', selected_course_ids: [], selected_course_labels: [],
  }));
  assert.equal(clearedResponse.status, 200);
  assert.equal(cleared.data.get('users/target').selected_course_ids.length, 0);
  assert.equal(cleared.data.get('course_registrations/admin_target_2026_term03').selected_course_ids.length, 0);
});

test('student transfer accepts only a signed eligible option and atomically closes the absence', async () => {
  const h = harness({
    profiles: { actor: { ...student, grade: '中3', parent_uid: 'parent' } },
    documents: {
      'requests/absence': { student_id: 'actor', parent_id: 'parent', type: 'absence', status: 'completed', target_date: '2026-10-05', transfer_status: 'waiting_student_selection' },
      'shift_assignments/shift': { target_date: '2026-10-12', unit: '電流', target_subject: '理科', target_detail_subject: '物理', target_meeting_id: '12345' },
    },
    env: { TRANSFER_OPTION_TOKEN_SECRET: 'fixture-secret' },
    overrides: { 'next/cache': { unstable_cache: fn => fn } },
  });
  const token = h.load('lib/server/transfer-option-token.ts').issueTransferOptionToken({
    actor_id: 'actor', student_id: 'actor', absence_id: 'absence', shift_id: 'shift',
    target_date: '2026-10-12', unit: '電流', subject: '理科', course_name: '物理', period: 1,
  });
  const route = h.load('app/api/student/transfers/route.ts');
  const response = await route.POST(request('/api/student/transfers', {
    absence_id: 'absence', transfer_shift_id: 'shift', transfer_token: token, note: '希望',
  }));
  assert.equal(response.status, 200);
  assert.equal(h.data.get('requests/absence').transfer_status, 'registered');
  assert.equal(h.data.get('requests/absence').transfer_request_id, 'absence_transfer');
  assert.equal(h.data.get('requests/absence_transfer').target_date, '2026-10-12');
  assert.equal(h.data.get('requests/absence_transfer').transfer_unit, '電流');

  const duplicate = await route.POST(request('/api/student/transfers', {
    absence_id: 'absence', transfer_shift_id: 'shift', transfer_token: token,
  }));
  assert.ok(duplicate.status >= 400);
});

test('student transfer rejects unsigned, foreign, expired, and changed options without writes', async () => {
  const makeHarness = () => harness({
    profiles: { actor: { ...student, grade: '中3' } },
    documents: {
      'requests/absence': { student_id: 'actor', type: 'absence', status: 'completed', target_date: '2026-10-05' },
      'shift_assignments/shift': { target_date: '2026-10-12', unit: '電流', target_subject: '理科', target_detail_subject: '物理' },
    },
    env: { TRANSFER_OPTION_TOKEN_SECRET: 'fixture-secret' },
  });
  const cases = [
    h => '',
    h => h.load('lib/server/transfer-option-token.ts').issueTransferOptionToken({ actor_id: 'other', student_id: 'other', absence_id: 'absence', shift_id: 'shift', target_date: '2026-10-12', unit: '電流', subject: '理科', course_name: '物理', period: 1 }),
    h => h.load('lib/server/transfer-option-token.ts').issueTransferOptionToken({ actor_id: 'actor', student_id: 'actor', absence_id: 'absence', shift_id: 'shift', target_date: '2026-10-12', unit: '電流', subject: '理科', course_name: '物理', period: 1 }, Date.now() - 31 * 60 * 1000),
    h => h.load('lib/server/transfer-option-token.ts').issueTransferOptionToken({ actor_id: 'actor', student_id: 'actor', absence_id: 'absence', shift_id: 'shift', target_date: '2026-10-12', unit: '別単元', subject: '理科', course_name: '物理', period: 1 }),
  ];
  for (const build of cases) {
    const h = makeHarness();
    const response = await h.load('app/api/student/transfers/route.ts').POST(request('/api/student/transfers', {
      absence_id: 'absence', transfer_shift_id: 'shift', transfer_token: build(h),
    }));
    assert.ok(response.status >= 400);
    assert.equal(h.data.has('requests/absence_transfer'), false);
    assert.notEqual(h.data.get('requests/absence').transfer_status, 'registered');
  }
});

test('parent transfer creates linked absence and transfer records from signed server fields', async () => {
  const parent = { role: 'parent', student_ids: ['child'], name: 'Parent One' };
  const h = harness({
    profiles: { actor: parent, child: { ...student, role: 'student', grade: '中3', parent_uid: 'actor', student_name: 'Child One' } },
    documents: {
      'shift_assignments/shift': { target_date: '2026-10-12', unit: '電流', target_subject: '理科', target_detail_subject: '物理', target_meeting_id: '12345' },
    },
    env: { TRANSFER_OPTION_TOKEN_SECRET: 'fixture-secret' },
  });
  const token = h.load('lib/server/transfer-option-token.ts').issueTransferOptionToken({
    actor_id: 'actor', student_id: 'child', absence_id: 'pending:child:2026-10-05', shift_id: 'shift',
    target_date: '2026-10-12', unit: '電流', subject: '理科', course_name: '物理', period: 1,
  });
  const response = await h.load('app/api/parent/absence-requests/route.ts').POST(request('/api/parent/absence-requests', {
    student_id: 'child', type: 'transfer', target_date: '2026-10-05', transfer_shift_id: 'shift', transfer_token: token,
    transfer_unit: '改ざん', transfer_subject: '改ざん', transfer_course_name: '改ざん', reason: '家庭都合',
  }));
  assert.equal(response.status, 200);
  const transferPath = h.writes.find(path => path.startsWith('requests/parent_absence_') && path.endsWith('_transfer'));
  assert.ok(transferPath);
  const transferId = transferPath.split('/').at(-1);
  const absenceId = transferId.replace(/_transfer$/, '');
  const absence = h.data.get(`requests/${absenceId}`);
  const transfer = h.data.get(transferPath);
  assert.equal(absence.type, 'absence');
  assert.equal(absence.target_date, '2026-10-05');
  assert.equal(absence.transfer_request_id, transferId);
  assert.equal(transfer.type, 'transfer');
  assert.equal(transfer.absence_request_id, absenceId);
  assert.equal(transfer.target_date, '2026-10-12');
  assert.equal(transfer.transfer_unit, '電流');
  const replay = await h.load('app/api/parent/absence-requests/route.ts').POST(request('/api/parent/absence-requests', {
    student_id: 'child', type: 'transfer', target_date: '2026-10-05', transfer_shift_id: 'shift', transfer_token: token,
  }));
  assert.equal(replay.status, 200);
  assert.equal([...h.data.keys()].filter(path => path.startsWith('requests/')).length, 2);
});

test('student can confirm a signed transfer without a prior absence record', async () => {
  const h = harness({
    profiles: { actor: { ...student, role: 'student', grade: '中3', student_name: 'Student One' } },
    documents: {
      'shift_assignments/shift': { target_date: '2026-10-12', unit: '電流', target_subject: '理科', target_detail_subject: '物理', target_meeting_id: '12345' },
    },
    env: { TRANSFER_OPTION_TOKEN_SECRET: 'fixture-secret' },
  });
  const token = h.load('lib/server/transfer-option-token.ts').issueTransferOptionToken({
    actor_id: 'actor', student_id: 'actor', absence_id: 'pending:actor:2026-10-05', shift_id: 'shift',
    target_date: '2026-10-12', unit: '電流', subject: '理科', course_name: '物理', period: 1,
  });
  const response = await h.load('app/api/parent/absence-requests/route.ts').POST(request('/api/parent/absence-requests', {
    student_id: 'actor', type: 'transfer', target_date: '2026-10-05', transfer_shift_id: 'shift', transfer_token: token,
  }));
  assert.equal(response.status, 200);
  const transferPath = h.writes.find(path => path.startsWith('requests/') && path.endsWith('_transfer'));
  assert.ok(transferPath);
  assert.equal(h.data.get(`${transferPath}`).target_date, '2026-10-12');
  assert.equal(h.data.get(transferPath.replace(/_transfer$/, '')).target_date, '2026-10-05');
});

test('parent absence is idempotent and rejects invalid dates, types, and oversized reasons', async () => {
  const makeHarness = () => harness({
    profiles: {
      actor: { role: 'parent', student_ids: ['child'], name: 'Parent One' },
      child: { ...student, role: 'student', parent_uid: 'actor', student_name: 'Child One' },
    },
  });
  const h = makeHarness();
  const payload = { student_id: 'child', type: 'absence', absence_type: 'late', target_date: '2099-10-05', reason: '交通機関遅延' };
  const route = h.load('app/api/parent/absence-requests/route.ts');
  assert.equal((await route.POST(request('/api/parent/absence-requests', payload))).status, 200);
  assert.equal((await route.POST(request('/api/parent/absence-requests', payload))).status, 200);
  assert.equal([...h.data.keys()].filter(path => path.startsWith('requests/parent_absence_')).length, 1);
  assert.equal([...h.data.keys()].filter(path => path.startsWith('user_notifications/absence_parent_absence_')).length, 1);

  for (const invalid of [
    { ...payload, target_date: '2099-02-30' },
    { ...payload, target_date: '2020-01-06' },
    { ...payload, absence_type: 'arbitrary' },
    { ...payload, reason: 'x'.repeat(2001) },
  ]) {
    const isolated = makeHarness();
    const response = await isolated.load('app/api/parent/absence-requests/route.ts').POST(request('/api/parent/absence-requests', invalid));
    assert.equal(response.status, 400);
    assert.equal(isolated.writes.length, 0);
  }
});

test('parent transfer options use the selected absence day and return only signed future matching units', async () => {
  const h = harness({
    profiles: {
      actor: { role: 'parent', student_ids: ['child'] },
      child: { ...student, role: 'student', grade: '中3', parent_uid: 'actor' },
    },
    documents: {
      'shift_assignments/absent': { target_date: '2099-10-05', target_grade: '中3', target_subject: '理科', target_detail_subject: '物理', unit: '電流', role_type: 'main', target_meeting_id: '11111111111' },
      'shift_assignments/match': { target_date: '2099-10-12', target_grade: '中3', target_subject: '理科', target_detail_subject: '物理', unit: '電流', role_type: 'main', target_meeting_id: '22222222222' },
      'shift_assignments/wrong': { target_date: '2099-10-12', target_grade: '中3', target_subject: '理科', target_detail_subject: '物理', unit: '天体', role_type: 'main', target_meeting_id: '33333333333' },
    },
    env: { TRANSFER_OPTION_TOKEN_SECRET: 'fixture-secret' },
    overrides: { 'next/cache': { unstable_cache: fn => fn } },
  });
  const response = await h.load('app/api/student/transfer-options/route.ts').GET(
    request('/api/student/transfer-options?student_id=child&absence_date=2099-10-05', null, 'valid', 'GET'),
  );
  assert.equal(response.status, 200);
  const body = await response.json();
  assert.equal(body.selected_absence.target_date, '2099-10-05');
  assert.equal(body.options.length, 1);
  assert.equal(body.options[0].id, 'match');
  const grant = h.load('lib/server/transfer-option-token.ts').verifyTransferOptionToken(body.options[0].transfer_token, {
    actor_id: 'actor', student_id: 'child', absence_id: 'pending:child:2099-10-05', shift_id: 'match',
  });
  assert.equal(grant.unit, '電流');
});

test('student transfer options allow selecting an original lesson day without a prior absence record', async () => {
  const h = harness({
    profiles: { actor: { ...student, role: 'student', grade: '中3' } },
    documents: {
      'shift_assignments/absent': { target_date: '2099-10-05', target_grade: '中3', target_subject: '理科', target_detail_subject: '物理', unit: '電流', role_type: 'main', target_meeting_id: '11111111111' },
      'shift_assignments/match': { target_date: '2099-10-12', target_grade: '中3', target_subject: '理科', target_detail_subject: '物理', unit: '電流', role_type: 'main', target_meeting_id: '22222222222' },
    },
    env: { TRANSFER_OPTION_TOKEN_SECRET: 'fixture-secret' },
    overrides: { 'next/cache': { unstable_cache: fn => fn } },
  });
  const response = await h.load('app/api/student/transfer-options/route.ts').GET(
    request('/api/student/transfer-options?absence_date=2099-10-05', null, 'valid', 'GET'),
  );
  assert.equal(response.status, 200);
  const body = await response.json();
  assert.equal(body.absences.length, 0);
  assert.equal(body.selected_absence.id, 'pending:actor:2099-10-05');
  assert.equal(body.options.length, 1);
  assert.equal(body.options[0].id, 'match');
});

test('parent transfer rejects an arbitrary option before creating either record', async () => {
  const h = harness({
    profiles: { actor: { role: 'parent', student_ids: ['child'] }, child: { ...student, role: 'student', parent_uid: 'actor' } },
    documents: { 'shift_assignments/shift': { target_date: '2026-10-12', unit: '電流', target_subject: '理科', target_detail_subject: '物理' } },
    env: { TRANSFER_OPTION_TOKEN_SECRET: 'fixture-secret' },
  });
  const response = await h.load('app/api/parent/absence-requests/route.ts').POST(request('/api/parent/absence-requests', {
    student_id: 'child', type: 'transfer', target_date: '2026-10-05', transfer_shift_id: 'shift', transfer_token: 'invalid',
  }));
  assert.ok(response.status >= 400);
  assert.equal([...h.data.keys()].some(path => path.startsWith('requests/')), false);
});

test('merged transfer options are signed with the chosen shift raw fields and can be confirmed', async () => {
  const h = harness({
    profiles: {
      actor: { role: 'parent', student_ids: ['child'] },
      child: { ...student, role: 'student', grade: '中3', parent_uid: 'actor' },
    },
    documents: {
      'shift_assignments/absent-physics': { target_date: '2099-10-05', target_grade: '中3', target_subject: '理科', target_detail_subject: '物理', unit: '電流', role_type: 'main', target_meeting_id: '11111111111' },
      'shift_assignments/absent-biology': { target_date: '2099-10-05', target_grade: '中3', target_subject: '理科', target_detail_subject: '生物', unit: '細胞', role_type: 'main', target_meeting_id: '11111111111' },
      'shift_assignments/m-physics': { target_date: '2099-10-12', target_grade: '中3', target_subject: '理科', target_detail_subject: '物理', unit: '電流', role_type: 'main', target_meeting_id: '22222222222' },
      'shift_assignments/m-biology': { target_date: '2099-10-12', target_grade: '中3', target_subject: '理科', target_detail_subject: '生物', unit: '細胞', role_type: 'main', target_meeting_id: '22222222222' },
    },
    env: { TRANSFER_OPTION_TOKEN_SECRET: 'fixture-secret' },
    overrides: { 'next/cache': { unstable_cache: fn => fn } },
  });
  const response = await h.load('app/api/student/transfer-options/route.ts').GET(
    request('/api/student/transfer-options?student_id=child&absence_date=2099-10-05', null, 'valid', 'GET'),
  );
  const body = await response.json();
  assert.equal(body.options.length, 1);
  const [option] = body.options;
  // 表示はまとめた文字列、署名は選んだシフトそのものの値。
  assert.match(option.course_name, / \/ /);
  assert.equal(option.raw_course_name, undefined);
  const confirm = await h.load('app/api/parent/absence-requests/route.ts').POST(request('/api/parent/absence-requests', {
    student_id: 'child', type: 'transfer', target_date: '2099-10-05', transfer_shift_id: option.id, transfer_token: option.transfer_token,
  }));
  assert.equal(confirm.status, 200);
  const transfer = h.data.get(`requests/${(await confirm.json()).id}`);
  assert.equal(transfer.transfer_shift_id, option.id);
  assert.ok(['物理', '生物'].includes(transfer.transfer_course_name));
});

test('absence contact keeps one active record per student and date, updating type, reason, and transfer mode in place', async () => {
  const h = harness({
    profiles: {
      actor: { role: 'parent', student_ids: ['child'], name: 'Parent One' },
      child: { ...student, role: 'student', parent_uid: 'actor', student_name: 'Child One' },
    },
    documents: {
      // 以前の仕組みで欠席と遅刻が別々に残っている日。
      'requests/legacy-late': { student_id: 'child', user_id: 'child', type: 'absence', absence_type: 'late', target_date: '2099-10-06', status: 'completed', reason: '旧', updated_at: { seconds: 1 } },
      'requests/legacy-absent': { student_id: 'child', user_id: 'child', type: 'absence', absence_type: 'absent', target_date: '2099-10-06', status: 'completed', reason: '旧', updated_at: { seconds: 2 } },
    },
  });
  const route = h.load('app/api/parent/absence-requests/route.ts');
  const send = body => route.POST(request('/api/parent/absence-requests', { student_id: 'child', type: 'absence', target_date: '2099-10-05', ...body }));
  const activeOn = date => [...h.data.entries()].filter(([key, value]) => key.startsWith('requests/') && value.target_date === date && value.type === 'absence' && value.status !== 'cancelled');

  assert.equal((await send({ absence_type: 'absent', reason: '発熱' })).status, 200);
  assert.equal((await send({ absence_type: 'late', reason: '通院のため20時から' })).status, 200);
  assert.equal(activeOn('2099-10-05').length, 1);
  assert.equal(activeOn('2099-10-05')[0][1].absence_type, 'late');
  assert.equal(activeOn('2099-10-05')[0][1].reason, '通院のため20時から');

  assert.equal((await send({ absence_type: 'absent', reason: '発熱', student_selects_transfer: true })).status, 200);
  const [[absenceKey, absence]] = activeOn('2099-10-05');
  assert.equal(absence.absence_type, 'absent');
  assert.equal(absence.transfer_status, 'waiting_student_selection');
  assert.equal(absence.transfer_selection_mode, 'student');
  assert.equal(h.data.get(`user_notifications/absence_${absenceKey.split('/').at(-1)}`).transfer_required_by_parent, true);

  assert.equal((await route.POST(request('/api/parent/absence-requests', { student_id: 'child', type: 'absence', absence_type: 'absent', target_date: '2099-10-06', reason: '新' }))).status, 200);
  assert.equal(activeOn('2099-10-06').length, 1);
  assert.equal(h.data.get('requests/legacy-late').status, 'cancelled');
  assert.equal(h.data.get('requests/legacy-absent').reason, '新');
});

test('transfer reuses the existing absence for that date and rejects a second transfer', async () => {
  const h = harness({
    profiles: {
      actor: { role: 'parent', student_ids: ['child'], name: 'Parent One' },
      child: { ...student, role: 'student', grade: '中3', parent_uid: 'actor', student_name: 'Child One' },
    },
    documents: {
      'shift_assignments/first': { target_date: '2099-10-12', unit: '電流', target_subject: '理科', target_detail_subject: '物理' },
      'shift_assignments/second': { target_date: '2099-10-13', unit: '電流', target_subject: '理科', target_detail_subject: '物理' },
    },
    env: { TRANSFER_OPTION_TOKEN_SECRET: 'fixture-secret' },
  });
  const route = h.load('app/api/parent/absence-requests/route.ts');
  const absenceResponse = await route.POST(request('/api/parent/absence-requests', { student_id: 'child', type: 'absence', absence_type: 'late', target_date: '2099-10-05', reason: '遅れます' }));
  const absenceId = (await absenceResponse.json()).id;
  const tokenFor = (shiftId, date) => h.load('lib/server/transfer-option-token.ts').issueTransferOptionToken({
    actor_id: 'actor', student_id: 'child', absence_id: 'pending:child:2099-10-05', shift_id: shiftId,
    target_date: date, unit: '電流', subject: '理科', course_name: '物理', period: 1,
  });
  const transferResponse = await route.POST(request('/api/parent/absence-requests', {
    student_id: 'child', type: 'transfer', target_date: '2099-10-05', transfer_shift_id: 'first', transfer_token: tokenFor('first', '2099-10-12'),
  }));
  assert.equal(transferResponse.status, 200);
  const transferBody = await transferResponse.json();
  assert.equal(transferBody.absence_id, absenceId);
  assert.equal(transferBody.id, `${absenceId}_transfer`);
  const absence = h.data.get(`requests/${absenceId}`);
  assert.equal(absence.transfer_status, 'registered');
  assert.equal(absence.transfer_request_id, transferBody.id);
  assert.equal(absence.absence_type, 'absent');
  assert.equal([...h.data.keys()].filter(key => key.startsWith('requests/')).length, 2);

  const second = await route.POST(request('/api/parent/absence-requests', {
    student_id: 'child', type: 'transfer', target_date: '2099-10-05', transfer_shift_id: 'second', transfer_token: tokenFor('second', '2099-10-13'),
  }));
  assert.equal(second.status, 400);
  assert.equal((await second.json()).error, 'transfer already registered');
  assert.equal(h.data.get(`requests/${transferBody.id}`).transfer_shift_id, 'first');
  assert.equal([...h.data.keys()].filter(key => key.startsWith('requests/')).length, 2);
});

test('review period items get calendar weekdays on UTC servers, random ids, and no duplicate ids', async () => {
  const previousTz = process.env.TZ;
  process.env.TZ = 'UTC';
  try {
    const h = harness({ profiles: { actor: master } });
    const route = h.load('app/api/review-periods/route.ts');
    const base = { name: '秋期', start_date: '2026-10-01', end_date: '2026-10-31' };
    const saved = await route.POST(request('/api/review-periods', { ...base, items: [
      { date: '2026-10-05', subject: '理科', unit: '電流', grade: '中２' },
      { date: '2026-10-05', subject: '理科', unit: '磁界', grade: '' },
    ] }));
    assert.equal(saved.status, 200);
    const items = h.data.get('review_periods/generated').items;
    assert.deepEqual(items.map(item => item.weekday), ['月', '月']);
    assert.deepEqual(items.map(item => item.grade), ['中2', '全学年']);
    assert.ok(items.every(item => /^review_[A-Za-z0-9]+$/.test(item.id) && !item.id.includes('2026-10-05')));
    assert.notEqual(items[0].id, items[1].id);

    const duplicate = await route.POST(request('/api/review-periods', { ...base, items: [
      { id: 'same', date: '2026-10-05', subject: '理科', unit: '電流' },
      { id: 'same', date: '2026-10-06', subject: '社会', unit: '歴史' },
    ] }));
    assert.equal(duplicate.status, 400);
  } finally {
    if (previousTz === undefined) delete process.env.TZ; else process.env.TZ = previousTz;
  }
});

test('review period selections drop removed items, block archived or ended periods, and never reactivate on save', async () => {
  const period = {
    name: 'Review', start_date: '2026-01-01', end_date: '2099-12-31', status: 'active', subjects: ['理科', '社会'],
    items: [
      { id: 'g1', date: '2026-10-01', subject: '理科', unit: '電流', grade: '中１' },
      { id: 'g2', date: '2026-10-01', subject: '社会', unit: '歴史', grade: '中2' },
    ],
  };
  const h = harness({
    profiles: { actor: { ...student, grade: '中1' } },
    documents: {
      'review_periods/review': period,
      'review_periods/ended': { ...period, end_date: '2020-01-31', start_date: '2020-01-01' },
      'review_period_selections/review_actor': { period_id: 'review', item_ids: ['g1', 'removed', 'g2'] },
    },
  });
  const route = h.load('app/api/review-periods/route.ts');
  const list = await (await route.GET(request('/api/review-periods', null, 'valid', 'GET'))).json();
  assert.deepEqual(Array.from(list.selections.review), ['g1']);
  assert.deepEqual(Array.from(list.periods, item => item.id), ['review']);

  const saved = await route.POST(request('/api/review-periods', { period_id: 'review', item_ids: ['g1', 'removed'] }));
  assert.equal(saved.status, 200);
  assert.deepEqual(Array.from(h.data.get('review_period_selections/review_actor').item_ids), ['g1']);
  assert.equal((await route.POST(request('/api/review-periods', { period_id: 'ended', item_ids: ['g1'] }))).status, 400);

  const admin = harness({ profiles: { actor: master }, documents: { 'review_periods/old': { ...period, status: 'archived' } } });
  const adminRoute = admin.load('app/api/review-periods/route.ts');
  const resave = await adminRoute.POST(request('/api/review-periods', { id: 'old', name: 'Review', start_date: '2026-01-01', end_date: '2099-12-31', items: period.items }));
  assert.equal(resave.status, 400);
  assert.equal(admin.data.get('review_periods/old').status, 'archived');
  assert.equal((await adminRoute.POST(request('/api/review-periods', { action: 'archive', id: 'missing' }))).status, 400);
  assert.equal(admin.data.has('review_periods/missing'), false);
});

test('transfer records are visible to affiliation and workplace campuses but approvable only by the workplace', async () => {
  const approver = schoolId => ({
    role: 'teacher', school_id: schoolId, school_ids: [schoolId], employment_category: 'dedicated',
    attendance_school_manager: true, name: `Approver ${schoolId}`,
  });
  const record = {
    teacher_id: 'target', teacher_name: 'Transferred Teacher', date: '2026-09-05',
    start_time: '2026-09-05T00:00:00.000Z', end_time: '2026-09-05T01:00:00.000Z',
    transportation: [{ transport_type: 'train', route_line: 'JR', from: '三ノ宮', to: '明石', trip_type: 'round_trip', cost: 1280 }],
    work_segments: [{ id: 'segment', type: 'lesson', school_id: '161', start: '09:00', end: '10:00', approval_status: 'pending' }],
  };
  const affiliation = harness({ profiles: { actor: approver('112'), target: teacher }, documents: { 'work_records/record': record } });
  const affiliationListing = await affiliation.load('app/api/attendance-detail-approvals/route.ts').GET(
    request('/api/attendance-detail-approvals?month=2026-09', null, 'valid', 'GET')
  );
  assert.equal(affiliationListing.status, 200);
  const affiliationBody = await affiliationListing.json();
  assert.equal(affiliationBody.records.length, 1);
  assert.equal(affiliationBody.records[0].school_id, '112');
  assert.equal(affiliationBody.records[0].work_segments[0].school_id, '161');
  assert.equal(affiliationBody.records[0].work_segments[0].can_review, false);
  assert.equal(affiliationBody.records[0].transportation[0].cost, 1280);
  const affiliationApproval = await affiliation.load('app/api/attendance-detail-approvals/route.ts').POST(request('/api/attendance-detail-approvals', {
    work_record_id: 'record', segment_id: 'segment', status: 'approved',
  }));
  assert.equal(affiliationApproval.status, 403);

  const workplace = harness({ profiles: { actor: approver('161'), target: teacher }, documents: { 'work_records/record': record } });
  const workplaceListing = await workplace.load('app/api/attendance-detail-approvals/route.ts').GET(
    request('/api/attendance-detail-approvals?month=2026-09', null, 'valid', 'GET')
  );
  assert.equal(workplaceListing.status, 200);
  const workplaceBody = await workplaceListing.json();
  assert.equal(workplaceBody.records.length, 1);
  assert.equal(workplaceBody.records[0].work_segments[0].can_review, true);
  const workplaceApproval = await workplace.load('app/api/attendance-detail-approvals/route.ts').POST(request('/api/attendance-detail-approvals', {
    work_record_id: 'record', segment_id: 'segment', status: 'approved',
  }));
  assert.equal(workplaceApproval.status, 200);
  assert.equal(workplace.data.get('work_records/record').work_segments[0].approval_status, 'approved');
});

test('selected bulk approval updates only explicitly selected permitted details', async () => {
  const attendanceApprover = {
    role: 'teacher', school_id: '112', school_ids: ['112'], employment_category: 'dedicated',
    attendance_school_manager: true, name: 'Approver',
  };
  const base = {
    teacher_id: 'target', teacher_name: 'Teacher', date: '2026-09-06',
    start_time: '2026-09-06T00:00:00.000Z', end_time: '2026-09-06T03:00:00.000Z',
  };
  const h = harness({
    profiles: { actor: attendanceApprover, target: teacher },
    documents: {
      'work_records/first': { ...base, work_segments: [
        { id: 'selected', type: 'lesson', school_id: '112', start: '09:00', end: '10:00', approval_status: 'pending' },
        { id: 'unselected', type: 'office', school_id: '112', start: '10:00', end: '11:00', approval_status: 'pending' },
      ] },
      'work_records/second': { ...base, work_segments: [
        { id: 'second-selected', type: 'lesson', school_id: '112', start: '11:00', end: '12:00', approval_status: 'pending' },
      ] },
    },
  });
  const response = await h.load('app/api/attendance-detail-approvals/route.ts').POST(request('/api/attendance-detail-approvals', {
    action: 'approve_selected',
    items: [
      { work_record_id: 'first', segment_id: 'selected' },
      { work_record_id: 'second', segment_id: 'second-selected' },
    ],
  }));
  assert.equal(response.status, 200);
  assert.equal((await response.json()).updated, 2);
  assert.equal(h.data.get('work_records/first').work_segments[0].approval_status, 'approved');
  assert.equal(h.data.get('work_records/first').work_segments[1].approval_status, 'pending');
  assert.equal(h.data.get('work_records/first').status, 'pending');
  assert.equal(h.data.get('work_records/second').work_segments[0].approval_status, 'approved');
  assert.equal(h.data.get('work_records/second').status, 'approved');
});

test('attendance approvers can edit a permitted pending detail with validation and audit history', async () => {
  const attendanceApprover = {
    role: 'teacher', school_id: '112', school_ids: ['112'], employment_category: 'dedicated',
    attendance_school_manager: true, name: 'Approver',
  };
  const h = harness({
    profiles: { actor: attendanceApprover, target: teacher },
    documents: { 'work_records/record': {
      teacher_id: 'target', teacher_name: 'Teacher', date: '2026-09-06', status: 'pending',
      start_time: '2026-09-06T00:00:00.000Z', end_time: '2026-09-06T03:00:00.000Z',
      work_segments: [{ id: 'detail', type: 'office', office_task: 'meeting', school_id: '112', start: '09:00', end: '10:00', approval_status: 'rejected' }],
    } },
  });
  const response = await h.load('app/api/attendance-detail-approvals/route.ts').POST(request('/api/attendance-detail-approvals', {
    action: 'edit_segment', work_record_id: 'record', segment_id: 'detail',
    segment: { type: 'office', program: 'normal', office_task: 'training', school_id: '112', start: '09:15', end: '10:30', note: '研修実施' },
  }));
  assert.equal(response.status, 200);
  const updated = h.data.get('work_records/record');
  assert.equal(updated.work_segments[0].start, '09:15');
  assert.equal(updated.work_segments[0].office_task, 'training');
  assert.equal(updated.work_segments[0].approval_status, 'pending');
  assert.equal(updated.status, 'pending');
  assert.equal(h.data.get('attendance_detail_edits/generated').segment_id, 'detail');
});

test('school directory keeps UI names and canonical stored school codes aligned', () => {
  const h = harness();
  const schools = h.load('lib/attendance-schools.ts');
  assert.equal(schools.ATTENDANCE_SCHOOL_DIRECTORY.length, 124);
  assert.equal(new Set(schools.ATTENDANCE_SCHOOL_DIRECTORY.map(item => item.code)).size, 124);
  assert.equal(schools.resolveAttendanceSchoolCode('創造学園本部'), 'souzogakuen_hq');
  assert.equal(schools.attendanceSchoolName('souzogakuen_hq'), '創造学園本部');
  assert.equal(schools.resolveAttendanceSchoolCode('創造学園 オンライン校'), '112');
  assert.equal(schools.resolveAttendanceSchoolCode('112'), '112');
  assert.equal(schools.attendanceSchoolName('112'), '創造学園 オンライン校');
  assert.equal(schools.resolveAttendanceSchoolCode('一覧にない校舎'), '');
});

test('master account registration stores codes, names, and attendance approval schools together', async () => {
  const h = harness({
    profiles: { actor: master },
    overrides: { '@/lib/events': { writeLearningEvent: async () => 'event' } },
  });
  const response = await h.load('app/api/admin/accounts/create/route.ts').POST(request('/api/admin/accounts/create', {
    role: 'teacher', login_id: 'T1001', display_name: 'Attendance Manager', password: 'safe-password',
    school_id: '112', school_ids: ['112', '161'], employment_category: 'dedicated',
    attendance_school_manager: true, auto_create_parent: false,
  }));
  assert.equal(response.status, 200);
  const stored = h.data.get('users/created');
  assert.equal(stored.school_id, '112');
  assert.equal(stored.school_code, '112');
  assert.equal(stored.school_name, '創造学園 オンライン校');
  assert.equal(stored.school, '創造学園 オンライン校');
  assert.deepEqual(Array.from(stored.school_ids), ['112', '161']);
  assert.deepEqual(Array.from(stored.school_names), ['創造学園 オンライン校', '創造学園 阪急伊丹校']);
  assert.equal(stored.attendance_school_manager, true);
});

test('account registration rejects missing and unknown school codes before Auth changes', async () => {
  for (const school_id of ['', '999']) {
    const h = harness({ profiles: { actor: master } });
    const response = await h.load('app/api/admin/accounts/create/route.ts').POST(request('/api/admin/accounts/create', {
      role: 'teacher', login_id: 'T1001', display_name: 'Teacher', password: 'safe-password', school_id,
      auto_create_parent: false,
    }));
    assert.equal(response.status, 400);
    assert.equal(h.authWrites.length, 0);
  }

  const invalidApprovalSchool = harness({ profiles: { actor: master } });
  const response = await invalidApprovalSchool.load('app/api/admin/accounts/create/route.ts').POST(request('/api/admin/accounts/create', {
    role: 'teacher', login_id: 'T1001', display_name: 'Attendance Manager', password: 'safe-password',
    school_id: '112', school_ids: ['112', '999'], employment_category: 'dedicated',
    attendance_school_manager: true, auto_create_parent: false,
  }));
  assert.equal(response.status, 400);
  assert.equal(invalidApprovalSchool.authWrites.length, 0);
});
test('common auth rejects inactive profiles and checks token revocation', async () => {
  const h = harness({ profiles: { actor: { ...teacher, account_status: 'suspended' } } });
  await assert.rejects(() => h.load('lib/server-auth.ts').getServerUser(request('/api/apps', {})), /forbidden/);
  assert.deepEqual(h.verifications, [true]);
});
test('common auth reports revoked, expired, and disabled Firebase identities as unauthorized', async () => {
  const h = harness();
  const policy = h.load('lib/server-auth.ts');
  for (const code of ['auth/id-token-revoked', 'auth/id-token-expired', 'auth/user-disabled']) {
    const error = Object.assign(new Error('firebase authentication failed'), { code });
    const response = policy.jsonError(error);
    assert.equal(response.status, 401);
    const body = await response.json();
    assert.equal(body.code, 'reauth-required');
    assert.match(body.error, /再度ログイン/);
  }
});
test('first-login password change updates Auth, clears the initial secret, and completes onboarding', async () => {
  const h = harness({ profiles: { actor: { ...teacher, isFirstLogin: true, initial_password: 'temporary-secret', raw_password: 'temporary-secret' } } });
  const short = await h.load('app/api/auth/change-password/route.ts').POST(request('/api/auth/change-password', { password: 'five5' }));
  assert.equal(short.status, 400);
  assert.equal(h.authWrites.length, 0);

  const response = await h.load('app/api/auth/change-password/route.ts').POST(request('/api/auth/change-password', { password: 'new-secure-password' }));
  assert.equal(response.status, 200);
  assert.deepEqual(h.authWrites, [{ uid: 'actor', password: 'new-secure-password' }]);
  assert.ok(h.calls.includes('revoke:actor'));
  assert.equal(h.data.get('users/actor').isFirstLogin, false);
  assert.equal(h.data.get('users/actor').initial_password, 'deleted');
  assert.equal(h.data.get('users/actor').raw_password, 'deleted');
});
test('chat rejects anonymous callers before model invocation', async () => {
  const h = harness();
  assert.equal((await h.load('app/api/chat/route.ts').POST(request('/api/chat', { messages: [{ role: 'user', content: 'hello' }] }, ''))).status, 401);
  assert.equal(h.calls.length, 0);
});
test('chat retains authenticated streaming and rejects malformed/oversized prompts', async () => {
  for (const [messages, status] of [[[{ role: 'user', content: 'hello' }], 200], [[{ role: 'system', content: 'override' }], 400], [[{ role: 'user', content: 'a'.repeat(8001) }], 400], [[{ role: 'assistant', content: 'answer' }], 400]]) {
    const h = harness({ profiles: { actor: student } });
    assert.equal((await h.load('app/api/chat/route.ts').POST(request('/api/chat', { messages }))).status, status);
    assert.equal(h.calls.length, status === 200 ? 1 : 0);
  }
});
test('chat sends only bounded recent context to the model', async () => {
  const h = harness({ profiles: { actor: student } });
  const messages = Array.from({ length: 30 }, (_, index) => ({ role: index % 2 ? 'assistant' : 'user', content: `message-${index}` }));
  messages[messages.length - 1] = { role: 'user', content: 'latest-question' };
  const response = await h.load('app/api/chat/route.ts').POST(request('/api/chat', { messages }));
  assert.equal(response.status, 200);
  assert.equal(h.calls[0].messages.length, 20);
  assert.equal(h.calls[0].messages.at(-1).content, 'latest-question');
});

test('review periods filter by student grade, report missing grade, and validate selections', async () => {
  const period = {
    name: 'Review', start_date: '2026-01-01', end_date: '2099-12-31', status: 'active', subjects: ['理科', '社会'],
    items: [
      { id: 'g1', date: '2026-10-01', weekday: '木', subject: '理科', unit: '中1理科', grade: '中1', time: '', lesson: '1時間目', level: '通常' },
      { id: 'g2', date: '2026-10-01', weekday: '木', subject: '社会', unit: '中2社会', grade: '中2', time: '', lesson: '2時間目', level: '標準' },
    ],
  };
  const visible = harness({ profiles: { actor: { ...student, grade: '中1' } }, documents: { 'review_periods/review': period } });
  const route = visible.load('app/api/review-periods/route.ts');
  const listResponse = await route.GET(request('/api/review-periods', null, 'valid', 'GET'));
  const list = await listResponse.json();
  assert.equal(listResponse.status, 200);
  assert.equal(list.grade_required, false);
  assert.deepEqual(Array.from(list.periods[0].items, item => item.id), ['g1']);

  const saved = await route.POST(request('/api/review-periods', { period_id: 'review', item_ids: ['g1'] }));
  assert.equal(saved.status, 200);
  assert.deepEqual(Array.from(visible.data.get('review_period_selections/review_actor').item_ids), ['g1']);
  assert.equal((await route.POST(request('/api/review-periods', { period_id: 'review', item_ids: ['g2'] }))).status, 400);
  assert.equal((await route.POST(request('/api/review-periods', { period_id: 'review', item_ids: Array.from({ length: 41 }, (_, index) => `item-${index}`) }))).status, 400);

  const missing = harness({ profiles: { actor: student }, documents: { 'review_periods/review': period } });
  const missingResponse = await missing.load('app/api/review-periods/route.ts').GET(request('/api/review-periods', null, 'valid', 'GET'));
  const missingBody = await missingResponse.json();
  assert.equal(missingBody.grade_required, true);
  assert.equal(missingBody.periods.length, 0);
});
test('chat rate limit prevents model invocation', async () => {
  const h = harness({ profiles: { actor: student }, overrides: { '@/lib/server/password-recovery': { consumeRateLimit: async () => false } } });
  assert.equal((await h.load('app/api/chat/route.ts').POST(request('/api/chat', { messages: [{ role: 'user', content: 'hello' }] }))).status, 429);
  assert.equal(h.calls.length, 0);
});
test('chat is student-only and teacher chat stays inside the teacher school', async () => {
  const teacherAi = harness({ profiles: { actor: teacher } });
  assert.equal((await teacherAi.load('app/api/chat/route.ts').POST(request('/api/chat', { messages: [{ role: 'user', content: 'hello' }] }))).status, 403);
  assert.equal(teacherAi.calls.length, 0);

  const h = harness({ profiles: { actor: teacher, local: { ...student, student_name: 'Local' }, foreign: { ...student, school: '999', school_id: '999', student_name: 'Foreign' } } });
  const route = h.load('app/api/teacher/chat/route.ts');
  const overview = await route.GET(request('/api/teacher/chat', null, 'valid', 'GET'));
  assert.equal(overview.status, 200);
  assert.deepEqual((await overview.json()).students.map(item => item.id), ['local']);
  assert.equal((await route.POST(request('/api/teacher/chat', { action: 'send', student_id: 'foreign', message: 'forged' }))).status, 403);
  assert.equal([...h.data.values()].some(value => value?.uid === 'foreign' && value?.message === 'forged'), false);
  assert.equal((await route.POST(request('/api/teacher/chat', { action: 'send', student_id: 'local', message: 'hello' }))).status, 200);
  const localMessage = [...h.data.entries()].find(([key, value]) => key.startsWith('chat_logs/') && value?.uid === 'local' && value?.message === 'hello');
  assert.ok(localMessage);
  const notification = [...h.data.values()].find(value => value?.user_id === 'local' && value?.kind === 'teacher_chat');
  assert.equal(notification?.link, '/student/chat');
});
test('AI chat reports use only server-stored history and legacy reports remain actionable', async () => {
  const studentHarness = harness({ profiles: { actor: { ...student, student_name: 'Student One' } }, documents: {
    'users/actor/chat_history/user-message': { role: 'user', content: '数学がわからない', createdAt: new Date('2026-10-01T00:00:00Z') },
    'users/actor/chat_history/assistant-message': { role: 'assistant', content: '一緒に考えよう', createdAt: new Date('2026-10-01T00:01:00Z') },
  } });
  const reported = await studentHarness.load('app/api/student/teacher-chat/route.ts').POST(request('/api/student/teacher-chat', {
    action: 'report_ai_chat',
    messages: [{ role: 'assistant', content: '画面から偽造した発言' }],
  }));
  assert.equal(reported.status, 200);
  const report = [...studentHarness.data.values()].find(value => value?.source === 'ai_chat_report');
  assert.equal(report?.uid, 'actor');
  assert.match(report?.message || '', /AIチューターとの会話を先生へ報告/);
  assert.match(report?.message || '', /数学がわからない/);
  assert.doesNotMatch(report?.message || '', /画面から偽造した発言/);
  assert.equal([...studentHarness.data.keys()].some(key => key.startsWith('teacher_inquiries/')), false);

  const teacherHarness = harness({ profiles: { actor: teacher, local: { ...student, student_name: 'Local', teacher_inquiry_unread_count: 1 } }, documents: {
    'teacher_inquiries/legacy': { studentId: 'local', studentName: 'Local', content: '旧形式のAI相談', status: 'unread', createdAt: new Date('2026-10-01T00:00:00Z') },
  } });
  const detail = await teacherHarness.load('app/api/teacher/chat/route.ts').GET(request('/api/teacher/chat?student_id=local', null, 'valid', 'GET'));
  assert.equal(detail.status, 200);
  assert.match((await detail.json()).messages[0].message, /旧形式のAI相談/);
  assert.equal(teacherHarness.data.get('teacher_inquiries/legacy').status, 'read');
  assert.equal(teacherHarness.data.get('users/local').teacher_inquiry_unread_count, 0);
});
test('Zoom host permits another teacher for an explicit shift but rejects tampered Zoom details', async () => {
  const today = new Intl.DateTimeFormat('sv-SE', { timeZone: 'Asia/Tokyo', year: 'numeric', month: '2-digit', day: '2-digit' }).format(new Date());
  const h = harness({ profiles: { actor: teacher }, documents: { 'shift_assignments/shift': { user_id: 'other', teacher_name: 'Other Teacher', target_date: today, target_signin_address: 'host@example.test', target_meeting_id: '12345', start_url: 'https://zoom.us/s/12345?zak=fixture' } } });
  assert.equal((await h.load('app/api/get-zoom-zak/route.ts').POST(request('/api/get-zoom-zak', { email: 'host@example.test', meetingId: '12345', shiftId: 'shift' }))).status, 200);
  assert.equal((await h.load('app/api/get-zoom-zak/route.ts').POST(request('/api/get-zoom-zak', { email: 'attacker@example.test', meetingId: '12345', shiftId: 'shift' }))).status, 403);
  assert.equal((await h.load('app/api/get-zoom-zak/route.ts').POST(request('/api/get-zoom-zak', { email: 'host@example.test', meetingId: '99999', shiftId: 'shift' }))).status, 403);
  assert.equal((await h.load('app/api/get-zoom-zak/route.ts').POST(request('/api/get-zoom-zak', { email: 'host@example.test', shiftId: 'shift' }))).status, 403);
});
test('Zoom host retains explicit-shift access for the assigned teacher', async () => {
  const today = new Intl.DateTimeFormat('sv-SE', { timeZone: 'Asia/Tokyo', year: 'numeric', month: '2-digit', day: '2-digit' }).format(new Date());
  const h = harness({ profiles: { actor: teacher }, documents: { 'shift_assignments/shift': { user_id: 'actor', teacher_name: teacher.name, target_date: today, target_signin_address: 'host@example.test', target_meeting_id: '12345', start_url: 'https://zoom.us/s/12345?zak=fixture' } } });
  assert.equal((await h.load('app/api/get-zoom-zak/route.ts').POST(request('/api/get-zoom-zak', { email: 'host@example.test', meetingId: '12345', shiftId: 'shift' }))).status, 200);
});
test('Zoom host rejects a past explicit shift for teachers', async () => {
  const h = harness({ profiles: { actor: teacher }, documents: { 'shift_assignments/old': { user_id: 'other', target_date: '2020-01-01', target_signin_address: 'host@example.test', target_meeting_id: '12345', start_url: 'https://zoom.us/s/12345?zak=fixture' } } });
  assert.equal((await h.load('app/api/get-zoom-zak/route.ts').POST(request('/api/get-zoom-zak', { email: 'host@example.test', meetingId: '12345', shiftId: 'old' }))).status, 403);
});
test('class participation rejects missing, tampered, foreign-student, and expired grants before attendance writes', async () => {
  const today = new Intl.DateTimeFormat('sv-SE', {
    timeZone: 'Asia/Tokyo', year: 'numeric', month: '2-digit', day: '2-digit',
  }).format(new Date());
  const h = harness({ profiles: { actor: student }, env: { CLASS_PARTICIPATION_TOKEN_SECRET: 'fixture-secret' } });
  const tokens = h.load('lib/server/class-participation-token.ts');
  const valid = tokens.issueClassParticipationToken({ student_id: 'actor', class_id: 'current', target_date: today, subject: 'Physics', course_name: 'Physics' });
  const foreign = tokens.issueClassParticipationToken({ student_id: 'other', class_id: 'current', target_date: today, subject: 'Physics', course_name: 'Physics' });
  const expired = tokens.issueClassParticipationToken({ student_id: 'actor', class_id: 'current', target_date: today, subject: 'Physics', course_name: 'Physics' }, Date.now() - 7 * 60 * 60 * 1000);
  for (const body of [
    { class_id: 'current' },
    { class_id: 'current', participation_token: `${valid}x` },
    { class_id: 'current', participation_token: foreign },
    { class_id: 'current', participation_token: expired },
    { class_id: 'different', participation_token: valid },
  ]) {
    const response = await h.load('app/api/class-participation/route.ts').POST(request('/api/class-participation', body));
    assert.equal(response.status, 403);
  }
  assert.equal(h.writes.length, 0);
});
test('class participation records an authorized class once and reuses the same event on re-entry', async () => {
  const today = new Intl.DateTimeFormat('sv-SE', {
    timeZone: 'Asia/Tokyo', year: 'numeric', month: '2-digit', day: '2-digit',
  }).format(new Date());
  const h = harness({ profiles: { actor: student }, env: { CLASS_PARTICIPATION_TOKEN_SECRET: 'fixture-secret' } });
  const participationToken = h.load('lib/server/class-participation-token.ts').issueClassParticipationToken({
    student_id: 'actor', class_id: 'current', target_date: today, subject: 'Physics', course_name: 'Physics',
  });
  const route = h.load('app/api/class-participation/route.ts');
  const response = await route.POST(request('/api/class-participation', { class_id: 'current', participation_token: participationToken }));
  assert.equal(response.status, 200);
  const first = await response.json();
  assert.equal(first.duplicate, false);
  assert.ok(h.writes.includes(`attendance/actor_${today}`));
  assert.equal(h.data.get(`attendance/actor_${today}`).subject, 'Physics');
  const secondResponse = await route.POST(request('/api/class-participation', { class_id: 'current', participation_token: participationToken }));
  assert.equal(secondResponse.status, 200);
  const second = await secondResponse.json();
  assert.equal(second.duplicate, true);
  assert.equal(second.event_id, first.event_id);
});
test('class participation propagates only to a reciprocal student twin link', async () => {
  const today = new Intl.DateTimeFormat('sv-SE', { timeZone: 'Asia/Tokyo', year: 'numeric', month: '2-digit', day: '2-digit' }).format(new Date());
  const h = harness({
    profiles: {
      actor: { ...student, twin_sibling_ids: ['twin', 'one-way'] },
      twin: { ...student, twin_sibling_ids: ['actor'] },
      'one-way': { ...student, twin_sibling_ids: [] },
    },
    env: { CLASS_PARTICIPATION_TOKEN_SECRET: 'fixture-secret' },
  });
  const participationToken = h.load('lib/server/class-participation-token.ts').issueClassParticipationToken({
    student_id: 'actor', class_id: 'current', target_date: today, subject: 'Physics', course_name: 'Physics',
  });
  const response = await h.load('app/api/class-participation/route.ts').POST(request('/api/class-participation', { class_id: 'current', participation_token: participationToken }));
  assert.equal(response.status, 200);
  assert.ok(h.data.has(`attendance/twin_${today}`));
  assert.equal(h.data.has(`attendance/one-way_${today}`), false);
});
test('retired Zoom registrant endpoint performs no external request', async () => {
  let requests = 0;
  const h = harness({ fetch: async () => { requests += 1; return new Response('{}'); } });
  const response = await h.load('app/api/join-zoom/route.ts').POST(request('/api/join-zoom', { meetingId: '12345', userId: 'actor' }));
  assert.equal(response.status, 410);
  assert.equal(requests, 0);
});

test('unused legacy mutation endpoints are authenticated, retired, and write nothing', async () => {
  const routes = [
    ['app/api/admin/shifts/upload/route.ts', '/api/admin/shifts/upload'],
    ['app/api/camera-session-summary/route.ts', '/api/camera-session-summary'],
    ['app/api/student/course-settings/route.ts', '/api/student/course-settings'],
    ['app/api/teacher/award-points/route.ts', '/api/teacher/award-points'],
    ['app/api/teacher/students/bulk-zoom-url/route.ts', '/api/teacher/students/bulk-zoom-url'],
  ];
  for (const [file, route] of routes) {
    const authenticated = harness({ profiles: { actor: master } });
    const response = await authenticated.load(file).POST(request(route, {
      student_id: 'victim', amount: 500, camera_on_seconds: 999999, shifts: [{}],
    }));
    assert.equal(response.status, 410, route);
    assert.equal(authenticated.writes.length, 0, route);

    const anonymous = harness();
    const denied = await anonymous.load(file).POST(request(route, {}, '', 'POST'));
    assert.equal(denied.status, 401, route);
    assert.equal(anonymous.writes.length, 0, route);
  }
});
test('Zoom host email search permits any teacher for a matching class shift today (covering)', async () => {
  const today = new Intl.DateTimeFormat('sv-SE', { timeZone: 'Asia/Tokyo', year: 'numeric', month: '2-digit', day: '2-digit' }).format(new Date());
  // 代行運用のため、担当外・別時限の講師でも当日の授業に登録されたZoom情報と一致すれば許可する
  for (const [actorPeriod, status] of [['1限', 200], ['2限', 200]]) {
    let zoomRequestCount = 0;
    const h = harness({ profiles: { actor: teacher }, documents: {
      'shift_assignments/target': {
        user_id: 'other', teacher_name: 'Other Teacher', target_date: today, note: '【1限】',
        target_signin_address: 'host@example.test', target_meeting_id: '12345', start_url: 'https://zoom.us/s/12345?zak=fixture',
      },
      'shift_assignments/actor-duty': {
        user_id: 'actor', teacher_name: teacher.name, target_date: today, note: `【${actorPeriod}】`, role_type: 'general',
      },
    }, env: { ZOOM_ACCOUNT_ID: 'fixture', ZOOM_CLIENT_ID: 'fixture', ZOOM_CLIENT_SECRET: 'fixture' }, fetch: async () => {
      const body = zoomRequestCount++ === 0 ? { access_token: 'fixture-access-token' } : { token: 'fixture-zak' };
      return new Response(JSON.stringify(body), { status: 200, headers: { 'content-type': 'application/json' } });
    } });
    const response = await h.load('app/api/get-zoom-zak/route.ts').POST(request('/api/get-zoom-zak', {
      email: 'host@example.test', meetingId: '12345',
    }));
    assert.equal(response.status, status);
  }
});
test('Zoom host token cannot be obtained by email search without assignment', async () => {
  const h = harness({ profiles: { actor: teacher }, documents: { 'shift_assignments/shift': { user_id: 'other', target_signin_address: 'host@example.test', target_meeting_id: '12345' } }, env: { ZOOM_ACCOUNT_ID: 'fixture', ZOOM_CLIENT_ID: 'fixture', ZOOM_CLIENT_SECRET: 'fixture' } });
  assert.equal((await h.load('app/api/get-zoom-zak/route.ts').POST(request('/api/get-zoom-zak', { email: 'host@example.test', meetingId: '12345' }))).status, 403);
});

test('Zoom meeting creation requires an authorized main shift and stores the join URL separately from recordings', async () => {
  const shift = {
    role_type: 'main', target_date: '2026-10-07', school_id: '112',
    target_signin_address: 'host@example.test', target_meeting_id: null,
  };
  const calls = [];
  const h = harness({
    profiles: { actor: admin },
    documents: { 'shift_assignments/shift': shift },
    overrides: { '@/lib/zoom-meeting': { getZoomServerAccessToken: async () => 'zoom-token' } },
    fetch: async (url, options) => {
      calls.push({ url: String(url), body: JSON.parse(options.body) });
      return Response.json({ id: 987654321, start_url: 'https://zoom.us/s/987654321?zak=fixture', join_url: 'https://zoom.us/j/987654321?pwd=fixture' });
    },
  });
  const response = await h.load('app/api/create-zoom-meeting/route.ts').POST(request('/api/create-zoom-meeting', {
    shift_id: 'shift', topic: '中3理科', startTime: '2026-10-07T19:20:00', duration: 75,
  }));
  assert.equal(response.status, 200);
  assert.equal(calls.length, 1);
  assert.equal(calls[0].url, 'https://api.zoom.us/v2/users/host%40example.test/meetings');
  assert.equal(calls[0].body.timezone, 'Asia/Tokyo');
  assert.equal(calls[0].body.settings.waiting_room, true);
  assert.match(calls[0].body.password, /^[A-Za-z0-9_-]{10}$/);
  const saved = h.data.get('shift_assignments/shift');
  assert.equal(saved.target_meeting_id, '987654321');
  assert.match(saved.target_password, /^[A-Za-z0-9_-]{10}$/);
  assert.equal(saved.target_join_url, 'https://zoom.us/j/987654321?pwd=fixture');
  assert.equal(saved.target_recording_url, undefined);
});

test('Zoom meeting creation rejects teachers, foreign schools, date mismatch, and duplicate meetings before Zoom is called', async () => {
  const cases = [
    { profile: teacher, shift: { role_type: 'main', target_date: '2026-10-07', school_id: '112', target_signin_address: 'host@example.test' }, startTime: '2026-10-07T19:20:00', status: 403 },
    { profile: { ...admin, school_id: '999', school_ids: ['999'] }, shift: { role_type: 'main', target_date: '2026-10-07', school_id: '112', target_signin_address: 'host@example.test' }, startTime: '2026-10-07T19:20:00', status: 403 },
    { profile: admin, shift: { role_type: 'main', target_date: '2026-10-07', school_id: '112', target_signin_address: 'host@example.test' }, startTime: '2026-10-08T19:20:00', status: 400 },
    { profile: admin, shift: { role_type: 'main', target_date: '2026-10-07', school_id: '112', target_signin_address: 'host@example.test', target_meeting_id: '123456789' }, startTime: '2026-10-07T19:20:00', status: 409 },
  ];
  for (const item of cases) {
    let called = false;
    const h = harness({
      profiles: { actor: item.profile }, documents: { 'shift_assignments/shift': item.shift },
      overrides: { '@/lib/zoom-meeting': { getZoomServerAccessToken: async () => 'zoom-token' } },
      fetch: async () => { called = true; return Response.json({}); },
    });
    const response = await h.load('app/api/create-zoom-meeting/route.ts').POST(request('/api/create-zoom-meeting', {
      shift_id: 'shift', topic: '中3理科', startTime: item.startTime, duration: 75,
    }));
    assert.equal(response.status, item.status);
    assert.equal(called, false);
  }
});
test('Zoom webhook validates the signature before URL validation', async () => {
  const secret = 'zoom-webhook-secret';
  const raw = JSON.stringify({ event: 'endpoint.url_validation', payload: { plainToken: 'plain-token' } });
  const timestamp = String(Math.floor(Date.now() / 1000));
  const signature = `v0=${createHmac('sha256', secret).update(`v0:${timestamp}:${raw}`).digest('hex')}`;
  const h = harness({ env: { ZOOM_WEBHOOK_SECRET: secret } });
  const route = h.load('app/api/zoom/webhook/route.ts');
  const unsigned = await route.POST(new Request('https://security.test/api/zoom/webhook', {
    method: 'POST', headers: { 'content-type': 'application/json' }, body: raw,
  }));
  assert.equal(unsigned.status, 401);
  const signed = await route.POST(new Request('https://security.test/api/zoom/webhook', {
    method: 'POST',
    headers: { 'content-type': 'application/json', 'x-zm-request-timestamp': timestamp, 'x-zm-signature': signature },
    body: raw,
  }));
  assert.equal(signed.status, 200);
  const result = await signed.json();
  assert.equal(result.plainToken, 'plain-token');
  assert.equal(result.encryptedToken, createHmac('sha256', secret).update('plain-token').digest('hex'));
});
test('Zoom recording sync rejects costly ranges and does not retry throttling against another endpoint', async () => {
  const invalidCalls = [];
  const invalid = harness({
    profiles: { actor: master },
    fetch: async url => { invalidCalls.push(String(url)); return Response.json({}); },
  });
  const invalidResponse = await invalid.load('app/api/zoom/recordings/sync/route.ts').POST(request('/api/zoom/recordings/sync', {
    from: '2026-01-01', to: '2026-03-01', max_meetings: 300,
  }));
  assert.equal(invalidResponse.status, 400);
  assert.equal(invalidCalls.length, 0);

  const calls = [];
  const throttled = harness({
    profiles: { actor: master },
    env: { ZOOM_ACCOUNT_ID: 'account', ZOOM_CLIENT_ID: 'client', ZOOM_CLIENT_SECRET: 'secret' },
    fetch: async url => {
      calls.push(String(url));
      if (String(url).startsWith('https://zoom.us/oauth/token')) return Response.json({ access_token: 'token' });
      return Response.json({ message: 'rate limited' }, { status: 429 });
    },
  });
  const throttledResponse = await throttled.load('app/api/zoom/recordings/sync/route.ts').POST(request('/api/zoom/recordings/sync', { days: 3 }));
  assert.equal(throttledResponse.status, 400);
  assert.equal(calls.length, 2);
  assert.ok(calls[1].includes('/accounts/me/recordings'));
});
test('Zoom live attendance is bound to an authorized current shift and scoped student roster', async () => {
  const today = new Intl.DateTimeFormat('sv-SE', { timeZone: 'Asia/Tokyo' }).format(new Date());
  const calls = [];
  const h = harness({
    profiles: {
      actor: teacher,
      own: { ...student, school_id: '112', email: 'own@example.test', student_name: '自校生徒' },
      foreign: { ...student, school_id: '999', email: 'foreign@example.test', student_name: '他校生徒' },
    },
    documents: {
      'shift_assignments/own-shift': { target_date: today, school_id: '112', target_meeting_id: '123456789', teacher_name: 'Teacher One' },
      'shift_assignments/foreign-shift': { target_date: today, school_id: '999', target_meeting_id: '987654321', teacher_name: 'Other Teacher' },
    },
    env: { ZOOM_ACCOUNT_ID: 'account', ZOOM_CLIENT_ID: 'client', ZOOM_CLIENT_SECRET: 'secret' },
    fetch: async url => {
      calls.push(String(url));
      if (String(url).startsWith('https://zoom.us/oauth/token')) return Response.json({ access_token: 'token' });
      return Response.json({ participants: [
        { id: 'p1', user_name: '自校生徒', email: 'own@example.test', status: 'in_meeting' },
        { id: 'p2', user_name: '他校生徒', email: 'foreign@example.test', status: 'in_meeting' },
      ] });
    },
  });
  const route = h.load('app/api/get-zoom-live-status/route.ts');
  const denied = await route.POST(request('/api/get-zoom-live-status', { meetingId: '987654321', shiftId: 'foreign-shift' }));
  assert.equal(denied.status, 403);
  assert.equal(calls.length, 0);
  const accepted = await route.POST(request('/api/get-zoom-live-status', { meetingId: '123-456-789', shiftId: 'own-shift' }));
  assert.equal(accepted.status, 200);
  const result = await accepted.json();
  assert.equal(result.participants.find(item => item.zoom_id === 'p1').matched_id, 'own');
  assert.equal(result.participants.find(item => item.zoom_id === 'p2').matched_id, null);
});
test('recording fetch rejects untrusted URL forms before any network request', async () => {
  let requests = 0;
  const h = harness({ fetch: async () => { requests++; return new Response('video'); } });
  const fetchRecording = h.load('lib/server/zoom-recording-fetch.ts').fetchZoomRecording;
  for (const url of ['http://zoom.us/rec', 'https://zoom.us.attacker.test/rec', 'https://127.0.0.1/rec', 'https://user:pass@zoom.us/rec', 'https://zoom.us:8443/rec']) {
    await assert.rejects(() => fetchRecording(url, { Authorization: 'Bearer fixture' }), /untrusted/);
  }
  assert.equal(requests, 0);
});
test('recording fetch validates redirects and retains trusted streaming/range requests', async () => {
  const requests = [];
  const h = harness({ fetch: async (url, options) => { requests.push({ url: String(url), ...options }); return requests.length === 1 ? new Response(null, { status: 302, headers: { location: 'https://attacker.test/steal' } }) : new Response('video'); } });
  await assert.rejects(() => h.load('lib/server/zoom-recording-fetch.ts').fetchZoomRecording('https://us02web.zoom.us/rec/download/fixture', { Authorization: 'Bearer fixture' }), /untrusted/);
  assert.equal(requests.length, 1); assert.equal(requests[0].redirect, 'manual');
  const ok = harness({ fetch: async (url, options) => { assert.equal(options.headers.Range, 'bytes=0-10'); return new Response('video', { status: 206 }); } });
  assert.equal((await ok.load('lib/server/zoom-recording-fetch.ts').fetchZoomRecording('https://us02web.zoom.us/rec/download/fixture', { Range: 'bytes=0-10' })).status, 206);
});
test('recording playback exchanges OAuth download for a trusted signed Zoom URL without proxying the video', async () => {
  const requests = [];
  const h = harness({ fetch: async (url, options) => {
    requests.push({ url: String(url), ...options });
    return new Response(null, { status: 302, headers: { location: 'https://jp01ssrweb.zoom.us/file/fixture?signature=signed' } });
  } });
  const result = await h.load('lib/server/zoom-recording-fetch.ts').resolveZoomRecordingPlayback(
    'https://zoom.us/rec/archive/download/fixture',
    { Authorization: 'Bearer fixture', Range: 'bytes=0-1' },
  );
  assert.equal(result.redirectUrl, 'https://jp01ssrweb.zoom.us/file/fixture?signature=signed');
  assert.equal(requests.length, 1);
  assert.equal(requests[0].redirect, 'manual');
  assert.equal(requests[0].headers.Authorization, 'Bearer fixture');

  const malicious = harness({ fetch: async () => new Response(null, { status: 302, headers: { location: 'https://attacker.test/video' } }) });
  await assert.rejects(() => malicious.load('lib/server/zoom-recording-fetch.ts').resolveZoomRecordingPlayback(
    'https://zoom.us/rec/archive/download/fixture',
    { Authorization: 'Bearer fixture' },
  ), /untrusted/);
});
test('school claim review rejects foreign schools before any batch write', async () => {
  const manager = { ...teacher, employment_category: 'dedicated', attendance_school_manager: true };
  for (const [school, status] of [['999', 403], ['112', 200]]) {
    const h = harness({ profiles: { actor: manager, target: { ...teacher, school_id: school } }, documents: { 'dedicated_transport_claims/claim': { user_id: 'target', expense_date: '2026-09-01', status: 'pending' } } });
    assert.equal((await h.load('app/api/admin/dedicated-claims/route.ts').POST(request('/api/admin/dedicated-claims', { kind: 'transport', id: 'claim', status: 'approved' }))).status, status);
    if (status === 403) assert.equal(h.writes.length, 0);
  }
});
test('school claim listings exclude other school records', async () => {
  const manager = { ...teacher, employment_category: 'dedicated', attendance_school_manager: true };
  const h = harness({ profiles: { actor: manager, ownSchool: teacher, foreign: { ...teacher, school_id: '999' } }, documents: {
    'dedicated_transport_claims/a': { user_id: 'ownSchool', expense_date: '2026-09-01' },
    'dedicated_transport_claims/b': { user_id: 'foreign', expense_date: '2026-09-01' },
  } });
  const response = await h.load('app/api/admin/dedicated-claims/route.ts').GET(request('/api/admin/dedicated-claims?month=2026-09', null, 'valid', 'GET'));
  assert.equal(response.status, 200); assert.deepEqual((await response.json()).transport.map(item => item.id), ['a']);
});

test('school administrators write attendance follow-up records only for their own school', async () => {
  for (const [school_id, expectedStatus] of [['112', 200], ['999', 403]]) {
    const h = harness({ profiles: { actor: admin, target: { ...student, school_id } } });
    const response = await h.load('app/api/admin/school-students/attendance-follow-ups/route.ts').POST(request('/api/admin/school-students/attendance-follow-ups', {
      student_id: 'target', status: 'contacted', note: '保護者へ電話連絡', week_start: '2026-08-31', week_end: '2026-09-06', consecutive_missed_weeks: 2,
    }));
    assert.equal(response.status, expectedStatus);
    if (expectedStatus === 403) assert.equal(h.writes.length, 0);
  }
});

test('school administrators edit student settings and monthly schedules only for their own school', async () => {
  for (const [schoolId, expectedStatus] of [['112', 200], ['999', 403]]) {
    const studentHarness = harness({ profiles: { actor: admin, target: { ...student, school_id: schoolId } } });
    const studentResponse = await studentHarness.load('app/api/admin/school-students/options/route.ts').POST(request('/api/admin/school-students/options', {
      user_id: 'target', middle_school: '創造中', camera_off_requested: true,
    }));
    assert.equal(studentResponse.status, expectedStatus);
    if (expectedStatus === 200) assert.equal(studentHarness.data.get('users/target').middle_school, '創造中');
    else assert.equal(studentHarness.writes.length, 0);

    const scheduleHarness = harness({ profiles: { actor: admin } });
    const scheduleResponse = await scheduleHarness.load('app/api/monthly-schedules/route.ts').POST(request('/api/monthly-schedules', {
      title: '授業日', start_date: '2026-10-20', end_date: '2026-10-20', school_id: schoolId,
    }));
    assert.equal(scheduleResponse.status, expectedStatus);
    if (expectedStatus === 200) assert.equal(scheduleHarness.data.get('monthly_schedules/generated').school_id, '112');
    else assert.equal(scheduleHarness.writes.length, 0);
  }
});

test('dedicated science-social teachers can view and follow up only their own school', async () => {
  const dedicated = {
    ...teacher,
    employment_category: 'dedicated',
    enabled_programs: ['science_social'],
  };
  const policyHarness = harness();
  const policy = policyHarness.load('lib/server-auth.ts');
  const serverUser = { uid: 'actor', role: 'teacher', school: '112', school_ids: ['112'], profile: dedicated };
  assert.equal(policy.canViewSchoolStudents(serverUser, '112'), true);
  assert.equal(policy.canViewSchoolStudents(serverUser, '999'), false);
  assert.equal(policy.canViewSchoolStudents({ ...serverUser, profile: { ...dedicated, employment_category: 'semi_dedicated' } }, '112'), false);

  for (const [school_id, status] of [['112', 200], ['999', 403]]) {
    const h = harness({ profiles: { actor: dedicated, target: { ...student, school_id } } });
    const response = await h.load('app/api/admin/school-students/attendance-follow-ups/route.ts').POST(request('/api/admin/school-students/attendance-follow-ups', {
      student_id: 'target', status: 'contacted', note: '校舎から声掛け', week_start: '2026-08-31', week_end: '2026-09-06', consecutive_missed_weeks: 2,
    }));
    assert.equal(response.status, status);
    if (status === 403) assert.equal(h.writes.length, 0);
  }
});

test('initial login cannot restore a changed password or reactivate inactive accounts', async () => {
  for (const filename of ['app/api/first-login/route.ts', 'app/api/admin/first-login/route.ts']) {
    for (const state of [{ account_status: 'suspended' }, { status: 'withdrawn' }, { account_status: 'archived' }]) {
      const h = harness({ profiles: { target: { ...master, lifetime_id: 'target', initial_password: 'old-password', ...state } }, authUsers: { target: { email: master.email } } });
      const response = await h.load(filename).POST(request('/api/first-login', { login: 'target', lifetimeId: 'target', password: 'old-password' }));
      assert.equal(response.status, 403); assert.equal(h.authWrites.length, 0);
    }
  }
  // 初回登録済みのアカウントは、古い初期パスワードでは入れない（現在のパスワードの確認で弾く）。
  const studentFlow = harness({
    profiles: { target: { ...master, lifetime_id: 'target', initial_password: 'old-password', isFirstLogin: false } },
    authUsers: { target: { email: master.email } },
    env: { NEXT_PUBLIC_FIREBASE_API_KEY: 'test-api-key' },
    fetch: async () => Response.json({ error: { message: 'INVALID_LOGIN_CREDENTIALS' } }, { status: 400 }),
  });
  assert.equal((await studentFlow.load('app/api/first-login/route.ts').POST(request('/api/first-login', { lifetimeId: 'target', password: 'old-password' }))).status, 401);
  assert.equal(studentFlow.authWrites.length, 0);
  // 停止中のAuthアカウントは入れない。
  const disabledFlow = harness({ profiles: { target: { ...master, lifetime_id: 'target', isFirstLogin: false } }, authUsers: { target: { email: master.email, disabled: true } } });
  assert.equal((await disabledFlow.load('app/api/first-login/route.ts').POST(request('/api/first-login', { lifetimeId: 'target', password: 'any' }))).status, 403);

  const adminFlow = harness({
    profiles: { target: { ...master, lifetime_id: 'target', initial_password: 'old-password', isFirstLogin: false } },
    authUsers: { target: { email: master.email } },
    env: { NEXT_PUBLIC_FIREBASE_API_KEY: 'test-api-key' },
    fetch: async () => Response.json({ error: { message: 'INVALID_LOGIN_CREDENTIALS' } }, { status: 400 }),
  });
  const rejected = await adminFlow.load('app/api/admin/first-login/route.ts').POST(request('/api/admin/first-login', { login: 'target', password: 'old-password' }));
  assert.equal(rejected.status, 401);
  assert.equal(adminFlow.authWrites.length, 0);
});
test('existing master can resolve a legacy login ID only after the current Firebase password is verified', async () => {
  let passwordCheck = null;
  const h = harness({
    profiles: { target: { ...master, lifetime_id: 'legacy-master-id', isFirstLogin: false } },
    authUsers: { target: { email: 'actual-admin@sozogakuen.co.jp', disabled: false } },
    env: { NEXT_PUBLIC_FIREBASE_API_KEY: 'test-api-key' },
    fetch: async (url, options) => {
      passwordCheck = { url: String(url), body: JSON.parse(String(options.body)) };
      return Response.json({ localId: 'target' });
    },
  });
  const response = await h.load('app/api/admin/first-login/route.ts').POST(request('/api/admin/first-login', {
    login: 'legacy-master-id', password: 'current-password',
  }));
  assert.equal(response.status, 200);
  assert.equal((await response.json()).email, 'actual-admin@sozogakuen.co.jp');
  assert.equal(passwordCheck.body.password, 'current-password');
  assert.match(passwordCheck.url, /signInWithPassword/);
  assert.equal(h.authWrites.length, 0);
  assert.equal(h.writes.length, 0);
});
test('staff registered with a real email can log in with the login ID after changing the password', async () => {
  let passwordCheck = null;
  const teacher = { role: 'teacher', name: '講師', lifetime_id: '142', initial_login_id: '142', email: 'y_staff@sozogakuen.co.jp', isFirstLogin: false, account_status: 'active' };
  const h = harness({
    profiles: { target: teacher },
    authUsers: { target: { email: 'y_staff@sozogakuen.co.jp', disabled: false } },
    env: { NEXT_PUBLIC_FIREBASE_API_KEY: 'test-api-key' },
    fetch: async (url, options) => {
      passwordCheck = JSON.parse(String(options.body));
      return passwordCheck.password === 'changed-password'
        ? Response.json({ localId: 'target' })
        : Response.json({ error: { message: 'INVALID_LOGIN_CREDENTIALS' } }, { status: 400 });
    },
  });
  const route = h.load('app/api/first-login/route.ts');
  const ok = await route.POST(request('/api/first-login', { lifetimeId: '142', password: 'changed-password' }));
  assert.equal(ok.status, 200);
  assert.equal((await ok.json()).email, 'y_staff@sozogakuen.co.jp');
  assert.equal(passwordCheck.email, 'y_staff@sozogakuen.co.jp');
  // ログインできた試行は、IP・アカウントの回数制限から戻す（同じ回線の職員を巻き込まない）。
  assert.equal(h.rateLimitReleases.length, 2);
  // パスワードが違えば実メールを返さない。
  const wrong = await route.POST(request('/api/first-login', { lifetimeId: '142', password: 'guess' }));
  assert.equal(wrong.status, 401);
  assert.equal(h.rateLimitReleases.length, 2);
  assert.equal((await wrong.json()).email, undefined);
  assert.equal(h.authWrites.length, 0);
  assert.equal(h.writes.length, 0);
});
test('real-email staff whose first-login flag was not cleared still log in with the current password', async () => {
  const teacher = { role: 'teacher', name: '講師', lifetime_id: '150', email: 'z_staff@sozogakuen.co.jp', initial_password: 'old-initial', account_status: 'active' };
  const h = harness({
    profiles: { target: teacher },
    authUsers: { target: { email: 'z_staff@sozogakuen.co.jp', disabled: false } },
    env: { NEXT_PUBLIC_FIREBASE_API_KEY: 'test-api-key' },
    fetch: async (url, options) => JSON.parse(String(options.body)).password === 'current-password'
      ? Response.json({ localId: 'target' })
      : Response.json({ error: { message: 'INVALID_LOGIN_CREDENTIALS' } }, { status: 400 }),
  });
  const route = h.load('app/api/first-login/route.ts');
  const ok = await route.POST(request('/api/first-login', { lifetimeId: '150', password: 'current-password' }));
  assert.equal(ok.status, 200);
  assert.equal((await ok.json()).email, 'z_staff@sozogakuen.co.jp');
  assert.equal(h.authWrites.length, 0);
});
test('public initial-login endpoints stop credential attempts when either rate limit is exhausted', async () => {
  for (const filename of ['app/api/first-login/route.ts', 'app/api/admin/first-login/route.ts']) {
    let checks = 0;
    const h = harness({
      profiles: { target: { ...master, lifetime_id: 'target', initial_login_id: 'target', initial_password: 'old-password' } },
      overrides: {
        '@/lib/server/password-recovery': {
          requestFingerprint: parts => `fingerprint:${parts.join('|')}`,
          getClientIp: () => '203.0.113.10',
          consumeRateLimit: async () => ++checks === 1,
        },
      },
    });
    const response = await h.load(filename).POST(request('/api/first-login', {
      login: 'target', lifetimeId: 'target', password: 'old-password',
    }));
    assert.equal(response.status, 429);
    assert.equal(h.authWrites.length, 0);
    assert.equal(h.writes.length, 0);
  }
});
test('recording completion cannot mint rewards for an invented recording id', async () => {
  const h = harness({ profiles: { actor: student } });
  const response = await h.load('app/api/recording-view/route.ts').POST(request('/api/recording-view', {
    recording_id: 'invented-recording', event_type: 'complete', watched_seconds: 3600, duration_seconds: 3600,
  }));
  assert.equal(response.status, 404);
  assert.equal(h.writes.length, 0);
});
test('student recording list includes past recordings from every grade without exposing playback URLs', async () => {
  const h = harness({ profiles: { actor: { ...student, grade: '中3', subjects: ['理科'] } }, documents: {
    'class_recordings/allowed': { title: '電流', grade: '中3', subject: '理科', target_date: '2026-09-20', video_url: 'https://zoom.us/rec/share/secret' },
    'class_recordings/wrong-grade': { title: '他学年', grade: '中2', subject: '理科', target_date: '2026-09-20', video_url: 'https://zoom.us/rec/share/other' },
    'class_recordings/wrong-subject': { title: '英語', grade: '中3', subject: '英語', target_date: '2026-09-20', video_url: 'https://zoom.us/rec/share/english' },
    'class_recordings/future-other-grade': { title: '未来の他学年', grade: '中2', subject: '理科', target_date: '2099-09-20', video_url: 'https://zoom.us/rec/share/future' },
    'class_recordings/draft': { title: '非公開', grade: '中3', subject: '理科', target_date: '2026-09-20', status: 'draft', video_url: 'https://zoom.us/rec/share/draft' },
  } });
  const response = await h.load('app/api/student/recordings/route.ts').GET(request('/api/student/recordings', null, 'valid', 'GET'));
  assert.equal(response.status, 200);
  const body = await response.json();
  assert.deepEqual(body.recordings.map(item => item.id), ['allowed', 'wrong-grade']);
  assert.equal(body.recordings[0].zoom_share, true);
  assert.equal(Object.hasOwn(body.recordings[0], 'video_url'), false);
});
test('recording playback is bound to the registered meeting ID and returns every matching occurrence', async () => {
  const meeting = (id, uuid, start, share, passcode, fileId) => ({
    id,
    uuid,
    start_time: start,
    share_url: share,
    recording_play_passcode: passcode,
    recording_files: [{
      id: fileId,
      status: 'completed',
      file_type: 'MP4',
      recording_type: 'shared_screen_with_speaker_view',
      recording_start: start,
      download_url: `https://zoom.us/rec/download/${fileId}`,
    }],
  });
  const meetings = [
    meeting('123 456', 'uuid-one', '2026-10-01T10:00:00Z', 'https://zoom.us/rec/share/exact-one', 'one', 'file-one'),
    meeting('987 654', 'uuid-wrong', '2026-10-01T10:02:00Z', 'https://zoom.us/rec/share/wrong-nearby', 'wrong', 'file-wrong'),
    meeting('123456', 'uuid-two', '2026-10-01T11:00:00Z', 'https://zoom.us/rec/share/exact-two', 'two', 'file-two'),
  ];
  const h = harness({
    profiles: { actor: { ...student, grade: '中3', subjects: ['理科'] } },
    documents: {
      'class_recordings/recording': {
        grade: '中3', subject: '理科', target_date: '2026-10-01', original_shift_id: 'shift',
        video_url: 'https://zoom.us/rec/share/source?startTime=1790848800000',
      },
      'shift_assignments/shift': { join_url: 'https://us06web.zoom.us/j/123456?pwd=registered', target_date: '2026-10-01' },
    },
    env: { ZOOM_ACCOUNT_ID: 'fixture', ZOOM_CLIENT_ID: 'fixture', ZOOM_CLIENT_SECRET: 'fixture' },
    fetch: async url => String(url).startsWith('https://zoom.us/oauth/token')
      ? Response.json({ access_token: 'fixture-zoom-token', expires_in: 3600 })
      : Response.json({ meetings }),
  });
  const route = h.load('app/api/zoom/recordings/file/route.ts');
  const created = await route.POST(request('/api/zoom/recordings/file', { recording_id: 'recording' }));
  assert.equal(created.status, 200);
  const body = await created.json();
  assert.equal(body.playback_options.length, 2);
  assert.ok(body.playback_options.every(option => !option.playback_url.includes('wrong-nearby')));

  const selectedOption = body.playback_options[1];
  const variantDigest = createHash('sha256').update(selectedOption.key).digest('hex').slice(0, 20);
  h.data.set(`recording_playback_secrets/recording_recording_${variantDigest}`, {
    source_url: 'https://zoom.us/rec/share/source?startTime=1790848800000',
    share_url: 'https://zoom.us/rec/share/wrong-nearby',
    play_passcode: 'wrong',
    meeting_id: '123456',
    variant_key: selectedOption.key,
    updated_at: '2020-01-01T00:00:00.000Z',
  });
  const selected = new URL(selectedOption.playback_url, 'https://security.test');
  const playback = await route.GET(request(`${selected.pathname}${selected.search}`, null, '', 'GET'));
  assert.equal(playback.status, 307);
  const location = playback.headers.get('location');
  assert.match(location, /\/rec\/share\/exact-two/);
  assert.equal(new URL(location).searchParams.get('pwd'), 'two');
  assert.doesNotMatch(location, /wrong-nearby/);
});
test('recording playback rejects ambiguous source identifiers before resolving Zoom', async () => {
  const h = harness({ profiles: { actor: master }, documents: {
    'class_recordings/recording': { video_url: 'https://zoom.us/rec/share/recording' },
    'shift_assignments/shift': { target_recording_url: 'https://zoom.us/rec/share/shift' },
  } });
  const route = h.load('app/api/zoom/recordings/file/route.ts');
  const response = await route.POST(request('/api/zoom/recordings/file', { recording_id: 'recording', shift_id: 'shift' }));
  assert.equal(response.status, 400);
  assert.equal(h.writes.length, 0);
});
test('a legacy recording resolves passcode only from its exact registered Zoom share URL', async () => {
  const sourceUrl = 'https://zoom.us/rec/share/imported-recording';
  const h = harness({
    profiles: { actor: { ...student, grade: '中3', subjects: ['理科'] } },
    documents: {
      'class_recordings/imported': { grade: '中3', subject: '理科', target_date: '2026-10-01', video_url: sourceUrl },
    },
    env: { ZOOM_ACCOUNT_ID: 'fixture', ZOOM_CLIENT_ID: 'fixture', ZOOM_CLIENT_SECRET: 'fixture' },
    fetch: async url => String(url).startsWith('https://zoom.us/oauth/token')
      ? Response.json({ access_token: 'fixture-zoom-token', expires_in: 3600 })
      : Response.json({ meetings: [
        {
          id: '111111', uuid: 'legacy-exact', start_time: '2026-10-01T10:00:00Z',
          share_url: sourceUrl, recording_play_passcode: 'legacy-pass',
          recording_files: [{ id: 'legacy-file', status: 'completed', file_type: 'MP4', recording_type: 'active_speaker', recording_start: '2026-10-01T10:00:00Z', download_url: 'https://zoom.us/rec/download/legacy-file' }],
        },
        {
          id: '222222', uuid: 'legacy-wrong', start_time: '2026-10-01T10:01:00Z',
          share_url: 'https://zoom.us/rec/share/nearby-but-wrong', recording_play_passcode: 'wrong-pass',
          recording_files: [{ id: 'wrong-file', status: 'completed', file_type: 'MP4', recording_type: 'active_speaker', recording_start: '2026-10-01T10:01:00Z', download_url: 'https://zoom.us/rec/download/wrong-file' }],
        },
      ] }),
  });
  const route = h.load('app/api/zoom/recordings/file/route.ts');
  const created = await route.POST(request('/api/zoom/recordings/file', { recording_id: 'imported' }));
  assert.equal(created.status, 200);
  const body = await created.json();
  assert.equal(body.playback_options.length, 1);
  const playbackUrl = new URL(body.playback_url, 'https://security.test');
  const playback = await route.GET(request(`${playbackUrl.pathname}${playbackUrl.search}`, null, '', 'GET'));
  assert.equal(playback.status, 307);
  const location = playback.headers.get('location');
  assert.equal(new URL(location).pathname, '/rec/share/imported-recording');
  assert.equal(new URL(location).searchParams.get('pwd'), 'legacy-pass');
  assert.doesNotMatch(location, /nearby-but-wrong|wrong-pass/);
});
test('replacement playback searches the source recording date rather than the target lesson date', async () => {
  const requestedUrls = [];
  const h = harness({
    profiles: { actor: { ...student, grade: '中3', subjects: ['理科'] } },
    documents: { 'class_recordings/replacement': {
      grade: '中3', subject: '理科', target_date: '2026-10-09', replacement_source_date: '2026-10-01',
      recording_meeting_id: '123456', video_url: 'https://zoom.us/rec/share/replacement-source',
    } },
    env: { ZOOM_ACCOUNT_ID: 'fixture', ZOOM_CLIENT_ID: 'fixture', ZOOM_CLIENT_SECRET: 'fixture' },
    fetch: async url => {
      requestedUrls.push(String(url));
      if (String(url).startsWith('https://zoom.us/oauth/token')) return Response.json({ access_token: 'token', expires_in: 3600 });
      return Response.json({ meetings: [{
        id: '123456', uuid: 'replacement-uuid', start_time: '2026-10-01T10:00:00Z',
        share_url: 'https://zoom.us/rec/share/replacement-source', recording_play_passcode: 'pass',
        recording_files: [{ id: 'replacement-file', status: 'completed', file_type: 'MP4', recording_type: 'active_speaker', recording_start: '2026-10-01T10:00:00Z', download_url: 'https://zoom.us/rec/download/replacement-file' }],
      }] });
    },
  });
  const response = await h.load('app/api/zoom/recordings/file/route.ts').POST(request('/api/zoom/recordings/file', { recording_id: 'replacement' }));
  assert.equal(response.status, 200);
  const listUrl = new URL(requestedUrls.find(url => url.includes('/recordings?')));
  assert.equal(listUrl.searchParams.get('from'), '2026-09-30');
  assert.equal(listUrl.searchParams.get('to'), '2026-10-02');
});
test('recording playback permits another grade for past recordings but rejects future recordings and instant completion', async () => {
  const pastOtherGrade = harness({ profiles: { actor: { ...student, grade: '中3', subjects: ['理科'] } }, documents: {
    'class_recordings/recording': { grade: '中2', subject: '理科', target_date: '2026-09-20', video_url: 'https://zoom.us/rec/share/secret?pwd=fixture' },
  } });
  const playback = await pastOtherGrade.load('app/api/zoom/recordings/file/route.ts').POST(request('/api/zoom/recordings/file', { recording_id: 'recording' }));
  assert.equal(playback.status, 200);
  const view = await pastOtherGrade.load('app/api/recording-view/route.ts').POST(request('/api/recording-view', { recording_id: 'recording', event_type: 'start' }));
  assert.equal(view.status, 200);

  const future = harness({ profiles: { actor: { ...student, grade: '中3', subjects: ['理科'] } }, documents: {
    'class_recordings/recording': { grade: '中2', subject: '理科', target_date: '2099-09-20', video_url: 'https://zoom.us/rec/share/future' },
  } });
  const futurePlayback = await future.load('app/api/zoom/recordings/file/route.ts').POST(request('/api/zoom/recordings/file', { recording_id: 'recording' }));
  assert.equal(futurePlayback.status, 403);
  const futureView = await future.load('app/api/recording-view/route.ts').POST(request('/api/recording-view', { recording_id: 'recording', event_type: 'start' }));
  assert.equal(futureView.status, 403);

  const eligible = harness({ profiles: { actor: { ...student, grade: '中3', subjects: ['理科'] } }, documents: {
    'class_recordings/recording': { grade: '中3', subject: '理科', target_date: '2026-09-20', video_url: 'https://zoom.us/rec/share/secret' },
  } });
  const instant = await eligible.load('app/api/recording-view/route.ts').POST(request('/api/recording-view', { recording_id: 'recording', event_type: 'complete', watched_seconds: 9999 }));
  assert.equal(instant.status, 200);
  assert.equal((await instant.json()).rewarded, false);
  assert.equal(eligible.data.has('coin_transactions/actor_recording_view_recording'), false);
});
test('recording coins require heartbeats while the video actually plays', async () => {
  const now = Date.now();
  // 20分の録画 → 必要な再生時間は 14分（70%）。13分50秒まで数えた状態から、30秒再生した合図で基準を超える。
  const recording = { grade: '中3', subject: '理科', target_date: '2026-09-20', video_url: 'https://zoom.us/rec/share/secret', trim_start_seconds: 0, trim_end_seconds: 1200 };
  const watching = (extra = {}) => ({
    user_id: 'actor', recording_id: 'recording', status: 'watching', started_at_ms: now - 900_000,
    active_session_id: 'session-1', session_started_at_ms: now - 900_000, session_last_beat_ms: now - 30_000, session_last_position: 820,
    credited_seconds: 830, session_credited_seconds: 830, watched_buckets: Array.from({ length: 14 }, (_, index) => index), ...extra,
  });
  const profile = { ...student, grade: '中3', subjects: ['理科'], coins: 0, active_recording_session_id: 'session-1' };

  const h = harness({ profiles: { actor: profile }, documents: { 'class_recordings/recording': recording, 'recording_views/actor_recording': watching() } });
  const route = h.load('app/api/recording-view/route.ts');
  const beat = await route.POST(request('/api/recording-view', { recording_id: 'recording', event_type: 'progress', session_id: 'session-1', position_seconds: 850 }));
  assert.equal(beat.status, 200);
  assert.equal((await beat.json()).rewarded, true);
  assert.equal(h.data.has('coin_transactions/actor_recording_view_recording'), true);
  const again = await route.POST(request('/api/recording-view', { recording_id: 'recording', event_type: 'complete', session_id: 'session-1', position_seconds: 860 }));
  assert.equal((await again.json()).rewarded, false);

  // 早送り（30秒で10分進む）は数えない
  const seek = harness({ profiles: { actor: profile }, documents: { 'class_recordings/recording': recording, 'recording_views/actor_recording': watching() } });
  const seekResponse = await seek.load('app/api/recording-view/route.ts').POST(request('/api/recording-view', { recording_id: 'recording', event_type: 'progress', session_id: 'session-1', position_seconds: 1420 }));
  assert.equal((await seekResponse.json()).rewarded, false);
  assert.equal(seek.data.has('coin_transactions/actor_recording_view_recording'), false);

  // 放置（再生位置が進まない）は数えない
  const idle = harness({ profiles: { actor: profile }, documents: { 'class_recordings/recording': recording, 'recording_views/actor_recording': watching() } });
  const idleResponse = await idle.load('app/api/recording-view/route.ts').POST(request('/api/recording-view', { recording_id: 'recording', event_type: 'complete', session_id: 'session-1', position_seconds: 820 }));
  assert.equal((await idleResponse.json()).rewarded, false);

  // 別の録画で新しく視聴を始めた後の古い視聴の合図は数えない（同時再生で稼げない）
  const parallel = harness({ profiles: { actor: { ...profile, active_recording_session_id: 'other-session' } }, documents: { 'class_recordings/recording': recording, 'recording_views/actor_recording': watching() } });
  const parallelResponse = await parallel.load('app/api/recording-view/route.ts').POST(request('/api/recording-view', { recording_id: 'recording', event_type: 'progress', session_id: 'session-1', position_seconds: 850 }));
  assert.equal((await parallelResponse.json()).rewarded, false);

  // 経過時間だけ長くても、合図による再生時間が無ければもらえない（旧ルールの抜け道）
  const wallClock = harness({ profiles: { actor: profile }, documents: { 'class_recordings/recording': recording, 'recording_views/actor_recording': watching({ credited_seconds: 0, session_credited_seconds: 0, watched_buckets: [], session_started_at_ms: now - 3_600_000 }) } });
  const wallClockResponse = await wallClock.load('app/api/recording-view/route.ts').POST(request('/api/recording-view', { recording_id: 'recording', event_type: 'complete', session_id: 'session-1', position_seconds: 850 }));
  assert.equal((await wallClockResponse.json()).rewarded, false);
});
test('homework reward requires the signed-in student valid submitted assignment', async () => {
  const profile = { ...student, grade: '中3', subjects: ['理科'], coins: 0 };
  for (const [documents, status] of [
    [{}, 404],
    [{ 'homework_assignments/task': { target_grade: '中3', subject: '理科' }, 'submissions/task_actor': { assignment_id: 'task', student_id: 'other', status: 'submitted' } }, 404],
    [{ 'homework_assignments/task': { target_grade: '中3', subject: '理科' }, 'submissions/task_actor': { assignment_id: 'task', student_id: 'actor', status: 'submitted' } }, 200],
  ]) {
    const h = harness({ profiles: { actor: profile }, documents });
    const response = await h.load('app/api/coin-transactions/route.ts').POST(request('/api/coin-transactions', { action: 'homework_submission_reward', assignment_id: 'task' }));
    assert.equal(response.status, status);
    assert.equal(h.data.has('coin_transactions/actor_homework_submission_task'), status === 200);
  }
});
test('survey reward requires an eligible current JST lesson and saves response with reward atomically', async () => {
  const profile = { ...student, grade: '中3', coins: 0 };
  const questions = [{ id: 1, type: 'rating', text: '授業はわかりやすかったか' }];
  const cases = [
    [{}, {}, 400],
    [{ 'shift_assignments/shift': { target_date: '2026-10-10', role_type: 'main', target_grade: '中2' } }, { 1: 5 }, 400],
    [{ 'shift_assignments/shift': { target_date: '2026-10-10', role_type: 'main', target_grade: '中3', school_id: '999' } }, { 1: 5 }, 400],
    [{ 'shift_assignments/shift': { target_date: '2026-10-10', role_type: 'main', target_grade: '中3', school_id: '112', target_subject: '理科' } }, { 1: 5 }, 200],
  ];
  for (const [shiftDocs, answers, status] of cases) {
    const h = harness({ profiles: { actor: profile }, documents: { ...shiftDocs, 'survey_templates/default': { questions } }, now: '2026-10-09T15:30:00.000Z' });
    const response = await h.load('app/api/coin-transactions/route.ts').POST(request('/api/coin-transactions', { action: 'survey_reward', shift_id: 'shift', answers }));
    assert.equal(response.status, status);
    assert.equal(h.data.has('coin_transactions/actor_survey_response_shift'), status === 200);
    assert.equal(h.data.has('survey_responses/shift_actor'), status === 200);
  }
});
test('daily reward boundaries use the Japan calendar date', async () => {
  const h = harness({ profiles: { actor: { ...student, coins: 0 } }, now: '2026-10-09T15:30:00.000Z' });
  const response = await h.load('app/api/coin-transactions/route.ts').POST(request('/api/coin-transactions', { action: 'daily_login' }));
  assert.equal(response.status, 200);
  assert.equal(h.data.has('coin_transactions/actor_daily_login_2026-10-10'), true);
});
test('homework submission API rejects other subjects and creates a server-owned submitted record', async () => {
  const formRequest = form => new NextRequest('https://security.test/api/student/homework/submission', { method: 'POST', headers: { authorization: 'Bearer valid' }, body: form });
  const profile = { ...student, grade: '中3', subjects: ['理科'] };
  const documents = { 'homework_assignments/science': { target_grade: '中3', subject: '理科' }, 'homework_assignments/english': { target_grade: '中3', subject: '英語' } };
  const deniedHarness = harness({ profiles: { actor: profile }, documents });
  const deniedForm = new FormData(); deniedForm.set('assignment_id', 'english'); deniedForm.set('image', new File(['image'], 'answer.png', { type: 'image/png' }));
  assert.equal((await deniedHarness.load('app/api/student/homework/submission/route.ts').POST(formRequest(deniedForm))).status, 404);
  assert.equal(deniedHarness.calls.length, 0);

  const allowedHarness = harness({ profiles: { actor: profile }, documents });
  const allowedForm = new FormData(); allowedForm.set('assignment_id', 'science'); allowedForm.set('comment', '解答'); allowedForm.set('image', new File(['image'], 'answer.png', { type: 'image/png' }));
  const response = await allowedHarness.load('app/api/student/homework/submission/route.ts').POST(formRequest(allowedForm));
  assert.equal(response.status, 200);
  assert.equal(allowedHarness.data.get('submissions/science_actor').status, 'submitted');
  assert.equal(allowedHarness.data.get('submissions/science_actor').student_id, 'actor');
  assert.ok(allowedHarness.calls.some(value => value.startsWith('upload:submissions/science/actor/')));
});
test('teacher homework review rejects a submission from a different assignment', async () => {
  const h = harness({ profiles: { actor: teacher }, documents: {
    'homework_assignments/task-a': { target_grade: '中3', subject: '理科' },
    'submissions/sub-b': { assignment_id: 'task-b', student_id: 'student', status: 'submitted' },
  } });
  const response = await h.load('app/api/teacher/homework/route.ts').POST(request('/api/teacher/homework', {
    action: 'review_submission', assignment_id: 'task-a', submission_id: 'sub-b', status: 'checked',
  }));
  assert.equal(response.status, 400);
  assert.equal(h.data.get('submissions/sub-b').status, 'submitted');
});
test('teacher homework creation validates fields and only the creator can archive it', async () => {
  const invalid = harness({ profiles: { actor: teacher } });
  const invalidResponse = await invalid.load('app/api/teacher/homework/route.ts').POST(request('/api/teacher/homework', {
    action: 'create', title: '不正', subject: '国語', target_grade: '高1', deadline: '2000-02-30',
  }));
  assert.equal(invalidResponse.status, 400);
  assert.equal(invalid.writes.length, 0);

  const foreign = harness({ profiles: { actor: teacher }, documents: { 'homework_assignments/task': { created_by: 'other', status: 'active' } } });
  assert.equal((await foreign.load('app/api/teacher/homework/route.ts').POST(request('/api/teacher/homework', { action: 'delete', assignment_id: 'task' }))).status, 403);
  assert.equal(foreign.data.get('homework_assignments/task').status, 'active');

  const own = harness({ profiles: { actor: teacher }, documents: { 'homework_assignments/task': { created_by: 'actor', status: 'active' } } });
  assert.equal((await own.load('app/api/teacher/homework/route.ts').POST(request('/api/teacher/homework', { action: 'delete', assignment_id: 'task' }))).status, 200);
  assert.equal(own.data.get('homework_assignments/task').status, 'archived');
  assert.equal(own.data.get('homework_assignments/task').archived, true);
});
test('teacher homework review rejects an untrusted stamp URL', async () => {
  const h = harness({ profiles: { actor: teacher }, documents: {
    'homework_assignments/task': { target_grade: '中3', subject: '理科', status: 'active' },
    'submissions/sub': { assignment_id: 'task', student_id: 'student', status: 'submitted' },
  } });
  const response = await h.load('app/api/teacher/homework/route.ts').POST(request('/api/teacher/homework', {
    action: 'review_submission', assignment_id: 'task', submission_id: 'sub', status: 'checked', stamp_url: 'https://tracker.example/pixel.png',
  }));
  assert.equal(response.status, 400);
  assert.equal(h.data.get('submissions/sub').status, 'submitted');
});
test('teacher stamp upload validates image type and size before server storage', async () => {
  const formRequest = form => new NextRequest('https://security.test/api/teacher/homework/stamp', { method: 'POST', headers: { authorization: 'Bearer valid' }, body: form });
  const invalidHarness = harness({ profiles: { actor: teacher } });
  const invalidForm = new FormData(); invalidForm.set('image', new File(['text'], 'stamp.svg', { type: 'image/svg+xml' }));
  assert.equal((await invalidHarness.load('app/api/teacher/homework/stamp/route.ts').POST(formRequest(invalidForm))).status, 400);
  assert.equal(invalidHarness.calls.length, 0);

  const validHarness = harness({ profiles: { actor: teacher } });
  const validForm = new FormData(); validForm.set('image', new File(['image'], 'stamp.png', { type: 'image/png' }));
  const response = await validHarness.load('app/api/teacher/homework/stamp/route.ts').POST(formRequest(validForm));
  assert.equal(response.status, 200);
  assert.ok(validHarness.calls.some(value => value.startsWith('upload:stamps/actor/')));
});
test('slide upload rejects invalid files and stores only validated PPTX metadata', async () => {
  const formRequest = form => new NextRequest('https://security.test/api/admin/slides/upload', { method: 'POST', headers: { authorization: 'Bearer valid' }, body: form });
  const pptxExtractor = { extractPptxText: async () => ({ text: '電流の性質', slide_count: 1, slides: [{ slide_no: 1, text: '電流の性質' }] }) };

  const invalidHarness = harness({ profiles: { actor: admin }, overrides: { '@/lib/pptx': pptxExtractor } });
  const invalidForm = new FormData();
  invalidForm.set('file', new File(['not a zip'], '電流.pptx', { type: 'application/vnd.openxmlformats-officedocument.presentationml.presentation' }));
  invalidForm.set('grade', '中2'); invalidForm.set('subject', '物理'); invalidForm.set('unit_name', '電流');
  assert.equal((await invalidHarness.load('app/api/admin/slides/upload/route.ts').POST(formRequest(invalidForm))).status, 400);
  assert.equal(invalidHarness.calls.length, 0);
  assert.equal(invalidHarness.writes.length, 0);

  const badGradeHarness = harness({ profiles: { actor: admin }, overrides: { '@/lib/pptx': pptxExtractor } });
  const badGradeForm = new FormData();
  badGradeForm.set('file', new File([new Uint8Array([0x50, 0x4b, 0x03, 0x04])], '電流.pptx'));
  badGradeForm.set('grade', '高校'); badGradeForm.set('subject', '物理'); badGradeForm.set('unit_name', '電流');
  assert.equal((await badGradeHarness.load('app/api/admin/slides/upload/route.ts').POST(formRequest(badGradeForm))).status, 400);
  assert.equal(badGradeHarness.calls.length, 0);

  const validHarness = harness({ profiles: { actor: admin }, overrides: { '@/lib/pptx': pptxExtractor } });
  const validForm = new FormData();
  validForm.set('file', new File([new Uint8Array([0x50, 0x4b, 0x03, 0x04])], '物理_電流.pptx'));
  validForm.set('grade', '中2'); validForm.set('subject', '物理'); validForm.set('unit_name', '電流');
  validForm.set('year', '2026'); validForm.set('generate_questions', 'false');
  const response = await validHarness.load('app/api/admin/slides/upload/route.ts').POST(formRequest(validForm));
  assert.equal(response.status, 200);
  assert.ok(validHarness.calls.some(value => value.startsWith('upload:lesson_slides/2026/')));
  assert.equal(validHarness.data.get('lesson_slides/generated').mime_type, 'application/vnd.openxmlformats-officedocument.presentationml.presentation');
  assert.equal(validHarness.data.get('lesson_slides/generated').learning_unit_id, 'generated');
  assert.equal(validHarness.data.get('learning_units/generated').source_slide_id, 'generated');
});
test('slide upload normalizes generated questions and rejects ambiguous choices', () => {
  const h = harness();
  const { normalizeGeneratedSlideQuestion } = h.load('lib/server/slide-questions.ts');
  const normalized = normalizeGeneratedSlideQuestion({
    question: '  電流の単位は？  ', correct_answer: 'A',
    wrong_answers: [' B ', 'Ｃ', 'd', '余分'], explanation: ' 解説 ', difficulty: 8.8, skill: '用語',
  });
  assert.equal(JSON.stringify(normalized), JSON.stringify({
    question: '電流の単位は?', correct_answer: 'A', wrong_answers: ['B', 'C', 'd'],
    explanation: '解説', difficulty: 5, skill: '用語',
  }));
  assert.equal(normalizeGeneratedSlideQuestion({
    question: '問題', correct_answer: '正解', wrong_answers: ['正解', '誤答', '誤答', '別の誤答'],
  }), null);
  assert.equal(normalizeGeneratedSlideQuestion({
    question: '問題', correct_answer: '正解', wrong_answers: ['1', '2', '3'], difficulty: 'not-a-number',
  }).difficulty, 3);
});
test('slide download signs only the expected storage prefix for authenticated staff', async () => {
  const context = id => ({ params: Promise.resolve({ id }) });
  const valid = harness({ profiles: { actor: teacher }, documents: {
    'lesson_slides/slide': { file_path: 'lesson_slides/2026/slide.pptx', file_name: '授業.pptx' },
  } });
  const response = await valid.load('app/api/slides/[id]/download/route.ts').GET(
    request('/api/slides/slide/download', null, 'valid', 'GET'), context('slide')
  );
  assert.equal(response.status, 200);
  assert.equal(valid.calls.includes('signed:lesson_slides/2026/slide.pptx'), true);

  const invalidPath = harness({ profiles: { actor: teacher }, documents: {
    'lesson_slides/slide': { file_path: 'attendance_imports/private.xlsx' },
  } });
  assert.equal((await invalidPath.load('app/api/slides/[id]/download/route.ts').GET(
    request('/api/slides/slide/download', null, 'valid', 'GET'), context('slide')
  )).status, 404);
  assert.equal(invalidPath.calls.some(value => value.startsWith('signed:')), false);

  const studentDenied = harness({ profiles: { actor: student }, documents: {
    'lesson_slides/slide': { file_path: 'lesson_slides/2026/slide.pptx' },
  } });
  assert.equal((await studentDenied.load('app/api/slides/[id]/download/route.ts').GET(
    request('/api/slides/slide/download', null, 'valid', 'GET'), context('slide')
  )).status, 403);
});
test('slide deletion removes linked data and records an admin audit event', async () => {
  const h = harness({ profiles: { actor: admin }, documents: {
    'lesson_slides/slide': { file_path: 'lesson_slides/2026/slide.pptx', learning_unit_id: 'unit' },
    'learning_units/unit': { source_slide_id: 'slide' },
    'quizzes/quiz': { source_slide_id: 'slide' },
    'quest_question_attempts/attempt': { source_slide_id: 'slide' },
  } });
  const response = await h.load('app/api/admin/slides/[id]/route.ts').DELETE(
    request('/api/admin/slides/slide', null, 'valid', 'DELETE'),
    { params: Promise.resolve({ id: 'slide' }) }
  );
  assert.equal(response.status, 200);
  assert.equal(h.data.has('lesson_slides/slide'), false);
  assert.equal(h.data.has('learning_units/unit'), false);
  assert.equal(h.data.has('quizzes/quiz'), false);
  assert.equal(h.data.has('quest_question_attempts/attempt'), false);
  assert.equal(h.data.get('admin_audit_logs/generated').action, 'lesson_slide.delete');
  assert.equal(h.data.get('admin_audit_logs/generated').deleted_quiz_count, 1);
});
test('annual schedule import rejects non-Google fetch targets and unsafe years', async () => {
  let fetchCalls = 0;
  const h = harness({ profiles: { actor: master }, fetch: async () => { fetchCalls += 1; throw new Error('must not fetch'); } });
  const route = h.load('app/api/annual-schedule-import/route.ts');
  const foreign = await route.POST(request('/api/annual-schedule-import', {
    type: 'lesson_schedule', year: 2026, sheet_url: 'https://attacker.example/private.csv',
  }));
  assert.equal(foreign.status, 400);
  assert.equal(fetchCalls, 0);
  const unsafeYear = await route.POST(request('/api/annual-schedule-import', {
    type: 'lesson_schedule', year: 1900, rows: [{ '日付': '4/1', '授業内容': '授業' }],
  }));
  assert.equal(unsafeYear.status, 400);
  const impossibleDate = await route.POST(request('/api/annual-schedule-import', {
    type: 'lesson_schedule', year: 2026, rows: [{ '日付': '2026/2/31', '授業内容': '授業' }],
  }));
  assert.equal(impossibleDate.status, 400);
  const otherYear = await route.POST(request('/api/annual-schedule-import', {
    type: 'lesson_schedule', year: 2026, rows: [{ '日付': '2027/4/1', '授業内容': '授業' }],
  }));
  assert.equal(otherYear.status, 400);
  assert.equal(h.writes.length, 0);
});
test('curriculum replacement preserves manual options and removes only stale imported data after writes', async () => {
  const h = harness({ profiles: { actor: master }, documents: {
    'annual_curriculum_schedules/old': { year: 2026, source: 'csv_import' },
    'course_registration_options/old-import': { year: 2026, source: 'curriculum_import' },
    'course_registration_options/manual': { year: 2026, source: 'manual', title: '手動設定' },
  } });
  const response = await h.load('app/api/annual-schedule-import/route.ts').POST(request('/api/annual-schedule-import', {
    type: 'curriculum', year: 2026, rows: [{
      '開始日': '2026/4/1', '終了日': '2026/4/30', '学年': '中1', '科目': '理科', '単元': '植物の世界', '内容': '植物の分類',
    }],
  }));
  assert.equal(response.status, 200);
  assert.equal(h.data.has('annual_curriculum_schedules/old'), false);
  assert.equal(h.data.has('course_registration_options/old-import'), false);
  assert.equal(h.data.has('course_registration_options/manual'), true);
  assert.equal([...h.data.keys()].some(key => key.startsWith('annual_curriculum_schedules/curriculum_')), true);
});
test('manual learning units use validated admin APIs and protect PPTX-linked units', async () => {
  const attendanceOnly = { ...admin, admin_permissions: { science_social: false, attendance: true } };
  const denied = harness({ profiles: { actor: attendanceOnly } });
  assert.equal((await denied.load('app/api/admin/slides/units/route.ts').POST(request('/api/admin/slides/units', {
    grade: '中2', subject: '物理', unit_name: '電流', content: '本文', year: '2026',
  }))).status, 403);
  assert.equal(denied.writes.length, 0);

  const invalid = harness({ profiles: { actor: admin } });
  assert.equal((await invalid.load('app/api/admin/slides/units/route.ts').POST(request('/api/admin/slides/units', {
    grade: '高校', subject: '物理', unit_name: '電流', content: '本文', year: '2026',
  }))).status, 400);
  assert.equal(invalid.writes.length, 0);

  const created = harness({ profiles: { actor: admin } });
  const response = await created.load('app/api/admin/slides/units/route.ts').POST(request('/api/admin/slides/units', {
    grade: '中2', subject: '物理', unit_name: '電流', content: '本文', year: '2026', tags: ['重要'],
  }));
  assert.equal(response.status, 200);
  assert.equal(created.data.get('learning_units/generated').source_type, 'manual');
  assert.equal(created.data.get('learning_units/generated').created_by, 'actor');
  assert.equal(created.data.get('admin_audit_logs/generated').action, 'learning_unit.create');

  const protectedUnit = harness({ profiles: { actor: admin }, documents: {
    'learning_units/pptx-unit': { source_type: 'pptx', source_slide_id: 'slide' },
  } });
  assert.equal((await protectedUnit.load('app/api/admin/slides/units/route.ts').DELETE(request('/api/admin/slides/units', { id: 'pptx-unit' }))).status, 409);
  assert.equal(protectedUnit.data.has('learning_units/pptx-unit'), true);

  const removable = harness({ profiles: { actor: admin }, documents: {
    'learning_units/manual-unit': { source_type: 'manual' },
    'quizzes/linked': { source_learning_unit_id: 'manual-unit' },
  } });
  const removed = await removable.load('app/api/admin/slides/units/route.ts').DELETE(request('/api/admin/slides/units', { id: 'manual-unit' }));
  assert.equal(removed.status, 200);
  assert.equal(removable.data.has('learning_units/manual-unit'), false);
  assert.equal(removable.data.has('quizzes/linked'), false);
  assert.equal(removable.data.get('admin_audit_logs/generated').action, 'learning_unit.delete');
});
test('slide question generation reloads authoritative content and persists only for science-social admins', async () => {
  const documents = {
    'lesson_slides/slide': { grade: '中2', subject: '物理', unit_name: '電流', content: '正式な教材本文', learning_unit_id: 'unit' },
  };
  const attendanceOnly = { ...admin, admin_permissions: { science_social: false, attendance: true } };
  const denied = harness({ profiles: { actor: attendanceOnly }, documents, env: { SECURITY_DIAGNOSIS_MODE: 'true' } });
  assert.equal((await denied.load('app/api/homework/adaptive/route.ts').POST(request('/api/homework/adaptive', {
    sourceSlideId: 'slide', persistForSlide: true, questionCount: 5, unitContent: '改ざん本文',
  }))).status, 403);
  assert.equal([...denied.data.keys()].some(key => key.startsWith('quizzes/')), false);

  const allowed = harness({ profiles: { actor: admin }, documents, env: { SECURITY_DIAGNOSIS_MODE: 'true' } });
  const response = await allowed.load('app/api/homework/adaptive/route.ts').POST(request('/api/homework/adaptive', {
    sourceSlideId: 'slide', persistForSlide: true, questionCount: 5, grade: '中3', subject: '歴史', unitContent: '改ざん本文',
  }));
  assert.equal(response.status, 200);
  assert.equal((await response.json()).saved_count, 5);
  assert.equal(allowed.data.get('quizzes/generated').grade, '中2');
  assert.equal(allowed.data.get('quizzes/generated').subject, '物理');
  assert.equal(allowed.data.get('quizzes/generated').source_slide_id, 'slide');
  assert.equal(allowed.data.get('admin_audit_logs/generated').action, 'lesson_slide.questions.generate');
});
test('student adaptive generation reloads the unit, fixes the batch at ten, and rejects unsafe IDs before rate limiting', async () => {
  const generated = harness({
    profiles: { actor: student },
    documents: { 'learning_units/unit': { grade: '中2', subject: '物理', unit_name: '電流', content: '正式な教材本文', source_slide_id: 'slide' } },
    env: { SECURITY_DIAGNOSIS_MODE: 'true' },
  });
  const response = await generated.load('app/api/homework/adaptive/route.ts').POST(request('/api/homework/adaptive', {
    learningUnitId: 'unit', questionCount: 60, grade: '中3', subject: '歴史', unitContent: '改ざん本文',
  }));
  assert.equal(response.status, 200);
  const body = await response.json();
  assert.equal(body.questions.length, 10);
  assert.equal(generated.data.get('quest_sessions/generated').grade, '中2');
  assert.equal(generated.data.get('quest_sessions/generated').subject, '物理');
  assert.equal(generated.data.get('quest_sessions/generated').unit_name, '電流');

  const invalid = harness({
    profiles: { actor: student },
    overrides: { '@/lib/server/password-recovery': { consumeRateLimit: async () => { throw new Error('rate-limit-should-not-run'); } } },
  });
  const rejected = await invalid.load('app/api/homework/adaptive/route.ts').POST(request('/api/homework/adaptive', { learningUnitId: 'bad/id' }));
  assert.equal(rejected.status, 400);
  assert.equal(invalid.writes.length, 0);
});
test('adaptive generation enforces the hourly quota before calling the AI provider', async () => {
  const h = harness({
    profiles: { actor: student },
    documents: { 'learning_units/unit': { grade: '中2', subject: '物理', unit_name: '電流', content: '本文' } },
    env: { OPENAI_API_KEY: 'test-key' },
    overrides: {
      '@/lib/server/password-recovery': { consumeRateLimit: async key => !String(key).includes('_hour_') },
      openai: class OpenAI { constructor() { throw new Error('provider-should-not-run'); } },
    },
  });
  const response = await h.load('app/api/homework/adaptive/route.ts').POST(request('/api/homework/adaptive', { learningUnitId: 'unit' }));
  assert.equal(response.status, 429);
  assert.equal(h.data.has('quest_sessions/generated'), false);
});
test('student today classes rejects the retired unsigned beta-transfer participation path', async () => {
  const h = harness({ profiles: { actor: { ...student, grade: '中3' } } });
  const response = await h.load('app/api/student/today-classes/route.ts').GET(
    request('/api/student/today-classes?period=1&beta_transfer=1', null, 'valid', 'GET')
  );
  assert.equal(response.status, 400);
  assert.equal((await response.json()).error, 'transfer registration is required');
  assert.equal(h.writes.length, 0);
});
test('student today classes never turns a past recurring placement into a joinable class', async () => {
  const h = harness({
    profiles: { actor: { ...student, grade: '中3', selected_course_ids: ['registered-course'] } },
    documents: {
      'shift_assignments/past': {
        target_date: '2026-09-25', target_grade: '中3', target_subject: '理科',
        role_type: 'main', target_meeting_id: '123456789',
      },
    },
    overrides: {
      '@/lib/server/student-class-masters': {
        loadStudentClassMasters: async () => ({
          optionDocs: [], curriculumDocs: [], testPrepOptionDocs: [], classButtonSettingsData: {},
        }),
      },
    },
  });
  const response = await h.load('app/api/student/today-classes/route.ts').GET(
    request('/api/student/today-classes?period=1', null, 'valid', 'GET')
  );
  assert.equal(response.status, 200);
  const body = await response.json();
  assert.deepEqual(body.classes, []);
  assert.equal(body.schedule_missing, true);
  assert.equal(h.writes.length, 0);
});
test('student today classes returns only the registered second-period course', async () => {
  const targetDate = new Intl.DateTimeFormat('sv-SE', { timeZone: 'Asia/Tokyo' }).format(new Date());
  const day = new Intl.DateTimeFormat('ja-JP', { timeZone: 'Asia/Tokyo', weekday: 'short' }).format(new Date()).replace('曜', '');
  const h = harness({
    profiles: { actor: { ...student, grade: '中3', selected_course_keys: [`course_中3_理科_化学_${day}_2限`] } },
    env: { CLASS_PARTICIPATION_TOKEN_SECRET: 'fixture-secret' },
    documents: {
      'shift_assignments/civics': {
        target_date: targetDate, target_grade: '中3', target_subject: '社会', target_detail_subject: '公民3',
        period: 2, role_type: 'main', target_meeting_id: '111111111', target_join_url: 'https://us02web.zoom.us/j/111111111?pwd=civics',
      },
      'shift_assignments/chemistry': {
        target_date: targetDate, target_grade: '中3', target_subject: '理科', target_detail_subject: '化学',
        period: 2, role_type: 'main', target_meeting_id: '222222222', target_join_url: 'https://us02web.zoom.us/j/222222222?pwd=chemistry',
      },
    },
    overrides: {
      '@/lib/server/student-class-masters': {
        loadStudentClassMasters: async () => ({ optionDocs: [], curriculumDocs: [], testPrepOptionDocs: [], classButtonSettingsData: {} }),
      },
    },
  });
  const response = await h.load('app/api/student/today-classes/route.ts').GET(
    request('/api/student/today-classes?period=2', null, 'valid', 'GET')
  );
  assert.equal(response.status, 200, JSON.stringify(await response.clone().json()));
  const body = await response.json();
  assert.equal(body.classes.length, 1, JSON.stringify(body));
  assert.equal(body.classes[0].course_name, '化学');
  assert.equal(body.classes[0].period, 2);
});
test('student today classes immediately prefers the latest administrator registration over old active history', async () => {
  const targetDate = new Intl.DateTimeFormat('sv-SE', { timeZone: 'Asia/Tokyo' }).format(new Date());
  const day = new Intl.DateTimeFormat('ja-JP', { timeZone: 'Asia/Tokyo', weekday: 'short' }).format(new Date()).replace('曜', '');
  const h = harness({
    profiles: { actor: {
      ...student,
      grade: '中3',
      active_course_registration_id: 'latest-admin',
      course_registration_year: 2026,
      course_registration_term: 'admin-selected-term',
    } },
    env: { CLASS_PARTICIPATION_TOKEN_SECRET: 'fixture-secret' },
    documents: {
      'course_registrations/old-active': {
        student_id: 'actor', registration_type: 'regular', year: 2026, term: 'current-term', status: 'active',
        is_current: true, current: true, selected_course_keys: [`course_中3_社会_公民3_${day}_2限`],
      },
      'course_registrations/latest-admin': {
        student_id: 'actor', registration_type: 'regular', year: 2026, term: 'admin-selected-term', status: 'active',
        is_current: true, current: true, selected_course_keys: [`course_中3_理科_化学_${day}_2限`],
      },
      'shift_assignments/civics': {
        target_date: targetDate, target_grade: '中3', target_subject: '社会', target_detail_subject: '公民3',
        period: 2, role_type: 'main', target_meeting_id: '111111111', target_join_url: 'https://us02web.zoom.us/j/111111111?pwd=civics',
      },
      'shift_assignments/chemistry': {
        target_date: targetDate, target_grade: '中3', target_subject: '理科', target_detail_subject: '化学',
        period: 2, role_type: 'main', target_meeting_id: '222222222', target_join_url: 'https://us02web.zoom.us/j/222222222?pwd=chemistry',
      },
    },
    overrides: {
      '@/lib/server/student-class-masters': {
        loadStudentClassMasters: async () => ({ optionDocs: [], curriculumDocs: [], testPrepOptionDocs: [], classButtonSettingsData: {} }),
      },
    },
  });
  const response = await h.load('app/api/student/today-classes/route.ts').GET(
    request('/api/student/today-classes?period=2', null, 'valid', 'GET')
  );
  assert.equal(response.status, 200, JSON.stringify(await response.clone().json()));
  const body = await response.json();
  assert.equal(body.classes.length, 1, JSON.stringify(body));
  assert.equal(body.classes[0].course_name, '化学');
});
test('announcement API returns only the signed-in role, school, and grade audience', async () => {
  const h = harness({
    profiles: { actor: { ...student, grade: '中3' } },
    documents: {
      'announcements/all': { title: '全員', target: 'all', created_at: '2026-10-02T10:00:00Z' },
      'announcements/student': { title: '生徒', target: 'student', created_at: '2026-10-02T09:00:00Z' },
      'announcements/teacher': { title: '講師', target: 'teacher', created_at: '2026-10-02T08:00:00Z' },
      'announcements/other-school': { title: '他校舎', target: 'student', school_id: '999', created_at: '2026-10-02T07:00:00Z' },
      'announcements/other-grade': { title: '他学年', target: 'student', grades: ['中2'], created_at: '2026-10-02T06:00:00Z' },
    },
  });
  const listResponse = await h.load('app/api/announcements/route.ts').GET(
    request('/api/announcements?limit=20', null, 'valid', 'GET')
  );
  assert.equal(listResponse.status, 200);
  const list = await listResponse.json();
  assert.deepEqual(list.announcements.map(item => item.id).sort(), ['all', 'student']);

  const detailResponse = await h.load('app/api/announcements/route.ts').GET(
    request('/api/announcements?id=teacher', null, 'valid', 'GET')
  );
  assert.equal(detailResponse.status, 403);
});
test('announcement API hides future reservations and matches canonical school codes to school names', async () => {
  const h = harness({
    profiles: { actor: { ...student, school: '創造学園 元町校', school_id: '創造学園 元町校', grade: '中3' } },
    documents: {
      'announcements/school-code': { title: '元町校向け', target: 'student', school_ids: ['178'], publish_at: '2026-10-01T00:00:00.000Z', created_at: '2026-10-01T00:00:00.000Z' },
      'announcements/future': { title: '予約中', target: 'student', school_ids: ['178'], publish_at: '2099-01-01T00:00:00.000Z', created_at: '2026-10-02T00:00:00.000Z' },
    },
  });
  const route = h.load('app/api/announcements/route.ts');
  const listResponse = await route.GET(request('/api/announcements?limit=20', null, 'valid', 'GET'));
  assert.equal(listResponse.status, 200);
  assert.deepEqual((await listResponse.json()).announcements.map(item => item.id), ['school-code']);
  assert.equal((await route.GET(request('/api/announcements?id=future', null, 'valid', 'GET'))).status, 403);
});
test('announcement attachments enforce the same audience boundary as the announcement', async () => {
  const documents = {
    'announcements/own': { title: '対象', target: 'student', school_ids: ['112'], publish_at: '2026-10-01T00:00:00.000Z', attachments: [{ id: 'file', name: '案内.pdf', path: 'announcement_attachments/own/file.pdf', content_type: 'application/pdf' }] },
    'announcements/foreign': { title: '他校舎', target: 'student', school_ids: ['999'], publish_at: '2026-10-01T00:00:00.000Z', attachments: [{ id: 'file', name: '秘密.pdf', path: 'announcement_attachments/foreign/file.pdf', content_type: 'application/pdf' }] },
  };
  const h = harness({ profiles: { actor: student }, documents });
  const route = h.load('app/api/announcements/[id]/attachments/[attachmentId]/route.ts');
  const own = await route.GET(request('/api/announcements/own/attachments/file', null, 'valid', 'GET'), { params: Promise.resolve({ id: 'own', attachmentId: 'file' }) });
  assert.equal(own.status, 200);
  assert.match(own.headers.get('content-disposition') || '', /attachment/);
  const missing = await route.GET(request('/api/announcements/own/attachments/missing', null, 'valid', 'GET'), { params: Promise.resolve({ id: 'own', attachmentId: 'missing' }) });
  assert.equal(missing.status, 404);
  const foreign = await route.GET(request('/api/announcements/foreign/attachments/file', null, 'valid', 'GET'), { params: Promise.resolve({ id: 'foreign', attachmentId: 'file' }) });
  assert.equal(foreign.status, 403);
});
test('announcement management is master-only and deletion archives an existing item', async () => {
  const schoolAdmin = harness({ profiles: { actor: admin } });
  const denied = await schoolAdmin.load('app/api/announcements/route.ts').POST(request('/api/announcements', {
    title: '全員宛', content: '他校舎へも配信', target: 'all', label: 'info',
  }));
  assert.equal(denied.status, 403);
  assert.equal(schoolAdmin.writes.length, 0);

  const privileged = harness({ profiles: { actor: master }, documents: { 'announcements/existing': { title: '旧', target: 'all' } } });
  const route = privileged.load('app/api/announcements/route.ts');
  const form = new FormData();
  form.set('title', '新規');
  form.set('content', '本文');
  form.set('target', 'student');
  form.set('label', 'important');
  const created = await route.POST(new NextRequest('https://security.test/api/announcements', {
    method: 'POST', headers: { authorization: 'Bearer valid' }, body: form,
  }));
  assert.equal(created.status, 200, JSON.stringify(await created.clone().json()));
  const createdId = (await created.json()).id;
  assert.equal(privileged.data.get(`announcements/${createdId}`).created_by, 'actor');
  const invalidSchoolForm = new FormData();
  invalidSchoolForm.set('title', '誤配信防止');
  invalidSchoolForm.set('content', '本文');
  invalidSchoolForm.set('target', 'student');
  invalidSchoolForm.set('label', 'important');
  invalidSchoolForm.set('school_ids', '存在しない校舎');
  const invalidSchool = await route.POST(new NextRequest('https://security.test/api/announcements', {
    method: 'POST', headers: { authorization: 'Bearer valid' }, body: invalidSchoolForm,
  }));
  assert.equal(invalidSchool.status, 400);
  const archived = await route.DELETE(request('/api/announcements', { id: 'existing' }, 'valid', 'DELETE'));
  assert.equal(archived.status, 200);
  assert.equal(privileged.data.get('announcements/existing').archived, true);
  const missing = await route.DELETE(request('/api/announcements', { id: 'missing' }, 'valid', 'DELETE'));
  assert.equal(missing.status, 404);
});
test('parent inquiry administration is school-scoped and cannot create a phantom reply', async () => {
  const schoolAdmin = harness({ profiles: { actor: admin }, documents: {
    'parent_inquiries/own': { parent_id: 'parent', school_id: '112', status: 'open', content: '自校舎の問い合わせ' },
    'parent_inquiries/foreign': { parent_id: 'other-parent', school_id: '999', status: 'open', content: '他校舎の問い合わせ' },
  } });
  const deniedList = await schoolAdmin.load('app/api/admin/parent-inquiries/route.ts').GET(request('/api/admin/parent-inquiries?status=all', null, 'valid', 'GET'));
  assert.equal(deniedList.status, 200);
  assert.deepEqual((await deniedList.json()).inquiries.map(item => item.id), ['own']);
  const deniedReply = await schoolAdmin.load('app/api/admin/parent-inquiries/route.ts').PATCH(request('/api/admin/parent-inquiries', { id: 'foreign', response: '回答', status: 'answered' }, 'valid', 'PATCH'));
  assert.equal(deniedReply.status, 403);
  const ownReply = await schoolAdmin.load('app/api/admin/parent-inquiries/route.ts').PATCH(request('/api/admin/parent-inquiries', { id: 'own', response: '回答', status: 'answered' }, 'valid', 'PATCH'));
  assert.equal(ownReply.status, 200);

  const privileged = harness({ profiles: { actor: master }, documents: { 'parent_inquiries/inquiry': { parent_id: 'parent', status: 'open', content: '問い合わせ' } } });
  const route = privileged.load('app/api/admin/parent-inquiries/route.ts');
  assert.equal((await route.PATCH(request('/api/admin/parent-inquiries', { id: 'missing', response: '回答', status: 'answered' }, 'valid', 'PATCH'))).status, 404);
  assert.equal(privileged.data.has('parent_inquiries/missing'), false);
  assert.equal((await route.PATCH(request('/api/admin/parent-inquiries', { id: 'inquiry', response: '回答', status: 'answered' }, 'valid', 'PATCH'))).status, 200);
  assert.equal(privileged.data.get('parent_inquiries/inquiry').status, 'answered');
  assert.equal(privileged.data.get('parent_inquiries/inquiry').responded_by, 'actor');
  assert.equal(privileged.data.get('user_notifications/parent_inquiry_answered_inquiry').user_id, 'parent');
  assert.equal(privileged.data.get('user_notifications/parent_inquiry_answered_inquiry').kind, 'parent_inquiry_answered');
});
test('parent support inquiry deduplicates a repeated daily question and records its school', async () => {
  const parentProfile = { role: 'parent', name: 'Parent', school_id: '112', school_name: '創造学園本部' };
  const h = harness({ profiles: { actor: parentProfile } });
  const route = h.load('app/api/parent/faq/route.ts');
  const payload = { action: 'send', question: '同じ問い合わせです' };
  const first = await route.POST(request('/api/parent/faq', payload));
  const second = await route.POST(request('/api/parent/faq', payload));
  assert.equal(first.status, 200);
  assert.equal(second.status, 200);
  assert.equal((await first.json()).inquiry_id, (await second.json()).inquiry_id);
  const inquiries = [...h.data.entries()].filter(([key]) => key.startsWith('parent_inquiries/'));
  assert.equal(inquiries.length, 1);
  assert.equal(inquiries[0][1].school_id, '112');
  assert.equal(inquiries[0][1].school_name, '創造学園本部');
});
test('school administrator sees absence and transfer notices only for assigned schools', async () => {
  const schoolAdmin = { ...admin, admin_permissions: { science_social: true, attendance: false } };
  const h = harness({
    profiles: {
      actor: schoolAdmin,
      own: { ...student, school_id: '112', student_name: 'Own Child' },
      foreign: { ...student, school_id: '161', student_name: 'Foreign Child' },
    },
    documents: {
      'requests/own-absence': { user_id: 'own', student_id: 'own', type: 'absence', absence_type: 'absent', target_date: '2026-10-05', status: 'completed' },
      'requests/own-transfer': { user_id: 'own', student_id: 'own', type: 'transfer', absence_date: '2026-10-05', target_date: '2026-10-08', status: 'confirmed' },
      'requests/foreign-absence': { user_id: 'foreign', student_id: 'foreign', type: 'absence', target_date: '2026-10-05', status: 'completed' },
    },
  });
  const response = await h.load('app/api/admin/requests/route.ts').GET(request('/api/admin/requests', null, 'valid', 'GET'));
  assert.equal(response.status, 200);
  const data = await response.json();
  assert.equal(data.can_process, false);
  assert.deepEqual(data.requests.map(item => item.id).sort(), ['own-absence', 'own-transfer']);
});
test('student homework API enforces the profile grade and subjects for lists and direct IDs', async () => {
  const h = harness({
    profiles: { actor: { ...student, grade: '中3', subjects: ['理科'] } },
    documents: {
      'homework_assignments/allowed': { title: '理科', target_grade: '中3', subject: '理科', deadline: '2026-10-10' },
      'homework_assignments/wrong-subject': { title: '英語', target_grade: '中3', subject: '英語', deadline: '2026-10-11' },
      'homework_assignments/wrong-grade': { title: '他学年', target_grade: '中2', subject: '理科', deadline: '2026-10-12' },
    },
  });
  const route = h.load('app/api/student/homework/route.ts');
  const listResponse = await route.GET(request('/api/student/homework?start=2026-10-01&end=2026-10-31', null, 'valid', 'GET'));
  assert.equal(listResponse.status, 200);
  assert.deepEqual((await listResponse.json()).assignments.map(item => item.id), ['allowed']);
  const denied = await route.GET(request('/api/student/homework?id=wrong-subject', null, 'valid', 'GET'));
  assert.equal(denied.status, 404);
});
test('student calendar API excludes other roles, schools, grades, and subjects', async () => {
  const h = harness({
    profiles: { actor: { ...student, grade: '中3', subjects: ['理科'] } },
    documents: {
      'homework_assignments/science': { title: '理科', target_grade: '中3', subject: '理科', deadline: '2026-10-10' },
      'homework_assignments/english': { title: '英語', target_grade: '中3', subject: '英語', deadline: '2026-10-11' },
      'monthly_schedules/allowed': { title: '対象', start_date: '2026-10-12', end_date: '2026-10-12', audience: 'student', school_id: '112', grades: ['中3'] },
      'monthly_schedules/teacher': { title: '講師', start_date: '2026-10-13', end_date: '2026-10-13', audience: 'teacher' },
      'monthly_schedules/school': { title: '他校', start_date: '2026-10-14', end_date: '2026-10-14', audience: 'student', school_id: '999' },
      'monthly_schedules/grade': { title: '他学年', start_date: '2026-10-15', end_date: '2026-10-15', audience: 'student', grades: ['中2'] },
    },
  });
  const response = await h.load('app/api/student/calendar/route.ts').GET(
    request('/api/student/calendar?start=2026-10-01&end=2026-10-31', null, 'valid', 'GET')
  );
  assert.equal(response.status, 200);
  const body = await response.json();
  assert.deepEqual(body.homeworks.map(item => item.id), ['science']);
  assert.deepEqual(body.schedules.map(item => item.id), ['allowed']);
});
test('parent calendar API requires a linked child and uses that child audience', async () => {
  const h = harness({
    profiles: {
      actor: { role: 'parent', student_ids: ['child'] },
      child: { ...student, grade: '中3', subjects: ['理科'], parent_uid: 'actor' },
      stranger: { ...student, grade: '中3', parent_uid: 'another-parent' },
    },
    documents: {
      'monthly_schedules/parent': { title: '保護者', start_date: '2026-10-12', end_date: '2026-10-12', audience: 'parent', school_id: '112', grades: ['中3'] },
      'monthly_schedules/student': { title: '生徒限定', start_date: '2026-10-13', end_date: '2026-10-13', audience: 'student', school_id: '112', grades: ['中3'] },
    },
  });
  const route = h.load('app/api/student/calendar/route.ts');
  const allowed = await route.GET(request('/api/student/calendar?start=2026-10-01&end=2026-10-31&student_id=child', null, 'valid', 'GET'));
  assert.equal(allowed.status, 200);
  assert.deepEqual((await allowed.json()).schedules.map(item => item.id), ['parent']);
  const denied = await route.GET(request('/api/student/calendar?start=2026-10-01&end=2026-10-31&student_id=stranger', null, 'valid', 'GET'));
  assert.equal(denied.status, 403);
});

test('parent dashboard returns only linked children and rejects another household', async () => {
  const recentDate = new Intl.DateTimeFormat('sv-SE', { timeZone: 'Asia/Tokyo' }).format(new Date(Date.now() - 2 * 24 * 60 * 60 * 1000));
  const parentProfile = { role: 'parent', student_ids: ['linked'], name: 'Parent' };
  const documents = {
    'users/linked': { role: 'student', student_name: 'Linked Child', grade: '中2', school_id: '112', parent_uid: 'actor' },
    'users/foreign': { role: 'student', student_name: 'Foreign Child', grade: '中1', school_id: '161', parent_uid: 'other-parent' },
    'submissions/linked-homework': { student_id: 'linked', homework_title: '理科宿題', status: 'submitted', comment: '提出済み', submitted_at: new Date(Date.now() - 2 * 24 * 60 * 60 * 1000).toISOString() },
    'submissions/foreign-homework': { student_id: 'foreign', homework_title: '見えてはいけない宿題', status: 'submitted' },
    [`attendance/linked_${recentDate}`]: { user_id: 'linked', target_date: recentDate, type: 'joined', participations: [{ subject: '理科', course_name: '中2理科' }] },
    'attendance/foreign_2099-01-01': { user_id: 'foreign', target_date: recentDate, type: 'joined' },
    'users/linked/chat_history/message': { role: 'user', content: '質問', createdAt: new Date(Date.now() - 2 * 24 * 60 * 60 * 1000) },
  };
  const h = harness({ profiles: { actor: parentProfile }, documents });
  const listResponse = await h.load('app/api/parent/dashboard/route.ts').GET(request('/api/parent/dashboard', null, 'valid', 'GET'));
  assert.equal(listResponse.status, 200);
  assert.deepEqual((await listResponse.json()).students.map(item => item.id), ['linked']);

  const detailResponse = await h.load('app/api/parent/dashboard/route.ts').GET(request('/api/parent/dashboard?student_id=linked', null, 'valid', 'GET'));
  assert.equal(detailResponse.status, 200);
  const detail = await detailResponse.json();
  assert.equal(detail.details.homework.length, 1);
  assert.equal(detail.details.homework[0].title, '理科宿題');
  assert.equal(detail.details.lessons.length, 1);
  assert.equal(detail.details.lessons[0].date, recentDate);
  assert.equal(detail.details.lessons[0].classes[0].live, true);
  assert.equal(detail.details.aiMessages.length, 1);

  const foreignResponse = await h.load('app/api/parent/dashboard/route.ts').GET(request('/api/parent/dashboard?student_id=foreign', null, 'valid', 'GET'));
  assert.equal(foreignResponse.status, 403);
});
test('notification jobs reject teacher and parent callers before queue creation', async () => {
  for (const profile of [teacher, { role: 'parent', student_ids: ['student'] }]) {
    const h = harness({ profiles: { actor: profile } });
    const response = await h.load('app/api/notification-jobs/route.ts').POST(request('/api/notification-jobs', {
      target_role: 'parent', channel: 'email', title: '偽通知', message: '任意メッセージ',
      period: { source: 'parent_dashboard' },
    }));
    assert.equal(response.status, 403);
    assert.equal(h.writes.length, 0);
  }
});
test('legacy LINE push endpoint is retired without external delivery', async () => {
  const calls = [];
  const h = harness({
    profiles: { actor: admin },
    fetch: async url => { calls.push(String(url)); return new Response('{}', { status: 200 }); },
  });
  const route = h.load('app/api/line/push/route.ts');
  const response = await route.POST(request('/api/line/push', { tasks: [{ uid: 'own', text: '通知' }] }));
  assert.equal(response.status, 410);
  assert.equal((await response.json()).replacement, '/api/admin/notifications');
  assert.equal(calls.length, 0);
});
test('LINE link initiation ignores a caller-supplied role and honors the authenticated role setting', async () => {
  const h = harness({
    profiles: { actor: student },
    documents: { 'settings/notification_channels': { line_enabled: true, student_line_enabled: false, teacher_line_enabled: true } },
    env: { LINE_LOGIN_CHANNEL_ID: 'line-client', LINE_LOGIN_STATE_SECRET: 'state-secret', NEXT_PUBLIC_BASE_URL: 'https://security.test' },
  });
  const response = await h.load('app/api/line/auth/route.ts').GET(request('/api/line/auth?mode=json&role=teacher&redirect=%2Fstudent%2Fsettings', null, 'valid', 'GET'));
  assert.equal(response.status, 503);
  assert.equal((await response.json()).error, 'line-integration-unavailable');
  assert.equal(h.writes.length, 0);
});
test('LINE callback consumes a short-lived account-bound state before linking', async () => {
  const externalCalls = [];
  const lineUserId = `U${'a'.repeat(32)}`;
  const h = harness({
    profiles: { actor: student },
    documents: { 'settings/notification_channels': { line_enabled: true, student_line_enabled: true } },
    env: {
      LINE_LOGIN_CHANNEL_ID: 'line-client', LINE_LOGIN_CHANNEL_SECRET: 'line-secret',
      LINE_LOGIN_STATE_SECRET: 'state-secret', NEXT_PUBLIC_BASE_URL: 'https://security.test',
    },
    fetch: async url => {
      externalCalls.push(String(url));
      return String(url).includes('/oauth2/v2.1/token')
        ? Response.json({ access_token: 'line-access-token' })
        : Response.json({ userId: lineUserId });
    },
  });
  const authRoute = h.load('app/api/line/auth/route.ts');
  const initiated = await authRoute.GET(request('/api/line/auth?mode=json&redirect=%2Fstudent%2Fsettings', null, 'valid', 'GET'));
  assert.equal(initiated.status, 200);
  const authorizationUrl = new URL((await initiated.json()).url);
  const state = authorizationUrl.searchParams.get('state');
  assert.ok(state);
  assert.match(String(h.data.get('users/actor').line_link_nonce_hash), /^[a-f0-9]{64}$/);

  const callbackRoute = h.load('app/api/line/callback/route.ts');
  const callbackUrl = `/api/line/callback?code=fixture-code&state=${encodeURIComponent(state)}`;
  const linked = await callbackRoute.GET(request(callbackUrl, null, '', 'GET'));
  assert.equal(linked.status, 307);
  assert.equal(new URL(linked.headers.get('location')).searchParams.get('line_linked'), '1');
  assert.equal(h.data.get('users/actor').line_user_id, lineUserId);

  const replayed = await callbackRoute.GET(request(callbackUrl, null, '', 'GET'));
  assert.equal(replayed.status, 307);
  assert.equal(new URL(replayed.headers.get('location')).searchParams.get('error'), 'line_link_failed');
  assert.equal(externalCalls.length, 4);
});
test('notification preference updates require booleans and preserve role-specific keys', async () => {
  const h = harness({ profiles: { actor: { ...teacher, notification_preferences: { shift: false, student_contact: true } } } });
  const route = h.load('app/api/notifications/preferences/route.ts');
  const invalid = await route.POST(request('/api/notifications/preferences', { email: 'false' }));
  assert.equal(invalid.status, 400);
  assert.equal(h.writes.length, 0);
  const saved = await route.POST(request('/api/notifications/preferences', { email: false, line: true }));
  assert.equal(saved.status, 200);
  const profile = h.data.get('users/actor');
  assert.deepEqual(profile.notification_preferences, { shift: false, student_contact: true });
  assert.equal(profile['notification_preferences.email'], false);
  assert.equal(profile['notification_preferences.line'], true);
});
test('school administrator notification campaigns cannot target another school', async () => {
  const makeHarness = () => harness({
    profiles: { actor: admin, own: { ...teacher, school_id: '112', line_user_id: 'secret-line-id' }, foreign: { ...teacher, school_id: '999', line_user_id: 'foreign-secret' } },
    documents: {
      'settings/notification_channels': { in_app_enabled: true },
      'shift_assignments/today-own': { target_date: new Intl.DateTimeFormat('sv-SE', { timeZone: 'Asia/Tokyo' }).format(new Date()), user_id: 'own' },
      'shift_assignments/today-foreign': { target_date: new Intl.DateTimeFormat('sv-SE', { timeZone: 'Asia/Tokyo' }).format(new Date()), user_id: 'foreign' },
    },
    overrides: { '@/lib/events': { writeLearningEvent: async () => 'fixture-event' } },
  });
  const listing = makeHarness();
  const listedResponse = await listing.load('app/api/admin/notifications/route.ts').GET(request('/api/admin/notifications?view=recipients', null, 'valid', 'GET'));
  assert.equal(listedResponse.status, 200);
  const listed = await listedResponse.json();
  assert.ok(listed.recipients.some(item => item.id === 'own'));
  assert.ok(!listed.recipients.some(item => item.id === 'foreign'));
  assert.equal(listed.recipients.find(item => item.id === 'own').line_linked, true);
  assert.equal(Object.hasOwn(listed.recipients.find(item => item.id === 'own'), 'line_user_id'), false);
  assert.deepEqual(listed.today_teacher_ids, ['own']);
  const foreign = makeHarness();
  const denied = await foreign.load('app/api/admin/notifications/route.ts').POST(request('/api/admin/notifications', {
    title: '通知', message: '他校舎宛', kind: 'system', channels: ['in_app'], selected_user_ids: ['foreign'],
  }));
  assert.equal(denied.status, 400);
  assert.equal(foreign.writes.length, 0);

  const own = makeHarness();
  const accepted = await own.load('app/api/admin/notifications/route.ts').POST(request('/api/admin/notifications', {
    title: '通知', message: '自校舎宛', kind: 'system', channels: ['in_app'], selected_user_ids: ['own'],
  }));
  assert.equal(accepted.status, 200);
  assert.equal((await accepted.json()).target_count, 1);
});
test('notification campaign request id prevents duplicate delivery and accepts operational kinds', async () => {
  const h = harness({
    profiles: { actor: master, target: { ...student, notification_preferences: { in_app: true } } },
    documents: { 'settings/notification_channels': { in_app_enabled: true } },
    overrides: { '@/lib/events': { writeLearningEvent: async () => 'fixture-event' } },
  });
  const route = h.load('app/api/admin/notifications/route.ts');
  const payload = {
    title: '登録依頼', message: '講座を登録してください', kind: 'registration', channels: ['in_app'],
    selected_user_ids: ['target'], request_id: 'request_fixed_12345',
  };
  const first = await route.POST(request('/api/admin/notifications', payload));
  const second = await route.POST(request('/api/admin/notifications', payload));
  assert.equal(first.status, 200);
  assert.equal(second.status, 200);
  assert.equal((await second.json()).already_processed, true);
  assert.equal([...h.data.keys()].filter(key => key.startsWith('notification_campaigns/')).length, 1);
  assert.equal([...h.data.keys()].filter(key => key.startsWith('user_notifications/')).length, 1);
});
test('notification email is delivered directly and does not create a dead queue job', async () => {
  const calls = [];
  const h = harness({
    profiles: { actor: master, target: { ...student, email: 'target@example.test', notification_preferences: { email: true } } },
    documents: { 'settings/notification_channels': { email_enabled: true } },
    env: { RESEND_API_KEY: 'fixture-key', RESEND_FROM_EMAIL: 'noreply@example.test' },
    fetch: async (url, options) => { calls.push({ url: String(url), headers: new Headers(options.headers), body: JSON.parse(options.body) }); return new Response('{"id":"email"}', { status: 200 }); },
    overrides: { '@/lib/events': { writeLearningEvent: async () => 'fixture-event' } },
  });
  const response = await h.load('app/api/admin/notifications/route.ts').POST(request('/api/admin/notifications', {
    title: '連絡', message: '本文', kind: 'system', channels: ['email'], selected_user_ids: ['target'],
  }));
  assert.equal(response.status, 200);
  const body = await response.json();
  assert.equal(body.email_sent_count, 1);
  assert.equal(body.email_failed_count, 0);
  assert.equal(calls.length, 1);
  assert.equal(calls[0].url, 'https://api.resend.com/emails');
  assert.deepEqual(calls[0].body.to, ['target@example.test']);
  assert.match(calls[0].headers.get('Idempotency-Key'), /^classbase-[a-f0-9]{64}$/);
  assert.equal([...h.data.keys()].some(path => path.startsWith('notification_jobs/')), false);
});
test('notification campaign safely retries provider network failures with the same idempotency key', async () => {
  const calls = [];
  const h = harness({
    profiles: { actor: master, target: { ...student, email: 'target@example.test', notification_preferences: { email: true, in_app: true } } },
    documents: { 'settings/notification_channels': { email_enabled: true, in_app_enabled: true } },
    env: { RESEND_API_KEY: 'fixture-key', RESEND_FROM_EMAIL: 'noreply@example.test' },
    fetch: async (_url, options) => {
      calls.push(new Headers(options.headers).get('Idempotency-Key'));
      if (calls.length === 1) throw new Error('temporary network failure');
      return new Response('{"id":"email"}', { status: 200 });
    },
    overrides: { '@/lib/events': { writeLearningEvent: async () => 'fixture-event' } },
  });
  const route = h.load('app/api/admin/notifications/route.ts');
  const payload = {
    title: '再試行テスト', message: '本文', kind: 'system', channels: ['in_app', 'email'],
    selected_user_ids: ['target'], request_id: 'request_retry_12345',
  };
  const first = await route.POST(request('/api/admin/notifications', payload));
  assert.equal(first.status, 200);
  const firstBody = await first.json();
  assert.equal(firstBody.status, 'completed_with_errors');
  assert.equal(firstBody.email_failed_count, 1);
  const second = await route.POST(request('/api/admin/notifications', payload));
  assert.equal(second.status, 200);
  const secondBody = await second.json();
  assert.equal(secondBody.status, 'completed');
  assert.equal(secondBody.email_sent_count, 1);
  assert.equal(calls.length, 2);
  assert.equal(calls[0], calls[1]);
  assert.equal([...h.data.keys()].filter(key => key.startsWith('user_notifications/')).length, 1);
  assert.equal(h.data.get([...h.data.keys()].find(key => key.startsWith('notification_campaigns/'))).retry_count, 1);
});
test('notification campaign sends a deterministic LINE retry key', async () => {
  const calls = [];
  const h = harness({
    profiles: { actor: master, target: { ...student, line_user_id: 'line-target', notification_preferences: { line: true } } },
    documents: { 'settings/notification_channels': { line_enabled: true, student_line_enabled: true } },
    env: { LINE_CHANNEL_ACCESS_TOKEN: 'fixture-token' },
    fetch: async (_url, options) => { calls.push(new Headers(options.headers)); return new Response('{}', { status: 200 }); },
    overrides: { '@/lib/events': { writeLearningEvent: async () => 'fixture-event' } },
  });
  const response = await h.load('app/api/admin/notifications/route.ts').POST(request('/api/admin/notifications', {
    title: 'LINE通知', message: '本文', kind: 'system', channels: ['line'],
    selected_user_ids: ['target'], request_id: 'request_line_12345',
  }));
  assert.equal(response.status, 200);
  assert.equal(calls.length, 1);
  assert.match(calls[0].get('X-Line-Retry-Key'), /^[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/);
});
test('LINE retry treats a provider-confirmed duplicate as delivered', async () => {
  const calls = [];
  const h = harness({
    profiles: {
      actor: master,
      first: { ...student, line_user_id: 'line-first', notification_preferences: { line: true } },
      second: { ...student, line_user_id: 'line-second', notification_preferences: { line: true } },
    },
    documents: { 'settings/notification_channels': { line_enabled: true, student_line_enabled: true } },
    env: { LINE_CHANNEL_ACCESS_TOKEN: 'fixture-token' },
    fetch: async (_url, options) => {
      calls.push(new Headers(options.headers).get('X-Line-Retry-Key'));
      if (calls.length === 2) throw new Error('temporary network failure');
      if (calls.length === 3) return new Response('{}', { status: 409, headers: { 'X-Line-Accepted-Request-Id': 'accepted-before' } });
      return new Response('{}', { status: 200 });
    },
    overrides: { '@/lib/events': { writeLearningEvent: async () => 'fixture-event' } },
  });
  const route = h.load('app/api/admin/notifications/route.ts');
  const payload = {
    title: 'LINE再試行', message: '本文', kind: 'system', channels: ['line'],
    selected_user_ids: ['first', 'second'], request_id: 'request_line_retry_12345',
  };
  const first = await route.POST(request('/api/admin/notifications', payload));
  assert.equal((await first.json()).line_failed_count, 1);
  const second = await route.POST(request('/api/admin/notifications', payload));
  const retried = await second.json();
  assert.equal(retried.status, 'completed');
  assert.equal(retried.line_sent_count, 2);
  assert.equal(retried.line_failed_count, 0);
  assert.equal(calls[0], calls[2]);
  assert.equal(calls[1], calls[3]);
});
test('manual notification jobs are master-only and the unprocessed queue is retired', async () => {
  const nonMaster = harness({ profiles: { actor: admin } });
  assert.equal((await nonMaster.load('app/api/notification-jobs/route.ts').POST(request('/api/notification-jobs', {
    target_role: 'parent', channel: 'email', message: '通知',
  }))).status, 403);
  const privileged = harness({ profiles: { actor: master } });
  assert.equal((await privileged.load('app/api/notification-jobs/route.ts').POST(request('/api/notification-jobs', {
    target_role: 'arbitrary', channel: 'webhook', message: '通知',
  }))).status, 410);
  assert.equal(privileged.writes.length, 0);
});
test('school approval capability does not grant system payroll/settings permissions', () => {
  const h = harness(); const policy = h.load('lib/server-auth.ts');
  const profile = { ...teacher, employment_category: 'dedicated', attendance_school_manager: true };
  const user = { uid: 'actor', role: 'teacher', school: '112', school_ids: [], profile };
  assert.equal(policy.canManageAttendance(user), true);
  assert.equal(policy.canManageAttendanceSchool(user, '112'), true);
  assert.equal(policy.canManageAttendanceSchool(user, '999'), false);
  assert.equal(policy.canManageAttendanceSystem(user), false);
});
test('CSV account import cannot change a protected existing identity', async () => {
  const h = harness({ profiles: { actor: admin, target: { ...master, email: 'target@classbase.local', lifetime_id: 'target' } }, authUsers: { target: { email: 'target@classbase.local' } }, overrides: { '@/lib/events': { writeLearningEvent: async () => 'fixture-event' } } });
  const response = await h.load('app/api/admin/school-students/import/route.ts').POST(request('/api/admin/school-students/import', { school_id: '112', csv_text: 'ログインID,氏名\ntarget,Target', default_password: 'safe-password' }));
  assert.equal(response.status, 200);
  const body = await response.json();
  assert.equal(body.count, 0);
  assert.equal(body.errors.length, 1);
  assert.equal(body.errors[0].error, 'forbidden');
  assert.equal(h.authWrites.length, 0);
  assert.equal(h.data.get('users/target').role, 'master');
});

test('recording proxy rejects a stored foreign download URL before forwarding the Zoom bearer', async () => {
  const requests = [];
  const h = harness({ profiles: { actor: student }, documents: { 'class_recordings/recording': { zoom_download_url: 'https://attacker.test/steal' } }, env: { ZOOM_ACCOUNT_ID: 'fixture', ZOOM_CLIENT_ID: 'fixture', ZOOM_CLIENT_SECRET: 'fixture' }, fetch: async (url, options) => {
    requests.push(String(url));
    return String(url).startsWith('https://zoom.us/oauth/token') ? Response.json({ access_token: 'fixture-zoom-token', expires_in: 3600 }) : new Response('video');
  } });
  const response = await h.load('app/api/zoom/recordings/file/route.ts').GET(request('/api/zoom/recordings/file?recording_id=recording', null, 'valid', 'GET'));
  assert.equal(response.status, 400);
  assert.equal(requests.length, 0);
  assert.ok(requests.every(url => new URL(url).hostname === 'zoom.us'));
});

test('OCR quiz validates image bytes and enforces per-student cost limits', async () => {
  const validPng = `data:image/png;base64,${Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]).toString('base64')}`;
  const allowed = harness({
    profiles: { actor: student },
    env: { SECURITY_DIAGNOSIS_MODE: 'true' },
  });
  const valid = await allowed.load('app/api/ocr-quiz/route.ts').POST(request('/api/ocr-quiz', {
    imageDataUrl: validPng, legalConsent: true, privateUseOnly: true, questionCount: 5,
  }));
  assert.equal(valid.status, 200);
  assert.equal((await valid.json()).questions.length, 5);

  const disguised = harness({ profiles: { actor: student }, env: { SECURITY_DIAGNOSIS_MODE: 'true' } });
  const invalid = await disguised.load('app/api/ocr-quiz/route.ts').POST(request('/api/ocr-quiz', {
    imageDataUrl: `data:image/png;base64,${Buffer.from('not-an-image').toString('base64')}`,
    legalConsent: true, privateUseOnly: true,
  }));
  assert.equal(invalid.status, 400);
  assert.equal((await invalid.json()).error, 'invalid-image-data');

  const limited = harness({
    profiles: { actor: student },
    env: { SECURITY_DIAGNOSIS_MODE: 'true' },
    overrides: { '@/lib/server/password-recovery': { consumeRateLimit: async key => !String(key).includes('_hour_') } },
  });
  const rejected = await limited.load('app/api/ocr-quiz/route.ts').POST(request('/api/ocr-quiz', {
    imageDataUrl: validPng, legalConsent: true, privateUseOnly: true,
  }));
  assert.equal(rejected.status, 429);
  assert.equal((await rejected.json()).error, 'rate-limit');
});

test('Eiken quiz stores attempts atomically and rejects an extra attempt', async () => {
  const h = harness({
    profiles: { actor: student },
    documents: {
      'course_enrollments/enrollment': { user_id: 'actor', program_id: 'eiken', course_id: 'course', status: 'active' },
      'eiken_quizzes/quiz': { course_id: 'course', status: 'published', max_attempts: 1 },
      'eiken_quiz_questions/question': { quiz_id: 'quiz', sequence: 1, correct_answer: 'A', skill_tag: 'reading' },
    },
  });
  const route = h.load('app/api/eiken/quizzes/[id]/submit/route.ts');
  const context = { params: Promise.resolve({ id: 'quiz' }) };
  const first = await route.POST(request('/api/eiken/quizzes/quiz/submit', { answers: { question: 'A' } }), context);
  assert.equal(first.status, 200);
  assert.equal((await first.json()).attempt_no, 1);
  assert.ok(h.data.has('eiken_quiz_results/actor_quiz_1'));

  const second = await route.POST(request('/api/eiken/quizzes/quiz/submit', { answers: { question: 'A' } }), context);
  assert.equal(second.status, 400);
  assert.equal((await second.json()).error, 'quiz-attempt-limit');
});

test('Eiken quiz and writing tasks require server-owned completion evidence', async () => {
  for (const [taskType, details, evidencePath, evidence] of [
    ['quiz', { quiz_id: 'quiz' }, 'eiken_quiz_results/result', { student_id: 'actor', quiz_id: 'quiz' }],
    ['ai_writing', {}, 'eiken_writing_submissions/actor_task', { student_id: 'actor', task_id: 'task', evaluation_status: 'completed' }],
  ]) {
    const baseDocuments = {
      'course_enrollments/enrollment': { user_id: 'actor', program_id: 'eiken', course_id: 'course', status: 'active' },
      'eiken_tasks/task': { course_id: 'course', status: 'published', task_type: taskType, details },
    };
    const context = { params: Promise.resolve({ id: 'task' }) };
    const denied = harness({ profiles: { actor: student }, documents: baseDocuments });
    const deniedResponse = await denied.load('app/api/eiken/tasks/[id]/progress/route.ts').POST(
      request('/api/eiken/tasks/task/progress', { action: 'complete' }), context,
    );
    assert.equal(deniedResponse.status, 400);
    assert.equal((await deniedResponse.json()).error, 'task-completion-evidence-required');

    const allowed = harness({ profiles: { actor: student }, documents: { ...baseDocuments, [evidencePath]: evidence } });
    const allowedResponse = await allowed.load('app/api/eiken/tasks/[id]/progress/route.ts').POST(
      request('/api/eiken/tasks/task/progress', { action: 'complete' }), context,
    );
    assert.equal(allowedResponse.status, 200);
    assert.equal(allowed.data.get('eiken_task_progress/actor_task').status, 'completed');
  }
});

test('online school global problem bank is editable by master and online-school administrators only', async () => {
  const payload = {
    subjectId: 'math', categoryId: 'algebra', categoryName: '代数', level: 1,
    problemType: 'number_input', prompt: '1+1', correctAnswer: '2', explanation: '加法', published: true,
  };
  const denied = harness({ profiles: { actor: admin } });
  const deniedResponse = await denied.load('app/api/online-school/admin/route.ts').POST(
    request('/api/online-school/admin', payload),
  );
  assert.equal(deniedResponse.status, 403);
  assert.equal(denied.writes.length, 0);

  const allowed = harness({ profiles: { actor: master } });
  const allowedResponse = await allowed.load('app/api/online-school/admin/route.ts').POST(
    request('/api/online-school/admin', payload),
  );
  assert.equal(allowedResponse.status, 200);
  assert.equal(allowed.writes.length, 1);
  // オンライン校の権限は理社講座とは別。オンライン校の権限を付けた管理者は編集できる。
  const onlineAdmin = harness({ profiles: { actor: { ...admin, admin_permissions: { science_social: false, online_school: true } } } });
  const onlineResponse = await onlineAdmin.load('app/api/online-school/admin/route.ts').POST(request('/api/online-school/admin', payload));
  assert.equal(onlineResponse.status, 200);
});

test('online school dashboard needs the online-school permission and stays within the administrator schools', async () => {
  const students = {
    mine: { ...student, school_id: '112', school: '112', enabled_programs: ['online_school'], student_name: '自校の生徒' },
    other: { ...student, school_id: '999', school: '999', enabled_programs: ['online_school'], student_name: '他校の生徒' },
  };
  const scienceOnly = harness({ profiles: { actor: { ...admin, admin_permissions: { science_social: true } }, ...students } });
  const denied = await scienceOnly.load('app/api/online-school/admin/route.ts').GET(request('/api/online-school/admin?mode=dashboard', null, 'valid', 'GET'));
  assert.equal(denied.status, 403);

  const online = harness({ profiles: { actor: { ...admin, school_ids: ['112'], admin_permissions: { online_school: true } }, ...students } });
  const response = await online.load('app/api/online-school/admin/route.ts').GET(request('/api/online-school/admin?mode=dashboard', null, 'valid', 'GET'));
  assert.equal(response.status, 200);
  const body = await response.json();
  assert.deepEqual(body.students.map(item => item.id), ['mine']);

  const apps = await online.load('app/api/apps/route.ts').GET(request('/api/apps', null, 'valid', 'GET'));
  const appsBody = await apps.json();
  assert.equal(appsBody.apps.online_school, true);
  assert.equal(appsBody.apps.science_social, false);
  assert.equal(appsBody.apps.attendance, false);
});

test('online school rejects answers after the bounded session answer limit', async () => {
  const h = harness({
    profiles: { actor: { ...student, enabled_programs: ['online_school'] } },
    documents: {
      'online_school_learning_sessions/session': {
        user_id: 'actor', status: 'active', answered_count: 100,
        current_problem: { problemInstanceId: 'problem', correctAnswer: '2' },
      },
    },
  });
  const response = await h.load('app/api/online-school/answer/route.ts').POST(request('/api/online-school/answer', {
    sessionId: 'session', problemInstanceId: 'problem', answerId: 'answer', answer: '2',
  }));
  assert.equal(response.status, 400);
  assert.equal((await response.json()).error, 'session-answer-limit');
  assert.equal(h.writes.length, 0);
});

test('PF dashboard fails closed for an administrator without assigned schools', async () => {
  const unscopedAdmin = { ...admin, school: '', school_id: '', school_ids: [] };
  const h = harness({ profiles: { actor: unscopedAdmin, child: student } });
  const response = await h.load('app/api/pf/dashboard/route.ts').GET(
    request('/api/pf/dashboard?period=week&anchor=2026-10-02', null, 'valid', 'GET'),
  );
  assert.equal(response.status, 403);
});

test('PF parent dashboard returns only linked children and their records', async () => {
  const h = harness({
    profiles: {
      actor: { role: 'parent', student_ids: ['child'] },
      child: { ...student, parent_uid: 'actor', student_name: '対象生徒' },
      stranger: { ...student, parent_uid: 'other', student_name: '対象外生徒' },
    },
    documents: {
      'attendance/child-day': { student_id: 'child', target_date: '2026-10-02', type: 'joined' },
      'attendance/stranger-day': { student_id: 'stranger', target_date: '2026-10-02', type: 'joined' },
      'pf_learning_records/child-task': { student_id: 'child', date: '2026-10-02', kind: 'homework', completed: true },
      'pf_learning_records/stranger-task': { student_id: 'stranger', date: '2026-10-02', kind: 'homework', completed: true },
    },
  });
  const response = await h.load('app/api/pf/dashboard/route.ts').GET(
    request('/api/pf/dashboard?period=week&anchor=2026-10-02', null, 'valid', 'GET'),
  );
  assert.equal(response.status, 200);
  const body = await response.json();
  assert.deepEqual(body.students.map(item => item.id), ['child']);
  assert.equal(body.students[0].attendance_total, 1);
  assert.equal(body.students[0].homework_total, 1);
});

test('PF CSV import rejects duplicate IDs and mismatched ID/name rows', async () => {
  const h = harness({
    profiles: {
      actor: master,
      first: { ...student, lifetime_id: 'duplicate', student_name: '生徒A' },
      second: { ...student, lifetime_id: 'duplicate', student_name: '生徒B' },
      unique: { ...student, lifetime_id: 'unique', student_name: '生徒C' },
    },
  });
  const csv = '生涯番号,氏名,実施日,課題名,ステータス\nduplicate,生徒A,2026-10-02,課題1,完了\nunique,別人,2026-10-02,課題2,完了';
  const response = await h.load('app/api/admin/pf/import/route.ts').POST(request('/api/admin/pf/import', {
    csv_text: csv, target_date: '2026-10-02', kind: 'homework', file_name: 'pf.csv',
  }));
  assert.equal(response.status, 200);
  const body = await response.json();
  assert.equal(body.imported, 0);
  assert.equal(body.unmatched, 2);
  assert.equal([...h.data.keys()].filter(key => key.startsWith('pf_learning_records/')).length, 0);
});
test('PF CSV import preflights oversized cells before reading or writing student data', async () => {
  const h = harness({ profiles: { actor: master } });
  const response = await h.load('app/api/admin/pf/import/route.ts').POST(request('/api/admin/pf/import', {
    csv_text: `生涯番号,氏名,課題名\nstudent,生徒,${'x'.repeat(4001)}`,
    target_date: '2026-10-02', kind: 'homework', file_name: 'pf.csv',
  }));
  assert.equal(response.status, 400);
  assert.equal([...h.data.keys()].some(key => key.startsWith('pf_learning_records/')), false);
});

test('Monoxer 宿題回数ログ is matched by 生徒番号, merged per Book, and diffed against the previous import', async () => {
  const h = harness({
    profiles: {
      actor: master,
      kid: { ...student, lifetime_id: '12129125', student_name: '木村 英嗣' },
    },
  });
  const route = h.load('app/api/admin/pf/import/route.ts');
  // 実際の出力と同じく、先頭の見出しは引用符の内側にBOMがある。同じBookが学年クラスと科目クラスの両方に出る。
  const header = '"\uFEFF""スクールID""",スクール名,クラスID,クラス名,生徒番号,表示名,Book ID,Book名,学習回数';
  const first = [header,
    '74503,【26年度】理社講座,1358655,中1,12129125,木村　英嗣,1674983,理科1年　15　地震,5',
    '74503,【26年度】理社講座,1384663,中1地学_土曜,12129125,木村英嗣,1674983,理科1年　15　地震,5',
    '74503,【26年度】理社講座,1384663,中1地学_土曜,12129125,木村英嗣,1674984,理科1年　16　火山　,2',
    '74503,【26年度】理社講座,1384663,中1地学_土曜,99999999,未登録 生徒,1674984,理科1年　16　火山,1',
  ].join('\r\n');
  const response = await route.POST(request('/api/admin/pf/import', { csv_text: first, target_date: '2026-10-05', file_name: 'log.csv' }));
  assert.equal(response.status, 200);
  const body = await response.json();
  assert.equal(body.mode, 'study_counts');
  assert.equal(body.csv_students, 2);
  assert.equal(body.imported, 1);
  assert.equal(body.unmatched, 1);
  const progress = h.data.get('pf_study_progress/kid');
  assert.equal(progress.total_count, 7);
  assert.equal(progress.books['1674984'].name, '理科1年 16 火山');
  assert.equal(progress.history[0].gained, null);

  const second = [header,
    '74503,【26年度】理社講座,1358655,中1,12129125,木村　英嗣,1674983,理科1年　15　地震,8',
    '74503,【26年度】理社講座,1384663,中1地学_土曜,12129125,木村英嗣,1674984,理科1年　16　火山,2',
  ].join('\n');
  assert.equal((await route.POST(request('/api/admin/pf/import', { csv_text: second, target_date: '2026-10-12', file_name: 'log.csv' }))).status, 200);
  // 同じ日に取り込み直しても、前回（10/5）との差で数え直す
  assert.equal((await route.POST(request('/api/admin/pf/import', { csv_text: second, target_date: '2026-10-12', file_name: 'log.csv' }))).status, 200);
  const updated = h.data.get('pf_study_progress/kid');
  assert.equal(updated.history.length, 2);
  assert.equal(updated.history[1].gained, 3);
  assert.equal(updated.history[1].books_studied, 1);
  // 古い日付のファイルは、新しい記録を上書きしない
  const older = await (await route.POST(request('/api/admin/pf/import', { csv_text: first, target_date: '2026-10-01', file_name: 'old.csv' }))).json();
  assert.equal(older.skipped_older, 1);
  assert.equal(h.data.get('pf_study_progress/kid').last_snapshot_date, '2026-10-12');
});

test('student community rejects activity on pending topics and invalid vote options', async () => {
  const h = harness({
    profiles: { actor: student },
    documents: {
      'community_topics/pending': { is_approved: false, type: 'vote', options: ['A', 'B'], voted_by: [] },
      'community_topics/approved': { is_approved: true, type: 'vote', options: ['A', 'B'], voted_by: [] },
    },
  });
  const route = h.load('app/api/student/community/route.ts');
  assert.equal((await route.POST(request('/api/student/community', { action: 'comment', topic_id: 'pending', text: 'hidden' }))).status, 404);
  assert.equal((await route.POST(request('/api/student/community', { action: 'vote', topic_id: 'approved', option_index: 2 }))).status, 400);
  assert.equal([...h.data.keys()].some(key => key.includes('/comments/')), false);
});
test('teacher community mutations use the validated API and only owners can archive topics', async () => {
  const denied = harness({ profiles: { actor: student } });
  const deniedResponse = await denied.load('app/api/teacher/community/route.ts').POST(request('/api/teacher/community', {
    audience: 'teacher', action: 'create_topic', title: '不正投稿', type: 'thread',
  }));
  assert.equal(deniedResponse.status, 403);
  assert.equal(denied.writes.length, 0);

  const created = harness({ profiles: { actor: teacher } });
  const route = created.load('app/api/teacher/community/route.ts');
  const createdResponse = await route.POST(request('/api/teacher/community', {
    audience: 'teacher', action: 'create_topic', title: '講師向け相談', type: 'thread', category: 'operation',
  }));
  assert.equal(createdResponse.status, 200);
  assert.equal(created.data.get('teacher_community_topics/generated').creator_uid, 'actor');
  assert.equal(created.data.get('teacher_community_topics/generated').is_approved, true);

  const ownership = harness({ profiles: { actor: teacher }, documents: {
    'teacher_community_topics/other': { creator_uid: 'other', is_approved: true },
    'teacher_community_topics/own': { creator_uid: 'actor', is_approved: true },
  } });
  const ownershipRoute = ownership.load('app/api/teacher/community/route.ts');
  assert.equal((await ownershipRoute.POST(request('/api/teacher/community', {
    audience: 'teacher', action: 'delete_topic', topic_id: 'other',
  }))).status, 403);
  assert.equal((await ownershipRoute.POST(request('/api/teacher/community', {
    audience: 'teacher', action: 'delete_topic', topic_id: 'own',
  }))).status, 200);
  assert.equal(ownership.data.get('teacher_community_topics/own').archived, true);
});
test('community like reward never creates a phantom account and rewards the authoritative creator once', async () => {
  const missingCreator = harness({ profiles: { actor: student }, documents: {
    'community_topics/topic': { creator_uid: 'missing', likes: 10, is_approved: true, reward_given: false },
  } });
  const denied = await missingCreator.load('app/api/coin-transactions/route.ts').POST(request('/api/coin-transactions', {
    action: 'community_like_reward', collection_name: 'community_topics', topic_id: 'topic',
  }));
  assert.equal(denied.status, 400);
  assert.equal(missingCreator.data.has('users/missing'), false);
  assert.equal(missingCreator.data.has('coin_transactions/missing_community_like_reward_community_topics_topic'), false);

  const valid = harness({ profiles: { actor: student, creator: { ...student, coins: 0 } }, documents: {
    'community_topics/topic': { creator_uid: 'creator', likes: 10, is_approved: true, reward_given: false },
  } });
  const route = valid.load('app/api/coin-transactions/route.ts');
  assert.equal((await route.POST(request('/api/coin-transactions', {
    action: 'community_like_reward', collection_name: 'community_topics', topic_id: 'topic',
  }))).status, 200);
  assert.equal(valid.data.has('coin_transactions/creator_community_like_reward_community_topics_topic'), true);
  assert.equal(valid.data.get('community_topics/topic').reward_given, true);
});
test('the tenth community like and its creator reward are committed by one server transaction', async () => {
  const h = harness({ profiles: {
    actor: student,
    creator: { ...student, coins: 0, total_coins: 0 },
  }, documents: {
    'community_topics/topic': {
      creator_uid: 'creator', is_approved: true, archived: false,
      likes: 9, liked_by: ['one', 'two'], reward_given: false,
    },
  } });
  const response = await h.load('app/api/student/community/route.ts').POST(request('/api/student/community', {
    action: 'like', topic_id: 'topic',
  }));
  assert.equal(response.status, 200);
  assert.equal((await response.json()).reward_applied, true);
  assert.equal(h.data.get('community_topics/topic').reward_given, true);
  assert.equal(h.data.has('coin_transactions/creator_community_like_reward_community_topics_topic'), true);
});

const questSession = (overrides = {}) => ({
  student_id: 'actor', used: false, expires_at: { toMillis: () => Date.now() + 60_000 },
  grade: '中2', subject: '物理', unit_name: '電流', learning_unit_id: '', source_slide_id: 'slide-1',
  questions: [{ id: 'q1', question: '問1', correct_answer: 'A', wrong_answers: ['B', 'C', 'D'], explanation: '解説' }],
  answers: {},
  ...overrides,
});

test('quest result ignores client-declared score and grades from answers recorded in the session', async () => {
  const h = harness({
    profiles: { actor: student },
    documents: { 'quest_sessions/s1': questSession({ answers: { q1: { selected_answer: 'B', is_correct: false } } }) },
  });
  const response = await h.load('app/api/quest-results/route.ts').POST(request('/api/quest-results', {
    session_id: 's1', score: 100, is_passed: true, source_slide_id: 'forged', unit_name: '偽単元',
    question_results: [{ question_id: 'q1', selected_answer: 'A', correct_answer: 'A', is_correct: true }],
  }));
  assert.equal(response.status, 200);
  const body = await response.json();
  assert.equal(body.score, 0);
  assert.equal(body.is_passed, false);
  assert.equal(body.earned_points, 0);
  assert.equal(h.data.get('quest_results/generated').source_slide_id, 'slide-1');
  assert.equal(h.data.get('quest_sessions/s1').used, true);
  assert.equal([...h.data.values()].some(value => value?.source === 'quest_result' && value?.amount === 10), false);
});

test('quest result requires a session and does not consume it while answers are missing', async () => {
  const h = harness({ profiles: { actor: student }, documents: { 'quest_sessions/s1': questSession() } });
  const route = h.load('app/api/quest-results/route.ts');
  assert.equal((await route.POST(request('/api/quest-results', {
    question_results: [{ question_id: 'q1', selected_answer: 'A' }],
  }))).status, 400);
  assert.equal((await route.POST(request('/api/quest-results', { session_id: 's1' }))).status, 400);
  assert.equal(h.data.get('quest_sessions/s1').used, false);
  assert.equal(h.data.has('quest_results/generated'), false);
});

test('quest answers are graded once per session question and never accepted for other students', async () => {
  const h = harness({
    profiles: { actor: student },
    documents: { 'quest_sessions/s1': questSession(), 'quest_sessions/other': questSession({ student_id: 'someone-else' }) },
  });
  const route = h.load('app/api/quest-sessions/answer/route.ts');
  const answered = await route.POST(request('/api/quest-sessions/answer', { session_id: 's1', question_id: 'q1', selected_answer: 'A' }));
  assert.equal(answered.status, 200);
  const body = await answered.json();
  assert.equal(body.is_correct, true);
  assert.equal(body.correct_answer, 'A');
  assert.equal(h.data.get('quest_sessions/s1').answers.q1.is_correct, true);
  assert.equal((await route.POST(request('/api/quest-sessions/answer', { session_id: 's1', question_id: 'q1', selected_answer: 'B' }))).status, 400);
  assert.equal(h.data.get('quest_sessions/s1').answers.q1.selected_answer, 'A');
  assert.equal((await route.POST(request('/api/quest-sessions/answer', { session_id: 's1', question_id: 'q9', selected_answer: 'A' }))).status, 400);
  assert.equal((await route.POST(request('/api/quest-sessions/answer', { session_id: 'other', question_id: 'q1', selected_answer: 'A' }))).status, 400);
});

test('quest session start returns choices without correct answers', async () => {
  const h = harness({
    profiles: { actor: student },
    documents: {
      'learning_units/u1': { unit_name: '電流', source_slide_id: 'slide-1', grade: '中2', subject: '物理' },
      'quizzes/q1': { question: '問1', correct_answer: 'A', wrong_answers: ['B', 'C', 'D'], explanation: '解説', source_slide_id: 'slide-1', unit_name: '電流', grade: '中2', subject: '物理' },
    },
  });
  const response = await h.load('app/api/quest-sessions/route.ts').POST(request('/api/quest-sessions', { learning_unit_id: 'u1' }));
  assert.equal(response.status, 200);
  const body = await response.json();
  assert.equal(body.session_id, 'generated');
  assert.deepEqual([...body.questions[0].options].sort(), ['A', 'B', 'C', 'D']);
  assert.equal(JSON.stringify(body).includes('correct_answer'), false);
  assert.equal(JSON.stringify(body).includes('解説'), false);
  assert.equal(h.data.get('quest_sessions/generated').questions[0].correct_answer, 'A');
});

test('reward exchange validates the reward and writes deduction plus request atomically', async () => {
  const h = harness({
    profiles: { actor: { ...student, coins: 100 } },
    documents: { 'rewards/reward': { name: 'ノート', required_coins: 30, active: true } },
  });
  const response = await h.load('app/api/coin-transactions/route.ts').POST(request('/api/coin-transactions', {
    action: 'reward_exchange', reward_id: 'reward', exchange_id: 'exchange_12345678',
  }));
  assert.equal(response.status, 200);
  assert.equal((await response.json()).coins, 70);
  assert.equal(h.data.get('requests/exchange_actor_exchange_12345678').status, 'pending');
  assert.equal(h.data.get('coin_transactions/actor_reward_exchange_exchange_12345678').amount, -30);

  const invalid = harness({ profiles: { actor: { ...student, coins: 100 } }, documents: {
    'rewards/reward': { name: '無効', required_coins: 0, active: true },
  } });
  const denied = await invalid.load('app/api/coin-transactions/route.ts').POST(request('/api/coin-transactions', {
    action: 'reward_exchange', reward_id: 'reward', exchange_id: 'exchange_12345678',
  }));
  assert.equal(denied.status, 400);
  assert.equal(invalid.data.has('requests/exchange_actor_exchange_12345678'), false);
});

test('reward management is limited to authorized science-social managers and archives instead of deleting', async () => {
  const denied = harness({ profiles: { actor: { ...admin, admin_permissions: { science_social: false } } }, documents: { 'rewards/reward': { name: 'ノート', required_coins: 30 } } });
  assert.equal((await denied.load('app/api/admin/rewards/route.ts').GET(request('/api/admin/rewards', null, 'valid', 'GET'))).status, 403);
  assert.equal((await denied.load('app/api/admin/rewards/route.ts').PATCH(request('/api/admin/rewards', { id: 'reward', active: false }))).status, 403);

  const scienceSocialManager = harness({ profiles: { actor: admin }, documents: { 'rewards/reward': { name: 'ノート', required_coins: 30, active: true } } });
  assert.equal((await scienceSocialManager.load('app/api/admin/rewards/route.ts').GET(request('/api/admin/rewards', null, 'valid', 'GET'))).status, 200);

  const allowed = harness({ profiles: { actor: master }, documents: { 'rewards/reward': { name: 'ノート', required_coins: 30, active: true } } });
  const listed = await allowed.load('app/api/admin/rewards/route.ts').GET(request('/api/admin/rewards', null, 'valid', 'GET'));
  assert.equal(listed.status, 200);
  assert.equal((await listed.json()).rewards.length, 1);
  const archived = await allowed.load('app/api/admin/rewards/route.ts').PATCH(request('/api/admin/rewards', { id: 'reward', active: false }));
  assert.equal(archived.status, 200);
  assert.equal(allowed.data.get('rewards/reward').archived, true);
  assert.ok(allowed.calls.includes('revalidate:reward-catalog'));
});

test('exchange rejection is master-only, atomic, audited, and cannot refund twice', async () => {
  const documents = { 'requests/exchange': { type: 'exchange', status: 'pending', userId: 'student', rewardId: 'reward', rewardName: 'ノート', cost: 30 } };
  const denied = harness({ profiles: { actor: admin, student: { ...student, coins: 70 } }, documents });
  assert.equal((await denied.load('app/api/admin/requests/route.ts').POST(request('/api/admin/requests', { request_id: 'exchange', action: 'reject' }))).status, 403);

  const h = harness({ profiles: { actor: master, student: { ...student, coins: 70 } }, documents });
  const route = h.load('app/api/admin/requests/route.ts');
  const first = await route.POST(request('/api/admin/requests', { request_id: 'exchange', action: 'reject' }));
  assert.equal(first.status, 200);
  assert.equal(h.data.get('requests/exchange').status, 'rejected');
  assert.equal(h.data.get('coin_transactions/reward_refund_exchange').amount, 30);
  const replay = await route.POST(request('/api/admin/requests', { request_id: 'exchange', action: 'reject' }));
  assert.equal(replay.status, 400);
  assert.equal([...h.data.keys()].filter(key => key === 'coin_transactions/reward_refund_exchange').length, 1);
});

test('course analytics is master-only and rejects invalid calendar filters', async () => {
  const denied = harness({ profiles: { actor: admin } });
  const deniedRoute = denied.load('app/api/admin/course-analytics/route.ts');
  assert.equal((await deniedRoute.GET(request('/api/admin/course-analytics?period=month&anchor=2026-10-01', null, 'valid', 'GET'))).status, 403);

  const h = harness({ profiles: { actor: master } });
  const route = h.load('app/api/admin/course-analytics/route.ts');
  assert.equal((await route.GET(request('/api/admin/course-analytics?period=quarter&anchor=2026-10-01', null, 'valid', 'GET'))).status, 400);
  assert.equal((await route.GET(request('/api/admin/course-analytics?period=week&anchor=2026-02-30', null, 'valid', 'GET'))).status, 400);
  const response = await route.GET(request('/api/admin/course-analytics?period=week&anchor=2026-10-01', null, 'valid', 'GET'));
  assert.equal(response.status, 200);
  const body = await response.json();
  assert.equal(body.range.start, '2026-09-28');
  assert.equal(body.range.end, '2026-10-04');
});

test('health endpoint keeps liveness public and protects the Firestore readiness probe', async () => {
  const h = harness({ env: { OPS_HEALTH_SECRET: 'health-secret-123' } });
  const route = h.load('app/api/health/route.ts');
  const liveness = await route.GET(request('/api/health', null, '', 'GET'));
  assert.equal(liveness.status, 200);
  assert.equal((await liveness.json()).check, 'liveness');
  assert.equal((await route.GET(request('/api/health?deep=1', null, 'wrong-secret', 'GET'))).status, 401);
  const readiness = await route.GET(request('/api/health?deep=1', null, 'health-secret-123', 'GET'));
  assert.equal(readiness.status, 200);
  const body = await readiness.json();
  assert.equal(body.check, 'readiness');
  assert.equal(body.dependencies.firestore, 'ok');
});

test('authenticated profile fallback returns the current account without stored secrets', async () => {
  const h = harness({ profiles: { actor: { ...student, initial_password: 'secret', line_user_id: 'line-secret', name: 'Student' } } });
  const route = h.load('app/api/auth/profile/route.ts');
  assert.equal((await route.GET(request('/api/auth/profile', null, '', 'GET'))).status, 401);
  const response = await route.GET(request('/api/auth/profile', null, 'valid', 'GET'));
  assert.equal(response.status, 200);
  const body = await response.json();
  assert.equal(body.profile.uid, 'actor');
  assert.equal(body.profile.role, 'student');
  assert.equal(body.profile.initial_password, undefined);
  assert.equal(body.profile.line_user_id, undefined);

  const inactive = harness({ profiles: { actor: { ...student, account_status: 'suspended' } } });
  assert.equal((await inactive.load('app/api/auth/profile/route.ts').GET(request('/api/auth/profile', null, 'valid', 'GET'))).status, 403);
});

test('account archive validates the whole selection and writes status with audit events atomically', async () => {
  const h = harness({ profiles: {
    actor: master,
    student1: { ...student, school_id: '112', status: 'active' },
    teacher1: { ...teacher, status: 'active' },
  } });
  const route = h.load('app/api/admin/accounts/status/route.ts');
  const response = await route.POST(request('/api/admin/accounts/status', { user_ids: ['student1', 'teacher1'], status: 'archived' }));
  assert.equal(response.status, 200);
  assert.equal((await response.json()).count, 2);
  assert.equal(h.data.get('users/student1').status, 'archived');
  assert.equal(h.data.get('users/teacher1').account_status, 'archived');
  assert.deepEqual(h.authWrites, [
    { uid: 'student1', disabled: true },
    { uid: 'teacher1', disabled: true },
  ]);
  assert.ok(h.calls.includes('revoke:student1'));
  assert.ok(h.calls.includes('revoke:teacher1'));
  const auditEvents = [...h.data.entries()].filter(([key, value]) => key.startsWith('learning_events/') && value.type === 'account_status_changed');
  assert.equal(auditEvents.length, 1); // The in-memory harness reuses its generated document id.
  assert.equal(auditEvents[0][1].metadata.bulk, true);

  const includesSelf = harness({ profiles: { actor: master, student1: student } });
  const selfResponse = await includesSelf.load('app/api/admin/accounts/status/route.ts').POST(request('/api/admin/accounts/status', { user_ids: ['student1', 'actor'], status: 'archived' }));
  assert.equal(selfResponse.status, 400);
  assert.equal(includesSelf.data.get('users/student1').status, undefined);

  const includesMaster = harness({ profiles: { actor: master, otherMaster: master, student1: student } });
  const masterResponse = await includesMaster.load('app/api/admin/accounts/status/route.ts').POST(request('/api/admin/accounts/status', { user_ids: ['student1', 'otherMaster'], status: 'archived' }));
  assert.equal(masterResponse.status, 400);
  assert.equal(includesMaster.data.get('users/student1').status, undefined);
});

test('account restore re-enables Firebase Auth before marking the profile active', async () => {
  const h = harness({ profiles: {
    actor: master,
    teacher1: { ...teacher, account_status: 'suspended', status: 'suspended' },
  } });
  const route = h.load('app/api/admin/accounts/status/route.ts');
  const response = await route.POST(request('/api/admin/accounts/status', { user_id: 'teacher1', status: 'active' }));
  assert.equal(response.status, 200);
  assert.deepEqual(h.authWrites, [{ uid: 'teacher1', disabled: false }]);
  assert.equal(h.data.get('users/teacher1').account_status, 'active');
  assert.ok(h.calls.includes('revoke:teacher1'));
});

test('勤怠承認シフトは専任の校舎承認者だけが同一校舎の職員に登録できる', async () => {
  const dedicated = { ...teacher, employment_category: 'dedicated', attendance_school_manager: true };
  const h = harness({ profiles: { actor: dedicated, teacher1: { ...teacher, employment_category: 'semi_dedicated', lifetime_id: 'teacher1' } } });
  const response = await h.load('app/api/attendance-shifts/route.ts').POST(request('/api/attendance-shifts', {
    action: 'create', school_id: '112', teacher_id: 'teacher1', date: '2026-10-09',
    start: '16:50', end: '18:00', category: 'individual', individual_ratio: '1:2', reflect_to_attendance: true,
  }));
  assert.equal(response.status, 200);
  assert.equal((await response.json()).count, 1);
  const created = [...h.data.entries()].find(([key]) => key.startsWith('attendance_shift_plans/'))?.[1];
  assert.equal(created.school_id, '112');
  assert.equal(created.teacher_id, 'teacher1');

  const attendanceAdmin = harness({ profiles: { actor: { role: 'attendance_admin', school_id: '112', school_ids: ['112'] }, teacher1: teacher } });
  const denied = await attendanceAdmin.load('app/api/attendance-shifts/route.ts').POST(request('/api/attendance-shifts', {
    action: 'create', school_id: '112', teacher_id: 'teacher1', date: '2026-10-09',
    start: '16:50', end: '18:00', category: 'individual', individual_ratio: '1:2',
  }));
  assert.equal(denied.status, 403);
  assert.equal(attendanceAdmin.writes.filter(key => key.startsWith('attendance_shift_plans/')).length, 0);
});

test('個別シフトは同一校舎の生徒だけを割り当て、校舎設定を保存できる', async () => {
  const dedicated = { ...teacher, employment_category: 'dedicated', attendance_school_manager: true };
  const h = harness({ profiles: {
    actor: dedicated,
    teacher1: { ...teacher, employment_category: 'semi_dedicated', lifetime_id: 'teacher1' },
    student1: { role: 'student', school_id: '112', student_name: '佐藤花子', lifetime_id: 'student1' },
    foreignStudent: { role: 'student', school_id: '999', student_name: '校舎外生徒', lifetime_id: 'foreignStudent' },
  } });
  const route = h.load('app/api/attendance-shifts/route.ts');
  const settingResponse = await route.POST(request('/api/attendance-shifts', {
    action: 'update_settings', school_id: '112', allow_individual_view: true,
  }));
  assert.equal(settingResponse.status, 200);
  assert.equal(h.data.get('users/actor').attendance_shift_individual_view, true);

  const response = await route.POST(request('/api/attendance-shifts', {
    action: 'create', school_id: '112', teacher_id: 'teacher1', student_ids: ['student1'], date: '2026-10-09',
    start: '16:50', end: '18:00', category: 'individual', individual_ratio: '1:2', room: 'ブース1',
  }));
  assert.equal(response.status, 200);
  const created = [...h.data.entries()].find(([key, value]) => key.startsWith('attendance_shift_plans/') && value.student_ids)?.[1];
  assert.deepEqual(created.student_ids, ['student1']);
  assert.deepEqual(created.student_names, ['佐藤花子']);

  const rejected = await route.POST(request('/api/attendance-shifts', {
    action: 'create', school_id: '112', teacher_id: 'teacher1', student_ids: ['foreignStudent'], date: '2026-10-09',
    start: '18:10', end: '19:20', category: 'individual', individual_ratio: '1:2', room: 'ブース2',
  }));
  assert.equal(rejected.status, 400);
});

test('講師は勤怠画面から自分の当日シフトだけ取得できる', async () => {
  const h = harness({
    profiles: { actor: teacher },
    documents: {
      'attendance_shift_plans/own': { date: '2026-10-09', teacher_id: 'actor', school_id: '112', start: '16:50', end: '18:00', category: 'individual' },
      'attendance_shift_plans/other': { date: '2026-10-09', teacher_id: 'other', school_id: '112', start: '18:10', end: '19:20', category: 'group' },
    },
  });
  const response = await h.load('app/api/attendance-shifts/route.ts').GET(request('/api/attendance-shifts?start=2026-10-09&end=2026-10-09', null, 'valid', 'GET'));
  assert.equal(response.status, 200);
  const body = await response.json();
  assert.deepEqual(body.shifts.map(item => item.id), ['own']);
  assert.deepEqual(body.staff, []);

  const dedicated = { ...teacher, employment_category: 'dedicated', attendance_school_manager: true };
  const managerView = harness({
    profiles: { actor: dedicated },
    documents: {
      'attendance_shift_plans/own': { date: '2026-10-09', teacher_id: 'actor', school_id: '112' },
      'attendance_shift_plans/other': { date: '2026-10-09', teacher_id: 'other', school_id: '112' },
    },
  });
  const ownResponse = await managerView.load('app/api/attendance-shifts/route.ts').GET(request('/api/attendance-shifts?start=2026-10-09&end=2026-10-09&scope=mine', null, 'valid', 'GET'));
  assert.equal(ownResponse.status, 200);
  assert.deepEqual((await ownResponse.json()).shifts.map(item => item.id), ['own']);
});

const gachaDoc = (overrides = {}) => ({ name: '夏ガチャ', cost: 20, active: true, items: [{ reward_id: 'prize', weight: 10000 }], miss_weight: 0, miss_refund_coins: 0, ...overrides });

test('gacha draw charges once, delivers a physical prize for shipping, and replays idempotently', async () => {
  const h = harness({
    profiles: { actor: { ...student, coins: 50 } },
    documents: { 'gachas/g1': gachaDoc(), 'rewards/prize': { name: 'ノート', required_coins: 100, active: true, stock: 3 } },
  });
  const route = h.load('app/api/rewards/gacha/route.ts');
  const response = await route.POST(request('/api/rewards/gacha', { gacha_id: 'g1', draw_id: 'draw_12345678' }));
  assert.equal(response.status, 200);
  const body = await response.json();
  assert.equal(body.result, 'win');
  assert.equal(body.coins, 30);
  assert.equal(h.data.get('coin_transactions/actor_gacha_draw_12345678').amount, -20);
  assert.equal(h.data.get('requests/gacha_actor_draw_12345678').status, 'pending');
  assert.equal(h.data.get('requests/gacha_actor_draw_12345678').cost, 0);
  assert.deepEqual(h.data.get('rewards/prize').stock, { increment: -1 });

  const replay = await route.POST(request('/api/rewards/gacha', { gacha_id: 'g1', draw_id: 'draw_12345678' }));
  assert.equal((await replay.json()).applied, false);
  assert.equal([...h.data.keys()].filter(key => key.startsWith('coin_transactions/actor_gacha_')).length, 1);
});

test('gacha treats an out-of-stock prize as a miss, refunds consolation coins, and rejects broken rates', async () => {
  const h = harness({
    profiles: { actor: { ...student, coins: 50 } },
    documents: {
      'gachas/g1': gachaDoc({ miss_refund_coins: 5 }),
      'gachas/broken': gachaDoc({ miss_weight: 100 }),
      'rewards/prize': { name: 'ノート', required_coins: 100, active: true, stock: 0 },
    },
  });
  const route = h.load('app/api/rewards/gacha/route.ts');
  const body = await (await route.POST(request('/api/rewards/gacha', { gacha_id: 'g1', draw_id: 'draw_miss_0001' }))).json();
  assert.equal(body.result, 'miss');
  assert.equal(body.refund, 5);
  assert.equal(body.coins, 35);
  assert.equal(h.data.has('requests/gacha_actor_draw_miss_0001'), false);
  assert.equal((await route.POST(request('/api/rewards/gacha', { gacha_id: 'broken', draw_id: 'draw_broken_01' }))).status, 400);

  const poor = harness({ profiles: { actor: { ...student, coins: 10 } }, documents: { 'gachas/g1': gachaDoc(), 'rewards/prize': { name: 'ノート', required_coins: 1, active: true } } });
  assert.equal((await poor.load('app/api/rewards/gacha/route.ts').POST(request('/api/rewards/gacha', { gacha_id: 'g1', draw_id: 'draw_poor_0001' }))).status, 400);
  assert.equal(poor.data.has('gacha_draws/actor_draw_poor_0001'), false);
});

test('digital rewards are granted on exchange and only the owner can get a download link', async () => {
  const documents = { 'rewards/wallpaper': { name: '壁紙', required_coins: 30, active: true, kind: 'digital', digital_file_path: 'reward_files/wallpaper/a.png', digital_file_name: 'a.png' } };
  const h = harness({ profiles: { actor: { ...student, coins: 100 } }, documents });
  const exchange = await h.load('app/api/coin-transactions/route.ts').POST(request('/api/coin-transactions', {
    action: 'reward_exchange', reward_id: 'wallpaper', exchange_id: 'exchange_digital_01',
  }));
  assert.equal(exchange.status, 200);
  assert.equal((await exchange.json()).kind, 'digital');
  assert.equal(h.data.get('reward_grants/shop_actor_exchange_digital_01').user_id, 'actor');
  assert.equal(h.data.has('requests/exchange_actor_exchange_digital_01'), false);

  const download = await h.load('app/api/rewards/download/route.ts').POST(request('/api/rewards/download', { grant_id: 'shop_actor_exchange_digital_01' }));
  assert.equal(download.status, 200);
  assert.ok(h.calls.includes('signed:reward_files/wallpaper/a.png'));

  const other = harness({ profiles: { actor: student }, documents: { 'reward_grants/g': { user_id: 'someone-else', digital_file_path: 'reward_files/x/a.png' } } });
  assert.equal((await other.load('app/api/rewards/download/route.ts').POST(request('/api/rewards/download', { grant_id: 'g' }))).status, 403);
  assert.equal(other.calls.some(call => String(call).startsWith('signed:')), false);

  const gachaOnly = harness({ profiles: { actor: { ...student, coins: 100 } }, documents: { 'rewards/r': { name: '限定', required_coins: 10, active: true, exchangeable: false } } });
  assert.equal((await gachaOnly.load('app/api/coin-transactions/route.ts').POST(request('/api/coin-transactions', {
    action: 'reward_exchange', reward_id: 'r', exchange_id: 'exchange_gacha_only',
  }))).status, 400);
});

test('reward shipments are school-scoped and cancellation refunds coins and restores stock once', async () => {
  const documents = {
    'requests/exchange_student_x1': { type: 'exchange', status: 'pending', userId: 'student', rewardId: 'reward', rewardName: 'ノート', cost: 30 },
    'rewards/reward': { name: 'ノート', required_coins: 30, active: true, stock: 2 },
  };
  const otherSchool = harness({ profiles: { actor: { ...admin, school: '200', school_id: '200', school_ids: ['200'] }, student: { ...student, coins: 0 } }, documents });
  const otherRoute = otherSchool.load('app/api/admin/reward-shipments/route.ts');
  assert.equal((await otherRoute.POST(request('/api/admin/reward-shipments', { request_id: 'exchange_student_x1', status: 'shipped' }))).status, 403);
  assert.equal((await (await otherRoute.GET(request('/api/admin/reward-shipments', null, 'valid', 'GET'))).json()).shipments.length, 0);

  const h = harness({ profiles: { actor: admin, student: { ...student, coins: 0 } }, documents });
  const route = h.load('app/api/admin/reward-shipments/route.ts');
  assert.equal((await route.POST(request('/api/admin/reward-shipments', { request_id: 'exchange_student_x1', status: 'preparing', student_note: '次の授業で渡します' }))).status, 200);
  assert.equal(h.data.get('requests/exchange_student_x1').status, 'preparing');
  const cancel = await route.POST(request('/api/admin/reward-shipments', { request_id: 'exchange_student_x1', status: 'rejected' }));
  assert.equal(cancel.status, 200);
  assert.equal(h.data.get('coin_transactions/reward_refund_exchange_student_x1').amount, 30);
  assert.deepEqual(h.data.get('rewards/reward').stock, { increment: 1 });
  assert.equal((await route.POST(request('/api/admin/reward-shipments', { request_id: 'exchange_student_x1', status: 'rejected' }))).status, 400);
});

test('point adjustments are school-scoped, audited, and cannot push a balance below zero', async () => {
  const otherSchool = harness({ profiles: { actor: { ...admin, school: '200', school_id: '200', school_ids: ['200'] }, student: { ...student, coins: 10 } } });
  assert.equal((await otherSchool.load('app/api/admin/points/route.ts').POST(request('/api/admin/points', {
    action: 'adjust', user_id: 'student', amount: 5, reason: '発言', adjustment_id: 'adjust_0000001',
  }))).status, 403);

  const h = harness({ profiles: { actor: admin, student: { ...student, coins: 10, total_coins: 10 } } });
  const route = h.load('app/api/admin/points/route.ts');
  assert.equal((await route.POST(request('/api/admin/points', { action: 'adjust', user_id: 'student', amount: -11, reason: '修正', adjustment_id: 'adjust_0000002' }))).status, 400);
  assert.equal((await route.POST(request('/api/admin/points', { action: 'adjust', user_id: 'student', amount: 5, reason: '', adjustment_id: 'adjust_0000003' }))).status, 400);
  const added = await route.POST(request('/api/admin/points', { action: 'adjust', user_id: 'student', amount: 5, reason: '発言', adjustment_id: 'adjust_0000004' }));
  assert.equal(added.status, 200);
  assert.equal(h.data.get('coin_transactions/student_admin_adjustment_adjust_0000004').amount, 5);
  assert.deepEqual(h.data.get('users/student').total_coins, { increment: 5 });

  assert.equal((await route.POST(request('/api/admin/points', { action: 'grant_badge', user_id: 'student', badge_id: 'badge_king' }))).status, 400);
  assert.equal((await route.POST(request('/api/admin/points', { action: 'grant_badge', user_id: 'student', badge_id: 'badge_special_mvp' }))).status, 200);
});

test('gacha configuration requires item rates plus the miss rate to total exactly 100 percent', async () => {
  const h = harness({ profiles: { actor: admin }, documents: { 'rewards/prize': { name: 'ノート', required_coins: 10, active: true } } });
  const route = h.load('app/api/admin/gachas/route.ts');
  const form = (items, missWeight) => {
    const body = new FormData();
    body.set('name', 'テスト'); body.set('cost', '10');
    body.set('items', JSON.stringify(items)); body.set('miss_weight', String(missWeight));
    return new NextRequest('https://security.test/api/admin/gachas', { method: 'POST', headers: { authorization: 'Bearer valid' }, body });
  };
  assert.equal((await route.POST(form([{ reward_id: 'prize', weight: 3000 }], 6000))).status, 400);
  assert.equal((await route.POST(form([{ reward_id: 'missing', weight: 3000 }], 7000))).status, 400);
  assert.equal((await route.POST(form([{ reward_id: 'prize', weight: 3000 }], 7000))).status, 200);
  assert.equal(h.data.get('gachas/generated').miss_weight, 7000);
});

test('reward shop stays closed when hidden globally except for students the master individually allowed', async () => {
  const documents = {
    'settings/portal_visibility': { student: { shop: false } },
    'rewards/reward': { name: 'ノート', required_coins: 10, active: true },
    'gachas/g1': gachaDoc({ items: [{ reward_id: 'reward', weight: 10000 }] }),
  };
  const closed = harness({ profiles: { actor: { ...student, coins: 100 } }, documents });
  assert.equal((await closed.load('app/api/rewards/route.ts').GET(request('/api/rewards', null, 'valid', 'GET'))).status, 400);
  assert.equal((await closed.load('app/api/coin-transactions/route.ts').POST(request('/api/coin-transactions', {
    action: 'reward_exchange', reward_id: 'reward', exchange_id: 'exchange_closed_01',
  }))).status, 400);
  assert.equal((await closed.load('app/api/rewards/gacha/route.ts').POST(request('/api/rewards/gacha', { gacha_id: 'g1', draw_id: 'draw_closed_001' }))).status, 400);
  assert.equal(closed.data.get('users/actor').coins, 100);

  const tester = harness({ profiles: { actor: { ...student, coins: 100, feature_overrides: { shop: true } } }, documents });
  assert.equal((await tester.load('app/api/rewards/route.ts').GET(request('/api/rewards', null, 'valid', 'GET'))).status, 200);
  assert.equal((await tester.load('app/api/coin-transactions/route.ts').POST(request('/api/coin-transactions', {
    action: 'reward_exchange', reward_id: 'reward', exchange_id: 'exchange_tester_01',
  }))).status, 200);

  const schoolAdmin = harness({ profiles: { actor: admin, student } });
  assert.equal((await schoolAdmin.load('app/api/admin/points/route.ts').POST(request('/api/admin/points', { action: 'set_shop_override', user_id: 'student', enabled: true }))).status, 403);
  const masterView = harness({ profiles: { actor: master, student } });
  assert.equal((await masterView.load('app/api/admin/points/route.ts').POST(request('/api/admin/points', { action: 'set_shop_override', user_id: 'student', enabled: true }))).status, 200);
  assert.equal(masterView.data.get('users/student').feature_overrides.shop, true);
});

test('cosmetic preset rewards are owned once, recorded server-side, and limited badges join earned badges', async () => {
  const documents = {
    'rewards/galaxy': { name: 'テーマ「ギャラクシー」', required_coins: 50, active: true, preset_id: 'theme_galaxy', kind: 'cosmetic' },
    'rewards/unicorn': { name: '限定バッジ「ユニコーン」', required_coins: 50, active: true, preset_id: 'badge_shop_unicorn', kind: 'cosmetic' },
  };
  const h = harness({ profiles: { actor: { ...student, coins: 200 } }, documents });
  const route = h.load('app/api/coin-transactions/route.ts');
  const theme = await route.POST(request('/api/coin-transactions', { action: 'reward_exchange', reward_id: 'galaxy', exchange_id: 'exchange_theme_01' }));
  assert.equal(theme.status, 200);
  assert.equal((await theme.json()).kind, 'cosmetic');
  assert.ok(h.data.get('users/actor').owned_cosmetics.includes('theme_galaxy'));
  assert.equal(h.data.get('reward_grants/shop_actor_exchange_theme_01').preset_id, 'theme_galaxy');
  assert.equal(h.data.has('requests/exchange_actor_exchange_theme_01'), false);

  const badge = await route.POST(request('/api/coin-transactions', { action: 'reward_exchange', reward_id: 'unicorn', exchange_id: 'exchange_badge_01' }));
  assert.equal(badge.status, 200);
  assert.ok(h.data.get('users/actor').earned_badges.includes('badge_shop_unicorn'));

  const owner = harness({ profiles: { actor: { ...student, coins: 200, owned_cosmetics: ['theme_galaxy'] } }, documents });
  const duplicate = await owner.load('app/api/coin-transactions/route.ts').POST(request('/api/coin-transactions', { action: 'reward_exchange', reward_id: 'galaxy', exchange_id: 'exchange_theme_02' }));
  assert.equal(duplicate.status, 400);
  assert.equal((await duplicate.json()).error, 'reward-already-owned');
  assert.equal(owner.data.get('users/actor').coins, 200);
});

test('gacha turns an already-owned cosmetic prize into a miss instead of a duplicate', async () => {
  const h = harness({
    profiles: { actor: { ...student, coins: 50, owned_cosmetics: ['vb_space'] } },
    documents: {
      'gachas/g1': gachaDoc({ items: [{ reward_id: 'space', weight: 10000 }], miss_refund_coins: 3 }),
      'rewards/space': { name: 'バーチャル背景「宇宙」', required_coins: 100, active: true, preset_id: 'vb_space', kind: 'digital' },
    },
  });
  const body = await (await h.load('app/api/rewards/gacha/route.ts').POST(request('/api/rewards/gacha', { gacha_id: 'g1', draw_id: 'draw_owned_001' }))).json();
  assert.equal(body.result, 'miss');
  assert.equal(body.refund, 3);
  assert.equal(h.data.has('reward_grants/gacha_actor_draw_owned_001'), false);
});

test('administrators add preset rewards without uploading images and unknown presets are rejected', async () => {
  const h = harness({ profiles: { actor: admin } });
  const route = h.load('app/api/admin/rewards/route.ts');
  const form = fields => {
    const body = new FormData();
    Object.entries(fields).forEach(([key, value]) => body.set(key, value));
    return new NextRequest('https://security.test/api/admin/rewards', { method: 'POST', headers: { authorization: 'Bearer valid' }, body });
  };
  assert.equal((await route.POST(form({ preset_id: 'vb_aurora', required_coins: '150' }))).status, 200);
  const created = h.data.get('rewards/generated');
  assert.equal(created.preset_id, 'vb_aurora');
  assert.equal(created.kind, 'digital');
  assert.equal(created.name, 'バーチャル背景「オーロラ」');
  assert.equal((await route.POST(form({ preset_id: 'not_a_preset', required_coins: '10' }))).status, 400);
  assert.equal((await route.POST(form({ name: '画像なし', required_coins: '10' }))).status, 400);
});

test('premium appearance options only apply when the student owns them', async () => {
  const { normalizeStudentAppearance } = harness().load('lib/student-customization.ts');
  const saved = { theme: 'galaxy', backgroundPattern: 'stars', title: 'title_ace', frame: 'frame_gold' };
  const locked = normalizeStudentAppearance(saved, []);
  assert.equal(locked.theme, 'aurora');
  assert.equal(locked.backgroundPattern, 'none');
  assert.equal(locked.title, '');
  assert.equal(locked.frame, '');
  const unlocked = normalizeStudentAppearance(saved, ['theme_galaxy', 'pattern_stars', 'title_ace', 'frame_gold']);
  assert.equal(unlocked.theme, 'galaxy');
  assert.equal(unlocked.backgroundPattern, 'stars');
  assert.equal(unlocked.title, 'title_ace');
  assert.equal(unlocked.frame, 'frame_gold');
});

test('printed password sync skips already-activated accounts unless an administrator explicitly reissues', async () => {
  const profiles = {
    actor: master,
    fresh: { ...student, lifetime_id: 'fresh01', email: 'fresh01@classbase.local', initial_password: 'Fresh12345', isFirstLogin: true },
    active: { ...student, lifetime_id: 'active01', email: 'active01@classbase.local', isFirstLogin: false },
  };
  const authUsers = { fresh: { email: 'fresh01@classbase.local' }, active: { email: 'active01@classbase.local' } };
  const h = harness({ profiles, authUsers });
  const route = h.load('app/api/admin/accounts/sync-printed-password/route.ts');
  const issued = await (await route.POST(request('/api/admin/accounts/sync-printed-password', { user_ids: ['fresh', 'active'] }))).json();
  assert.equal(issued.synced_count, 1);
  assert.equal(issued.skipped_count, 1);
  assert.equal(issued.skipped[0].user_id, 'active');
  assert.equal(issued.results[0].initial_password, 'Fresh12345');
  assert.equal(h.authWrites.some(write => write.uid === 'active'), false);
  assert.equal(h.data.get('users/active').isFirstLogin, false);

  const reissued = await (await route.POST(request('/api/admin/accounts/sync-printed-password', { user_ids: ['active'], mode: 'reissue' }))).json();
  assert.equal(reissued.synced_count, 1);
  assert.equal(reissued.results[0].generated_password, true);
  assert.ok(h.authWrites.some(write => write.uid === 'active' && write.password === reissued.results[0].initial_password));

  const tooMany = await route.POST(request('/api/admin/accounts/sync-printed-password', { user_ids: Array.from({ length: 101 }, (_, i) => `u${i}`) }));
  assert.equal(tooMany.status, 400);
});

test('ID guide pages alternate student and parent sheets and keep duplex pairs aligned', async () => {
  const { buildGuidePages, toGuideAccount } = harness().load('app/components/account-guides/guide-model.ts');
  const accounts = [
    toGuideAccount({ id: 'a', role: 'student', student_name: 'A', lifetime_id: '1', initial_password: 'pw1', parent_login_id: '1P', parent_initial_password: 'pp1' }),
    toGuideAccount({ id: 'b', role: 'student', student_name: 'B', lifetime_id: '2', initial_password: 'pw2', parent_status: 'activated' }),
    toGuideAccount({ id: 'c', role: 'student', student_name: 'C', lifetime_id: '3', initial_password: 'pw3', parent_login_id: '3P', parent_initial_password: 'pp3' }),
  ];
  const types = options => Array.from(buildGuidePages(accounts, { order: 'alternate', duplex: false, checklist: false, ...options }), page => `${page.type}:${page.account?.key || page.page}`);
  assert.deepEqual(types({}), ['student:a', 'parent:a', 'student:b', 'student:c', 'parent:c']);
  assert.deepEqual(types({ duplex: true }), ['student:a', 'parent:a', 'student:b', 'parent-placeholder:b', 'student:c', 'parent:c']);
  assert.deepEqual(types({ order: 'grouped' }), ['student:a', 'student:b', 'student:c', 'parent:a', 'parent:c']);
  assert.deepEqual(types({ order: 'parent-only' }), ['parent:a', 'parent:c']);
  assert.deepEqual(types({ checklist: true, duplex: true }).slice(0, 3), ['checklist:1', 'checklist:2', 'student:a']);
});
test('ID guide roster merge fills names from a local spreadsheet by student ID only', () => {
  const { toGuideAccount, parseRosterTable, matchRosterNames, applyRosterNames } = harness().load('app/components/account-guides/guide-model.ts');
  const accounts = [
    toGuideAccount({ id: 'a', role: 'student', student_name: 'テスト1', lifetime_id: '22220001' }),
    toGuideAccount({ id: 'b', role: 'student', student_name: 'テスト2', lifetime_id: '22220002' }),
    toGuideAccount({ id: 'p', role: 'parent', parent_name: '保護者', lifetime_id: '22220003P' }),
    toGuideAccount({ id: 't', role: 'teacher', name: '講師', lifetime_id: 'T1' }),
  ];
  // スプレッドシートから貼り付けたタブ区切り（全角ID・余分な行・引用符を含む）。
  const pasted = '学年\t生徒ID\t氏名\n中1\t２２２２０００１\t山田 太郎\n中2\t99999999\t他校 花子\n中1\t22220003\t"佐藤　次郎"\n';
  const result = matchRosterNames(parseRosterTable(pasted), accounts);
  assert.equal(result.matched, 2);
  assert.deepEqual(Array.from(result.missing), ['22220002']);
  assert.equal(result.extraRows, 1);
  const merged = applyRosterNames(accounts, result.names);
  assert.equal(merged[0].name, '山田 太郎');
  assert.equal(merged[1].name, 'テスト2');
  assert.equal(merged[2].childName, '佐藤 次郎');
  assert.equal(merged[3].name, '講師');

  // 見出しがなくても、ID が一致した行の文字列を氏名として使う。CSV の姓・名列にも対応する。
  assert.equal(matchRosterNames(parseRosterTable('22220002,鈴木 三郎\n'), accounts).names.get('22220002'), '鈴木 三郎');
  assert.equal(matchRosterNames(parseRosterTable('ID,姓,名\n22220001,田中,一郎\n'), accounts).names.get('22220001'), '田中 一郎');
});
test('student CSV is split into chunks that keep the header and sibling groups together', () => {
  const { chunkStudentCsv } = harness().load('lib/csv-chunks.ts');
  const lines = ['生涯番号,氏名,学年,兄弟姉妹グループ'];
  for (let n = 1; n <= 45; n++) lines.push(`${10000000 + n},${10000000 + n},中1,${n === 3 || n === 22 ? 'G1' : ''}`);
  const { chunks, total } = chunkStudentCsv(`﻿${lines.join('\r\n')}\r\n,,,\r\n`, 20);
  assert.equal(total, 45);
  assert.ok(chunks.every(chunk => chunk.text.startsWith('生涯番号,氏名') && chunk.rowCount <= 20));
  const withSiblings = chunks.filter(chunk => chunk.text.includes('G1'));
  assert.equal(withSiblings.length, 1);
  assert.equal((withSiblings[0].text.match(/G1/g) || []).length, 2);
  assert.equal(chunks.reduce((sum, chunk) => sum + chunk.text.split('\n').length - 1, 0), 45);
});
test('CSV import appends chunks to one batch and keeps passwords of students who already logged in', async () => {
  const active = { ...student, lifetime_id: '20011962', email: '20011962@classbase.local', isFirstLogin: false };
  const h = harness({ profiles: { actor: admin, active }, authUsers: { active: { email: '20011962@classbase.local' } }, overrides: { '@/lib/events': { writeLearningEvent: async () => 'fixture-event' } } });
  const route = h.load('app/api/admin/school-students/import/route.ts');
  const response = await route.POST(request('/api/admin/school-students/import', {
    school_id: '112', csv_text: '生涯番号,氏名,学年\n20011962,20011962,中1\n12138090,12138090,中1', import_key: 'abc', row_offset: 0,
  }));
  assert.equal(response.status, 200);
  const body = await response.json();
  assert.equal(body.count, 2);
  assert.equal(body.import_batch_id, 'actor_abc');
  assert.deepEqual(Array.from(body.preserved, item => item.login_id), ['20011962']);
  assert.equal(h.authWrites.some(write => write.uid === 'active' && 'password' in write), false);
  assert.equal(h.data.get('users/active').isFirstLogin, false);
  assert.equal(Array.from(body.students, item => item.lifetime_id).join(','), '20011962,12138090');
  assert.deepEqual(h.data.get('account_import_batches/actor_abc').success_count, { increment: 2 });

  const tooMany = ['生涯番号,氏名'];
  for (let n = 0; n < 41; n++) tooMany.push(`${30000000 + n},x`);
  const rejected = await route.POST(request('/api/admin/school-students/import', { school_id: '112', csv_text: tooMany.join('\n') }));
  assert.equal(rejected.status, 400);
});
test('Zoom recordings matching a teacher shift are auto-published only when no detectable problem exists', async () => {
  const shift = { target_date: '2026-10-14', target_meeting_id: '12345678901', period: '1限', teacher_name: '講師A', target_grade: '中2', target_subject: '理科', unit: '電流' };
  const recordingOf = ({ start = '2026-10-14T10:20:00Z', end = '2026-10-14T11:25:00Z', type = 'shared_screen_with_speaker_view', extraFiles = [] } = {}) => ({
    id: 12345678901, uuid: 'u1', start_time: start, share_url: 'https://us02web.zoom.us/rec/share/abc',
    recording_files: [{ id: 'f1', recording_type: type, file_type: 'MP4', status: 'completed', recording_start: start, recording_end: end, play_url: 'https://us02web.zoom.us/rec/play/abc' }, ...extraFiles],
  });
  const run = async (documents, recording) => {
    const h = harness({ documents });
    const result = await h.load('lib/zoom-recording-match.ts').attachRecordingToBestShift(recording, 'zoom_webhook');
    return { h, result };
  };

  // 正常：講師配置の会議ID・日付・時限と一致する共有画面付きスピーカービューは自動で公開される。
  const ok = await run({ 'shift_assignments/s1': { ...shift } }, recordingOf());
  assert.equal(ok.h.data.get('class_recordings/auto_s1').status, 'published');
  assert.equal(ok.h.data.get('class_recordings/auto_s1').source, 'zoom_auto');
  assert.equal(ok.h.data.get('class_recordings/auto_s1').target_recording_type, 'shared_screen_with_speaker_view');
  assert.equal(ok.h.data.get('shift_assignments/s1').recording_status, 'published');

  // 録画が短い（途中で切れた）・分割・スピーカービューなしは公開せず保留にする。
  const short = await run({ 'shift_assignments/s1': { ...shift } }, recordingOf({ end: '2026-10-14T10:40:00Z' }));
  assert.equal(short.h.data.has('class_recordings/auto_s1'), false);
  assert.equal(short.h.data.get('shift_assignments/s1').recording_status, 'blocked');
  assert.ok(Array.from(short.h.data.get('shift_assignments/s1').recording_issues, issue => issue.code).includes('too-short'));

  // 授業の途中で録画が止まり、2つの区間に分かれた場合は、どちらの区間も公開しない。
  const split = await run({ 'shift_assignments/s1': { ...shift } }, recordingOf({ end: '2026-10-14T10:50:00Z', extraFiles: [{ id: 'f2', recording_type: 'shared_screen_with_speaker_view', file_type: 'MP4', status: 'completed', recording_start: '2026-10-14T10:52:00Z', recording_end: '2026-10-14T11:25:00Z' }] }));
  assert.equal(split.h.data.has('class_recordings/auto_s1'), false);
  assert.equal(split.h.data.get('shift_assignments/s1').recording_status, 'blocked');
  // 同じ区間に共有画面付きスピーカービューが2本ある場合は分割として保留。
  const rules = harness().load('lib/recording-publish-rules.ts');
  const duplicated = recordingOf({ extraFiles: [{ id: 'f2', recording_type: 'shared_screen_with_speaker_view', file_type: 'MP4', status: 'completed', recording_start: '2026-10-14T11:00:00Z', recording_end: '2026-10-14T11:25:00Z' }] });
  assert.ok(Array.from(rules.inspectRecordingForShift(duplicated, { period: '1限' }), issue => issue.code).includes('split-recording'));

  // 共有画面が別ファイルに分かれていて、共有画面付きスピーカービューがない場合は保留。
  const galleryOnly = await run({ 'shift_assignments/s1': { ...shift } }, recordingOf({ type: 'active_speaker', extraFiles: [{ id: 'f3', recording_type: 'shared_screen', file_type: 'MP4', status: 'completed', recording_start: '2026-10-14T10:20:00Z', recording_end: '2026-10-14T11:25:00Z' }] }));
  assert.equal(galleryOnly.h.data.has('class_recordings/auto_s1'), false);
  assert.ok(Array.from(galleryOnly.h.data.get('shift_assignments/s1').recording_issues, issue => issue.code).includes('no-speaker-view'));
  // 共有画面を別に録画していない（アクティブスピーカーだけ）の授業は、アクティブスピーカーで公開する。
  const activeOnly = await run({ 'shift_assignments/s1': { ...shift } }, recordingOf({ type: 'active_speaker' }));
  assert.equal(activeOnly.h.data.get('class_recordings/auto_s1').target_recording_type, 'active_speaker');
  assert.equal(activeOnly.h.data.get('shift_assignments/s1').recording_status, 'published');

  // 授業時間と重ならない録画（別の時限）は公開しない。
  const offTime = await run({ 'shift_assignments/s1': { ...shift } }, recordingOf({ start: '2026-10-14T12:30:00Z', end: '2026-10-14T13:30:00Z' }));
  assert.equal(offTime.h.data.has('class_recordings/auto_s1'), false);

  // 管理者が停止した講師配置、手動で公開・差し替えた録画は自動で上書きしない。
  const stopped = await run({ 'shift_assignments/s1': { ...shift, recording_publish_mode: 'stopped' } }, recordingOf());
  assert.equal(stopped.h.data.has('class_recordings/auto_s1'), false);
  const manual = await run({ 'shift_assignments/s1': { ...shift }, 'class_recordings/m1': { original_shift_id: 's1', source: 'recording_replacement', is_replacement: true, video_url: 'https://us02web.zoom.us/rec/share/other' } }, recordingOf());
  assert.equal(manual.h.data.has('class_recordings/auto_s1'), false);
  assert.equal(manual.h.data.get('class_recordings/m1').video_url, 'https://us02web.zoom.us/rec/share/other');
});
test('group meetings (集会) recorded before or after the class are excluded when setting the class recording', async () => {
  const shift = { target_date: '2026-10-14', target_meeting_id: '12345678901', teacher_name: '講師A', target_grade: '中2', target_subject: '理科', unit: '電流' };
  const file = (id, start, end) => ({ id, recording_type: 'shared_screen_with_speaker_view', file_type: 'MP4', status: 'completed', recording_start: `2026-10-14T${start}:00Z`, recording_end: `2026-10-14T${end}:00Z`, play_url: `https://us02web.zoom.us/rec/play/${id}` });
  const recordingOf = files => ({ id: 12345678901, uuid: 'u1', start_time: files[0].recording_start, share_url: 'https://us02web.zoom.us/rec/share/abc', recording_files: files });
  const run = async (documents, recording) => {
    const h = harness({ documents });
    await h.load('lib/zoom-recording-match.ts').attachRecordingToBestShift(recording, 'zoom_webhook');
    return h;
  };

  // 授業の前の集会（19:22〜19:32）が別の録画：授業（19:32〜20:31）を切り取らずに公開し、集会は候補として残す。
  const before = await run({ 'shift_assignments/s1': { ...shift, period: '1限' } }, recordingOf([file('meeting', '10:22', '10:32'), file('lesson', '10:32', '11:31')]));
  assert.equal(before.data.get('class_recordings/auto_s1').zoom_recording_file_id, 'lesson');
  assert.equal(before.data.get('class_recordings/auto_s1').trim_end_seconds, null);
  assert.equal(before.data.get('shift_assignments/s1').recording_group_meeting, 'before');
  assert.equal(before.data.get('shift_assignments/s1').recording_status, 'published');
  assert.ok(Array.from(before.data.get('shift_assignments/s1').zoom_recording_candidates).some(candidate => candidate.file_id === 'meeting' && candidate.kind === 'group_meeting' && candidate.meeting_position === 'before'));
  // 集会の録画は管理画面から「グループミーティング」として公開する（授業の録画の種類とは別）。
  const recordings = harness().load('lib/recordings.ts');
  assert.equal(recordings.normalizeRecordingType('group_meeting'), 'group_meeting');
  assert.equal(recordings.recordingTypeLabel('group_meeting'), 'グループミーティング');
  assert.equal(recordings.normalizeRecordingType('regular'), 'regular');

  // 集会が20分あり授業が遅れて始まっても（19:42開始）、遅れとして保留にしない。
  const late = await run({ 'shift_assignments/s1': { ...shift, period: '1限' } }, recordingOf([file('meeting', '10:20', '10:40'), file('lesson', '10:42', '11:47')]));
  assert.equal(late.data.get('class_recordings/auto_s1').zoom_recording_file_id, 'lesson');
  assert.equal(late.data.get('shift_assignments/s1').recording_status, 'published');

  // 2限のあとの集会（21:49〜22:05）が別の録画：2限の授業だけを公開する。
  const after = await run({ 'shift_assignments/s2': { ...shift, period: '2限' } }, recordingOf([file('lesson2', '11:40', '12:41'), file('meeting2', '12:49', '13:05')]));
  assert.ok(Array.from(after.data.get('shift_assignments/s2').zoom_recording_candidates).some(candidate => candidate.file_id === 'meeting2' && candidate.meeting_position === 'after'));
  assert.equal(after.data.get('class_recordings/auto_s2').zoom_recording_file_id, 'lesson2');
  assert.equal(after.data.get('shift_assignments/s2').recording_group_meeting, 'after');

  // 集会だけの録画は授業の録画にしない。
  const onlyMeeting = await run({ 'shift_assignments/s1': { ...shift, period: '1限' } }, recordingOf([file('meeting', '10:20', '10:38')]));
  assert.equal(onlyMeeting.data.has('class_recordings/auto_s1'), false);

  // 集会と授業が1つの録画（19:20〜20:47）につながっている：前か後かを時刻だけで決められないので保留し、両方の切り取り位置を用意する。
  const joined = await run({ 'shift_assignments/s1': { ...shift, period: '1限' } }, recordingOf([file('joined', '10:20', '11:47')]));
  const joinedShift = joined.data.get('shift_assignments/s1');
  assert.equal(joined.data.has('class_recordings/auto_s1'), false);
  assert.ok(Array.from(joinedShift.recording_issues, issue => issue.code).includes('meeting-suspected'));
  assert.equal(joinedShift.recording_meeting_trim_options.after.start, 0);
  assert.equal(joinedShift.recording_meeting_trim_options.after.end, 65 * 60);
  // 集会が前：録画の終わりから授業時間＋5分を残す（20:47 − 70分 = 19:37 から）。
  assert.equal(joinedShift.recording_meeting_trim_options.before.start, 17 * 60);
  assert.equal(joinedShift.recording_meeting_trim_options.before.end, null);

  // 1限と2限を通した録画は集会の疑いにしない。
  const rules = harness().load('lib/recording-publish-rules.ts');
  assert.equal(rules.meetingExcessMinutes(19 * 60 + 20, 21 * 60 + 42, '1限'), 0);
  assert.equal(rules.meetingExcessMinutes(19 * 60 + 20, 20 * 60 + 32, '1限'), 0);
  // 2限の開始直前（20:41）まで続いた1限の録画は、集会の疑いにしない。
  assert.equal(rules.meetingExcessMinutes(19 * 60 + 20, 20 * 60 + 41, '1限'), 0);
  // 1分ほどの切れ端は集会として扱わない。
  const { groupMeetingSegments } = harness().load('lib/zoom-recording-match.ts');
  assert.equal(groupMeetingSegments([recordingOf([file('lesson', '10:20', '11:29')]), recordingOf([file('tiny', '11:29', '11:30')])]).size, 0);
});
test('students cannot open recordings an administrator stopped', () => {
  const h = harness();
  const { canAccessClassRecording } = h.load('lib/server/recording-access.ts');
  const studentUser = { uid: 's', role: 'student', school: '112', school_ids: [], profile: { ...student, grade: '中2' } };
  assert.equal(canAccessClassRecording(studentUser, { target_date: '2026-04-10', grade: '中2', subject: '理科', status: 'published' }), true);
  assert.equal(canAccessClassRecording(studentUser, { target_date: '2026-04-10', grade: '中2', subject: '理科', status: 'stopped' }), false);
});

test('one Zoom meeting holding both 1限 and 2限 files publishes each period with its own speaker-view file', async () => {
  const base = { target_date: '2026-10-12', target_meeting_id: '8284141630', teacher_name: '講師A', target_grade: '中1', target_subject: '社会' };
  const files = [
    { id: 'p1-ssv', recording_type: 'shared_screen_with_speaker_view', file_type: 'MP4', status: 'completed', recording_start: '2026-10-12T10:21:15Z', recording_end: '2026-10-12T11:29:11Z' },
    { id: 'p1-as', recording_type: 'active_speaker', file_type: 'MP4', status: 'completed', recording_start: '2026-10-12T10:21:15Z', recording_end: '2026-10-12T11:29:11Z' },
    { id: 'p2-ssv', recording_type: 'shared_screen_with_speaker_view', file_type: 'MP4', status: 'completed', recording_start: '2026-10-12T11:41:18Z', recording_end: '2026-10-12T12:38:41Z' },
  ];
  const recording = { id: 8284141630, uuid: 'm1', start_time: '2026-10-12T09:57:38Z', share_url: 'https://zoom.us/rec/share/x', recording_files: files };
  const h = harness({ documents: {
    'shift_assignments/s1': { ...base, period: '1限' },
    'shift_assignments/s2': { ...base, period: '2限', target_grade: '中2' },
  } });
  await h.load('lib/zoom-recording-match.ts').attachRecordingToBestShift(recording, 'zoom_webhook');
  assert.equal(h.data.get('class_recordings/auto_s1')?.zoom_recording_file_id, 'p1-ssv');
  assert.equal(h.data.get('class_recordings/auto_s2')?.zoom_recording_file_id, 'p2-ssv');
  assert.equal(h.data.get('shift_assignments/s1').recording_status, 'published');
  assert.equal(h.data.get('shift_assignments/s2').recording_status, 'published');

  // 2限で共有画面が別ファイルになっていて、共有画面付きスピーカービューがなければ、2限だけ保留にする。
  const rules = h.load('lib/recording-publish-rules.ts');
  const onlyActive = { ...recording, recording_files: [files[0], { ...files[2], id: 'p2-as', recording_type: 'active_speaker' }, { ...files[2], id: 'p2-screen', recording_type: 'shared_screen' }] };
  assert.equal(Array.from(rules.inspectRecordingForShift(onlyActive, { period: '1限' })).length, 0);
  assert.deepEqual(Array.from(rules.inspectRecordingForShift(onlyActive, { period: '2限' }), issue => issue.code), ['no-speaker-view']);
});

test('the annual recording list keeps replacement and HR-split URLs and records the Zoom account for API lookup', () => {
  const h = harness();
  const { parseRecordingCsv } = h.load('app/master/recordings/recording-csv.ts');
  const csv = [
    '2026年度オンライン理社録画,,,,,,,,,,,,,,,',
    '学年,授業日,,録画パス,ID,archive化,クラス,単元名,予定,UP,講師,サポート,備考,動画実施,備考,URL,,,',
    '中２,4/27,4,af652630@,sozo_kyoumu_3F3@sozogakuen.co.jp,FALSE,[対策]歴史,安土桃山時代,TRUE,TRUE,講師,,不適,,,https://zoom.us/rec/share/A?startTime=1777290075000,　,20250211,https://zoom.us/rec/share/OLD?startTime=1770809741000',
    '中３,6/22,6,rs857056@,"sozo_kyoumu_03@sozogakuen.co.jp""",FALSE,生物,遺伝,TRUE,TRUE,講師,,,,,HR,https://zoom.us/rec/share/B?startTime=1782123621000,１時間目,https://zoom.us/rec/share/B?startTime=1782124352000',
    '中１,7/20,7,ys449871@,sozo_kyoumu_3F3@sozogakuen.co.jp,,歴史A,弥生・古墳時代,TRUE,TRUE,講師,,,,,https://zoom.us/rec/share/C?startTime=1784543775000,←１時間目,https://zoom.us/rec/share/C?startTime=1784542809000,←HR',
    '中１,7/21,7,ys449871@,sozo_kyoumu_3F2@sozogakuen.co.jp,,地理A,日本の位置と領域,TRUE,FALSE,講師,,,,,https://zoom.us/rec/share/D?startTime=1784629297000',
    '中２,7/21,7,ys449871@,sozo_kyoumu_3F2@sozogakuen.co.jp,,地理C,日本の地形,TRUE,TRUE,講師,,,,,https://zoom.us/rec/share/D?startTime=1784634100000',
  ].join('\n');
  const result = parseRecordingCsv(csv);
  assert.equal(result.isAnnualRecordingList, true);
  assert.equal(result.excludedRows, 1);
  const items = Array.from(result.items);
  assert.equal(items.length, 6);

  const replaced = items.find(item => item.unit === '安土桃山時代');
  assert.match(replaced.video_url, /OLD/);
  assert.equal(replaced.target_date, '2026-04-27');
  assert.equal(replaced.is_replacement, true);
  assert.equal(replaced.period, '2限');
  assert.equal(replaced.recording_type, 'test_prep');
  assert.equal(replaced.recording_host_email, 'sozo_kyoumu_3f3@sozogakuen.co.jp');

  const hr = items.filter(item => item.unit === '遺伝');
  assert.deepEqual(hr.map(item => item.recording_part), ['HR', '授業']);
  assert.equal(hr[0].recording_host_email, 'sozo_kyoumu_03@sozogakuen.co.jp');
  assert.equal(hr[0].period, '1限');

  const arrows = items.filter(item => item.unit === '弥生・古墳時代');
  assert.deepEqual(arrows.map(item => [item.recording_part, item.recording_start_ms]), [['HR', 1784542809000], ['授業', 1784543775000]]);

  const second = items.find(item => item.unit === '日本の地形');
  assert.equal(second.period, '2限');
  assert.equal(second.school_year, 2026);
});

test('CSV recordings are matched to Zoom files by account and start time so students play them without a passcode', async () => {
  const meeting = {
    id: 2407608937, uuid: 'mtg-uuid', host_email: 'sozo_kyoumu_3F3@sozogakuen.co.jp', share_url: 'https://zoom.us/rec/share/DIFFERENT',
    recording_files: [
      { id: 'hr', recording_type: 'shared_screen_with_speaker_view', file_type: 'MP4', status: 'completed', recording_start: '2026-07-20T10:20:09Z', recording_end: '2026-07-20T10:35:00Z', download_url: 'https://zoom.us/rec/download/hr' },
      { id: 'lesson-as', recording_type: 'active_speaker', file_type: 'MP4', status: 'completed', recording_start: '2026-07-20T10:36:15Z', recording_end: '2026-07-20T11:30:00Z', download_url: 'https://zoom.us/rec/download/as' },
      { id: 'lesson', recording_type: 'shared_screen_with_speaker_view', file_type: 'MP4', status: 'completed', recording_start: '2026-07-20T10:36:15Z', recording_end: '2026-07-20T11:30:00Z', download_url: 'https://zoom.us/rec/download/lesson' },
    ],
  };
  const other = { id: 999, uuid: 'other', host_email: 'someone@sozogakuen.co.jp', recording_files: [{ ...meeting.recording_files[2], id: 'other-file' }] };
  const requests = [];
  const h = harness({
    env: { ZOOM_ACCOUNT_ID: 'fixture', ZOOM_CLIENT_ID: 'fixture', ZOOM_CLIENT_SECRET: 'fixture' },
    documents: {
      'class_recordings/csv_lesson': { target_date: '2026-07-20', video_url: 'https://zoom.us/rec/share/C?startTime=1784543775000', recording_host_email: 'sozo_kyoumu_3f3@sozogakuen.co.jp', recording_start_ms: 1784543775000, period: '1限', recording_part: '授業', status: 'published' },
      'class_recordings/csv_missing': { target_date: '2026-07-21', video_url: 'https://zoom.us/rec/share/X?startTime=1784629297000', recording_start_ms: 1784629297000, period: '1限', status: 'published' },
      'class_recordings/auto_shift1': { source: 'zoom_auto', status: 'published', original_shift_id: 'shift1' },
      'shift_assignments/shift1': { target_date: '2026-07-20', target_meeting_id: '240 760 8937', period: '1限', published_recording_id: 'auto_shift1' },
    },
    fetch: async url => {
      requests.push(String(url));
      if (String(url).startsWith('https://zoom.us/oauth/token')) return Response.json({ access_token: 'token', expires_in: 3600 });
      return Response.json({ meetings: String(url).includes('from=2026-07-19') ? [other, meeting] : [] });
    },
  });
  const summary = await h.load('lib/server/zoom-recording-resolve.ts').resolveCsvRecordingsWithZoom(['csv_lesson', 'csv_missing']);
  assert.equal(summary.resolved, 1);
  assert.equal(summary.linked_shifts, 1);
  assert.deepEqual(Array.from(summary.unresolved, item => item.id), ['csv_missing']);

  const lesson = h.data.get('class_recordings/csv_lesson');
  assert.equal(lesson.recording_meeting_id, '2407608937');
  assert.equal(lesson.zoom_recording_file_id, 'lesson');
  assert.equal(lesson.original_shift_id, 'shift1');
  assert.equal(h.data.get('shift_assignments/shift1').published_recording_id, 'csv_lesson');
  // 自動アップ済みの録画は重複しないよう生徒画面から外す。
  assert.equal(h.data.get('class_recordings/auto_shift1').status, 'archived');
  assert.match(h.data.get('class_recordings/csv_missing').zoom_resolve_error, /見つかりません/);
  assert.ok(requests.some(url => url.includes('/v2/accounts/me/recordings')));

  // 照合済みの録画は生徒画面でアプリ内再生（Zoomの公式プレイヤー＝パスコード画面に出さない）。
  const studentRoute = fs.readFileSync(path.join(process.cwd(), 'app/api/student/recordings/route.ts'), 'utf8');
  assert.match(studentRoute, /zoom_share: !hasResolvedZoomFile\(data\)/);
});

test('a recording already matched to a Zoom file plays in the app player without asking for a passcode', async () => {
  const requests = [];
  const h = harness({
    profiles: { actor: { ...student, grade: '中3', subjects: ['理科'] } },
    documents: {
      'class_recordings/matched': {
        grade: '中3', subject: '理科', target_date: '2026-10-01', status: 'published',
        video_url: 'https://zoom.us/rec/share/sheet-link?startTime=1790848800000',
        recording_meeting_id: '4521013411', zoom_recording_file_id: 'lesson',
        zoom_recording_files: [
          { id: 'other', recording_type: 'active_speaker', file_type: 'MP4', download_url: 'https://zoom.us/rec/download/other' },
          { id: 'lesson', recording_type: 'shared_screen_with_speaker_view', file_type: 'MP4', download_url: 'https://zoom.us/rec/download/lesson' },
        ],
      },
    },
    env: { ZOOM_ACCOUNT_ID: 'fixture', ZOOM_CLIENT_ID: 'fixture', ZOOM_CLIENT_SECRET: 'fixture' },
    fetch: async (url, options) => {
      requests.push(String(url));
      if (String(url).startsWith('https://zoom.us/oauth/token')) return Response.json({ access_token: 'fixture-zoom-token', expires_in: 3600 });
      if (String(url) === 'https://zoom.us/rec/download/lesson') {
        assert.equal(options.headers.Authorization, 'Bearer fixture-zoom-token');
        return new Response(null, { status: 302, headers: { location: 'https://jp01ssrweb.zoom.us/cmr/replay/signed.mp4' } });
      }
      throw new Error(`unexpected fetch ${url}`);
    },
  });
  const route = h.load('app/api/zoom/recordings/file/route.ts');
  const response = await route.GET(request('/api/zoom/recordings/file?recording_id=matched', null, 'valid', 'GET'));
  assert.equal(response.status, 307);
  assert.equal(response.headers.get('location'), 'https://jp01ssrweb.zoom.us/cmr/replay/signed.mp4');
  // 録画一覧APIは呼ばず、登録済みのファイルだけを取りに行く。
  assert.ok(!requests.some(url => url.includes('/recordings?')));

  // 会議UUIDがあれば、その録画専用の再生用トークン付きURLへブラウザを直接案内する（サーバーで動画を取りに行かない）。
  const record = h.data.get('class_recordings/matched');
  h.data.set('class_recordings/matched', { ...record, zoom_recording_files: record.zoom_recording_files.map(file => ({ ...file, meeting_id: 'abc/=uuid' })) });
  const tokenHarness = harness({
    profiles: { actor: { ...student, grade: '中3', subjects: ['理科'] } },
    documents: { 'class_recordings/matched': h.data.get('class_recordings/matched') },
    env: { ZOOM_ACCOUNT_ID: 'fixture', ZOOM_CLIENT_ID: 'fixture', ZOOM_CLIENT_SECRET: 'fixture' },
    fetch: async url => {
      if (String(url).startsWith('https://zoom.us/oauth/token')) return Response.json({ access_token: 'fixture-zoom-token', expires_in: 3600 });
      if (String(url).startsWith(`https://api.zoom.us/v2/meetings/${encodeURIComponent(encodeURIComponent('abc/=uuid'))}/recordings`)) return Response.json({ download_access_token: 'dl-token' });
      throw new Error(`unexpected fetch ${url}`);
    },
  });
  const direct = await tokenHarness.load('app/api/zoom/recordings/file/route.ts').GET(request('/api/zoom/recordings/file?recording_id=matched', null, 'valid', 'GET'));
  assert.equal(direct.status, 307);
  assert.equal(direct.headers.get('location'), 'https://zoom.us/rec/download/lesson?access_token=dl-token');
});

test('administrators preview one Zoom candidate file (not the whole 1限+2限 meeting) when choosing a replacement', async () => {
  const zoomFetch = async url => {
    if (String(url).startsWith('https://zoom.us/oauth/token')) return Response.json({ access_token: 'fixture-zoom-token', expires_in: 3600 });
    if (String(url).startsWith(`https://api.zoom.us/v2/meetings/${encodeURIComponent(encodeURIComponent('uuid/1'))}/recordings`)) {
      return Response.json({ download_access_token: 'dl', recording_files: [
        { id: 'first', download_url: 'https://zoom.us/rec/download/first' },
        { id: 'second', download_url: 'https://zoom.us/rec/download/second' },
      ] });
    }
    throw new Error(`unexpected fetch ${url}`);
  };
  const env = { ZOOM_ACCOUNT_ID: 'fixture', ZOOM_CLIENT_ID: 'fixture', ZOOM_CLIENT_SECRET: 'fixture' };
  const shift = { target_date: '2026-10-14', target_meeting_id: '8284141630', zoom_recording_candidates: [{ file_id: 'second', meeting_uuid: 'uuid/1', url: 'https://zoom.us/rec/play/x' }] };

  const adminHarness = harness({ profiles: { actor: master }, documents: { 'shift_assignments/s1': shift }, env, fetch: zoomFetch });
  const preview = await adminHarness.load('app/api/zoom/recordings/file/route.ts')
    .GET(request('/api/zoom/recordings/file?shift_id=s1&candidate_file_id=second', null, 'valid', 'GET'));
  assert.equal(preview.status, 307);
  assert.equal(preview.headers.get('location'), 'https://zoom.us/rec/download/second?access_token=dl');

  // 生徒は講師配置の候補を開けない。
  const studentHarness = harness({ profiles: { actor: { ...student, grade: '中2' } }, documents: { 'shift_assignments/s1': shift }, env, fetch: zoomFetch });
  const denied = await studentHarness.load('app/api/zoom/recordings/file/route.ts')
    .GET(request('/api/zoom/recordings/file?shift_id=s1&candidate_file_id=second', null, 'valid', 'GET'));
  assert.equal(denied.status, 403);

  // 差し替えで公開したZoom録画（会議UUIDとファイルIDだけ持つ）も、そのファイルだけを再生する。
  const replaced = harness({
    profiles: { actor: { ...student, grade: '中2', subjects: ['理科'] } },
    documents: { 'class_recordings/r1': { grade: '中2', subject: '理科', target_date: '2026-10-14', status: 'published', video_url: 'https://zoom.us/rec/play/x', recording_meeting_id: '8284141630', zoom_meeting_uuid: 'uuid/1', zoom_recording_file_id: 'second', zoom_recording_files: [] } },
    env, fetch: zoomFetch,
  });
  const played = await replaced.load('app/api/zoom/recordings/file/route.ts')
    .GET(request('/api/zoom/recordings/file?recording_id=r1', null, 'valid', 'GET'));
  assert.equal(played.status, 307);
  assert.equal(played.headers.get('location'), 'https://zoom.us/rec/download/second?access_token=dl');
});

test('an absence sent by a student reaches every parent, and one sent by a parent reaches the student, both with the reason', async () => {
  const profiles = {
    p1: { role: 'parent', student_ids: ['child'], name: '保護者A' },
    p2: { role: 'parent', student_ids: ['child'], name: '保護者B' },
    child: { ...student, role: 'student', parent_uid: 'p1', parent_ids: ['p1', 'p2'], student_name: '生徒A' },
  };
  const notificationsOf = h => [...h.data.entries()].filter(([key]) => key.startsWith('user_notifications/')).map(([, value]) => value);

  const byStudent = harness({ profiles, identity: { uid: 'child', email: 'child@example.test' } });
  const studentResponse = await byStudent.load('app/api/parent/absence-requests/route.ts')
    .POST(request('/api/parent/absence-requests', { student_id: 'child', type: 'absence', absence_type: 'absent', target_date: '2099-10-05', reason: '発熱のため' }));
  assert.equal(studentResponse.status, 200);
  const toParents = notificationsOf(byStudent);
  assert.deepEqual(toParents.map(item => item.user_id).sort(), ['p1', 'p2']);
  assert.ok(toParents.every(item => item.role === 'parent' && item.message.includes('発熱のため') && item.message.includes('生徒Aさん本人')));

  const byParent = harness({ profiles, identity: { uid: 'p1', email: 'p1@example.test' } });
  const parentResponse = await byParent.load('app/api/parent/absence-requests/route.ts')
    .POST(request('/api/parent/absence-requests', { student_id: 'child', type: 'absence', absence_type: 'late', target_date: '2099-10-06', reason: '通院のため' }));
  assert.equal(parentResponse.status, 200);
  const fromParent = notificationsOf(byParent);
  // 連絡した保護者自身には送らない。生徒ともう一人の保護者に届く。
  assert.deepEqual(fromParent.map(item => item.user_id).sort(), ['child', 'p2']);
  assert.ok(fromParent.every(item => item.message.includes('通院のため') && item.title === '遅刻連絡が届きました'));
});

test('the 校舎 dashboard leaves withdrawn (受講解除) students out of the students to check', async () => {
  const h = harness({
    profiles: {
      actor: master,
      active: { ...student, student_name: '在籍生徒' },
      withdrawn: { ...student, student_name: '解除済み生徒', account_status: 'withdrawn', status: 'withdrawn', enrollment_cancel_month: '2026-09' },
    },
  });
  const response = await h.load('app/api/pf/dashboard/route.ts').GET(
    request('/api/pf/dashboard?period=week&anchor=2026-10-02', null, 'valid', 'GET'),
  );
  assert.equal(response.status, 200);
  const body = await response.json();
  assert.deepEqual(Array.from(body.students, item => item.id), ['active']);
});

test('attendance managers review and delete commuter passes only for teachers of their schools', async () => {
  const documents = {
    'teacher_commuter_passes/own-school': { teacher_id: 't1', from: '西明石', to: '三宮', end_date: '2099-01-01', status: 'active' },
    'teacher_commuter_passes/other-school': { teacher_id: 't2', from: '姫路', to: '加古川', end_date: '2099-01-01', status: 'active' },
  };
  const profiles = {
    actor: { role: 'attendance_admin', school: '112', school_ids: ['112'] },
    t1: { role: 'teacher', name: '講師A', school: '112' },
    t2: { role: 'teacher', name: '講師B', school: '205' },
  };
  const h = harness({ profiles, documents });
  const route = h.load('app/api/teacher/commuter-passes/route.ts');
  const listed = await route.GET(request('/api/teacher/commuter-passes?scope=managed', null, 'valid', 'GET'));
  assert.equal(listed.status, 200);
  const body = await listed.json();
  assert.deepEqual(Array.from(body.passes, pass => pass.id), ['own-school']);
  assert.equal(body.passes[0].teacher_name, '講師A');

  assert.equal((await route.DELETE(request('/api/teacher/commuter-passes?id=other-school', null, 'valid', 'DELETE'))).status, 403);
  assert.equal(h.data.has('teacher_commuter_passes/other-school'), true);
  assert.equal((await route.DELETE(request('/api/teacher/commuter-passes?id=own-school', null, 'valid', 'DELETE'))).status, 200);
  assert.equal(h.data.has('teacher_commuter_passes/own-school'), false);

  // 講師本人は一覧も削除もできない。
  const teacherHarness = harness({ profiles: { ...profiles, actor: { role: 'teacher', school: '112' } }, documents });
  const teacherRoute = teacherHarness.load('app/api/teacher/commuter-passes/route.ts');
  assert.equal((await teacherRoute.GET(request('/api/teacher/commuter-passes?scope=managed', null, 'valid', 'GET'))).status, 403);
  assert.equal((await teacherRoute.DELETE(request('/api/teacher/commuter-passes?id=own-school', null, 'valid', 'DELETE'))).status, 403);
});

test('absence contact closes once the last lesson of the day has ended', async () => {
  const h = harness({});
  const { lessonDayEnded } = h.load('lib/lesson-deadline.ts');
  const at = time => new Date(`2026-10-15T${time}:00+09:00`);
  assert.equal(lessonDayEnded('2026-10-14', '21:40', at('10:00')), true);
  assert.equal(lessonDayEnded('2026-10-15', '21:40', at('21:39')), false);
  assert.equal(lessonDayEnded('2026-10-15', '21:40', at('21:40')), true);
  assert.equal(lessonDayEnded('2026-10-15', '20:25', at('20:30')), true);
  assert.equal(lessonDayEnded('2026-10-16', '20:25', at('23:00')), false);
});

test('parent learning history and AI chat history only show linked children', async () => {
  const documents = {
    'users/linked': { role: 'student', student_name: 'Linked Child', parent_uid: 'actor' },
    'users/foreign': { role: 'student', student_name: 'Foreign Child', parent_uid: 'other-parent' },
    'class_recordings/rec1': { target_date: '2026-10-01', subject: '理科', detail_subject: '生物', unit: '細胞', period: 1 },
    'recording_views/linked_rec1': { user_id: 'linked', recording_id: 'rec1', status: 'completed', watched_seconds: 2700, started_at_ms: 1790000000000 },
    'requests/abs1': { user_id: 'linked', type: 'absence', absence_type: 'absent', target_date: '2026-10-01', reason: '発熱', status: 'completed', source: 'parent_portal' },
    'users/linked/chat_history/q_user': { role: 'user', content: '光合成とは', request_id: 'q', createdAt: new Date('2026-10-02T08:00:00Z') },
    'users/linked/chat_history/q_assistant': { role: 'assistant', content: '植物が光で養分を作るはたらきです', request_id: 'q', createdAt: new Date('2026-10-02T08:00:00Z') },
  };
  const h = harness({ profiles: { actor: { role: 'parent', student_ids: ['linked'] } }, documents });
  const history = h.load('app/api/parent/learning-history/route.ts');
  const own = await history.GET(request('/api/parent/learning-history?student_id=linked', null, 'valid', 'GET'));
  assert.equal(own.status, 200);
  const days = (await own.json()).days;
  const day = days.find(item => item.date === '2026-10-01');
  assert.ok(day, 'recording day should be listed');
  assert.equal(day.absence.kind, 'absent');
  assert.equal(day.absence.by, 'parent');
  assert.equal(day.classes[0].recording.completed, true);
  assert.equal(day.classes[0].live, false);
  assert.equal((await history.GET(request('/api/parent/learning-history?student_id=foreign', null, 'valid', 'GET'))).status, 403);

  const chat = h.load('app/api/parent/chat-history/route.ts');
  const chatResponse = await chat.GET(request('/api/parent/chat-history?student_id=linked', null, 'valid', 'GET'));
  assert.equal(chatResponse.status, 200);
  const chatBody = await chatResponse.json();
  assert.deepEqual(chatBody.messages.map(item => item.request_id), ['q', 'q']);
  assert.equal((await chat.GET(request('/api/parent/chat-history?student_id=foreign', null, 'valid', 'GET'))).status, 403);
});

test('attendance-only administrators get the attendance app and nothing else from the app switcher', async () => {
  const h = harness({ profiles: { actor: { role: 'attendance_admin', email: 'attendance@example.test' } } });
  const response = await h.load('app/api/apps/route.ts').GET(request('/api/apps', null, 'valid', 'GET'));
  assert.equal(response.status, 200);
  const body = await response.json();
  assert.equal(body.apps.attendance, true);
  assert.equal(body.apps.science_social, false);
});

test('AI chat detects a self-harm phrase and notifies linked parents and school admins once per window', async () => {
  const h = harness({ profiles: {
    actor: { ...student, student_name: 'Student One', parent_uid: 'parent1' },
    parent1: { role: 'parent', name: 'Parent One', student_ids: ['actor'] },
    boss: { role: 'master', name: 'Boss' },
    localAdmin: { ...admin, name: 'Local Admin' },
    foreignAdmin: { ...admin, school: '999', school_id: '999', school_ids: ['999'] },
  } });
  const route = h.load('app/api/chat/route.ts');
  const response = await route.POST(request('/api/chat', { messages: [{ role: 'user', content: '最近ずっと死にたいと思ってる' }] }));
  assert.equal(response.status, 200);
  assert.equal(h.calls[0].model, 'gpt-4o-mini');
  const saved = [...h.data.entries()].find(([key, value]) => key.startsWith('users/actor/chat_history/') && value?.role === 'user');
  assert.ok(saved, '返信前に生徒の質問を保存する');
  const alerts = [...h.data.entries()].filter(([key]) => key.startsWith('safety_alerts/'));
  assert.equal(alerts.length, 1);
  assert.equal(alerts[0][1].category, 'self_harm');
  assert.equal(alerts[0][1].severity, 'high');
  assert.equal(alerts[0][1].status, 'open');
  assert.equal(alerts[0][1].student_id, 'actor');
  assert.equal(alerts[0][1].request_id, saved[1].request_id);
  const notifications = [...h.data.values()].filter(value => value?.kind === 'safety_alert');
  const parentNotice = notifications.find(value => value.user_id === 'parent1');
  assert.equal(parentNotice?.link, '/parent/messages');
  assert.doesNotMatch(parentNotice?.message || '', /死にたい/);
  assert.equal(notifications.find(value => value.user_id === 'boss')?.link, '/master/safety-alerts');
  assert.ok(notifications.find(value => value.user_id === 'localAdmin'));
  assert.equal(notifications.some(value => value.user_id === 'foreignAdmin'), false);

  const notificationCount = notifications.length;
  assert.equal((await route.POST(request('/api/chat', { messages: [{ role: 'user', content: 'やっぱり消えたい。死にたい' }] }))).status, 200);
  assert.equal([...h.data.keys()].filter(key => key.startsWith('safety_alerts/')).length, 1);
  assert.deepEqual(h.data.get(alerts[0][0]).occurrence_count, { increment: 1 });
  assert.equal([...h.data.values()].filter(value => value?.kind === 'safety_alert').length, notificationCount);

  const calm = harness({ profiles: { actor: student } });
  assert.equal((await calm.load('app/api/chat/route.ts').POST(request('/api/chat', { messages: [{ role: 'user', content: '光合成について教えて' }] }))).status, 200);
  assert.equal([...calm.data.keys()].some(key => key.startsWith('safety_alerts/')), false);
});

test('AI safety detection falls back to keywords when moderation fails and maps moderation categories', async () => {
  const h = harness();
  const safety = h.load('lib/server/student-safety.ts');
  const failing = await safety.detectSafetyConcerns('学校でいじめられてる', async () => { throw new Error('network'); });
  assert.deepEqual(JSON.parse(JSON.stringify(failing.map(item => [item.category, item.severity]))), [['bullying', 'medium']]);
  const moderated = await safety.detectSafetyConcerns('...', async () => ({ flagged: true, categories: { 'self-harm/intent': true } }));
  assert.deepEqual(JSON.parse(JSON.stringify(moderated.map(item => [item.category, item.severity, item.source]))), [['self_harm', 'high', 'moderation']]);
  assert.deepEqual(JSON.parse(JSON.stringify(safety.detectSafetyKeywords('お父さんに殴られた').map(item => item.category))), ['abuse']);
  assert.deepEqual(JSON.parse(JSON.stringify(safety.detectSafetyKeywords('声をかけられて嬉しかった'))), []);
  assert.deepEqual(JSON.parse(JSON.stringify(safety.detectSafetyKeywords('ネットの人に裸の写真を送ってと言われた').map(item => item.category))), ['sexual']);
});

test('AI chat accepts long histories by using only the recent window', async () => {
  const h = harness({ profiles: { actor: student } });
  const messages = Array.from({ length: 150 }, (_, index) => ({ role: index % 2 ? 'assistant' : 'user', content: `message-${index}-${'x'.repeat(900)}` }));
  messages.push({ role: 'user', content: 'latest-question' });
  const response = await h.load('app/api/chat/route.ts').POST(request('/api/chat', { messages }));
  assert.equal(response.status, 200);
  assert.ok(h.calls[0].messages.length <= 20);
  assert.equal(h.calls[0].messages.at(-1).content, 'latest-question');
});

test('AI chat history keeps the question before the answer when both share a timestamp', async () => {
  const at = { toMillis: () => Date.parse('2026-10-02T08:00:00Z') };
  const h = harness({ profiles: { actor: student }, documents: {
    'users/actor/chat_history/q_user': { role: 'user', content: '質問', request_id: 'q', createdAt: at },
    'users/actor/chat_history/q_assistant': { role: 'assistant', content: '回答', request_id: 'q', createdAt: at },
  } });
  // Firestore は同時刻を ID 降順で返すため、取得順を q_user → q_assistant（降順）に固定する。
  const response = await h.load('app/api/chat/history/route.ts').GET(request('/api/chat/history', null, 'valid', 'GET'));
  assert.equal(response.status, 200);
  assert.deepEqual((await response.json()).messages.map(item => item.role), ['user', 'assistant']);
});

test('parent inquiries notify classroom admins, require consent for FAQ tickets, and reject empty staff replies', async () => {
  const parentProfile = { role: 'parent', name: 'Parent', school_id: '112' };
  const h = harness({ profiles: { actor: parentProfile, boss: { role: 'master', name: 'Boss' }, foreignAdmin: { ...admin, school_id: '999', school_ids: ['999'] } } });
  const route = h.load('app/api/parent/faq/route.ts');
  const unmatched = await route.POST(request('/api/parent/faq', { action: 'answer', question: 'まったく関係のない質問です' }));
  assert.equal((await unmatched.json()).needs_support, true);
  assert.equal([...h.data.keys()].some(key => key.startsWith('parent_inquiries/')), false, 'FAQ未解決でも同意なしに問い合わせを作らない');

  const sent = await route.POST(request('/api/parent/faq', { action: 'send', question: '教室に確認したいです', subject: '確認', from_faq: true }));
  assert.equal(sent.status, 200);
  const inquiryId = (await sent.json()).inquiry_id;
  const staffNotice = [...h.data.values()].find(value => value?.kind === 'parent_inquiry' && value.user_id === 'boss');
  assert.equal(staffNotice?.link, '/master/parent-inquiries');
  assert.equal([...h.data.values()].some(value => value?.kind === 'parent_inquiry' && value.user_id === 'foreignAdmin'), false);
  const differentSubject = await route.POST(request('/api/parent/faq', { action: 'send', question: '教室に確認したいです', subject: '別件' }));
  assert.notEqual((await differentSubject.json()).inquiry_id, inquiryId);

  const staff = harness({ profiles: { actor: { ...master, name: '教室 太郎' } }, documents: { 'parent_inquiries/inquiry': { parent_id: 'parent', status: 'open', subject: '確認', content: '問い合わせ', student_name: 'Child' } } });
  const adminRoute = staff.load('app/api/admin/parent-inquiries/route.ts');
  assert.equal((await adminRoute.PATCH(request('/api/admin/parent-inquiries', { id: 'inquiry', response: '   ' }, 'valid', 'PATCH'))).status, 400);
  assert.equal((await adminRoute.PATCH(request('/api/admin/parent-inquiries', { id: 'inquiry', response: '回答です' }, 'valid', 'PATCH'))).status, 200);
  assert.equal(staff.data.get('parent_inquiries/inquiry').responded_by_name, '教室 太郎');
  assert.equal(staff.data.get('user_notifications/parent_inquiry_answered_inquiry').link, '/parent/contact');
});

test('safety alert administration is school-scoped and records status changes', async () => {
  const documents = {
    'safety_alerts/own': { student_id: 's1', school_id: '112', status: 'open', category: 'bullying', severity: 'medium', created_at: 'now' },
    'safety_alerts/foreign': { student_id: 's2', school_id: '999', status: 'open', category: 'self_harm', severity: 'high', created_at: 'now' },
    'safety_alerts/unknown': { student_id: 's3', school_id: null, status: 'open', category: 'self_harm', severity: 'high', created_at: 'now' },
  };
  const h = harness({ profiles: { actor: admin }, documents });
  const route = h.load('app/api/admin/safety-alerts/route.ts');
  const listed = await route.GET(request('/api/admin/safety-alerts?status=all', null, 'valid', 'GET'));
  assert.deepEqual((await listed.json()).alerts.map(item => item.id), ['own']);
  assert.equal((await route.PATCH(request('/api/admin/safety-alerts', { id: 'foreign', status: 'resolved' }, 'valid', 'PATCH'))).status, 403);
  assert.equal((await route.PATCH(request('/api/admin/safety-alerts', { id: 'own', status: 'in_progress', memo: '面談予定' }, 'valid', 'PATCH'))).status, 200);
  assert.equal(h.data.get('safety_alerts/own').status, 'in_progress');
  assert.equal(h.data.get('safety_alerts/own').memo, '面談予定');
  assert.equal((await route.PATCH(request('/api/admin/safety-alerts', { id: 'own', status: 'bogus' }, 'valid', 'PATCH'))).status, 400);
  const parentHarness = harness({ profiles: { actor: { role: 'parent' } }, documents });
  assert.equal((await parentHarness.load('app/api/admin/safety-alerts/route.ts').GET(request('/api/admin/safety-alerts', null, 'valid', 'GET'))).status, 403);
  const rules = fs.readFileSync(path.resolve(sourceRoot, 'firestore.rules'), 'utf8');
  assert.match(rules, /match \/safety_alerts\/\{alertId\} \{\s*allow read, write: if false;/);
  assert.match(rules, /match \/parent_inquiries\/\{inquiryId\} \{[^}]*allow write: if false;/);
});

test('admin requests page surfaces load/action errors and counts pending with the list predicate', () => {
  const source = fs.readFileSync(path.resolve(sourceRoot, 'app/master/requests/page.tsx'), 'utf8');
  assert.match(source, /setLoadError\(/);
  assert.match(source, /loadError \? \(/);
  assert.match(source, /onClick=\{fetchRequests\}/);
  assert.match(source, /未対応 \(\{requests\.filter\(isPendingRequest\)\.length\}\)/);
  assert.match(source, /activeTab === 'pending'\) return isPendingRequest\(r\)/);
  assert.doesNotMatch(source, /catch \(error\) \{ console\.error\(error\); \}/);
});

test('course allocation loads shifts for the JST school year with an error state', () => {
  const source = fs.readFileSync(path.resolve(sourceRoot, 'app/master/course-allocation/page.tsx'), 'utf8');
  assert.match(source, /jstSchoolYear\(\)/);
  assert.match(source, /where\('target_date', '>=', start\)/);
  assert.match(source, /where\('target_date', '<=', end\)/);
  assert.match(source, /startAfter\(cursor\)/);
  assert.doesNotMatch(source, /orderBy\('target_date', 'desc'\), limit\(1200\)/);
  assert.match(source, /setError\(/);
});

test('admin and recording date defaults use JST date keys', () => {
  const files = [
    'app/components/ActivityLogger.tsx',
    'app/master/attendance/page.tsx',
    'app/master/attendance/diagnostics/page.tsx',
    'app/master/attendance/payroll/page.tsx',
    'app/master/school-students/page.tsx',
    'app/master/substitutions/page.tsx',
    'app/master/registration-tasks/page.tsx',
    'app/master/monthly-schedules/page.tsx',
  ];
  for (const file of files) {
    const source = fs.readFileSync(path.resolve(sourceRoot, file), 'utf8');
    assert.doesNotMatch(source, /new Date\(\)\.toISOString\(\)\.(?:slice\(0, (?:7|10)\)|split\('T'\))/, file);
    assert.match(source, /jstDateKey\(/, file);
  }
});

test('parent dashboard counts the last 60 days and keeps declined requests visible', async () => {
  const dayKey = daysAgo => new Intl.DateTimeFormat('sv-SE', { timeZone: 'Asia/Tokyo' }).format(new Date(Date.now() - daysAgo * 24 * 60 * 60 * 1000));
  const iso = daysAgo => new Date(Date.now() - daysAgo * 24 * 60 * 60 * 1000).toISOString();
  const documents = {
    'users/linked': { role: 'student', student_name: 'Linked Child', parent_uid: 'actor' },
    'submissions/recent-1': { student_id: 'linked', homework_title: '最近1', submitted_at: iso(1) },
    'submissions/recent-2': { student_id: 'linked', homework_title: '最近2', submitted_at: iso(50) },
    'submissions/old': { student_id: 'linked', homework_title: '古い', submitted_at: iso(90) },
    'users/linked/chat_history/u1': { role: 'user', content: '質問1', createdAt: new Date(Date.now() - 86400000) },
    'users/linked/chat_history/a1': { role: 'assistant', content: '回答1', createdAt: new Date(Date.now() - 86400000) },
    'users/linked/chat_history/u-old': { role: 'user', content: '古い質問', createdAt: new Date(Date.now() - 90 * 86400000) },
    'requests/rejected': { user_id: 'linked', type: 'absence', absence_type: 'absent', target_date: dayKey(3), status: 'rejected', reason: '旅行' },
    'requests/duplicate': { user_id: 'linked', type: 'absence', absence_type: 'absent', target_date: dayKey(4), status: 'cancelled', replaced_by: 'kept' },
  };
  for (let i = 1; i <= 25; i += 1) documents[`attendance/linked_${dayKey(i)}`] = { user_id: 'linked', target_date: dayKey(i), type: 'joined', participations: [{ subject: '理科' }] };
  const h = harness({ profiles: { actor: { role: 'parent', student_ids: ['linked'] } }, documents });
  const response = await h.load('app/api/parent/dashboard/route.ts').GET(request('/api/parent/dashboard?student_id=linked', null, 'valid', 'GET'));
  assert.equal(response.status, 200);
  const body = await response.json();
  assert.equal(body.summary.window_days, 60);
  assert.equal(body.summary.homework_count, 2);
  assert.deepEqual(body.details.homework.map(item => item.title), ['最近1', '最近2']);
  assert.equal(body.summary.ai_question_count, 1);
  assert.equal(body.details.lessons.length, 25, 'lesson days must not be capped at 20');
  assert.deepEqual(body.details.absence.map(item => [item.id, item.status]), [['rejected', 'rejected']]);
});

test('parent portal UI keeps request mode, labels and homework view parent-friendly', () => {
  const page = fs.readFileSync(path.resolve(sourceRoot, 'app/parent/page.tsx'), 'utf8');
  assert.match(page, /setRequestMode\(allowedRequestModes\(date\)\[0\]/);
  assert.match(page, /REQUEST_PANEL_TITLE\[requestMode\]/);
  assert.doesNotMatch(page, /item\.status \|\| 'pending'\}`/);
  assert.doesNotMatch(page, /最近2か月の記録から集計/);
  const homework = fs.readFileSync(path.resolve(sourceRoot, 'app/parent/pf/homework/page.tsx'), 'utf8');
  assert.match(homework, /ParentHomeworkView/);
  assert.doesNotMatch(homework, /PfProgressDashboard/);
  const view = fs.readFileSync(path.resolve(sourceRoot, 'app/components/parent/ParentHomeworkView.tsx'), 'utf8');
  assert.doesNotMatch(view, /lifetime_id|Progress Follow-up|前回の取込なし|min-w-\[920px\]/);
});

test('Zoom host start lets a non-assigned teacher cover today\'s class and logs the substitute start', async () => {
  const today = new Intl.DateTimeFormat('sv-SE', { timeZone: 'Asia/Tokyo', year: 'numeric', month: '2-digit', day: '2-digit' }).format(new Date());
  const h = harness({ profiles: { actor: teacher }, documents: {
    'shift_assignments/shift': { user_id: 'other', teacher_name: 'Other Teacher', role_type: 'main', target_date: today, target_signin_address: 'host@example.test', target_meeting_id: '12345', start_url: 'https://zoom.us/s/12345?zak=fixture' },
    'shift_assignments/future': { user_id: 'other', teacher_name: 'Other Teacher', role_type: 'main', target_date: '2999-01-01', target_signin_address: 'host@example.test', target_meeting_id: '12345' },
  } });
  const route = h.load('app/api/get-zoom-zak/route.ts');
  assert.equal((await route.POST(request('/api/get-zoom-zak', { email: 'host@example.test', meetingId: '12345', shiftId: 'shift' }))).status, 200);
  const log = h.data.get('zoom_host_start_logs/generated');
  assert.equal(log?.uid, 'actor');
  assert.equal(log?.shift_id, 'shift');
  assert.equal(log?.assigned_teacher, false);
  assert.equal(log?.substitute_start, true);
  // 未来日・存在しない授業・Zoom情報の差し替えは引き続き拒否する
  assert.equal((await route.POST(request('/api/get-zoom-zak', { email: 'host@example.test', meetingId: '12345', shiftId: 'future' }))).status, 403);
  assert.equal((await route.POST(request('/api/get-zoom-zak', { email: 'host@example.test', meetingId: '12345', shiftId: 'missing' }))).status, 403);
  assert.equal((await route.POST(request('/api/get-zoom-zak', { email: 'other@example.test', meetingId: '12345', shiftId: 'shift' }))).status, 403);
  // 生徒・保護者は対象外
  const studentHarness = harness({ profiles: { actor: student }, documents: { 'shift_assignments/shift': { user_id: 'other', target_date: today, target_signin_address: 'host@example.test', target_meeting_id: '12345' } } });
  assert.equal((await studentHarness.load('app/api/get-zoom-zak/route.ts').POST(request('/api/get-zoom-zak', { email: 'host@example.test', meetingId: '12345', shiftId: 'shift' }))).status, 403);
});
test('contact call marks are shared per date and student, scoped to accessible students, and not overwritten', async () => {
  const today = new Intl.DateTimeFormat('sv-SE', { timeZone: 'Asia/Tokyo', year: 'numeric', month: '2-digit', day: '2-digit' }).format(new Date());
  const h = harness({ profiles: {
    actor: teacher,
    local: { ...student, student_name: 'Local Student' },
    foreign: { ...student, school: '999', school_id: '999', student_name: 'Foreign Student' },
  }, documents: {
    [`contact_call_logs/${today}_foreign`]: { student_id: 'foreign', date: today, teacher_id: 'x', teacher_name: 'X', marked_at: '2026-01-01T00:00:00.000Z' },
  } });
  const route = h.load('app/api/teacher/contact-call-marks/route.ts');
  const marked = await route.POST(request('/api/teacher/contact-call-marks', { student_id: 'local', date: today, note: '留守電' }));
  assert.equal(marked.status, 200);
  assert.equal(h.data.get(`contact_call_logs/${today}_local`)?.teacher_id, 'actor');
  const again = await route.POST(request('/api/teacher/contact-call-marks', { student_id: 'local', date: today }));
  assert.equal(again.status, 409);
  assert.equal((await again.json()).mark.teacher_name, teacher.name);
  assert.equal((await route.POST(request('/api/teacher/contact-call-marks', { student_id: 'foreign', date: today }))).status, 403);
  assert.equal((await route.POST(request('/api/teacher/contact-call-marks', { student_id: 'local', date: '2999-01-01' }))).status, 400);
  const listed = await route.GET(request(`/api/teacher/contact-call-marks?date=${today}&student_ids=local,foreign`, null, 'valid', 'GET'));
  assert.equal(listed.status, 200);
  const body = await listed.json();
  assert.deepEqual(body.marks.map(mark => mark.student_id), ['local']);
  const studentHarness = harness({ profiles: { actor: student } });
  assert.equal((await studentHarness.load('app/api/teacher/contact-call-marks/route.ts').GET(request(`/api/teacher/contact-call-marks?date=${today}&student_ids=actor`, null, 'valid', 'GET'))).status, 403);
});

test('absence cancel is limited to linked parents/the student and closes before the lesson day ends', async () => {
  const parent = { role: 'parent', student_ids: ['child'], name: 'Parent One' };
  const child = { ...student, role: 'student', parent_uid: 'actor', student_name: 'Child One' };
  const absence = date => ({ type: 'absence', absence_type: 'absent', user_id: 'child', student_id: 'child', target_date: date, status: 'completed', reason: '体調不良' });
  const make = (actorProfile, documents) => harness({ profiles: { actor: actorProfile, child, sibling: { role: 'parent', student_ids: ['child'], name: 'Other Parent' } }, documents });
  const cancel = (route, id, extra = {}) => route.POST(request('/api/parent/absence-requests', { action: 'cancel', request_id: id, ...extra }));

  // 別の家庭の保護者は取り消せない
  const stranger = make({ role: 'parent', student_ids: ['someone-else'], name: 'Stranger' }, { 'requests/a1': absence('2099-10-05'), 'users/child': { ...child, parent_uid: 'real-parent' } });
  assert.equal((await cancel(stranger.load('app/api/parent/absence-requests/route.ts'), 'a1')).status, 403);
  assert.equal(stranger.data.get('requests/a1').status, 'completed');
  assert.equal(stranger.writes.length, 0);

  // ほかの生徒の連絡は、生徒本人でも取り消せない
  const otherStudent = make({ ...student, role: 'student' }, { 'requests/a1': absence('2099-10-05') });
  assert.equal((await cancel(otherStudent.load('app/api/parent/absence-requests/route.ts'), 'a1')).status, 403);
  assert.equal(otherStudent.writes.length, 0);

  // 授業日が終わった連絡は取り消せない
  const ended = make(parent, { 'requests/old': absence('2020-01-06') });
  const endedResponse = await cancel(ended.load('app/api/parent/absence-requests/route.ts'), 'old');
  assert.equal(endedResponse.status, 400);
  assert.equal((await endedResponse.json()).error, 'lesson-already-ended');
  assert.equal(ended.data.get('requests/old').status, 'completed');

  // つながった保護者は取り消せて、生徒とほかの保護者に知らせる
  const h = make(parent, { 'requests/a1': absence('2099-10-05'), 'users/child': { ...child, parent_ids: ['sibling'] } });
  const ok = await cancel(h.load('app/api/parent/absence-requests/route.ts'), 'a1');
  assert.equal(ok.status, 200);
  assert.equal(h.data.get('requests/a1').status, 'cancelled');
  assert.equal(h.data.get('requests/a1').cancelled_by, 'actor');
  assert.equal(h.data.get('user_notifications/absence_a1')?.user_id, 'child');
  assert.equal(h.data.get('user_notifications/absence_a1')?.kind, 'parent_absence_cancelled');
  assert.equal(h.data.get('user_notifications/absence_a1_parent_sibling')?.user_id, 'sibling');
  assert.equal(h.data.has('user_notifications/absence_a1_parent_actor'), false);
  // 2回目は何も変えずに成功扱い
  const writesBefore = h.writes.length;
  assert.equal((await cancel(h.load('app/api/parent/absence-requests/route.ts'), 'a1')).status, 200);
  assert.equal(h.writes.length, writesBefore);

  // 振替の記録は取り消しの対象にできない
  const transferOnly = make(parent, { 'requests/t1': { type: 'transfer', user_id: 'child', student_id: 'child', target_date: '2099-10-12', status: 'confirmed' } });
  assert.equal((await cancel(transferOnly.load('app/api/parent/absence-requests/route.ts'), 't1')).status, 403);
  assert.equal(transferOnly.data.get('requests/t1').status, 'confirmed');
});

test('absence cancel with a registered transfer asks first, cancels both only when confirmed, and refuses past transfers', async () => {
  const parent = { role: 'parent', student_ids: ['child'], name: 'Parent One' };
  const child = { ...student, role: 'student', parent_uid: 'actor', student_name: 'Child One' };
  const docs = transferDate => ({
    'requests/a1': { type: 'absence', absence_type: 'absent', user_id: 'child', student_id: 'child', target_date: '2099-10-05', status: 'completed', transfer_status: 'registered', transfer_request_id: 'a1_transfer' },
    'requests/a1_transfer': { type: 'transfer', user_id: 'child', student_id: 'child', absence_request_id: 'a1', target_date: transferDate, status: 'confirmed', transfer_status: 'registered', transfer_course_name: '物理' },
  });
  const cancel = (route, extra = {}) => route.POST(request('/api/parent/absence-requests', { action: 'cancel', request_id: 'a1', ...extra }));

  const h = harness({ profiles: { actor: parent, child }, documents: docs('2099-10-12') });
  const route = h.load('app/api/parent/absence-requests/route.ts');
  const asked = await cancel(route);
  assert.equal(asked.status, 409);
  const askedBody = await asked.json();
  assert.equal(askedBody.error, 'transfer-registered');
  assert.match(askedBody.message, /振替/);
  assert.equal(h.data.get('requests/a1').status, 'completed');
  assert.equal(h.data.get('requests/a1_transfer').status, 'confirmed');
  assert.equal(h.writes.length, 0);

  const confirmed = await cancel(route, { cancel_transfer: true });
  assert.equal(confirmed.status, 200);
  assert.equal((await confirmed.json()).transfer_cancelled, true);
  assert.equal(h.data.get('requests/a1').status, 'cancelled');
  assert.equal(h.data.get('requests/a1').transfer_status, 'cancelled');
  assert.equal(h.data.get('requests/a1_transfer').status, 'cancelled');
  assert.match(h.data.get('user_notifications/absence_a1').message, /振替も取り消されました/);

  // 振替先の授業がもう終わっている（振替を受けた後）なら、どちらも取り消さない
  const past = harness({ profiles: { actor: parent, child }, documents: docs('2020-01-06') });
  const refused = await cancel(past.load('app/api/parent/absence-requests/route.ts'), { cancel_transfer: true });
  assert.equal(refused.status, 400);
  assert.equal((await refused.json()).error, 'transfer-lesson-ended');
  assert.equal(past.data.get('requests/a1').status, 'completed');
  assert.equal(past.data.get('requests/a1_transfer').status, 'confirmed');
});

test('student can cancel their own absence and parents are notified', async () => {
  const h = harness({
    profiles: { actor: { ...student, role: 'student', parent_uid: 'mom', student_name: 'Student One' } },
    documents: { 'requests/mine': { type: 'absence', absence_type: 'late', user_id: 'actor', student_id: 'actor', target_date: '2099-10-05', status: 'completed' } },
  });
  const response = await h.load('app/api/parent/absence-requests/route.ts').POST(request('/api/parent/absence-requests', { action: 'cancel', request_id: 'mine' }));
  assert.equal(response.status, 200);
  assert.equal(h.data.get('requests/mine').status, 'cancelled');
  assert.equal(h.data.get('user_notifications/absence_mine_parent_mom')?.kind, 'student_absence_cancelled');
  assert.equal(h.data.has('user_notifications/absence_mine'), false);
});

test('mark-all-read only touches the caller\'s own unread notifications and the bell count is server-side', async () => {
  const h = harness({
    profiles: { actor: { role: 'parent', student_ids: [], name: 'Parent One' } },
    documents: {
      'user_notifications/n1': { user_id: 'actor', read: false, title: 'a' },
      'user_notifications/n2': { user_id: 'actor', read: false, title: 'b' },
      'user_notifications/n3': { user_id: 'actor', read: true, title: 'c' },
      'user_notifications/other': { user_id: 'someone', read: false, title: 'x' },
    },
  });
  const route = h.load('app/api/notifications/route.ts');
  const before = await (await route.GET(request('/api/notifications?limit=1', null, 'valid', 'GET'))).json();
  assert.equal(before.unread_count, 2);
  assert.equal(before.notifications.length, 1);
  const response = await route.PATCH(request('/api/notifications', { all: true }, 'valid', 'PATCH'));
  assert.equal(response.status, 200);
  assert.equal((await response.json()).updated, 2);
  assert.equal(h.data.get('user_notifications/n1').read, true);
  assert.equal(h.data.get('user_notifications/n2').read, true);
  assert.equal(h.data.get('user_notifications/other').read, false);
  assert.ok(!h.writes.includes('user_notifications/other'));
  const after = await (await route.GET(request('/api/notifications?limit=1', null, 'valid', 'GET'))).json();
  assert.equal(after.unread_count, 0);
});

test('parent home summary counts only the parent\'s own unread classroom replies and unread urgent news', async () => {
  const recent = new Date(Date.now() - 24 * 60 * 60 * 1000);
  const ts = date => ({ toDate: () => date });
  const h = harness({
    profiles: { actor: { role: 'parent', student_ids: [], name: 'Parent One' } },
    documents: {
      'parent_inquiries/mine1': { parent_id: 'actor', unread_for_parent: true },
      'parent_inquiries/mine2': { parent_id: 'actor', unread_for_parent: false },
      'parent_inquiries/other': { parent_id: 'someone', unread_for_parent: true },
      'announcements/urgent': { title: '台風のため休講', label: 'alert', target: 'parent', created_at: ts(recent) },
      'announcements/read': { title: '既読の重要連絡', label: 'important', target: 'all', created_at: ts(recent) },
      'announcements/normal': { title: 'イベント', label: 'event', target: 'all', created_at: ts(recent) },
      'announcements/students': { title: '生徒向け', label: 'important', target: 'student', created_at: ts(recent) },
      'announcement_reads/read_actor': { announcement_id: 'read', user_id: 'actor' },
    },
  });
  const response = await h.load('app/api/parent/home-summary/route.ts').GET(request('/api/parent/home-summary', null, 'valid', 'GET'));
  assert.equal(response.status, 200);
  const body = await response.json();
  assert.equal(body.unread_replies, 1);
  assert.deepEqual(body.urgent_news.map(item => item.id), ['urgent']);
  assert.equal(h.writes.length, 0);
  const studentHarness = harness({ profiles: { actor: student } });
  assert.equal((await studentHarness.load('app/api/parent/home-summary/route.ts').GET(request('/api/parent/home-summary', null, 'valid', 'GET'))).status, 403);
});

test('dedicated staff can request clock corrections and missing-clock records only for themselves', async () => {
  const dedicated = { role: 'teacher', school: '112', school_id: '112', employment_category: 'dedicated', name: 'Dedicated One' };
  const documents = {
    'work_records/own': {
      teacher_id: 'actor', teacher_name: 'Dedicated One', school_id: '112', date: '2026-10-01', status: 'pending',
      start_time: '2026-10-01T00:00:00.000Z', end_time: '2026-10-01T09:00:00.000Z',
    },
    'work_records/foreign': {
      teacher_id: 'someone-else', teacher_name: 'Other', school_id: '112', date: '2026-10-01', status: 'pending',
      start_time: '2026-10-01T00:00:00.000Z', end_time: '2026-10-01T09:00:00.000Z',
    },
    'attendance_correction_requests/foreign-request': { teacher_id: 'someone-else', target_date: '2026-10-02', status: 'pending' },
  };
  const overrides = { '@/lib/events': { writeLearningEvent: async () => 'event' } };
  const own = harness({ profiles: { actor: dedicated }, documents, overrides });
  const ownRoute = own.load('app/api/attendance-corrections/route.ts');
  const requested = await ownRoute.POST(request('/api/attendance-corrections', {
    action: 'request', work_record_id: 'own',
    requested_start_time: '2026-10-01T00:05:00.000Z', requested_end_time: '2026-10-01T09:30:00.000Z', reason: '退勤の押し忘れ',
  }));
  assert.equal(requested.status, 200, JSON.stringify(await requested.clone().json()));
  const created = own.data.get('attendance_correction_requests/generated');
  assert.equal(created.teacher_id, 'actor');
  assert.equal(created.request_type, 'time_correction');
  assert.equal(created.status, 'pending');
  // 申請だけでは勤務記録は変わらない
  assert.equal(own.data.get('work_records/own').end_time, '2026-10-01T09:00:00.000Z');

  const foreign = harness({ profiles: { actor: dedicated }, documents, overrides });
  const foreignResponse = await foreign.load('app/api/attendance-corrections/route.ts').POST(request('/api/attendance-corrections', {
    action: 'request', work_record_id: 'foreign',
    requested_start_time: '2026-10-01T00:05:00.000Z', requested_end_time: '2026-10-01T09:30:00.000Z', reason: '他人の記録',
  }));
  assert.equal(foreignResponse.status, 403);
  assert.equal(foreign.data.has('attendance_correction_requests/generated'), false);

  const missing = harness({ profiles: { actor: dedicated }, documents, overrides });
  const missingResponse = await missing.load('app/api/attendance-corrections/route.ts').POST(request('/api/attendance-corrections', {
    action: 'request', target_date: '2026-10-03', school_id: '112',
    requested_start_time: '2026-10-03T00:00:00.000Z', requested_end_time: '2026-10-03T09:00:00.000Z', reason: '打刻忘れ',
  }));
  assert.equal(missingResponse.status, 200, JSON.stringify(await missingResponse.clone().json()));
  assert.equal(missing.data.get('attendance_correction_requests/generated').request_type, 'missing_clock');
  assert.equal(missing.data.get('attendance_correction_requests/generated').teacher_id, 'actor');

  // 自分の申請一覧に他の職員の申請は混ざらない（teacher_id を指定しても無視される）
  const listed = await missing.load('app/api/attendance-corrections/route.ts').GET(
    request('/api/attendance-corrections?month=2026-10&teacher_id=someone-else', null, 'valid', 'GET'),
  );
  assert.equal(listed.status, 200);
  const listedIds = (await listed.json()).requests.map(item => item.id);
  assert.ok(!listedIds.includes('foreign-request'));
  assert.ok(listedIds.includes('generated'));

  // 生徒は申請できない
  const studentHarness = harness({ profiles: { actor: student }, documents, overrides });
  assert.equal((await studentHarness.load('app/api/attendance-corrections/route.ts').POST(request('/api/attendance-corrections', {
    action: 'request', target_date: '2026-10-04', school_id: '112',
    requested_start_time: '2026-10-04T00:00:00.000Z', requested_end_time: '2026-10-04T09:00:00.000Z', reason: 'x',
  }))).status, 403);
});

test('rejected attendance corrections keep the reviewer note for the requesting teacher', async () => {
  const attendanceAdmin = { ...admin, admin_permissions: { science_social: false, attendance: true } };
  const h = harness({
    profiles: { actor: attendanceAdmin, target: teacher },
    documents: {
      'attendance_correction_requests/correction': {
        teacher_id: 'target', school_id: '112', target_date: '2026-10-05', status: 'pending', request_type: 'missing_clock',
        requested_start_time: '2026-10-05T00:00:00.000Z', requested_end_time: '2026-10-05T09:00:00.000Z',
      },
    },
    overrides: { '@/lib/events': { writeLearningEvent: async () => 'event' } },
  });
  const response = await h.load('app/api/attendance-corrections/route.ts').POST(request('/api/attendance-corrections', {
    action: 'review', request_id: 'correction', status: 'rejected', review_note: '出勤時刻をシフトと合わせて再申請してください',
  }));
  assert.equal(response.status, 200);
  assert.equal(h.data.get('attendance_correction_requests/correction').status, 'rejected');
  assert.equal(h.data.get('attendance_correction_requests/correction').review_note, '出勤時刻をシフトと合わせて再申請してください');
});

test('teacher next-class widget and dedicated attendance use scoped, shared flows', () => {
  const widget = fs.readFileSync(path.resolve(sourceRoot, 'app/components/NextClassWidget.tsx'), 'utf8');
  // 自分の配置だけを今日からの日付で絞って読む（全講師の配置を名前の部分一致で探さない）
  assert.match(widget, /where\('user_id', '==', userId\)/);
  assert.match(widget, /where\('target_date', 'in', nextClassDateKeys\(today\)\)/);
  assert.doesNotMatch(widget, /isNameMatch|teacher_name/);
  assert.match(widget, /requestZoomHostStart/);
  assert.match(widget, /ホストで開始/);
  assert.match(widget, /EmptyState/);
  const dashboard = fs.readFileSync(path.resolve(sourceRoot, 'app/components/TeacherDashboard.tsx'), 'utf8');
  assert.match(dashboard, /requestZoomHostStart/);
  const dedicatedPage = fs.readFileSync(path.resolve(sourceRoot, 'app/teacher/attendance/dedicated/page.tsx'), 'utf8');
  assert.match(dedicatedPage, /<TimeCorrectionModal/);
  assert.match(dedicatedPage, /<MissingClockModal/);
  assert.match(dedicatedPage, /<CorrectionRequestList/);
  const partTimePage = fs.readFileSync(path.resolve(sourceRoot, 'app/teacher/attendance/page.tsx'), 'utf8');
  assert.match(partTimePage, /draftSegmentsFromShiftPlans/);
  assert.match(partTimePage, /scope=mine/);
  assert.match(partTimePage, /勤務の詳細を入力する/);
  const shared = fs.readFileSync(path.resolve(sourceRoot, 'app/teacher/attendance/correction-requests.tsx'), 'utf8');
  assert.match(shared, /\/api\/attendance-corrections/);
  const settings = fs.readFileSync(path.resolve(sourceRoot, 'app/teacher/settings/page.tsx'), 'utf8');
  assert.doesNotMatch(settings, /key: 'notification_student'|student_contact: settings/);
  assert.match(settings, /key: 'notification_shift'/);
});

// ---- 管理画面の対応待ち件数・操作ログ ----
// テスト用の Firestore には count() がないため、絞り込み条件を記録しながら件数を返す集計を足す。
function withCountQueries(h) {
  const queries = [];
  const original = h.db.collection;
  const wrap = (query, name, filters) => ({
    ...query,
    where: (field, op, value) => wrap(query.where(field, op, value), name, [...filters, [field, op, value]]),
    count: () => ({ get: async () => { queries.push({ name, filters }); const snap = await query.get(); return { data: () => ({ count: snap.size }) }; } }),
  });
  h.db.collection = name => wrap(original(name), name, []);
  return queries;
}

test('admin inbox counts are scoped: non-master sees only their school and no master-only counts', async () => {
  const today = new Intl.DateTimeFormat('sv-SE', { timeZone: 'Asia/Tokyo', year: 'numeric', month: '2-digit', day: '2-digit' }).format(new Date());
  const documents = {
    'parent_inquiries/a': { status: 'open', school_id: '112' },
    'parent_inquiries/b': { status: 'open', school_id: '161' },
    'parent_inquiries/c': { status: 'answered', school_id: '112' },
    'requests/change': { status: 'pending', type: 'change', user_id: 's1' },
    'requests/absence': { status: 'pending', type: 'absence', user_id: 's1' },
    'requests/exchange_local': { status: 'pending', type: 'exchange', school: '112' },
    'requests/exchange_foreign': { status: 'preparing', type: 'exchange', school: '161' },
    'safety_alerts/open': { status: 'open', school_id: '112' },
    'work_records/local': { detail_approval_status: 'pending', school_id: '112', date: today },
    'work_records/foreign': { detail_approval_status: 'pending', school_id: '161', date: today },
    'attendance_correction_requests/local': { status: 'pending', school_id: '112' },
  };
  const masterHarness = harness({ profiles: { actor: master }, documents });
  withCountQueries(masterHarness);
  const masterResponse = await masterHarness.load('app/api/admin/inbox-counts/route.ts').GET(request('/api/admin/inbox-counts', null, 'valid', 'GET'));
  assert.equal(masterResponse.status, 200);
  const masterCounts = (await masterResponse.json()).counts;
  assert.equal(masterCounts.parentInquiries, 2);
  assert.equal(masterCounts.requests, 2); // 変更申請と景品交換。欠席の連絡は数えない
  assert.equal(masterCounts.safetyAlerts, 1);
  assert.equal(masterCounts.detailApprovals, 3);
  assert.equal(masterCounts.rewards, 2);

  const schoolAdmin = { ...admin, admin_permissions: { science_social: true, attendance: true } };
  const adminHarness = harness({ profiles: { actor: schoolAdmin }, documents });
  const queries = withCountQueries(adminHarness);
  const adminResponse = await adminHarness.load('app/api/admin/inbox-counts/route.ts').GET(request('/api/admin/inbox-counts', null, 'valid', 'GET'));
  assert.equal(adminResponse.status, 200);
  const adminCounts = (await adminResponse.json()).counts;
  assert.deepEqual(Object.keys(adminCounts).sort(), ['detailApprovals', 'rewards']);
  assert.equal(adminCounts.detailApprovals, 2);
  assert.equal(adminCounts.rewards, 1);
  assert.ok(!queries.some(item => ['parent_inquiries', 'safety_alerts', 'teacher_substitution_posts'].includes(item.name)));
  assert.ok(queries.filter(item => item.name !== 'settings').every(item => item.filters.some(([field, op]) => ['school_id', 'school'].includes(field) && op === 'in')));

  const studentHarness = harness({ profiles: { actor: student }, documents });
  withCountQueries(studentHarness);
  assert.equal((await studentHarness.load('app/api/admin/inbox-counts/route.ts').GET(request('/api/admin/inbox-counts', null, 'valid', 'GET'))).status, 403);
  // 対応待ちの一覧はマスターだけ
  assert.equal((await adminHarness.load('app/api/admin/inbox/route.ts').GET(request('/api/admin/inbox', null, 'valid', 'GET'))).status, 403);
});

test('audit log endpoint rejects non-admins and records the server-verified actor', async () => {
  for (const profile of [student, teacher]) {
    const h = harness({ profiles: { actor: profile } });
    const response = await h.load('app/api/admin/audit-log/route.ts').POST(request('/api/admin/audit-log', { action: 'survey_setting_delete', target_type: 'survey_template', target_id: 's1' }));
    assert.equal(response.status, 403);
    assert.ok(!h.writes.some(key => key.startsWith('admin_audit_logs/')));
  }
  const h = harness({ profiles: { actor: { ...master, name: 'Master One' } } });
  const route = h.load('app/api/admin/audit-log/route.ts');
  // サーバーで行う操作の名前や未知の操作は、画面からは記録できない
  assert.equal((await route.POST(request('/api/admin/audit-log', { action: 'account_password_change', target_type: 'user', target_id: 'u1' }))).status, 400);
  assert.equal((await route.POST(request('/api/admin/audit-log', { action: 'registration_task_delete', target_type: 'registration_request' }))).status, 400);
  const saved = await route.POST(request('/api/admin/audit-log', {
    action: 'registration_task_delete', target_type: 'registration_request', target_id: 'task1', target_label: '春の登録',
    actor_id: 'someone-else', actor_name: 'Spoofed', details: { password: 'secret', note: 'ok' },
  }));
  assert.equal(saved.status, 200);
  const log = h.data.get('admin_audit_logs/generated');
  assert.equal(log.action, 'registration_task_delete');
  assert.equal(log.actor_id, 'actor');
  assert.equal(log.actor_name, 'Master One');
  assert.equal(log.target_id, 'task1');
  assert.equal(log.reported_by_client, true);
  assert.equal(log.details.note, 'ok');
  assert.equal(log.details.password, undefined);
  // 一覧はマスターだけ
  const listed = await route.GET(request('/api/admin/audit-log?action=registration_task_delete', null, 'valid', 'GET'));
  assert.equal(listed.status, 200);
  assert.equal((await listed.json()).logs[0].actor_id, 'actor');
  const adminHarness = harness({ profiles: { actor: admin } });
  assert.equal((await adminHarness.load('app/api/admin/audit-log/route.ts').GET(request('/api/admin/audit-log', null, 'valid', 'GET'))).status, 403);
});

test('safety alert status change writes an audit log, and a failed log does not block the change', async () => {
  const documents = { 'safety_alerts/alert1': { status: 'open', student_name: 'Student A', school_id: '112' } };
  const h = harness({ profiles: { actor: { ...master, name: 'Master One' } }, documents });
  const response = await h.load('app/api/admin/safety-alerts/route.ts').PATCH(request('/api/admin/safety-alerts', { id: 'alert1', status: 'in_progress' }, 'valid', 'PATCH'));
  assert.equal(response.status, 200);
  const log = h.data.get('admin_audit_logs/generated');
  assert.equal(log.action, 'safety_alert_status');
  assert.equal(log.actor_id, 'actor');
  assert.equal(log.target_id, 'alert1');
  assert.equal(log.details.status, 'in_progress');
  assert.equal(log.details.previous_status, 'open');

  const failing = harness({ profiles: { actor: master }, documents });
  const original = failing.db.collection;
  failing.db.collection = name => name === 'admin_audit_logs' ? { ...original(name), add: async () => { throw new Error('write failed'); } } : original(name);
  const stillOk = await failing.load('app/api/admin/safety-alerts/route.ts').PATCH(request('/api/admin/safety-alerts', { id: 'alert1', status: 'resolved' }, 'valid', 'PATCH'));
  assert.equal(stillOk.status, 200);
  assert.equal(failing.data.get('safety_alerts/alert1').status, 'resolved');
});

const timetableDateKey = offset => {
  const date = new Date(Date.now() + offset * 86400000);
  return new Intl.DateTimeFormat('sv-SE', { timeZone: 'Asia/Tokyo' }).format(date);
};
const timetableWeekday = offset => new Intl.DateTimeFormat('ja-JP', { timeZone: 'Asia/Tokyo', weekday: 'short' }).format(new Date(Date.now() + offset * 86400000)).replace('曜', '');
const timetableFixture = (profiles) => {
  const tomorrow = timetableDateKey(1);
  const nextWeek = timetableDateKey(8);
  const day = timetableWeekday(1);
  return harness({
    profiles,
    documents: {
      'course_registrations/other-registration': {
        student_id: 'other', registration_type: 'regular', status: 'active', selected_course_keys: [`course_中3_社会_公民3_${day}_2限`],
      },
      'shift_assignments/chemistry': {
        target_date: tomorrow, target_grade: '中3', target_subject: '理科', target_detail_subject: '化学', unit: '化学変化',
        period: 2, role_type: 'main', target_meeting_id: '222222222', start_url: 'https://zoom.us/s/222?zak=secret',
      },
      'shift_assignments/civics': {
        target_date: tomorrow, target_grade: '中3', target_subject: '社会', target_detail_subject: '公民3',
        period: 2, role_type: 'main', target_meeting_id: '111111111',
      },
      'monthly_schedules/closed': { title: '秋休み', category: 'closed', audience: 'all', start_date: nextWeek, end_date: nextWeek },
    },
    overrides: {
      '@/lib/server/student-class-masters': {
        loadStudentClassMasters: async () => ({ optionDocs: [], curriculumDocs: [], testPrepOptionDocs: [], classButtonSettingsData: {} }),
      },
    },
  });
};

test('student timetable returns only the signed-in student\'s registered course and marks holidays as cancelled', async () => {
  const day = timetableWeekday(1);
  const h = timetableFixture({
    actor: { ...student, grade: '中3', selected_course_keys: [`course_中3_理科_化学_${day}_2限`] },
    other: { ...student, grade: '中3' },
  });
  const response = await h.load('app/api/student/timetable/route.ts').GET(request('/api/student/timetable?student_id=other', null, 'valid', 'GET'));
  assert.equal(response.status, 200, JSON.stringify(await response.clone().json()));
  const body = await response.json();
  assert.deepEqual(body.weekly.map(slot => [slot.day, slot.period, slot.courses.map(course => course.label)]), [[day, 2, ['理科（化学）']]]);
  const tomorrow = body.lessons.find(lesson => lesson.date === timetableDateKey(1));
  assert.equal(tomorrow?.status, 'scheduled');
  assert.equal(tomorrow?.label, '理科（化学）');
  assert.equal(tomorrow?.start, '20:35');
  assert.ok(!body.lessons.some(lesson => /公民/.test(lesson.label)), 'another student\'s course must not leak');
  const holiday = body.lessons.find(lesson => lesson.date === timetableDateKey(8));
  assert.equal(holiday?.status, 'cancelled');
  assert.equal(holiday?.note, '秋休み');
  assert.doesNotMatch(JSON.stringify(body), /zak=secret|222222222/);
  assert.equal(h.writes.length, 0);
  // 保護者・講師は生徒用APIを使えない
  for (const role of [{ role: 'parent', student_ids: ['actor'] }, teacher]) {
    const denied = timetableFixture({ actor: role });
    assert.equal((await denied.load('app/api/student/timetable/route.ts').GET(request('/api/student/timetable', null, 'valid', 'GET'))).status, 403);
  }
});

test('parent timetable is limited to linked children', async () => {
  const day = timetableWeekday(1);
  const child = { ...student, grade: '中3', selected_course_keys: [`course_中3_理科_化学_${day}_2限`] };
  const h = timetableFixture({
    actor: { role: 'parent', student_ids: ['child'] },
    child,
    other: { ...student, grade: '中3', selected_course_keys: [`course_中3_社会_公民3_${day}_2限`] },
    teacherUser: teacher,
  });
  const route = h.load('app/api/parent/timetable/route.ts');
  const ok = await route.GET(request('/api/parent/timetable?student_id=child', null, 'valid', 'GET'));
  assert.equal(ok.status, 200, JSON.stringify(await ok.clone().json()));
  const body = await ok.json();
  assert.equal(body.student_id, 'child');
  assert.deepEqual(body.weekly.flatMap(slot => slot.courses.map(course => course.label)), ['理科（化学）']);
  assert.equal((await route.GET(request('/api/parent/timetable?student_id=other', null, 'valid', 'GET'))).status, 403);
  assert.equal((await route.GET(request('/api/parent/timetable?student_id=teacherUser', null, 'valid', 'GET'))).status, 403);
  assert.equal((await route.GET(request('/api/parent/timetable', null, 'valid', 'GET'))).status, 400);
  // parent_uid だけで紐づいた子も見られる
  const byParentUid = timetableFixture({ actor: { role: 'parent', student_ids: [] }, child: { ...child, parent_uid: 'actor' } });
  assert.equal((await byParentUid.load('app/api/parent/timetable/route.ts').GET(request('/api/parent/timetable?student_id=child', null, 'valid', 'GET'))).status, 200);
  // 生徒は保護者用APIで他の生徒を指定できない
  const studentHarness = timetableFixture({ actor: { ...student, grade: '中3' }, other: { ...student, grade: '中3' } });
  assert.equal((await studentHarness.load('app/api/parent/timetable/route.ts').GET(request('/api/parent/timetable?student_id=other', null, 'valid', 'GET'))).status, 403);
});

test('community report dedupes per student and target, notifies admins, hides nothing, and rejects non-students', async () => {
  const h = harness({
    profiles: { actor: { ...student, student_name: 'Reporter' }, author: { ...student }, boss: { role: 'master', name: 'Master' } },
    documents: {
      'community_topics/topic': { title: 'こまった投稿', is_approved: true, creator_uid: 'author', likes: 0 },
      'community_topics/topic/comments/comment': { text: 'いやなコメント', uid: 'author', name: 'Author' },
      'community_topics/pending': { title: '審査中', is_approved: false, creator_uid: 'author' },
    },
  });
  const route = h.load('app/api/student/community/route.ts');
  const first = await route.POST(request('/api/student/community', { action: 'report', target_type: 'topic', topic_id: 'topic', reason: 'bullying' }));
  assert.equal(first.status, 200, JSON.stringify(await first.clone().json()));
  assert.equal((await first.json()).duplicate, false);
  const report = h.data.get('community_reports/actor_topic_topic');
  assert.equal(report?.reporter_uid, 'actor');
  assert.equal(report?.target_type, 'topic');
  assert.equal(report?.target_id, 'topic');
  assert.equal(report?.reason, 'bullying');
  assert.equal(report?.created_at, 'now');
  const notification = h.data.get('user_notifications/community_report_actor_topic_topic_boss');
  assert.equal(notification?.user_id, 'boss');
  assert.equal(notification?.kind, 'community_report');
  assert.equal(notification?.read, false);
  // 自動で非表示にしない
  assert.equal(h.data.get('community_topics/topic').is_approved, true);
  const writesAfterFirst = h.writes.length;
  const again = await route.POST(request('/api/student/community', { action: 'report', target_type: 'topic', topic_id: 'topic', reason: 'spam' }));
  assert.equal(again.status, 200);
  assert.equal((await again.json()).duplicate, true);
  assert.equal(h.writes.length, writesAfterFirst, 'duplicate report must not write or re-notify');
  assert.equal(h.data.get('community_reports/actor_topic_topic').reason, 'bullying');
  // コメントの通報は別の対象として1件
  const comment = await route.POST(request('/api/student/community', { action: 'report', target_type: 'comment', topic_id: 'topic', comment_id: 'comment', reason: 'personal_info' }));
  assert.equal(comment.status, 200);
  assert.equal(h.data.get('community_reports/actor_comment_topic_comment')?.target_id, 'topic/comment');
  // 不正な理由・未承認・存在しない対象は拒否
  assert.equal((await route.POST(request('/api/student/community', { action: 'report', target_type: 'topic', topic_id: 'topic', reason: 'free text' }))).status, 400);
  assert.equal((await route.POST(request('/api/student/community', { action: 'report', target_type: 'topic', topic_id: 'pending', reason: 'bullying' }))).status, 404);
  assert.equal((await route.POST(request('/api/student/community', { action: 'report', target_type: 'comment', topic_id: 'topic', comment_id: 'missing', reason: 'bullying' }))).status, 404);
  // 生徒以外は通報できない（講師の掲示板指定も不可）
  for (const actorProfile of [teacher, { role: 'parent', student_ids: ['author'] }, master]) {
    const denied = harness({ profiles: { actor: actorProfile }, documents: { 'community_topics/topic': { title: 'x', is_approved: true, creator_uid: 'author' } } });
    const response = await denied.load('app/api/student/community/route.ts').POST(request('/api/student/community', { action: 'report', target_type: 'topic', topic_id: 'topic', reason: 'bullying' }));
    assert.equal(response.status, 403);
    assert.equal(denied.writes.length, 0);
  }
  const teacherBoard = harness({ profiles: { actor: teacher }, documents: { 'teacher_community_topics/topic': { title: 'x', is_approved: true } } });
  assert.equal((await teacherBoard.load('app/api/student/community/route.ts').POST(request('/api/student/community', { action: 'report', audience: 'teacher', target_type: 'topic', topic_id: 'topic', reason: 'bullying' }))).status, 400);
  assert.equal(teacherBoard.writes.length, 0);
});

test('student community lists only the student\'s own pending topics', async () => {
  const h = harness({
    profiles: { actor: student },
    documents: {
      'community_topics/mine-pending': { title: '自分の申請', is_approved: false, creator_uid: 'actor', type: 'thread' },
      'community_topics/mine-approved': { title: '公開済み', is_approved: true, creator_uid: 'actor' },
      'community_topics/mine-archived': { title: '削除済み', is_approved: false, archived: true, creator_uid: 'actor' },
      'community_topics/other-pending': { title: '他人の申請', is_approved: false, creator_uid: 'other' },
    },
  });
  const response = await h.load('app/api/student/community/route.ts').GET(request('/api/student/community', null, 'valid', 'GET'));
  assert.equal(response.status, 200);
  assert.deepEqual((await response.json()).topics.map(topic => topic.id), ['mine-pending']);
  const teacherHarness = harness({ profiles: { actor: teacher } });
  assert.equal((await teacherHarness.load('app/api/student/community/route.ts').GET(request('/api/student/community', null, 'valid', 'GET'))).status, 403);
});

test('student recordings show watched markers from the student\'s own views without coin thresholds', async () => {
  const route = fs.readFileSync(path.resolve(sourceRoot, 'app/api/student/recordings/route.ts'), 'utf8');
  assert.match(route, /collection\('recording_views'\)\.where\('user_id', '==', user\.uid\)/);
  assert.match(route, /watch_status/);
  assert.doesNotMatch(route, /required_seconds['"]?\s*[:,]/);
  const page = fs.readFileSync(path.resolve(sourceRoot, 'app/student/recordings/page.tsx'), 'utf8');
  assert.match(page, /視聴済み/);
  assert.match(page, /途中まで/);
  assert.doesNotMatch(page, /required_seconds|credited_seconds/);
});

test('community reports are reviewed by masters only and the review is audit-logged', async () => {
  const documents = {
    'community_reports/r1': { reporter_uid: 's1', target_type: 'topic', target_id: 't1', topic_id: 't1', target_excerpt: '悪口の投稿', reason: 'bullying', reason_label: '悪口・いじめ', status: 'open', created_at: new Date() },
    'community_reports/r2': { reporter_uid: 's2', target_type: 'topic', target_id: 't1', topic_id: 't1', target_excerpt: '悪口の投稿', reason: 'other', reason_label: 'その他', status: 'open', created_at: new Date() },
  };
  const denied = harness({ profiles: { actor: admin }, documents });
  const deniedResponse = await denied.load('app/api/admin/community-reports/route.ts').GET(request('/api/admin/community-reports', null, 'valid', 'GET'));
  assert.equal(deniedResponse.status, 403);

  const h = harness({ profiles: { actor: master }, documents });
  const route = h.load('app/api/admin/community-reports/route.ts');
  const list = await (await route.GET(request('/api/admin/community-reports', null, 'valid', 'GET'))).json();
  assert.equal(list.groups.length, 1);
  assert.equal(list.groups[0].report_ids.length, 2);
  const patched = await route.PATCH(request('/api/admin/community-reports', { report_ids: ['r1', 'r2'], status: 'resolved' }, 'valid', 'PATCH'));
  assert.equal(patched.status, 200);
  assert.equal(h.data.get('community_reports/r1').status, 'resolved');
  assert.ok([...h.data.keys()].some(key => key.startsWith('admin_audit_logs/')));
});

test('course registration change is refused for a parent of another family', async () => {
  const child = { ...student, grade: '中3', student_name: 'Child One', parent_uid: 'real-parent', parent_ids: ['real-parent'], selected_course_ids: ['physics-monday'] };
  const h = harness({ profiles: { actor: { role: 'parent', student_ids: ['someone-else'], name: 'Stranger' }, child } });
  const response = await h.load('app/api/parent/course-registrations/route.ts').POST(request('/api/parent/course-registrations', {
    student_id: 'child', year: 2026, term: 'term03', registration_type: 'regular', selected_course_ids: [], registration_tokens: [],
  }));
  assert.equal(response.status, 403);
  assert.equal(h.writes.length, 0);
  assert.equal(h.data.get('users/child').selected_course_ids.length, 1);
});

test('student course change notifies every linked parent once, and only them', async () => {
  const parentProfile = name => ({ role: 'parent', student_ids: ['actor'], name });
  const h = harness({
    profiles: {
      actor: { ...student, grade: '中3', student_name: 'Taro', parent_uid: 'dad', parent_ids: ['mom'], selected_course_ids: ['old-course'] },
      mom: parentProfile('Mom'), dad: parentProfile('Dad'), stranger: { role: 'parent', student_ids: ['other'], name: 'Stranger' },
    },
    env: { COURSE_REGISTRATION_TOKEN_SECRET: 'fixture-secret' },
  });
  const issue = h.load('lib/server/course-registration-token.ts').issueCourseRegistrationToken;
  const token = issue({ actor_id: 'actor', grade: '中3', option_id: 'physics-monday', stable_key: 'physics', year: 2026, term: 'term03', registration_type: 'regular', request_id: '', day: '月', slot: '1時間目', course_text: '理科 物理 力と運動' });
  const route = h.load('app/api/parent/course-registrations/route.ts');
  const save = () => route.POST(request('/api/parent/course-registrations', {
    student_id: 'actor', year: 2026, term: 'term03', registration_type: 'regular', selected_course_ids: ['physics-monday'], registration_tokens: [token],
  }));
  assert.equal((await save()).status, 200);
  const notices = () => [...h.data].filter(([key]) => key.startsWith('user_notifications/')).map(([, value]) => value);
  const sent = notices();
  assert.deepEqual(sent.map(item => item.user_id).sort(), ['dad', 'mom']);
  for (const item of sent) {
    assert.equal(item.role, 'parent');
    assert.equal(item.kind, 'course_registration_changed');
    assert.equal(item.title, 'Taroさんが受講講座を変更しました');
    assert.equal(item.link, '/parent/courses');
    assert.equal(item.read, false);
    assert.match(item.message, /月 1時間目 理科（物理）/);
  }
  // 同じ内容の再送では通知を増やさない
  assert.equal((await save()).status, 200);
  assert.equal(notices().length, 2);
});

test('parent course change notifies the student and the other linked parents, not unrelated users', async () => {
  const h = harness({
    profiles: {
      actor: { role: 'parent', student_ids: ['child'], name: 'Parent One' },
      child: { ...student, grade: '中3', student_name: 'Hanako', parent_uid: 'actor', parent_ids: ['actor', 'sibling'], active_course_registration_id: 'current', selected_course_ids: ['physics-monday'] },
      sibling: { role: 'parent', student_ids: ['child'], name: 'Other Parent' },
      stranger: { role: 'parent', student_ids: ['other'], name: 'Stranger' },
      classmate: { ...student, grade: '中3', student_name: 'Classmate', parent_uid: 'stranger' },
    },
    documents: { 'course_registrations/current': { student_id: 'child', registration_type: 'regular', is_current: true, current: true, selected_course_ids: ['physics-monday'] } },
  });
  // すべて解除（講座トークン不要）でも通知する
  const response = await h.load('app/api/parent/course-registrations/route.ts').POST(request('/api/parent/course-registrations', {
    student_id: 'child', year: 2026, term: 'term03', registration_type: 'regular', selected_course_ids: [], registration_tokens: [],
  }));
  assert.equal(response.status, 200);
  assert.equal(h.data.get('users/child').selected_course_ids.length, 0);
  const sent = [...h.data].filter(([key]) => key.startsWith('user_notifications/')).map(([, value]) => value);
  assert.deepEqual(sent.map(item => item.user_id).sort(), ['child', 'sibling']);
  const toStudent = sent.find(item => item.user_id === 'child');
  assert.equal(toStudent.role, 'student');
  assert.equal(toStudent.kind, 'course_registration_changed');
  assert.equal(toStudent.title, '保護者の方が受講講座を変更しました');
  assert.ok(toStudent.link.startsWith('/student/'));
  assert.match(toStudent.message, /すべて解除/);
  const toSibling = sent.find(item => item.user_id === 'sibling');
  assert.equal(toSibling.role, 'parent');
  assert.equal(toSibling.title, '保護者の方がHanakoさんの受講講座を変更しました');
  assert.equal(toSibling.link, '/parent/courses');
});

test('timetable shows the student\'s confirmed transfer, marks the absence day, and ignores cancelled or other students\' transfers', async () => {
  const day = timetableWeekday(1);
  const h = timetableFixture({
    actor: { ...student, grade: '中3', selected_course_keys: [`course_中3_理科_化学_${day}_2限`] },
    other: { ...student, grade: '中3' },
  });
  const transferDate = timetableDateKey(3);
  h.data.set('requests/abs1', {
    user_id: 'actor', student_id: 'actor', type: 'absence', status: 'completed', target_date: timetableDateKey(1),
    transfer_status: 'registered', transfer_request_id: 'abs1_transfer',
  });
  h.data.set('requests/abs1_transfer', {
    user_id: 'actor', student_id: 'actor', type: 'transfer', status: 'confirmed', target_date: transferDate,
    absence_date: timetableDateKey(1), transfer_period: 1, transfer_subject: '理科', transfer_course_name: '化学', transfer_unit: '化学変化',
  });
  h.data.set('requests/abs2_transfer', {
    user_id: 'actor', student_id: 'actor', type: 'transfer', status: 'cancelled', target_date: timetableDateKey(4),
    absence_date: timetableDateKey(2), transfer_period: 1, transfer_subject: '社会', transfer_course_name: '歴史',
  });
  h.data.set('requests/other_transfer', {
    user_id: 'other', student_id: 'other', type: 'transfer', status: 'confirmed', target_date: timetableDateKey(5),
    absence_date: timetableDateKey(2), transfer_period: 2, transfer_subject: '社会', transfer_course_name: '公民3',
  });
  const response = await h.load('app/api/student/timetable/route.ts').GET(request('/api/student/timetable', null, 'valid', 'GET'));
  assert.equal(response.status, 200, JSON.stringify(await response.clone().json()));
  const body = await response.json();
  const transfers = body.lessons.filter(lesson => lesson.kind === 'transfer');
  assert.equal(transfers.length, 1);
  assert.equal(transfers[0].date, transferDate);
  assert.equal(transfers[0].period, 1);
  assert.equal(transfers[0].status, 'scheduled');
  assert.equal(transfers[0].label, '理科（化学）');
  assert.match(transfers[0].note, /の振替$/);
  assert.equal(body.lessons.find(lesson => lesson.date === timetableDateKey(1))?.status, 'absent');
  assert.ok(!body.lessons.some(lesson => /歴史|公民/.test(lesson.label)), 'cancelled and other students\' transfers must not appear');
  assert.equal(h.writes.length, 0);
});

test('account creation writes an audit log without the password', async () => {
  const h = harness({
    profiles: { actor: master },
    overrides: { '@/lib/events': { writeLearningEvent: async () => 'event' } },
  });
  const response = await h.load('app/api/admin/accounts/create/route.ts').POST(request('/api/admin/accounts/create', {
    role: 'teacher', login_id: 'T2001', display_name: 'New Teacher', password: 'safe-password',
    school_id: '112', auto_create_parent: false,
  }));
  assert.equal(response.status, 200, JSON.stringify(await response.clone().json()));
  const log = h.data.get('admin_audit_logs/generated');
  assert.equal(log.action, 'account_create');
  assert.equal(log.actor_id, 'actor');
  assert.equal(log.target_id, 'created');
  assert.equal(log.target_label, 'New Teacher');
  assert.equal(log.details.target_role, 'teacher');
  assert.doesNotMatch(JSON.stringify(log), /safe-password/);

  // 記録に失敗してもアカウントの作成は成功のまま
  const failing = harness({ profiles: { actor: master }, overrides: { '@/lib/events': { writeLearningEvent: async () => 'event' } } });
  const original = failing.db.collection;
  failing.db.collection = name => name === 'admin_audit_logs' ? { ...original(name), add: async () => { throw new Error('write failed'); } } : original(name);
  const stillOk = await failing.load('app/api/admin/accounts/create/route.ts').POST(request('/api/admin/accounts/create', {
    role: 'teacher', login_id: 'T2002', display_name: 'Another Teacher', password: 'safe-password', school_id: '112', auto_create_parent: false,
  }));
  assert.equal(stillOk.status, 200);
  assert.ok(failing.data.get('users/created'));
});

test('attendance correction review writes an audit log with the request id and reviewer', async () => {
  const attendanceAdmin = { ...admin, admin_permissions: { science_social: false, attendance: true } };
  const fixture = () => harness({
    profiles: { actor: attendanceAdmin, target: teacher },
    documents: {
      'work_records/work': {
        teacher_id: 'target', teacher_name: 'Teacher One', school_id: '112', date: '2026-10-01', status: 'approved',
        start_time: '2026-10-01T00:00:00.000Z', end_time: '2026-10-01T01:00:00.000Z',
      },
      'attendance_correction_requests/correction': {
        teacher_id: 'target', teacher_name: 'Teacher One', school_id: '112', target_date: '2026-10-01', status: 'pending',
        request_type: 'time_correction', work_record_id: 'work',
        requested_start_time: '2026-10-01T00:05:00.000Z', requested_end_time: '2026-10-01T01:05:00.000Z',
      },
    },
    overrides: { '@/lib/events': { writeLearningEvent: async () => 'event' } },
  });
  for (const status of ['approved', 'rejected']) {
    const h = fixture();
    const response = await h.load('app/api/attendance-corrections/route.ts').POST(request('/api/attendance-corrections', {
      action: 'review', request_id: 'correction', status,
    }));
    assert.equal(response.status, 200, JSON.stringify(await response.clone().json()));
    const log = h.data.get('admin_audit_logs/generated');
    assert.equal(log.action, status === 'approved' ? 'attendance_correction_approve' : 'attendance_correction_reject');
    assert.equal(log.target_type, 'attendance_correction_request');
    assert.equal(log.target_id, 'correction');
    assert.equal(log.actor_id, 'actor');
    assert.equal(log.details.reviewer_id, 'actor');
    assert.equal(log.details.teacher_id, 'target');
    assert.equal(log.school_id, '112');
  }

  const failing = fixture();
  const original = failing.db.collection;
  failing.db.collection = name => name === 'admin_audit_logs' ? { ...original(name), add: async () => { throw new Error('write failed'); } } : original(name);
  const stillOk = await failing.load('app/api/attendance-corrections/route.ts').POST(request('/api/attendance-corrections', {
    action: 'review', request_id: 'correction', status: 'rejected',
  }));
  assert.equal(stillOk.status, 200);
  assert.equal(failing.data.get('attendance_correction_requests/correction').status, 'rejected');
});

test('parent monthly report is limited to linked parents and counts records by JST month', async () => {
  const oct31Late = new Date('2026-10-31T14:30:00Z'); // 2026-10-31 23:30 JST
  const nov1 = new Date('2026-10-31T15:00:00Z'); // 2026-11-01 00:00 JST
  const documents = {
    'users/linked': { role: 'student', student_name: 'Linked Child', parent_uid: 'actor' },
    'users/foreign': { role: 'student', student_name: 'Foreign Child', parent_uid: 'other-parent' },
    'attendance/linked_2026-10-31': { user_id: 'linked', target_date: '2026-10-31', participations: [{ subject: '理科' }] },
    'attendance/linked_2026-11-01': { user_id: 'linked', target_date: '2026-11-01', participations: [{ subject: '社会' }] },
    'requests/late1': { user_id: 'linked', type: 'absence', absence_type: 'late', target_date: '2026-10-14', status: 'approved' },
    'recording_views/linked_rec1': { user_id: 'linked', recording_id: 'rec1', status: 'completed', credited_seconds: 1800, required_seconds: 999, started_at_ms: oct31Late.getTime(), updated_at: oct31Late },
    'pf_study_progress/linked': { history: [
      { date: '2026-09-20', total: 100, gained: 10, books_studied: 2, import_id: 'a' },
      { date: '2026-10-20', total: 130, gained: 30, books_studied: 3, import_id: 'b' },
    ] },
    'users/linked/chat_history/q1': { role: 'user', content: 'q', createdAt: oct31Late },
    'users/linked/chat_history/a1': { role: 'assistant', content: 'a', createdAt: oct31Late },
    'users/linked/chat_history/q2': { role: 'user', content: 'q', createdAt: nov1 },
    'coin_transactions/c1': { user_id: 'linked', amount: 5, created_at: oct31Late },
    'coin_transactions/c2': { user_id: 'linked', amount: 7, created_at: nov1 },
    'coin_transactions/c3': { user_id: 'linked', amount: -20, created_at: oct31Late },
    'coin_transactions/c4': { user_id: 'foreign', amount: 50, created_at: oct31Late },
  };
  const h = harness({ profiles: { actor: { role: 'parent', student_ids: ['linked'] } }, documents, now: '2026-11-05T03:00:00Z' });
  const route = h.load('app/api/parent/report/route.ts');
  const get = query => route.GET(request(`/api/parent/report?${query}`, null, 'valid', 'GET'));

  const october = await get('student_id=linked&month=2026-10');
  assert.equal(october.status, 200);
  const body = await october.json();
  assert.equal(body.month, '2026-10');
  assert.equal(body.is_current_month, false);
  assert.equal(body.sections.attendance.ok, true);
  assert.equal(body.sections.attendance.data.current.live_days, 1);
  assert.equal(body.sections.attendance.data.current.late_days, 1);
  assert.equal(body.sections.recordings.data.current.count, 1);
  assert.equal(body.sections.recordings.data.current.watched_minutes, 30);
  assert.doesNotMatch(JSON.stringify(body), /required_seconds|999/);
  assert.equal(body.sections.homework.data.period_count, 30);
  assert.equal(body.sections.homework.data.previous_period_count, 10);
  assert.equal(body.sections.ai.data.questions, 1);
  assert.equal(body.sections.coins.data.earned, 5);
  assert.equal(body.sections.quiz.data, null);
  assert.match(body.summary, /^10月はZoomで1回参加し、録画を1本見ました。宿題の学習回数は9月より20回増えました。/);

  const november = await (await get('student_id=linked&month=2026-11')).json();
  assert.equal(november.is_current_month, true);
  assert.equal(november.sections.ai.data.questions, 1);
  assert.equal(november.sections.coins.data.earned, 7);
  assert.equal(november.sections.attendance.data.current.live_days, 1);

  assert.equal((await get('student_id=foreign&month=2026-10')).status, 403);
  assert.equal((await get('student_id=linked&month=2026-12')).status, 400);
  assert.equal((await get('student_id=linked&month=bad')).status, 400);

  const otherFamily = harness({ profiles: { stranger: { role: 'parent', student_ids: ['someone-else'] } }, identity: { uid: 'stranger', email: 'stranger@example.test' }, documents, now: '2026-11-05T03:00:00Z' });
  assert.equal((await otherFamily.load('app/api/parent/report/route.ts').GET(request('/api/parent/report?student_id=linked&month=2026-10', null, 'valid', 'GET'))).status, 403);
  const asStudent = harness({ profiles: { actor: { ...student } }, documents: { ...documents, 'users/linked': { role: 'student', parent_uid: 'actor' } }, now: '2026-11-05T03:00:00Z' });
  assert.equal((await asStudent.load('app/api/parent/report/route.ts').GET(request('/api/parent/report?student_id=linked&month=2026-10', null, 'valid', 'GET'))).status, 403);
});

test('teacher substitution requests are limited to the teacher own upcoming shift and notify admins', async () => {
  const now = '2026-10-19T03:00:00.000Z';
  const fixture = () => harness({
    now,
    profiles: { actor: teacher, other: { ...teacher, name: 'Teacher Two' }, boss: master, campus: admin },
    documents: {
      'shift_assignments/mine': { user_id: 'actor', teacher_name: 'Teacher One', target_date: '2026-10-25', note: '【1限】', target_grade: '中2', target_subject: '理科', role_type: 'main' },
      'shift_assignments/theirs': { user_id: 'other', teacher_name: 'Teacher Two', target_date: '2026-10-25', note: '【2限】', role_type: 'main' },
      'shift_assignments/past': { user_id: 'actor', teacher_name: 'Teacher One', target_date: '2026-10-10', note: '【1限】', role_type: 'main' },
    },
    overrides: { '@/lib/events': { writeLearningEvent: async () => 'event' } },
  });
  const route = h => h.load('app/api/teacher/substitutions/route.ts');

  const foreign = fixture();
  const denied = await route(foreign).POST(request('/api/teacher/substitutions', { action: 'request', shift_assignment_id: 'theirs', reason: '体調不良' }));
  assert.equal(denied.status, 403);
  assert.ok(![...foreign.data.keys()].some(key => key.startsWith('teacher_substitution_posts/') || key.startsWith('user_notifications/')));

  const past = fixture();
  const pastResponse = await route(past).POST(request('/api/teacher/substitutions', { action: 'request', shift_assignment_id: 'past', reason: '体調不良' }));
  assert.equal(pastResponse.status, 400);
  assert.equal((await pastResponse.json()).error, 'shift-in-past');

  const h = fixture();
  const created = await route(h).POST(request('/api/teacher/substitutions', { action: 'request', shift_assignment_id: 'mine', reason: '大学の試験' }));
  assert.equal(created.status, 200, JSON.stringify(await created.clone().json()));
  const post = h.data.get('teacher_substitution_posts/teacher_mine');
  assert.equal(post.status, 'open');
  assert.equal(post.requester_id, 'actor');
  assert.equal(post.created_by, 'actor');
  assert.equal(post.teacher_name, 'Teacher One');
  assert.equal(post.shift_assignment_id, 'mine');
  assert.equal(post.target_date, '2026-10-25');
  assert.equal(post.period, '1限');
  const notifications = [...h.data.entries()].filter(([key]) => key.startsWith('user_notifications/')).map(([, value]) => value);
  assert.ok(notifications.some(item => item.user_id === 'boss' && item.kind === 'teacher_substitution_request' && item.link === '/master/substitutions'));
  assert.ok(notifications.some(item => item.user_id === 'campus'));
  assert.ok(!notifications.some(item => item.user_id === 'actor' || item.user_id === 'other'));

  const duplicate = await route(h).POST(request('/api/teacher/substitutions', { action: 'request', shift_assignment_id: 'mine', reason: '再送' }));
  assert.equal(duplicate.status, 409);

  // 本人は自分の依頼に返答できず、別の講師が返答すると担当が引き継がれる。
  const self = await route(h).POST(request('/api/teacher/substitutions', { post_id: 'teacher_mine' }));
  assert.equal(self.status, 400);
  assert.equal((await self.json()).error, 'cannot-claim-own-request');
  h.data.set('users/actor', { ...teacher, name: 'Teacher Three' });
  h.data.set('teacher_substitution_posts/teacher_mine', { ...post, requester_id: 'other', created_by: 'other' });
  h.data.set('shift_assignments/mine', { ...h.data.get('shift_assignments/mine'), user_id: 'other' });
  const claimed = await route(h).POST(request('/api/teacher/substitutions', { post_id: 'teacher_mine' }));
  assert.equal(claimed.status, 200, JSON.stringify(await claimed.clone().json()));
  assert.equal(h.data.get('shift_assignments/mine').user_id, 'actor');
  assert.equal(h.data.get('shift_assignments/mine').substitute_for_user_id, 'other');
  assert.equal(h.data.get('teacher_substitution_posts/teacher_mine').status, 'claimed');
  assert.equal(h.data.get('user_notifications/substitution_claimed_teacher_mine').user_id, 'other');
});

test('teacher shift submissions reject past dates and assigned days cannot be withdrawn', async () => {
  const now = '2026-10-19T03:00:00.000Z';
  const fixture = () => harness({
    now,
    profiles: { actor: teacher },
    documents: {
      'teacher_availability/assigned': { teacher_id: 'actor', user_id: 'actor', available_date: '2026-10-25' },
      'teacher_availability/free': { teacher_id: 'actor', user_id: 'actor', available_date: '2026-10-26' },
      'teacher_availability/today': { teacher_id: 'actor', user_id: 'actor', available_date: '2026-10-19' },
      'teacher_availability/foreign': { teacher_id: 'other', user_id: 'other', available_date: '2026-10-27' },
      'shift_assignments/s1': { user_id: 'actor', target_date: '2026-10-25' },
    },
  });
  const route = h => h.load('app/api/teacher/shifts/route.ts');
  const body = { time_range: '19:00 - 22:00', workplace: 'エディック 明石本部校', roles: ['main'] };

  const past = fixture();
  const rejected = await route(past).POST(request('/api/teacher/shifts', { ...body, dates: ['2026-10-18', '2026-10-28'] }));
  assert.equal(rejected.status, 400);
  assert.equal((await rejected.json()).error, 'date-in-past');
  assert.equal(past.writes.length, 0);

  const ok = fixture();
  const created = await route(ok).POST(request('/api/teacher/shifts', { ...body, dates: ['2026-10-28', '2026-10-26'] }));
  assert.equal(created.status, 200);
  assert.deepEqual((await created.json()).skipped, ['2026-10-26']);
  const saved = ok.data.get('teacher_availability/generated');
  assert.equal(saved.teacher_name, 'Teacher One');
  assert.equal(saved.available_date, '2026-10-28');
  assert.equal(saved.workplace, 'エディック 明石本部校');
  assert.equal(saved.location, 'エディック 明石本部校');

  const del = (h, id) => route(h).DELETE(request(`/api/teacher/shifts?id=${id}`, null, 'valid', 'DELETE'));
  for (const [id, status] of [['assigned', 409], ['today', 409], ['foreign', 403], ['free', 200]]) {
    const h = fixture();
    assert.equal((await del(h, id)).status, status, id);
    assert.equal(h.data.has(`teacher_availability/${id}`), status !== 200, id);
  }
});

test('student records API is student-only and returns only the signed-in student\'s own data', async () => {
  const oct = day => new Date(`2026-10-${day}T03:00:00Z`);
  const fixture = actorProfile => {
    const h = harness({
      now: '2026-10-21T03:00:00Z',
      profiles: {
        actor: actorProfile,
        other: { ...student, lifetime_id: 'other', coins: 9999, total_coins: 9999, recording_complete_count: 99, earned_badges: ['badge_recording_30'] },
      },
      documents: {
        'attendance/actor_2026-10-05': { user_id: 'actor', target_date: '2026-10-05', type: 'joined' },
        'attendance/actor_2026-10-14': { user_id: 'actor', target_date: '2026-10-14', type: 'joined' },
        'attendance/actor_2026-10-16': { user_id: 'actor', target_date: '2026-10-16', type: 'absent' },
        'attendance/other_2026-10-15': { user_id: 'other', target_date: '2026-10-15', type: 'joined' },
        'attendance/other_2026-10-16': { user_id: 'other', target_date: '2026-10-16', type: 'joined' },
        'recording_views/actor_rec1': { user_id: 'actor', status: 'completed', completed_at: oct('10'), updated_at: oct('10') },
        'recording_views/actor_rec2': { user_id: 'actor', status: 'watching', updated_at: oct('12') },
        'recording_views/other_rec1': { user_id: 'other', status: 'completed', completed_at: oct('11'), updated_at: oct('11') },
        'pf_study_progress/actor': { student_id: 'actor', total_count: 120, history: [
          { date: '2026-10-06', total: 100, gained: null, books_studied: null, import_id: 'a' },
          { date: '2026-10-13', total: 120, gained: 20, books_studied: 2, import_id: 'b' },
        ] },
        'pf_study_progress/other': { student_id: 'other', total_count: 5000, history: [{ date: '2026-10-13', total: 5000, gained: 900, books_studied: 9, import_id: 'c' }] },
        'quest_results/actor_q1': { student_id: 'actor', is_passed: true, created_at: oct('08') },
        'quest_results/actor_q2': { student_id: 'actor', is_passed: false, created_at: oct('09') },
        'quest_results/other_q1': { student_id: 'other', is_passed: true, created_at: oct('09') },
        'coin_transactions/actor_1': { user_id: 'actor', amount: 10, created_at: oct('05') },
        'coin_transactions/actor_2': { user_id: 'actor', amount: 5, created_at: oct('14') },
        'coin_transactions/actor_3': { user_id: 'actor', amount: -20, created_at: oct('15') },
        'coin_transactions/other_1': { user_id: 'other', amount: 1000, created_at: oct('15') },
      },
    });
    // 本番の count() 集計をテスト用の Firestore に足す
    const original = h.db.collection;
    const withCount = query => ({
      ...query,
      where: (...args) => withCount(query.where(...args)),
      limit: () => withCount(query), orderBy: () => withCount(query), select: () => withCount(query),
      count: () => ({ get: async () => { const snap = await query.get(); return { data: () => ({ count: snap.size }) }; } }),
    });
    h.db.collection = name => withCount(original(name));
    return h;
  };
  const route = 'app/api/student/records/route.ts';

  for (const profile of [teacher, admin, master]) {
    const h = fixture(profile);
    const response = await h.load(route).GET(request('/api/student/records?student_id=other', null, 'valid', 'GET'));
    assert.equal(response.status, 403);
  }
  assert.equal((await fixture(student).load(route).GET(request('/api/student/records', null, '', 'GET'))).status, 401);

  const h = fixture({ ...student, coins: 30, total_coins: 80, recording_complete_count: 7, login_count: 12, login_streak: 3, quest_clear_count: 4, earned_badges: ['badge_1', 'badge_book'] });
  const response = await h.load(route).GET(request('/api/student/records?student_id=other&uid=other', null, 'valid', 'GET'));
  assert.equal(response.status, 200);
  const body = await response.json();
  assert.deepEqual(body.errors, {});
  assert.deepEqual(body.zoom, { month_days: 2, total_days: 2 });
  assert.deepEqual(body.recordings, { month_completed: 1, total_completed: 7 });
  assert.equal(body.homework.month_count, 20);
  assert.equal(body.homework.total_count, 120);
  assert.deepEqual(body.quests, { month_cleared: 1, month_capped: false, total_cleared: 4 });
  assert.deepEqual(body.coins, { balance: 30, total_earned: 80, month_earned: 15, month_capped: false });
  assert.equal(body.weekly.length, 8);
  assert.deepEqual(body.weekly.map(week => week.zoom_days), [0, 0, 0, 0, 0, 1, 1, 0]);
  assert.equal(body.weekly.at(-2).homework_gained, 20);
  assert.equal(body.weekly.at(-3).homework_gained, null);
  assert.deepEqual(body.streak.zoom_weeks, { weeks: 2, capped: false });
  assert.deepEqual(body.badges.earned.map(item => item.id), ['badge_1', 'badge_book']);
  assert.equal(body.badges.next.find(item => item.metric === 'recording_complete_count').remaining, 3);
  assert.doesNotMatch(JSON.stringify(body), /9999|5000|900|1000|badge_recording_30/);
  assert.equal(h.writes.length, 0);
});

test('student records API flags a failed section instead of reporting zero', async () => {
  const h = harness({ now: '2026-10-21T03:00:00Z', profiles: { actor: { ...student, coins: 3 } } });
  const original = h.db.collection;
  h.db.collection = name => name === 'coin_transactions'
    ? { ...original(name), where: () => { throw new Error('index missing'); } }
    : original(name);
  const response = await h.load('app/api/student/records/route.ts').GET(request('/api/student/records', null, 'valid', 'GET'));
  assert.equal(response.status, 200);
  const body = await response.json();
  assert.equal(body.errors.coins, true);
  assert.equal(body.coins.month_earned, null);
  // count() が使えない環境では通算の参加日数だけを失敗扱いにする
  assert.equal(body.errors.zoom_total, true);
  assert.equal(body.zoom.total_days, null);
  assert.equal(body.zoom.month_days, 0);
});

// 生徒の総合ページ：生徒検索は担当校の生徒だけ、管理者以外は 403。
test('admin student search is scoped to the admin schools and rejects non-admins', async () => {
  const students = {
    own: { role: 'student', school_id: '112', student_name: '山田 太郎', student_name_kana: 'ヤマダ タロウ', lifetime_id: 'S1001' },
    other: { role: 'student', school_id: '999', student_name: '山田 次郎', student_name_kana: 'ヤマダ ジロウ', lifetime_id: 'S1002' },
    noSchool: { role: 'student', student_name: '山田 三郎', lifetime_id: 'S1003' },
  };
  const search = async (actorProfile, q) => {
    const h = harness({ profiles: { actor: actorProfile, ...students } });
    const response = await h.load('app/api/admin/students/search/route.ts').GET(request(`/api/admin/students/search?q=${encodeURIComponent(q)}`, null, 'valid', 'GET'));
    return { status: response.status, body: await response.json() };
  };
  const asAdmin = await search(admin, 'やまだ');
  assert.equal(asAdmin.status, 200);
  assert.deepEqual(asAdmin.body.students.map(item => item.id), ['own']);
  assert.deepEqual((await search(admin, 'S1002')).body.students, []);
  const asMaster = await search(master, '山田');
  assert.deepEqual(asMaster.body.students.map(item => item.id).sort(), ['noSchool', 'other', 'own']);
  for (const profile of [teacher, student, { role: 'parent' }, { role: 'attendance_admin' }, { ...admin, admin_permissions: { science_social: false, attendance: true } }]) {
    assert.equal((await search(profile, 'やまだ')).status, 403);
  }
});

// 生徒の総合ページ：教室への連絡・安全アラートはマスターにだけ返す（読みもしない）。担当外の生徒は 403。
test('admin student overview hides master-only sections from school admins and blocks other schools', async () => {
  const fixture = actorProfile => harness({
    profiles: {
      actor: actorProfile,
      target: { role: 'student', school_id: '112', student_name: '山田 太郎', lifetime_id: 'S1001', coins: 30, parent_uid: 'parent1' },
      foreign: { role: 'student', school_id: '999', student_name: '他校 生徒' },
      parent1: { role: 'parent', parent_name: '山田 保護者', line_user_id: 'U1' },
    },
    documents: {
      'safety_alerts/alert1': { student_id: 'target', category_label: 'いじめ', status: 'open', school_id: '112' },
      'parent_inquiries/inq1': { student_id: 'target', parent_id: 'parent1', subject: '欠席について', status: 'open' },
      'coin_transactions/tx1': { user_id: 'target', amount: 10, reason: '授業参加' },
      'requests/abs1': { user_id: 'target', type: 'absence', target_date: '2026-10-01', status: 'pending' },
    },
  });
  const overview = async (actorProfile, id = 'target') => {
    const h = fixture(actorProfile);
    const response = await h.load('app/api/admin/students/[id]/overview/route.ts').GET(
      request(`/api/admin/students/${id}/overview`, null, 'valid', 'GET'),
      { params: Promise.resolve({ id }) },
    );
    return { status: response.status, body: await response.json() };
  };

  const asAdmin = await overview(admin);
  assert.equal(asAdmin.status, 200, JSON.stringify(asAdmin.body));
  assert.equal(asAdmin.body.sections.parent_contacts, undefined);
  assert.equal(asAdmin.body.sections.safety_alerts, undefined);
  assert.deepEqual([...asAdmin.body.hidden_sections].sort(), ['parent_contacts', 'safety_alerts']);
  assert.equal(asAdmin.body.sections.profile.ok, true);
  assert.equal(asAdmin.body.sections.profile.data.parents[0].line_linked, true);
  assert.equal(asAdmin.body.sections.coins.data.balance, 30);
  assert.equal(asAdmin.body.sections.requests.data.absences.length, 1);

  const asMaster = await overview(master);
  assert.equal(asMaster.status, 200);
  assert.deepEqual(asMaster.body.hidden_sections, []);
  assert.equal(asMaster.body.sections.safety_alerts.data.length, 1);
  assert.equal(asMaster.body.sections.parent_contacts.data.length, 1);

  assert.equal((await overview(admin, 'foreign')).status, 403);
  assert.equal((await overview(master, 'foreign')).status, 200);
  assert.equal((await overview(admin, 'parent1')).status, 404);
  assert.equal((await overview(teacher)).status, 403);
  assert.equal((await overview({ role: 'attendance_admin' })).status, 403);
});

// 自分のアカウント画面はどの管理者でも開け、受講講座の表示設定は既定で表示。
test('admin account page is global and parent course visibility defaults to visible', () => {
  const permissions = fs.readFileSync(path.resolve(sourceRoot, 'lib/admin-app-permissions.ts'), 'utf8');
  assert.match(permissions, /GLOBAL_ADMIN_PATHS = \[[^\]]*'\/master\/account'/);
  const visibility = fs.readFileSync(path.resolve(sourceRoot, 'app/hooks/usePortalVisibility.ts'), 'utf8');
  assert.match(visibility, /parent: \{[^}]*courseRegistration: true/);
  const parentLayout = fs.readFileSync(path.resolve(sourceRoot, 'app/parent/layout.tsx'), 'utf8');
  assert.match(parentLayout, /'\/parent\/courses'[^}]*visibility\.courseRegistration !== false/);
});

// 返信のひな形（教室への連絡）はマスターだけが読み書きでき、クライアントからは直接触れない。
test('reply templates API is master-only, validates input, caps the count, and rules deny clients', async () => {
  const route = 'app/api/admin/reply-templates/route.ts';
  for (const profile of [admin, teacher, student, { role: 'parent' }, { role: 'attendance_admin' }]) {
    const h = harness({ profiles: { actor: profile }, documents: { 'reply_templates/t1': { title: 'お礼', body: '本文' } } });
    const routes = h.load(route);
    assert.equal((await routes.GET(request('/api/admin/reply-templates', null, 'valid', 'GET'))).status, 403);
    assert.equal((await routes.POST(request('/api/admin/reply-templates', { title: 'x', body: 'y' }))).status, 403);
    assert.equal((await routes.PATCH(request('/api/admin/reply-templates', { id: 't1', title: 'x', body: 'y' }, 'valid', 'PATCH'))).status, 403);
    assert.equal((await routes.DELETE(request('/api/admin/reply-templates?id=t1', null, 'valid', 'DELETE'))).status, 403);
    assert.equal(h.writes.length, 0);
  }
  const unauthenticated = harness({ profiles: { actor: master } }).load(route);
  assert.equal((await unauthenticated.GET(request('/api/admin/reply-templates', null, '', 'GET'))).status, 401);

  const h = harness({ profiles: { actor: master }, documents: { 'reply_templates/t1': { title: 'お礼', body: '{保護者名}様', updated_at_iso: '2026-10-01T00:00:00.000Z' } } });
  const routes = h.load(route);
  const listed = await routes.GET(request('/api/admin/reply-templates', null, 'valid', 'GET'));
  assert.equal(listed.status, 200);
  assert.deepEqual((await listed.json()).templates, [{ id: 't1', title: 'お礼', body: '{保護者名}様', updated_at: '2026-10-01T00:00:00.000Z' }]);
  assert.equal((await routes.POST(request('/api/admin/reply-templates', { title: '', body: 'y' }))).status, 400);
  assert.equal((await routes.POST(request('/api/admin/reply-templates', { title: 'x', body: 'y'.repeat(5001) }))).status, 400);
  assert.equal((await routes.POST(request('/api/admin/reply-templates', { title: '新規', body: '本文' }))).status, 200);
  assert.equal(h.data.get('reply_templates/generated').title, '新規');
  assert.equal(h.data.get('reply_templates/generated').created_by, 'actor');
  assert.equal((await routes.PATCH(request('/api/admin/reply-templates', { id: 't1', title: '変更', body: '本文2' }, 'valid', 'PATCH'))).status, 200);
  assert.equal(h.data.get('reply_templates/t1').title, '変更');
  assert.equal((await routes.PATCH(request('/api/admin/reply-templates', { id: 'missing', title: 'x', body: 'y' }, 'valid', 'PATCH'))).status, 404);
  assert.equal((await routes.PATCH(request('/api/admin/reply-templates', { id: 'a/b', title: 'x', body: 'y' }, 'valid', 'PATCH'))).status, 400);
  assert.equal((await routes.DELETE(request('/api/admin/reply-templates?id=t1', null, 'valid', 'DELETE'))).status, 200);
  assert.equal(h.data.has('reply_templates/t1'), false);

  const full = harness({ profiles: { actor: master }, documents: Object.fromEntries(Array.from({ length: 50 }, (_, index) => [`reply_templates/t${index}`, { title: `t${index}`, body: 'b' }])) });
  assert.equal((await full.load(route).POST(request('/api/admin/reply-templates', { title: 'x', body: 'y' }))).status, 400);
  assert.equal(full.writes.length, 0);

  const rules = fs.readFileSync(path.resolve(sourceRoot, 'firestore.rules'), 'utf8');
  assert.match(rules, /match \/reply_templates\/\{templateId\} \{\s*allow read, write: if false;\s*\}/);
});

// 端末への通知（Web Push）：購読は本人分だけ保存し、https の送信先だけを受け付ける。
test('push subscription API stores only the signed-in user and rejects invalid endpoints', async () => {
  const keys = { p256dh: 'B'.repeat(87), auth: 'a'.repeat(22) };
  const endpoint = 'https://push.example.test/send/abc';
  const id = createHash('sha256').update(new URL(endpoint).toString()).digest('hex');
  const h = harness({ profiles: { actor: student, victim: student } });
  const route = h.load('app/api/push/subscriptions/route.ts');
  const saved = await route.POST(request('/api/push/subscriptions', { user_id: 'victim', subscription: { endpoint, keys } }));
  assert.equal(saved.status, 200);
  assert.equal(h.data.get(`push_subscriptions/${id}`).user_id, 'actor');
  assert.deepEqual({ ...h.data.get(`push_subscriptions/${id}`).keys }, keys);
  for (const bad of ['http://push.example.test/send', 'javascript:alert(1)', 'https://user:pass@push.example.test/x', '', `https://push.example.test/${'x'.repeat(2100)}`]) {
    const fresh = harness({ profiles: { actor: student } });
    const response = await fresh.load('app/api/push/subscriptions/route.ts').POST(request('/api/push/subscriptions', { subscription: { endpoint: bad, keys } }));
    assert.equal(response.status, 400, bad);
    assert.equal(fresh.writes.length, 0);
  }
  const noKeys = harness({ profiles: { actor: student } });
  assert.equal((await noKeys.load('app/api/push/subscriptions/route.ts').POST(request('/api/push/subscriptions', { subscription: { endpoint, keys: { p256dh: 'x', auth: '' } } }))).status, 400);
  const anonymous = harness({ profiles: { actor: student } });
  assert.equal((await anonymous.load('app/api/push/subscriptions/route.ts').POST(request('/api/push/subscriptions', { subscription: { endpoint, keys } }, ''))).status, 401);
  assert.equal(anonymous.writes.length, 0);

  // 他人の端末の登録は消せない。本人の分は消せる。
  const other = harness({ profiles: { actor: student }, documents: { [`push_subscriptions/${id}`]: { user_id: 'victim', endpoint, keys } } });
  assert.equal((await other.load('app/api/push/subscriptions/route.ts').DELETE(request('/api/push/subscriptions', { endpoint }, 'valid', 'DELETE'))).status, 200);
  assert.ok(other.data.has(`push_subscriptions/${id}`));
  const own = harness({ profiles: { actor: student }, documents: { [`push_subscriptions/${id}`]: { user_id: 'actor', endpoint, keys } } });
  assert.equal((await own.load('app/api/push/subscriptions/route.ts').DELETE(request('/api/push/subscriptions', { endpoint }, 'valid', 'DELETE'))).status, 200);
  assert.equal(own.data.has(`push_subscriptions/${id}`), false);

  // 1人10台まで。11台目を登録すると古い順に外す。
  const many = Object.fromEntries(Array.from({ length: 10 }, (_, index) => [`push_subscriptions/old${index}`, { user_id: 'actor', endpoint: `https://push.example.test/${index}`, keys, created_at: { toMillis: () => index } }]));
  const full = harness({ profiles: { actor: student }, documents: many });
  assert.equal((await full.load('app/api/push/subscriptions/route.ts').POST(request('/api/push/subscriptions', { subscription: { endpoint, keys } }))).status, 200);
  assert.equal([...full.data.keys()].filter(key => key.startsWith('push_subscriptions/')).length, 10);
  assert.equal(full.data.has('push_subscriptions/old0'), false);
  assert.match(fs.readFileSync(path.resolve(sourceRoot, 'firestore.rules'), 'utf8'), /match \/push_subscriptions\/\{subscriptionId\} \{\s*allow read, write: if false;/);
});

test('web push sender is a no-op without VAPID keys and prunes expired subscriptions when configured', async () => {
  const sent = [];
  const webPush = { sendNotification: async (subscription, payload) => { sent.push({ subscription, payload: JSON.parse(payload) }); if (subscription.endpoint.endsWith('gone')) throw Object.assign(new Error('gone'), { statusCode: 410 }); } };
  const keys = { p256dh: 'p', auth: 'a' };
  const documents = {
    'push_subscriptions/live': { user_id: 'parent1', endpoint: 'https://push.example.test/live', keys },
    'push_subscriptions/gone': { user_id: 'parent1', endpoint: 'https://push.example.test/gone', keys },
    'push_subscriptions/muted': { user_id: 'muted', endpoint: 'https://push.example.test/muted', keys },
  };
  const profiles = { parent1: { role: 'parent' }, muted: { role: 'parent', notification_preferences: { push: false } } };
  const off = harness({ profiles, documents, overrides: { 'web-push': webPush } });
  const offResult = await off.load('lib/server/web-push.ts').sendPushToUsers(['parent1', 'muted'], { title: 't', body: 'b', link: '/parent' });
  assert.deepEqual({ ...offResult }, { sent: 0, failed: 0, removed: 0 });
  assert.equal(sent.length, 0);
  assert.doesNotThrow(() => off.load('lib/server/web-push.ts').queuePushToUsers(['parent1'], { title: 't', body: 'b' }));
  assert.equal(off.writes.length, 0);

  const env = { NEXT_PUBLIC_VAPID_PUBLIC_KEY: 'public', VAPID_PRIVATE_KEY: 'private', VAPID_SUBJECT: 'mailto:ops@example.test' };
  const on = harness({ profiles, documents, env, overrides: { 'web-push': webPush } });
  const result = await on.load('lib/server/web-push.ts').sendPushToUsers(['parent1', 'muted'], { title: 't', body: 'b', link: 'https://evil.example/x' });
  assert.deepEqual({ ...result }, { sent: 1, failed: 1, removed: 1 });
  assert.deepEqual(sent.map(item => item.subscription.endpoint).sort(), ['https://push.example.test/gone', 'https://push.example.test/live']);
  assert.equal(sent[0].payload.link, '/');
  assert.equal(on.data.has('push_subscriptions/gone'), false);
  assert.ok(on.data.has('push_subscriptions/live'));

  const disabled = harness({ profiles, documents: { ...documents, 'settings/notification_channels': { push_enabled: false } }, env, overrides: { 'web-push': webPush } });
  sent.length = 0;
  assert.equal((await disabled.load('lib/server/web-push.ts').sendPushToUsers(['parent1'], { title: 't', body: 'b' })).sent, 0);
  assert.equal(sent.length, 0);
});

test('notifyStaff still writes in-app notifications when push delivery fails', async () => {
  const env = { NEXT_PUBLIC_VAPID_PUBLIC_KEY: 'public', VAPID_PRIVATE_KEY: 'private', VAPID_SUBJECT: 'mailto:ops@example.test' };
  const h = harness({
    profiles: { boss: master },
    documents: { 'push_subscriptions/boss': { user_id: 'boss', endpoint: 'https://push.example.test/boss', keys: { p256dh: 'p', auth: 'a' } } },
    env,
    overrides: { 'web-push': { sendNotification: () => { throw new Error('push-down'); } } },
  });
  const staff = h.load('lib/server/staff-recipients.ts');
  const count = await staff.notifyStaff([{ id: 'boss', data: master, isMaster: true }], {
    idPrefix: 'fixture', title: '保護者から新しい連絡が届きました', message: '本文', kind: 'parent_inquiry', masterLink: '/master/parent-inquiries',
  });
  assert.equal(count, 1);
  assert.equal(h.data.get('user_notifications/fixture_boss').title, '保護者から新しい連絡が届きました');
  await new Promise(resolve => setTimeout(resolve, 10));
  assert.ok(h.data.has('push_subscriptions/boss'));
});

test('announcement push is master-only, follows the read audience rules, and is sent once', async () => {
  const env = { NEXT_PUBLIC_VAPID_PUBLIC_KEY: 'public', VAPID_PRIVATE_KEY: 'private', VAPID_SUBJECT: 'mailto:ops@example.test' };
  const sent = [];
  const webPush = { sendNotification: async (subscription, payload) => { sent.push({ endpoint: subscription.endpoint, payload: JSON.parse(payload) }); } };
  const keys = { p256dh: 'p', auth: 'a' };
  const people = {
    s1: { role: 'student', school_id: '112', grade: '中1' },
    s2: { role: 'student', school_id: '999', grade: '中1' },
    s3: { role: 'student', school_id: '112', grade: '中2' },
    gone: { role: 'student', school_id: '112', grade: '中1', account_status: 'withdrawn' },
    p1: { role: 'parent', student_ids: ['s1'] },
    p2: { role: 'parent', student_ids: ['s2'] },
    t1: { role: 'teacher', school_id: '112' },
    a1: { ...admin },
  };
  const documents = {
    'announcements/ann': { title: '台風による休講', content: '本文', target: 'all', label: 'alert', school_ids: ['112'], grades: ['中1'], publish_at: '2026-01-01T00:00:00.000Z' },
    'announcements/future': { title: '予約', content: '本文', target: 'all', label: 'important', publish_at: '2099-01-01T00:00:00.000Z' },
    ...Object.fromEntries(Object.keys(people).map(id => [`push_subscriptions/${id}`, { user_id: id, endpoint: `https://push.example.test/${id}`, keys }])),
  };
  const notify = (h, id) => h.load('app/api/announcements/route.ts').POST(request('/api/announcements', { action: 'notify_push', id }));

  // 校舎管理者・生徒は送れない。
  for (const profile of [admin, student]) {
    const denied = harness({ profiles: { ...people, actor: profile }, documents, env, overrides: { 'web-push': webPush } });
    assert.equal((await notify(denied, 'ann')).status, 403);
    assert.equal(denied.writes.length, 0);
  }
  assert.equal(sent.length, 0);

  // 対象は一覧と同じ判定：他校舎・他学年の生徒、その保護者、学年のない講師、管理者、退塾者には送らない。
  const h = harness({ profiles: { ...people, actor: master }, documents, env, overrides: { 'web-push': webPush } });
  const first = await notify(h, 'ann');
  assert.equal(first.status, 200);
  const body = await first.json();
  assert.equal(body.push.status, 'sent');
  assert.equal(body.push.recipients, 2);
  await new Promise(resolve => setTimeout(resolve, 20));
  assert.deepEqual(sent.map(item => item.endpoint).sort(), ['https://push.example.test/p1', 'https://push.example.test/s1']);
  assert.equal(sent.find(item => item.endpoint.endsWith('/s1')).payload.link, '/student/news/ann');
  assert.equal(sent.find(item => item.endpoint.endsWith('/p1')).payload.link, '/parent/news/ann');
  assert.equal(sent[0].payload.title, 'お知らせ：台風による休講');
  assert.ok(!sent[0].payload.body.includes('本文'));
  assert.equal(h.data.get('announcements/ann').push_notified_at, 'now');
  assert.equal(h.data.get('announcements/ann').push_recipient_count, 2);
  const audit = h.data.get('admin_audit_logs/generated');
  assert.equal(audit.action, 'announcement_push');
  assert.equal(audit.details.recipients, 2);
  assert.equal([...h.data.keys()].filter(key => key.startsWith('user_notifications/')).length, 0);

  // 2回目は何もしない。
  sent.length = 0;
  const second = await notify(h, 'ann');
  assert.equal(second.status, 200);
  assert.equal((await second.json()).push.status, 'already-notified');
  await new Promise(resolve => setTimeout(resolve, 20));
  assert.equal(sent.length, 0);

  // 予約配信の前は送れない。存在しないお知らせは404。
  assert.equal((await notify(h, 'future')).status, 409);
  assert.equal(h.data.get('announcements/future').push_notified_at, undefined);
  assert.equal((await notify(h, 'missing')).status, 404);
});

test('announcement push defaults on for important announcements and no-ops without VAPID keys', async () => {
  const sent = [];
  const webPush = { sendNotification: async subscription => { sent.push(subscription.endpoint); } };
  const keys = { p256dh: 'p', auth: 'a' };
  const documents = { 'push_subscriptions/s1': { user_id: 's1', endpoint: 'https://push.example.test/s1', keys } };
  const profiles = { actor: master, s1: { role: 'student', school_id: '112', grade: '中1' } };
  const publish = async (h, label, push) => {
    const form = new FormData();
    form.set('title', 'お知らせ'); form.set('content', '本文'); form.set('target', 'student'); form.set('label', label);
    if (push !== undefined) form.set('push', push);
    const response = await h.load('app/api/announcements/route.ts').POST(new NextRequest('https://security.test/api/announcements', { method: 'POST', headers: { authorization: 'Bearer valid' }, body: form }));
    assert.equal(response.status, 200);
    return response.json();
  };

  // 鍵が未設定なら送らず、通知済みの記録も残さない（鍵を設定した後に送れる）。
  const off = harness({ profiles, documents, overrides: { 'web-push': webPush } });
  assert.equal((await publish(off, 'important')).push.status, 'disabled');
  assert.equal(off.data.get('announcements/generated').push_requested, true);
  assert.equal(off.data.get('announcements/generated').push_notified_at, undefined);
  assert.equal(off.data.has('admin_audit_logs/generated'), false);
  await new Promise(resolve => setTimeout(resolve, 20));
  assert.equal(sent.length, 0);

  const env = { NEXT_PUBLIC_VAPID_PUBLIC_KEY: 'public', VAPID_PRIVATE_KEY: 'private', VAPID_SUBJECT: 'mailto:ops@example.test' };
  const normal = harness({ profiles, documents, env, overrides: { 'web-push': webPush } });
  assert.equal((await publish(normal, 'info')).push.status, 'not-requested');
  assert.equal(normal.data.get('announcements/generated').push_requested, false);
  const optedOut = harness({ profiles, documents, env, overrides: { 'web-push': webPush } });
  assert.equal((await publish(optedOut, 'alert', '0')).push.status, 'not-requested');
  await new Promise(resolve => setTimeout(resolve, 20));
  assert.equal(sent.length, 0);

  const important = harness({ profiles, documents, env, overrides: { 'web-push': webPush } });
  const result = await publish(important, 'important');
  assert.equal(result.push.status, 'sent');
  assert.equal(result.push.recipients, 1);
  const optedIn = harness({ profiles, documents, env, overrides: { 'web-push': webPush } });
  assert.equal((await publish(optedIn, 'info', '1')).push.status, 'sent');
  await new Promise(resolve => setTimeout(resolve, 20));
  assert.deepEqual(sent, ['https://push.example.test/s1', 'https://push.example.test/s1']);
});

test('Vercel cron GET endpoints require Authorization: Bearer CRON_SECRET and fail closed without it', async () => {
  const cronRequest = (url, header) => new NextRequest(`https://security.test${url}`, { method: 'GET', headers: header ? { authorization: header } : {} });
  const routes = [
    ['app/api/zoom/recordings/sync/route.ts', '/api/zoom/recordings/sync?days=3&max_meetings=100'],
    ['app/api/attendance-integration/sync/route.ts', '/api/attendance-integration/sync'],
  ];
  for (const [file, url] of routes) {
    // CRON_SECRET 未設定なら、どんなヘッダーでも拒否する。
    const unset = harness({ fetch: async () => { throw new Error('network must not be reached'); } });
    assert.equal((await unset.load(file).GET(cronRequest(url, 'Bearer '))).status, 401);
    assert.equal((await unset.load(file).GET(cronRequest(url, 'Bearer undefined'))).status, 401);

    const env = { CRON_SECRET: 'cron-secret-for-security-tests-0123456789' };
    const configured = harness({ env, fetch: async () => { throw new Error('network must not be reached'); } });
    const route = configured.load(file);
    assert.equal((await route.GET(cronRequest(url))).status, 401);
    assert.equal((await route.GET(cronRequest(url, 'Bearer wrong-secret'))).status, 401);
    assert.equal((await route.GET(cronRequest(url, env.CRON_SECRET))).status, 401);
    // Firebase のIDトークンでは cron を起動できない（GET は cron 専用）。
    assert.equal((await route.GET(cronRequest(url, 'Bearer valid'))).status, 401);
    assert.equal(configured.verifications.length, 0);
    const accepted = await route.GET(cronRequest(url, `Bearer ${env.CRON_SECRET}`));
    assert.notEqual(accepted.status, 401);
  }
});

test('science-social staff tools reject admins without the science-social app and teachers assigned to other programs', async () => {
  const boosterOnlyAdmin = { ...admin, admin_permissions: { science_social: false, eiken: true, attendance: true, online_school: false } };
  const boosterTeacher = { ...teacher, enabled_programs: ['eiken'] };
  const scienceTeacher = { ...teacher, enabled_programs: ['science_social'] };
  const local = { ...student, student_name: 'Local' };
  const slideContext = { params: Promise.resolve({ id: 'slide' }) };
  const slideDoc = { 'lesson_slides/slide': { file_path: 'lesson_slides/2026/slide.pptx', file_name: 'a.pptx' } };

  for (const actor of [boosterOnlyAdmin, boosterTeacher]) {
    const h = harness({ profiles: { actor, local }, documents: slideDoc });
    assert.equal((await h.load('app/api/teacher/students/route.ts').GET(request('/api/teacher/students', null, 'valid', 'GET'))).status, 403);
    assert.equal((await h.load('app/api/teacher/chat/route.ts').GET(request('/api/teacher/chat?student_id=local', null, 'valid', 'GET'))).status, 403);
    assert.equal((await h.load('app/api/teacher/chat/route.ts').POST(request('/api/teacher/chat', { action: 'send', student_id: 'local', message: 'x' }))).status, 403);
    assert.equal((await h.load('app/api/teacher/contacts/route.ts').POST(request('/api/teacher/contacts', { student_id: 'local' }))).status, 403);
    assert.equal((await h.load('app/api/slides/[id]/download/route.ts').GET(request('/api/slides/slide/download', null, 'valid', 'GET'), slideContext)).status, 403);
    assert.equal(h.calls.some(value => String(value).startsWith('signed:')), false);
    assert.equal(h.writes.length, 0);
  }

  const allowed = harness({ profiles: { actor: scienceTeacher, local } });
  const listed = await allowed.load('app/api/teacher/students/route.ts').GET(request('/api/teacher/students', null, 'valid', 'GET'));
  assert.equal(listed.status, 200);
  assert.deepEqual((await listed.json()).students.map(item => item.id), ['local']);

  const adminHarness = harness({ profiles: { actor: boosterOnlyAdmin } });
  assert.equal((await adminHarness.load('app/api/curriculum-admin/route.ts').GET(request('/api/curriculum-admin?year=2026', null, 'valid', 'GET'))).status, 403);
  assert.equal((await adminHarness.load('app/api/pf/dashboard/route.ts').GET(request('/api/pf/dashboard', null, 'valid', 'GET'))).status, 403);
  assert.equal((await adminHarness.load('app/api/admin/pf/import/route.ts').POST(request('/api/admin/pf/import', { csv_text: 'a' }))).status, 403);
  assert.equal((await adminHarness.load('app/api/homework/adaptive/route.ts').POST(request('/api/homework/adaptive', { grade: '中1', subject: '理科' }))).status, 403);
  assert.equal(adminHarness.writes.length, 0);
});

test('risk analysis is limited to science-social staff, returns auth status codes, and is rate limited', async () => {
  const anonymous = harness();
  assert.equal((await anonymous.load('app/api/teacher/analyze-risk/route.ts').POST(request('/api/teacher/analyze-risk', { batchSize: 1 }, ''))).status, 401);
  const studentHarness = harness({ profiles: { actor: student } });
  assert.equal((await studentHarness.load('app/api/teacher/analyze-risk/route.ts').POST(request('/api/teacher/analyze-risk', { batchSize: 1 }))).status, 403);
  const limited = harness({
    profiles: { actor: teacher },
    env: { OPENAI_API_KEY: 'test' },
    overrides: { '@/lib/server/password-recovery': { consumeRateLimit: async () => false } },
  });
  assert.equal((await limited.load('app/api/teacher/analyze-risk/route.ts').POST(request('/api/teacher/analyze-risk', { batchSize: 1 }))).status, 429);
  assert.equal(limited.writes.length, 0);
});

test('logout removes this device push subscription first and staff portals mount the idle timeout', () => {
  const read = relative => fs.readFileSync(path.resolve(sourceRoot, relative), 'utf8');
  const authContext = read('app/context/AuthContext.tsx');
  const logoutBody = authContext.slice(authContext.indexOf('const logout = async'), authContext.indexOf('const finishAuthWithProfile'));
  assert.ok(logoutBody.indexOf('cleanupThisDevicePushOnLogout()') > 0);
  assert.ok(logoutBody.indexOf('cleanupThisDevicePushOnLogout()') < logoutBody.indexOf('firebaseSignOut(auth)'));
  const webPush = read('app/hooks/useWebPush.ts');
  assert.match(webPush, /export async function cleanupThisDevicePushOnLogout/);
  assert.match(webPush, /callApi\('DELETE', \{ endpoint: subscription\.endpoint \}\)/);

  assert.match(read('app/master/layout.tsx'), /<StaffIdleTimeout \/>/);
  assert.match(read('app/teacher/layout.tsx'), /<StaffIdleTimeout \/>/);
  assert.doesNotMatch(read('app/student/layout.tsx'), /StaffIdleTimeout/);
  assert.doesNotMatch(read('app/parent/layout.tsx'), /StaffIdleTimeout/);
  const idle = read('app/hooks/useStaffIdleTimeout.ts');
  assert.match(idle, /STAFF_IDLE_TIMEOUT_MS = 4 \* 60 \* 60 \* 1000/);
  assert.match(idle, /STAFF_IDLE_WARNING_MS = 5 \* 60 \* 1000/);
  assert.match(idle, /localStorage/);
});

test('teacher weekly availability pattern is saved only to the teacher own profile with validated values', async () => {
  const week = (patch = {}) => Object.fromEntries(['sun', 'mon', 'tue', 'wed', 'thu', 'fri', 'sat'].map(key => [key, {
    status: 'unavailable', start_time: '19:00', end_time: '22:00', workplace: '元町', roles: ['main'], commitment_type: 'university', commitment_end_time: '18:00', note: '',
    ...(patch[key] || {}),
  }]));
  const fixture = () => harness({ profiles: { actor: teacher, other: { ...teacher, name: 'Teacher Two' } } });
  const route = h => h.load('app/api/teacher/availability-profile/route.ts');
  const put = (h, body) => route(h).PUT(request('/api/teacher/availability-profile', body, 'valid', 'PUT'));

  // 他の講師の設定は保存できない。
  const foreign = fixture();
  for (const field of ['teacher_id', 'user_id', 'uid']) {
    const denied = await put(foreign, { [field]: 'other', weekdays: week() });
    assert.equal(denied.status, 403);
  }
  assert.equal(foreign.writes.length, 0);

  // 生徒・管理者はこのAPIを使えない。
  const asStudent = harness({ profiles: { actor: student } });
  assert.equal((await put(asStudent, { weekdays: week() })).status, 403);
  assert.equal(asStudent.writes.length, 0);

  // 不正な値は拒否する。
  const invalid = [
    [{ mon: { status: 'sometimes' } }, 'invalid-status'],
    [{ mon: { status: 'available', start_time: '22:00', end_time: '19:00', workplace: '創造学園 元町校' } }, 'invalid-time-range'],
    [{ mon: { status: 'available', start_time: '25:00', end_time: '26:00', workplace: '創造学園 元町校' } }, 'invalid-time'],
    [{ mon: { status: 'available', start_time: '19:00', end_time: '22:00', workplace: '存在しない校舎' } }, 'invalid-workplace'],
    [{ mon: { status: 'available', start_time: '19:00', end_time: '22:00', workplace: '創造学園 元町校', roles: ['owner'] } }, 'invalid-role'],
    [{ tue: { commitment_type: 'party' } }, 'invalid-commitment'],
    [{ wed: { commitment_end_time: '' } }, 'commitment-required'],
  ];
  for (const [patch, error] of invalid) {
    const h = fixture();
    const response = await put(h, { weekdays: week(patch) });
    assert.equal(response.status, 400, error);
    assert.equal((await response.json()).error, error);
    assert.equal(h.writes.length, 0);
  }
  const extraDay = fixture();
  assert.equal((await put(extraDay, { weekdays: { ...week(), holiday: week().mon } })).status, 400);
  const missingDay = fixture();
  const partial = week(); delete partial.sat;
  assert.equal((await put(missingDay, { weekdays: partial })).status, 400);

  // 本人の文書に、従来と同じ形で保存される（講師名はプロフィールから）。
  const h = fixture();
  const saved = await put(h, { teacher_name: '偽名', weekdays: week({ mon: { status: 'available', start_time: '18:30', end_time: '21:30', workplace: '創造学園 元町校', roles: ['main', 'sub'] } }) });
  assert.equal(saved.status, 200, JSON.stringify(await saved.clone().json()));
  assert.deepEqual(h.writes, ['teacher_availability_profiles/actor']);
  const stored = h.data.get('teacher_availability_profiles/actor');
  assert.equal(stored.teacher_id, 'actor');
  assert.equal(stored.user_id, 'actor');
  assert.equal(stored.teacher_name, 'Teacher One');
  assert.equal(stored.weekdays.mon.workplace, '創造学園 元町校');
  assert.deepEqual([...stored.weekdays.mon.roles], ['main', 'sub']);
  assert.equal(stored.weekdays.tue.status, 'unavailable');
  assert.ok(stored.created_at && stored.updated_at);

  // 管理画面が読む文書をブラウザから直接書かない。
  const page = fs.readFileSync(path.resolve(sourceRoot, 'app/teacher/shifts/page.tsx'), 'utf8');
  assert.doesNotMatch(page, /setDoc\(/);
  assert.match(page, /\/api\/teacher\/availability-profile/);
  const rules = fs.readFileSync(path.resolve(sourceRoot, 'firestore.rules'), 'utf8');
  const block = rules.slice(rules.indexOf('match /teacher_availability_profiles/{teacherId}'), rules.indexOf('match /teacher_commuter_passes'));
  assert.match(block, /allow create, update, delete: if isAttendanceManager\(\);/);
  assert.doesNotMatch(block, /allow (create|update|delete)[^;]*isTeacher\(\)/);
});

test('admin substitution reopen returns a teacher-raised shift to the original requester and notifies both teachers', async () => {
  const pushes = [];
  const fixture = (actorProfile = master, extra = {}) => harness({
    profiles: { actor: actorProfile, requester: { ...teacher, name: 'Teacher Req' }, claimer: { ...teacher, name: 'Teacher Sub' } },
    documents: {
      'teacher_substitution_posts/teacher_s1': {
        requested_by_teacher: true, requester_id: 'requester', requester_name: 'Teacher Req', teacher_name: 'Teacher Req',
        shift_assignment_id: 's1', target_date: '2026-10-25', period: '1限', title: '中2 理科', status: 'claimed', claimed_by: 'claimer', claimed_by_name: 'Teacher Sub',
      },
      'shift_assignments/s1': { user_id: 'claimer', teacher_name: 'Teacher Sub', substitute_post_id: 'teacher_s1', substitute_for_user_id: 'requester', substitute_for_teacher_name: 'Teacher Req', target_date: '2026-10-25' },
      'teacher_substitution_posts/admin_post': { created_by: 'boss', teacher_name: '管理者', shift_assignment_id: 's2', target_date: '2026-10-26', period: '2限', title: '中3 社会', status: 'claimed', claimed_by: 'claimer', claimed_by_name: 'Teacher Sub' },
      'shift_assignments/s2': { user_id: 'claimer', teacher_name: 'Teacher Sub', target_date: '2026-10-26' },
      ...extra,
    },
    overrides: { '@/lib/server/web-push': { queuePushToUsers: (ids, message) => pushes.push({ ids, message }) } },
  });
  const route = h => h.load('app/api/admin/substitutions/route.ts');
  const reopen = (h, postId) => route(h).POST(request('/api/admin/substitutions', { action: 'reopen', post_id: postId }));

  // 講師・生徒・他校舎の管理者は再募集できない。
  for (const profile of [teacher, student, { ...admin, school_id: '999', school: '999', school_ids: ['999'] }]) {
    const h = fixture(profile);
    assert.equal((await reopen(h, 'teacher_s1')).status, 403);
    assert.equal(h.writes.length, 0);
  }
  assert.equal((await route(harness()).POST(request('/api/admin/substitutions', { action: 'reopen', post_id: 'teacher_s1' }, ''))).status, 401);

  // マスター（と担当校舎の管理者）は再募集でき、担当が依頼した講師に戻る。
  for (const profile of [master, admin]) {
    pushes.length = 0;
    const h = fixture(profile);
    const response = await reopen(h, 'teacher_s1');
    assert.equal(response.status, 200, JSON.stringify(await response.clone().json()));
    assert.equal((await response.json()).restored, true);
    const post = h.data.get('teacher_substitution_posts/teacher_s1');
    assert.equal(post.status, 'open');
    assert.equal(post.claimed_by, null);
    const shift = h.data.get('shift_assignments/s1');
    assert.equal(shift.user_id, 'requester');
    assert.equal(shift.teacher_name, 'Teacher Req');
    assert.equal(shift.substitute_post_id, 'deleted');
    assert.equal(shift.substitute_for_user_id, 'deleted');
    assert.equal(h.data.get('user_notifications/substitution_reopened_teacher_s1_claimer').user_id, 'claimer');
    assert.equal(h.data.get('user_notifications/substitution_reopened_teacher_s1_requester').user_id, 'requester');
    assert.deepEqual(pushes.flatMap(item => item.ids).sort(), ['claimer', 'requester']);
    const audit = h.data.get('admin_audit_logs/generated');
    assert.equal(audit.action, 'substitution_reopen');
    assert.equal(audit.target_id, 'teacher_s1');
    assert.equal(audit.details.restored_user_id, 'requester');
    assert.equal((await reopen(h, 'teacher_s1')).status, 409);
  }

  // 返答後に手で配置し直された講師配置は触らない。
  const reassigned = fixture(master, { 'shift_assignments/s1': { user_id: 'someone', teacher_name: 'Someone', substitute_post_id: 'teacher_s1', substitute_for_user_id: 'requester' } });
  assert.equal((await reopen(reassigned, 'teacher_s1')).status, 200);
  assert.equal(reassigned.data.get('shift_assignments/s1').user_id, 'someone');

  // 管理者が作った依頼は従来どおり（状態だけ募集中に戻し、講師配置・通知はそのまま）。
  pushes.length = 0;
  const adminPost = fixture(master);
  assert.equal((await reopen(adminPost, 'admin_post')).status, 200);
  assert.equal(adminPost.data.get('teacher_substitution_posts/admin_post').status, 'open');
  assert.equal(adminPost.data.get('shift_assignments/s2').user_id, 'claimer');
  assert.ok(![...adminPost.data.keys()].some(key => key.startsWith('user_notifications/')));
  assert.equal(pushes.length, 0);
  assert.equal(adminPost.data.get('admin_audit_logs/generated').action, 'substitution_reopen');

  const page = fs.readFileSync(path.resolve(sourceRoot, 'app/master/substitutions/page.tsx'), 'utf8');
  const reopenBody = page.slice(page.indexOf('const reopenPost'), page.indexOf('return (', page.indexOf('const reopenPost')));
  assert.match(reopenBody, /\/api\/admin\/substitutions/);
  assert.doesNotMatch(reopenBody, /updateDoc\(/);
});

// 生徒ホームの「振替で参加する（ここから選ぶ）」：今日・同じ学年の授業へ振替する。
const todayGradeNow = '2026-10-19T09:30:00Z'; // 日本時間 18:30（1限の終了前）
const todayGradeMasters = (classButtonSettingsData = {}) => ({
  '@/lib/server/student-class-masters': {
    loadStudentClassMasters: async () => ({ optionDocs: [], curriculumDocs: [], testPrepOptionDocs: [], classButtonSettingsData }),
  },
});
const todayGradeShift = (extra) => ({
  target_date: '2026-10-19', target_grade: '中2', target_subject: '理科', target_detail_subject: '物理', unit: '電流',
  period: 1, role_type: 'main', teacher_name: '山田', ...extra,
});
const todayGradeDocuments = {
  'shift_assignments/p1-same': todayGradeShift({ target_meeting_id: '111111111', target_join_url: 'https://us02web.zoom.us/j/111111111?pwd=same' }),
  'shift_assignments/p1-other-grade': todayGradeShift({ target_grade: '中3', target_meeting_id: '222222222' }),
  'shift_assignments/p1-no-zoom': todayGradeShift({ target_detail_subject: '化学' }),
  'shift_assignments/p1-support': todayGradeShift({ role_type: 'support', target_meeting_id: '555555555' }),
  'shift_assignments/p2-same': todayGradeShift({ period: 2, target_meeting_id: '333333333' }),
  'shift_assignments/p1-eligible': todayGradeShift({ target_subject: '社会', target_detail_subject: '歴史', unit: '江戸', target_meeting_id: '444444444' }),
  'shift_assignments/p1-yesterday': todayGradeShift({ target_date: '2026-10-18', target_meeting_id: '666666666' }),
};
const todayGradeHarness = ({ classButtonSettingsData = {}, profile = {}, documents = {} } = {}) => harness({
  profiles: { actor: { ...student, grade: '中2', student_name: 'Student One', selected_course_ids: ['p1-eligible'], ...profile } },
  documents: { ...todayGradeDocuments, ...documents },
  env: { TRANSFER_OPTION_TOKEN_SECRET: 'fixture-secret', CLASS_PARTICIPATION_TOKEN_SECRET: 'fixture-secret' },
  overrides: todayGradeMasters(classButtonSettingsData),
  now: todayGradeNow,
});

test('today-grade transfer candidates list only same-grade, visible, not-ended classes for the period that are not already joinable', async () => {
  const h = todayGradeHarness({
    documents: {
      'requests/open-absence': { student_id: 'actor', type: 'absence', absence_type: 'absent', target_date: '2026-10-12', status: 'completed' },
      'requests/old-absence': { student_id: 'actor', type: 'absence', absence_type: 'absent', target_date: '2026-08-01', status: 'completed' },
      'requests/done-absence': { student_id: 'actor', type: 'absence', absence_type: 'absent', target_date: '2026-10-13', status: 'completed', transfer_status: 'registered' },
    },
  });
  const route = h.load('app/api/student/transfer-options/route.ts');
  const response = await route.GET(request('/api/student/transfer-options?scope=today_grade&period=1', null, 'valid', 'GET'));
  assert.equal(response.status, 200);
  const body = await response.json();
  assert.deepEqual(body.candidates.map(item => item.id), ['p1-same']);
  const [candidate] = body.candidates;
  assert.equal(candidate.period, 1);
  assert.equal(candidate.unit, '電流');
  assert.equal(candidate.start_time, '19:20');
  assert.equal(candidate.end_time, '20:25');
  assert.equal(candidate.teacher_name, '山田');
  assert.equal(JSON.stringify(body).includes('111111111'), false, 'no Zoom meeting ids or URLs');
  assert.equal(candidate.transfer_token, undefined);
  assert.deepEqual(body.absences.map(item => item.target_date), ['2026-10-12']);
  assert.equal(h.writes.length, 0);

  const ended = todayGradeHarness({ classButtonSettingsData: { period1_end: '18:00' } });
  const endedBody = await (await ended.load('app/api/student/transfer-options/route.ts').GET(
    request('/api/student/transfer-options?scope=today_grade&period=1', null, 'valid', 'GET'),
  )).json();
  assert.deepEqual(endedBody.candidates, []);
});

test('today-grade transfer tokens are refused for another grade, joinable, ended, or today-dated classes', async () => {
  const h = todayGradeHarness();
  const route = h.load('app/api/student/transfer-options/route.ts');
  const ask = body => route.POST(request('/api/student/transfer-options', { scope: 'today_grade', absence_date: '2026-10-12', ...body }));
  for (const shiftId of ['p1-other-grade', 'p1-eligible', 'p1-support', 'p1-no-zoom', 'p1-yesterday', 'missing']) {
    const response = await ask({ shift_id: shiftId });
    assert.equal(response.status, 400, shiftId);
    assert.equal((await response.json()).transfer_token, undefined, shiftId);
  }
  assert.equal((await ask({ shift_id: 'p1-same', absence_date: '2026-10-19' })).status, 400);
  assert.equal((await ask({ shift_id: 'p1-same', absence_date: '2026-06-01' })).status, 400);

  const ended = todayGradeHarness({ classButtonSettingsData: { period1_end: '18:00' } });
  const endedResponse = await ended.load('app/api/student/transfer-options/route.ts').POST(
    request('/api/student/transfer-options', { scope: 'today_grade', shift_id: 'p1-same', absence_date: '2026-10-12' }),
  );
  assert.equal(endedResponse.status, 400);
  assert.equal((await endedResponse.json()).error, 'transfer-target-ended');
});

test('a grade-scope transfer token cannot be confirmed for another grade or another student', async () => {
  const h = todayGradeHarness();
  const tokens = h.load('lib/server/transfer-option-token.ts');
  // 他学年の授業に署名を作っても、確定時の学年確認で止まる。
  const forged = tokens.issueTransferOptionToken({
    actor_id: 'actor', student_id: 'actor', absence_id: 'pending:actor:2026-10-12', shift_id: 'p1-other-grade',
    target_date: '2026-10-19', unit: '電流', subject: '理科', course_name: '物理', period: 1, scope: 'grade',
  });
  const route = h.load('app/api/parent/absence-requests/route.ts');
  const response = await route.POST(request('/api/parent/absence-requests', {
    student_id: 'actor', type: 'transfer', target_date: '2026-10-12', transfer_shift_id: 'p1-other-grade', transfer_token: forged,
  }));
  assert.equal(response.status, 400);
  assert.equal((await response.json()).error, 'transfer option changed; reload options');
  assert.equal([...h.data.keys()].some(key => key.startsWith('requests/')), false);

  const other = harness({
    profiles: {
      actor: { ...student, grade: '中2' },
      other: { ...student, grade: '中2', student_name: 'Other' },
    },
    documents: todayGradeDocuments,
    env: { TRANSFER_OPTION_TOKEN_SECRET: 'fixture-secret' },
    overrides: todayGradeMasters(),
    now: todayGradeNow,
  });
  const grant = await (await other.load('app/api/student/transfer-options/route.ts').POST(
    request('/api/student/transfer-options', { scope: 'today_grade', shift_id: 'p1-same', absence_date: '2026-10-12' }),
  )).json();
  assert.ok(grant.transfer_token);
  const stolen = await other.load('app/api/parent/absence-requests/route.ts').POST(request('/api/parent/absence-requests', {
    student_id: 'other', type: 'transfer', target_date: '2026-10-12', transfer_shift_id: 'p1-same', transfer_token: grant.transfer_token,
  }));
  assert.equal(stolen.status, 403);
  assert.equal([...other.data.keys()].some(key => key.startsWith('requests/')), false);
});

test('student confirms a grade-scope transfer and today classes then shows the joined class', async () => {
  const h = todayGradeHarness({
    documents: { 'shift_assignments/p1-same': todayGradeShift({ unit: '', target_meeting_id: '111111111', target_join_url: 'https://us02web.zoom.us/j/111111111?pwd=same' }) },
  });
  const before = await (await h.load('app/api/student/today-classes/route.ts').GET(
    request('/api/student/today-classes?period=1', null, 'valid', 'GET'),
  )).json();
  assert.deepEqual(before.classes.map(item => item.id), ['p1-eligible']);

  const grant = await (await h.load('app/api/student/transfer-options/route.ts').POST(
    request('/api/student/transfer-options', { scope: 'today_grade', shift_id: 'p1-same', absence_date: '2026-10-12' }),
  )).json();
  assert.equal(grant.absence_id, 'pending:actor:2026-10-12');
  const confirm = await h.load('app/api/parent/absence-requests/route.ts').POST(request('/api/parent/absence-requests', {
    student_id: 'actor', type: 'transfer', target_date: '2026-10-12', transfer_shift_id: 'p1-same', transfer_token: grant.transfer_token,
  }));
  assert.equal(confirm.status, 200, JSON.stringify(await confirm.clone().json()));
  const confirmed = await confirm.json();
  const transfer = h.data.get(`requests/${confirmed.id}`);
  assert.equal(transfer.type, 'transfer');
  assert.equal(transfer.target_date, '2026-10-19');
  assert.equal(transfer.transfer_shift_id, 'p1-same');
  assert.equal(h.data.get(`requests/${confirmed.absence_id}`).target_date, '2026-10-12');

  const after = await (await h.load('app/api/student/today-classes/route.ts').GET(
    request('/api/student/today-classes?period=1', null, 'valid', 'GET'),
  )).json();
  const joined = after.classes.find(item => item.id === 'p1-same');
  assert.ok(joined, JSON.stringify(after.classes));
  assert.equal(joined.source, 'transfer');

  const candidates = await (await h.load('app/api/student/transfer-options/route.ts').GET(
    request('/api/student/transfer-options?scope=today_grade&period=1', null, 'valid', 'GET'),
  )).json();
  assert.deepEqual(candidates.candidates, []);
});

test('today-grade transfer candidates and tokens are student only', async () => {
  for (const profile of [{ role: 'parent', student_ids: ['child'] }, teacher, admin]) {
    const h = harness({ profiles: { actor: profile }, documents: todayGradeDocuments, env: { TRANSFER_OPTION_TOKEN_SECRET: 'fixture-secret' }, overrides: todayGradeMasters(), now: todayGradeNow });
    const route = h.load('app/api/student/transfer-options/route.ts');
    assert.equal((await route.GET(request('/api/student/transfer-options?scope=today_grade&period=1&student_id=child', null, 'valid', 'GET'))).status, 403);
    assert.equal((await route.POST(request('/api/student/transfer-options', { scope: 'today_grade', shift_id: 'p1-same', absence_date: '2026-10-12' }))).status, 403);
  }
});

// ---- パスワード再設定：「メールが使えない」の依頼の記録と管理者への通知 ----
// 依頼の画面は実物の照合・回数制限を使い、端末通知やメール送信は起こさない。
function recoveryHarness({ profiles = {}, documents = {} } = {}) {
  const recovery = {};
  const h = harness({ profiles, documents, identity: null, overrides: { '@/lib/server/password-recovery': recovery } });
  Object.assign(recovery, h.load('lib/server/password-recovery.ts'), { getClientIp: () => '203.0.113.20' });
  const route = h.load('app/api/auth/password-reset/request/route.ts');
  const send = body => route.POST(request('/api/auth/password-reset/request', body, ''));
  const notifications = () => [...h.data].filter(([key]) => key.startsWith('user_notifications/password_recovery_')).map(([key, value]) => ({ key, ...value }));
  return { h, send, notifications };
}
const recoveryStaff = {
  boss: master,
  att112: { role: 'attendance_admin', school_id: '112', name: '勤怠112' },
  att161: { role: 'attendance_admin', school_id: '161', name: '勤怠161' },
  ss112: { ...admin, name: '理社112' },
};

test('support recovery request keeps the submitted login id and name when unmatched and notifies masters only', async () => {
  const { h, send, notifications } = recoveryHarness({ profiles: { ...recoveryStaff, t1: { role: 'teacher', school_id: '112', name: '山田 太郎', lifetime_id: 't0001' } } });
  const response = await send({ mode: 'support', login_id: '  t0009 ', name: ' 山田　花子 ', phone_last4: '1234' });
  assert.equal(response.status, 200);
  const body = await response.json();
  assert.match(body.request_code, /^PR-/);
  const stored = h.data.get('password_recovery_requests/generated');
  assert.equal(stored.target_user_id, null);
  assert.equal(stored.submitted_login_id, 't0009');
  assert.equal(stored.submitted_name, '山田 花子');
  assert.equal(stored.status, 'pending');
  const sent = notifications();
  assert.deepEqual(sent.map(item => item.user_id), ['boss']);
  assert.equal(sent[0].link, '/master/accounts/recovery');
  assert.equal(sent[0].request_code, body.request_code);
  assert.match(sent[0].message, /登録と一致しませんでした/);

  // 入力は長さを切って保存する
  const long = recoveryHarness({ profiles: recoveryStaff });
  await long.send({ mode: 'support', login_id: 'x'.repeat(300), name: '名'.repeat(300) });
  const longStored = long.h.data.get('password_recovery_requests/generated');
  assert.equal(longStored.submitted_login_id.length, 64);
  assert.equal(longStored.submitted_name.length, 64);
});

test('teacher recovery request notifies masters and the attendance managers of that school only, once per fingerprint', async () => {
  const { h, send, notifications } = recoveryHarness({ profiles: { ...recoveryStaff, t1: { role: 'teacher', school_id: '112', name: '山田 太郎', lifetime_id: 't0001' } } });
  const first = await (await send({ mode: 'support', login_id: 't0001', name: '山田太郎' })).json();
  const stored = h.data.get('password_recovery_requests/generated');
  assert.equal(stored.target_user_id, 't1');
  assert.equal(stored.target_school_id, '112');
  assert.equal(stored.submitted_login_id, 't0001');
  const sent = notifications();
  assert.deepEqual(sent.map(item => item.user_id).sort(), ['att112', 'boss']);
  const forManager = sent.find(item => item.user_id === 'att112');
  assert.equal(forManager.link, '/master/notifications');
  assert.match(forManager.message, /マスター/);
  assert.equal(forManager.request_code, first.request_code);

  // 同じ入力の2回目の依頼は記録するが、通知は重ねない
  const writesBefore = h.writes.filter(key => key.startsWith('user_notifications/')).length;
  await send({ mode: 'support', login_id: 't0001', name: '山田太郎' });
  assert.equal(h.writes.filter(key => key.startsWith('user_notifications/')).length, writesBefore);
});

test('student recovery request notifies the science-social admins of the school, not attendance managers', async () => {
  const { send, notifications } = recoveryHarness({ profiles: { ...recoveryStaff, s1: { ...student, lifetime_id: 's0001', student_name: '佐藤 一郎' } } });
  await send({ mode: 'support', login_id: 's0001', name: '佐藤一郎' });
  assert.deepEqual(notifications().map(item => item.user_id).sort(), ['boss', 'ss112']);
});

test('email-mode password reset response is the same for a known account without email and an unknown account', async () => {
  const profiles = {
    ...recoveryStaff,
    t1: { role: 'teacher', school_id: '112', name: '山田 太郎', lifetime_id: 't0001' },
  };
  const bodies = [];
  for (const input of [
    { login_id: 't0001', name: '山田太郎', email: 'yamada@example.test' },
    { login_id: 'nobody', name: '誰か', email: 'someone@example.test' },
  ]) {
    const { h, send, notifications } = recoveryHarness({ profiles });
    const response = await send({ mode: 'email', ...input });
    assert.equal(response.status, 200);
    const body = await response.json();
    assert.equal(body.request_code, undefined);
    bodies.push(body);
    assert.ok(![...h.data.keys()].some(key => key.startsWith('password_recovery_requests/') || key.startsWith('password_reset_tokens/')));
    assert.equal(notifications().length, 0);
  }
  assert.deepEqual(bodies[0], bodies[1]);
  assert.match(bodies[0].message, /確認済みメールを登録している場合だけ届きます/);
});

test('admin inbox counts pending password recovery requests for masters only', async () => {
  const documents = {
    'password_recovery_requests/a': { status: 'pending', target_user_id: null, submitted_name: '山田', created_at: 'now' },
    'password_recovery_requests/b': { status: 'pending', target_user_id: 't1', created_at: 'now' },
    'password_recovery_requests/c': { status: 'resolved', target_user_id: 't1', created_at: 'now' },
  };
  const masterHarness = harness({ profiles: { actor: master }, documents });
  withCountQueries(masterHarness);
  const counts = (await (await masterHarness.load('app/api/admin/inbox-counts/route.ts').GET(request('/api/admin/inbox-counts', null, 'valid', 'GET'))).json()).counts;
  assert.equal(counts.passwordRecovery, 2);

  for (const profile of [{ ...admin, admin_permissions: { science_social: true, attendance: true } }, { role: 'attendance_admin', school_id: '112' }]) {
    const other = harness({ profiles: { actor: profile }, documents });
    const queries = withCountQueries(other);
    const response = await other.load('app/api/admin/inbox-counts/route.ts').GET(request('/api/admin/inbox-counts', null, 'valid', 'GET'));
    assert.equal(response.status, 200);
    assert.equal(Object.hasOwn((await response.json()).counts, 'passwordRecovery'), false);
    assert.ok(!queries.some(item => item.name === 'password_recovery_requests'));
  }

  const menu = fs.readFileSync(path.resolve(sourceRoot, 'app/components/master/admin-menu.ts'), 'utf8');
  assert.match(menu, /key: 'passwordRecovery'[^\n]+badgeKey: 'passwordRecovery'/);
});
