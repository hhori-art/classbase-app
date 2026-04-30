import { NextRequest } from 'next/server';
import { FieldValue } from 'firebase-admin/firestore';
import { adminAuth, adminDb } from '@/lib/firebase-admin';

export const runtime = 'nodejs';

const ADMIN_EMAIL_DOMAIN = 'sozogakuen.co.jp';

const parseBootstrapEmails = () =>
  String(process.env.ADMIN_BOOTSTRAP_EMAILS || '')
    .split(',')
    .map(email => email.trim().toLowerCase())
    .filter(Boolean);

const isBootstrapAllowedEmail = (email?: string) => {
  const normalized = String(email || '').trim().toLowerCase();
  if (!normalized) return false;
  const explicitEmails = parseBootstrapEmails();
  return explicitEmails.includes(normalized) || normalized.endsWith(`@${ADMIN_EMAIL_DOMAIN}`);
};

export async function POST(request: NextRequest) {
  try {
    const authHeader = request.headers.get('authorization') || '';
    const token = authHeader.startsWith('Bearer ') ? authHeader.slice(7) : '';
    if (!token) return Response.json({ ok: false, error: 'missing-token' }, { status: 401 });

    const decoded = await adminAuth().verifyIdToken(token);
    if (!isBootstrapAllowedEmail(decoded.email)) {
      return Response.json({ ok: false, error: 'bootstrap-not-allowed' }, { status: 403 });
    }

    const db = adminDb();
    const userRef = db.collection('users').doc(decoded.uid);
    const userSnap = await userRef.get();

    if (userSnap.exists) {
      return Response.json({ ok: true, exists: true, role: userSnap.data()?.role || null });
    }

    await userRef.set({
      uid: decoded.uid,
      id: decoded.uid,
      email: decoded.email || null,
      name: decoded.name || decoded.email || '管理者(自動修復)',
      student_name: null,
      role: 'master',
      account_status: 'active',
      status: 'active',
      created_at: FieldValue.serverTimestamp(),
      updated_at: FieldValue.serverTimestamp(),
      bootstrap_source: 'admin_login',
    }, { merge: true });

    return Response.json({ ok: true, exists: false, role: 'master' });
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error);
    return Response.json({ ok: false, error: message }, { status: 400 });
  }
}
