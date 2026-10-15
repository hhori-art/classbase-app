import { NextRequest } from 'next/server';
import { FieldValue } from 'firebase-admin/firestore';
import { adminDb } from '@/lib/firebase-admin';
import { getServerUser, jsonError, requireRole } from '@/lib/server-auth';
import { consumeRateLimit } from '@/lib/server/password-recovery';
import { loadStudentAiChatHistory } from '@/lib/server/student-ai-chat';

export const runtime = 'nodejs';

export async function GET(request: NextRequest) {
  try {
    const user = await getServerUser(request); requireRole(user, ['student']);
    const snap = await adminDb().collection('chat_logs').where('uid', '==', user.uid).orderBy('created_at', 'desc').limit(100).get();
    const messages = snap.docs.map(doc => ({ id: doc.id, ...doc.data(), created_at_ms: doc.data().created_at?.toMillis?.() || doc.data().createdAt?.toMillis?.() || 0 })).sort((a, b) => a.created_at_ms - b.created_at_ms);
    return Response.json({ ok: true, messages }, { headers: { 'Cache-Control': 'private, no-store' } });
  } catch (error) { return jsonError(error); }
}

export async function POST(request: NextRequest) {
  try {
    const user = await getServerUser(request);
    requireRole(user, ['student']);

    const body = await request.json();
    if (body.action === 'report_ai_chat') {
      if (!(await consumeRateLimit(`student_teacher_report_${user.uid}`, 5, 60_000))) return Response.json({ ok: false, error: 'rate-limit' }, { status: 429 });
      const messages = (await loadStudentAiChatHistory(user.uid, 30)).reverse();
      if (!messages.length) return Response.json({ ok: false, error: '報告できるAI会話履歴がありません' }, { status: 400 });
      const content = messages.map(item => `${item.role === 'assistant' ? 'AI' : '生徒'}: ${item.content.trim().slice(0, 2000)}`).join('\n\n').slice(0, 20_000);
      if (!content) return Response.json({ ok: false, error: 'invalid-messages' }, { status: 400 });
      const db = adminDb();
      const ref = db.collection('chat_logs').doc();
      const batch = db.batch();
      batch.set(ref, {
        uid: user.uid,
        student_name: user.profile.student_name || user.profile.name || '生徒',
        role: 'user',
        message: `【AIチューターとの会話を先生へ報告】\n\n${content}`,
        read: false,
        created_at: FieldValue.serverTimestamp(),
        createdAt: FieldValue.serverTimestamp(),
        source: 'ai_chat_report',
      });
      batch.set(db.collection('users').doc(user.uid), {
        teacher_chat_unread_count: FieldValue.increment(1),
        teacher_inquiry_unread_count: FieldValue.increment(1),
      }, { merge: true });
      await batch.commit();
      return Response.json({ ok: true, id: ref.id });
    }
    const rawMessage = String(body.message || '').trim();
    if (!rawMessage || rawMessage.length > 2000) return Response.json({ ok: false, error: 'message is required' }, { status: 400 });
    if (!(await consumeRateLimit(`student_teacher_chat_${user.uid}`, 20, 60_000))) return Response.json({ ok: false, error: 'rate-limit' }, { status: 429 });
    const message = rawMessage;

    const db = adminDb();
    const ref = db.collection('chat_logs').doc();
    const batch = db.batch();
    batch.set(ref, {
      uid: user.uid,
      student_name: user.profile.student_name || user.profile.name || user.email || '生徒',
      role: 'user',
      message,
      read: false,
      created_at: FieldValue.serverTimestamp(),
      createdAt: FieldValue.serverTimestamp(),
      source: 'student_teacher_chat',
    });
    batch.set(db.collection('users').doc(user.uid), { teacher_chat_unread_count: FieldValue.increment(1) }, { merge: true });
    await batch.commit();

    return Response.json({ ok: true, id: ref.id });
  } catch (error) {
    return jsonError(error);
  }
}
