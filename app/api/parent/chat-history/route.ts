import { NextRequest } from 'next/server';
import { adminDb } from '@/lib/firebase-admin';
import { getServerUser, jsonError, requireRole } from '@/lib/server-auth';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';
const clean = (value: unknown) => String(value || '').normalize('NFKC').trim();
const PAGE_SIZE = 80;

/** 保護者向け：お子さま1人分のAIチャット履歴（新しい順に80件ずつ。before_id で続きを取得）。 */
export async function GET(request: NextRequest) {
  try {
    const actor = await getServerUser(request); requireRole(actor, ['parent']);
    const db = adminDb();
    const linkedIds = new Set((Array.isArray(actor.profile.student_ids) ? actor.profile.student_ids : []).map(clean).filter(Boolean).slice(0, 10));
    const reverse = await db.collection('users').where('parent_uid', '==', actor.uid).limit(10).get();
    reverse.docs.filter(doc => doc.data().role === 'student').forEach(doc => linkedIds.add(doc.id));
    const studentDocs = await Promise.all([...linkedIds].map(id => db.collection('users').doc(id).get()));
    const students = studentDocs.filter(doc => doc.exists && doc.data()?.role === 'student' && (clean(doc.data()?.parent_uid) === actor.uid || (Array.isArray(actor.profile.student_ids) && actor.profile.student_ids.map(clean).includes(doc.id)))).map(doc => ({ id: doc.id, student_name: clean(doc.data()?.student_name || doc.data()?.name) || '生徒', grade: clean(doc.data()?.grade) }));
    const requestedId = clean(request.nextUrl.searchParams.get('student_id'));
    if (requestedId && !students.some(student => student.id === requestedId)) throw new Error('forbidden');
    const target = students.find(student => student.id === requestedId) || students[0];
    if (!target) return Response.json({ ok: true, students, student_id: '', messages: [], has_more: false }, { headers: { 'Cache-Control': 'private, no-store' } });

    const history = db.collection('users').doc(target.id).collection('chat_history');
    const beforeId = clean(request.nextUrl.searchParams.get('before_id')).slice(0, 200);
    let historyQuery = history.orderBy('createdAt', 'desc');
    if (beforeId) {
      const cursor = await history.doc(beforeId).get();
      if (cursor.exists) historyQuery = historyQuery.startAfter(cursor);
    }
    const snap = await historyQuery.limit(PAGE_SIZE).get();
    const messages = snap.docs.map(doc => ({
      id: doc.id,
      request_id: clean(doc.data().request_id) || doc.id.replace(/_(user|assistant)$/, ''),
      role: doc.data().role === 'assistant' ? 'assistant' : 'user',
      message_type: clean(doc.data().message_type),
      content: String(doc.data().content || '').slice(0, 8000),
      created_at_ms: doc.data().createdAt?.toMillis?.() || 0,
    }));
    return Response.json({ ok: true, students, student_id: target.id, messages, has_more: snap.size === PAGE_SIZE }, { headers: { 'Cache-Control': 'private, no-store' } });
  } catch (error) { return jsonError(error); }
}
