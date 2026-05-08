import { NextRequest } from 'next/server';
import { FieldValue } from 'firebase-admin/firestore';
import { adminDb } from '@/lib/firebase-admin';
import { getServerUser, jsonError, requireRole } from '@/lib/server-auth';

export const runtime = 'nodejs';

export async function POST(request: NextRequest) {
  try {
    const user = await getServerUser(request);
    requireRole(user, ['student']);

    const body = await request.json();
    const message = String(body.message || '').trim().slice(0, 2000);
    if (!message) return Response.json({ ok: false, error: 'message is required' }, { status: 400 });

    const ref = await adminDb().collection('chat_logs').add({
      uid: user.uid,
      student_name: user.profile.student_name || user.profile.name || user.email || '生徒',
      role: 'user',
      message,
      read: false,
      created_at: FieldValue.serverTimestamp(),
      createdAt: FieldValue.serverTimestamp(),
      source: 'student_teacher_chat',
    });

    return Response.json({ ok: true, id: ref.id });
  } catch (error) {
    return jsonError(error);
  }
}
