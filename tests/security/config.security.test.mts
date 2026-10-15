import assert from 'node:assert/strict';
import fs from 'node:fs';
import test from 'node:test';
import { NextRequest } from 'next/server';
import nextConfig from '../../next.config.mjs';
import { middleware } from '../../middleware.ts';

test('全ルートに主要セキュリティヘッダーを設定する', async () => {
  const entries = await nextConfig.headers();
  const allRoutes = entries.find(entry => entry.source === '/:path*');
  assert.ok(allRoutes);
  const headers = new Map<string, string>(allRoutes.headers.map(item => [item.key.toLowerCase(), String(item.value)]));
  assert.equal(headers.get('x-content-type-options'), 'nosniff');
  assert.equal(headers.get('x-frame-options'), 'DENY');
  assert.equal(headers.get('referrer-policy'), 'strict-origin-when-cross-origin');
  assert.match(headers.get('strict-transport-security') || '', /max-age=31536000/);
  assert.match(headers.get('content-security-policy') || '', /default-src 'self'/);
  assert.match(headers.get('content-security-policy') || '', /frame-ancestors 'none'/);
  assert.match(headers.get('permissions-policy') || '', /geolocation=\(\)/);
});

test('通常本番は変動IPでもmaster画面を通し、認証と役割で制御する', () => {
  const request = new NextRequest('https://security.test/master', {
    headers: { 'x-forwarded-for': '203.0.113.10' },
  });
  const response = middleware(request);
  assert.equal(response.headers.get('x-middleware-next'), '1');
});

test('ローカルIPからmaster画面への検証アクセスは許可する', () => {
  const request = new NextRequest('https://security.test/master', {
    headers: { 'x-forwarded-for': '127.0.0.1' },
  });
  const response = middleware(request);
  assert.equal(response.headers.get('x-middleware-next'), '1');
});

test('外部診断モードでは許可IP以外から全画面とAPIを遮断する', () => {
  const oldMode = process.env.SECURITY_DIAGNOSIS_MODE;
  const oldAllowedIps = process.env.ALLOWED_IPS;
  process.env.SECURITY_DIAGNOSIS_MODE = 'true';
  process.env.ALLOWED_IPS = '113.37.16.194,124.33.127.18';
  try {
    for (const path of ['/', '/student', '/api/apps']) {
      const blocked = middleware(new NextRequest(`https://security.test${path}`, {
        headers: { 'x-vercel-forwarded-for': '203.0.113.10' },
      }));
      assert.equal(blocked.status, 307);
      assert.equal(blocked.headers.get('location'), 'https://security.test/403');
    }
  } finally {
    if (oldMode === undefined) delete process.env.SECURITY_DIAGNOSIS_MODE;
    else process.env.SECURITY_DIAGNOSIS_MODE = oldMode;
    if (oldAllowedIps === undefined) delete process.env.ALLOWED_IPS;
    else process.env.ALLOWED_IPS = oldAllowedIps;
  }
});

test('外部診断モードでは指定Web診断IPを許可する', () => {
  const oldMode = process.env.SECURITY_DIAGNOSIS_MODE;
  const oldAllowedIps = process.env.ALLOWED_IPS;
  process.env.SECURITY_DIAGNOSIS_MODE = 'true';
  process.env.ALLOWED_IPS = '113.37.16.194,124.33.127.18';
  try {
    const allowed = middleware(new NextRequest('https://security.test/student', {
      headers: { 'x-vercel-forwarded-for': '113.37.16.194' },
    }));
    assert.equal(allowed.headers.get('x-middleware-next'), '1');
  } finally {
    if (oldMode === undefined) delete process.env.SECURITY_DIAGNOSIS_MODE;
    else process.env.SECURITY_DIAGNOSIS_MODE = oldMode;
    if (oldAllowedIps === undefined) delete process.env.ALLOWED_IPS;
    else process.env.ALLOWED_IPS = oldAllowedIps;
  }
});

test('通常本番は変動IPでもteacher画面を通し、認証と役割で制御する', () => {
  const teacherPf = middleware(new NextRequest('https://security.test/teacher/pf', {
    headers: { 'x-forwarded-for': '203.0.113.10' },
  }));
  const allowed = middleware(new NextRequest('https://security.test/teacher/attendance', {
    headers: { 'x-forwarded-for': '203.0.113.10' },
  }));
  assert.equal(teacherPf.headers.get('x-middleware-next'), '1');
  assert.equal(allowed.headers.get('x-middleware-next'), '1');
});

test('セキュリティ用環境変数は架空プロジェクトだけを参照する', () => {
  const env = fs.readFileSync('.env.security.example', 'utf8');
  assert.match(env, /demo-classbase-security/);
  assert.doesNotMatch(env, /class-base-app/);
  assert.doesNotMatch(env, /FIREBASE_PRIVATE_KEY/);
  assert.doesNotMatch(env, /FIREBASE_CLIENT_EMAIL/);
  assert.match(env, /SECURITY_DIAGNOSIS_MODE=true/);
  assert.match(env, /113\.37\.16\.194/);
  assert.match(env, /124\.33\.127\.18/);
});

test('API共通認証はトークン欠落を401へ変換する', () => {
  const source = fs.readFileSync('lib/server-auth.ts', 'utf8');
  assert.match(source, /if \(!token\)\s*\{\s*throw new Error\('missing-token'\)/);
  assert.match(source, /message === 'missing-token' \|\|/);
  assert.match(source, /authenticationExpired \? 401/);
});
