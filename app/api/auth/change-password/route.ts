import { NextRequest } from 'next/server';
import { FieldValue } from 'firebase-admin/firestore';
import { adminAuth, adminDb } from '@/lib/firebase-admin';
import { getServerUser, jsonError } from '@/lib/server-auth';
import { minPasswordLength } from '@/lib/password-policy';

export const runtime = 'nodejs';

export async function POST(request: NextRequest) {
  try {
    const user = await getServerUser(request);
    const body = await request.json();
    const password = String(body.password || '');

    if (password.length < minPasswordLength(user.profile.role) || password.length > 128) {
      return Response.json({ ok: false, error: 'password-length' }, { status: 400 });
    }

    await adminAuth().updateUser(user.uid, { password });
    await adminAuth().revokeRefreshTokens(user.uid);
    await adminDb().collection('users').doc(user.uid).set({
      initial_password: FieldValue.delete(),
      raw_password: FieldValue.delete(),
        password: FieldValue.delete(),
      isFirstLogin: false,
      password_changed_at: FieldValue.serverTimestamp(),
      updated_at: FieldValue.serverTimestamp(),
    }, { merge: true });

    return Response.json({ ok: true });
  } catch (error) {
    return jsonError(error);
  }
}
