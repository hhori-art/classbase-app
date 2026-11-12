import { NextRequest } from 'next/server';
import { FieldValue } from 'firebase-admin/firestore';
import { adminAuth, adminDb } from '@/lib/firebase-admin';
import { jsonError } from '@/lib/api-error';

export const runtime = 'nodejs';

const parseBootstrapEmails = () =>
  String(process.env.ADMIN_BOOTSTRAP_EMAILS || '')
    .split(',')
    .map(email => email.trim().toLowerCase())
    .filter(Boolean);

const isBootstrapAllowedEmail = (email?: string) => {
  const normalized = String(email || '').trim().toLowerCase();
  if (!normalized) return false;
  const explicitEmails = parseBootstrapEmails();
  return explicitEmails.includes(normalized);
};

export async function POST(request: NextRequest) {
  try {
    const authHeader = request.headers.get('authorization') || '';
    const token = authHeader.startsWith('Bearer ') ? authHeader.slice(7) : '';
    if (!token) return Response.json({ ok: false, error: 'missing-token' }, { status: 401 });

    const decoded = await adminAuth().verifyIdToken(token, true);
    if (decoded.email_verified !== true || !isBootstrapAllowedEmail(decoded.email)) {
      return Response.json({ ok: false, error: 'bootstrap-not-allowed' }, { status: 403 });
    }

    const db = adminDb();
    const userRef = db.collection('users').doc(decoded.uid);
    const userSnap = await userRef.get();

    if (userSnap.exists) {
      return Response.json({ ok: true, exists: true, role: userSnap.data()?.role || null });
    }

    await userRef.create({
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
    });

    return Response.json({ ok: true, exists: false, role: 'master' });
  } catch (error) {
    // Firebase のエラー文は見せず、受付番号だけ返す（中身はログ）。
    return jsonError(error);
  }
}
