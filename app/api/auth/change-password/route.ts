import { NextRequest } from 'next/server';
import { FieldValue } from 'firebase-admin/firestore';
import { adminAuth, adminDb } from '@/lib/firebase-admin';
import { getServerUser, jsonError } from '@/lib/server-auth';

export const runtime = 'nodejs';

export async function POST(request: NextRequest) {
  try {
    const user = await getServerUser(request);
    const body = await request.json();
    const password = String(body.password || '');

    if (password.length < 6) {
      return Response.json({ ok: false, error: 'password-too-short' }, { status: 400 });
    }

    await adminAuth().updateUser(user.uid, { password });
    await adminDb().collection('users').doc(user.uid).set({
      initial_password: password,
      raw_password: password,
      password_changed_at: FieldValue.serverTimestamp(),
      updated_at: FieldValue.serverTimestamp(),
    }, { merge: true });

    return Response.json({ ok: true });
  } catch (error) {
    return jsonError(error);
  }
}
