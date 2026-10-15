import { NextRequest } from 'next/server';
import { FieldValue } from 'firebase-admin/firestore';
import { adminDb } from '@/lib/firebase-admin';
import { getServerUser, jsonError, requireRole } from '@/lib/server-auth';
import { consumeRateLimit } from '@/lib/server/password-recovery';
import { loadStudentAiChatHistory } from '@/lib/server/student-ai-chat';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';
const STAMPS = new Set(['ありがとう', 'わかった', '質問です', '復習します']);

export async function GET(request: NextRequest) {
  try {
    const actor = await getServerUser(request); requireRole(actor, ['student']);
    const messages = (await loadStudentAiChatHistory(actor.uid, 100)).reverse();
    return Response.json({ ok: true, messages }, { headers: { 'Cache-Control': 'private, no-store' } });
  } catch (error) { return jsonError(error); }
}

export async function POST(request: NextRequest) {
  try {
    const actor = await getServerUser(request); requireRole(actor, ['student']);
    const body = await request.json();
    if (body.action !== 'stamp' || !STAMPS.has(String(body.stamp || ''))) return Response.json({ ok: false, error: 'invalid-stamp' }, { status: 400 });
    if (!(await consumeRateLimit(`chat_stamp_${actor.uid}`, 20, 60_000))) return Response.json({ ok: false, error: 'rate-limit' }, { status: 429 });
    const content = `[スタンプ] ${body.stamp}`;
    const ref = await adminDb().collection('users').doc(actor.uid).collection('chat_history').add({ role: 'user', content, message_type: 'stamp', createdAt: FieldValue.serverTimestamp() });
    return Response.json({ ok: true, message: { id: ref.id, role: 'user', content } });
  } catch (error) { return jsonError(error); }
}
