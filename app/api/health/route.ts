import crypto from 'node:crypto';
import { adminDb } from '@/lib/firebase-admin';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

const timeout = async <T,>(promise: Promise<T>, milliseconds: number) => {
  let timer: ReturnType<typeof setTimeout> | undefined;
  try {
    return await Promise.race([
      promise,
      new Promise<never>((_, reject) => { timer = setTimeout(() => reject(new Error('health-check-timeout')), milliseconds); }),
    ]);
  } finally {
    if (timer) clearTimeout(timer);
  }
};

const sameSecret = (actual: string, expected: string) => {
  const left = Buffer.from(actual);
  const right = Buffer.from(expected);
  return left.length === right.length && crypto.timingSafeEqual(left, right);
};

export async function GET(request: Request) {
  const startedAt = Date.now();
  const headers = { 'Cache-Control': 'no-store, max-age=0' };
  const expectedSecret = String(process.env.OPS_HEALTH_SECRET || '').trim();
  const suppliedSecret = (request.headers.get('authorization') || '').replace(/^Bearer\s+/i, '').trim();
  const deepRequested = new URL(request.url).searchParams.get('deep') === '1';

  if (!deepRequested) {
    return Response.json({ ok: true, status: 'ok', check: 'liveness', timestamp: new Date().toISOString() }, { headers });
  }
  if (!expectedSecret || !sameSecret(suppliedSecret, expectedSecret)) {
    return Response.json({ ok: false, status: 'unauthorized' }, { status: 401, headers });
  }

  try {
    await timeout(adminDb().collection('system_health').limit(1).get(), 4_000);
    return Response.json({
      ok: true,
      status: 'ok',
      check: 'readiness',
      dependencies: { firestore: 'ok' },
      duration_ms: Date.now() - startedAt,
      timestamp: new Date().toISOString(),
    }, { headers });
  } catch (error) {
    console.error('Readiness health check failed', error instanceof Error ? error.message : 'unknown');
    return Response.json({
      ok: false,
      status: 'down',
      check: 'readiness',
      dependencies: { firestore: 'down' },
      duration_ms: Date.now() - startedAt,
      timestamp: new Date().toISOString(),
    }, { status: 503, headers });
  }
}
