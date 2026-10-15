import { NextRequest } from 'next/server';
import { adminAuth, adminDb } from '@/lib/firebase-admin';
import { repairUserProfileForAuth } from '@/lib/account-repair';
import { normalizeRole } from '@/lib/server-auth';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

const PRIVATE_FIELDS = new Set([
  'initial_password', 'raw_password', 'parent_initial_password',
  'password', 'password_hash', 'temporary_password',
  'line_user_id', 'lineUserId', 'reset_token', 'verification_token',
]);

const safeProfile = (uid: string, data: Record<string, unknown>) => Object.fromEntries(
  Object.entries({ ...data, uid, role: normalizeRole(data.role) })
    .filter(([key]) => !PRIVATE_FIELDS.has(key)),
);

export async function GET(request: NextRequest) {
  try {
    const authHeader = request.headers.get('authorization') || '';
    const token = authHeader.startsWith('Bearer ') ? authHeader.slice(7) : '';
    if (!token) return Response.json({ ok: false, error: 'missing-token' }, { status: 401 });
    const decoded = await adminAuth().verifyIdToken(token, true);
    const db = adminDb();
    const ref = db.collection('users').doc(decoded.uid);
    let snapshot = await ref.get();
    if (!snapshot.exists) {
      const repaired = await repairUserProfileForAuth(decoded.uid, decoded.email || null);
      if (!repaired.ok) return Response.json({ ok: false, error: 'profile-not-found' }, { status: 404 });
      snapshot = await ref.get();
    }
    if (!snapshot.exists) return Response.json({ ok: false, error: 'profile-not-found' }, { status: 404 });
    const data = snapshot.data() || {};
    if (['suspended', 'withdrawn', 'archived'].includes(String(data.account_status || data.status || '').toLowerCase())) {
      return Response.json({ ok: false, error: 'account-inactive' }, { status: 403 });
    }
    return Response.json({ ok: true, profile: safeProfile(decoded.uid, data) }, {
      headers: { 'Cache-Control': 'private, no-store' },
    });
  } catch (error: any) {
    const code = String(error?.code || '');
    const status = ['auth/id-token-revoked', 'auth/id-token-expired', 'auth/user-disabled', 'auth/argument-error'].includes(code) ? 401 : 503;
    console.error('[auth-profile] failed:', code || String(error?.message || 'unknown').slice(0, 120));
    return Response.json({ ok: false, error: status === 401 ? 'session-expired' : 'profile-service-unavailable' }, { status });
  }
}
