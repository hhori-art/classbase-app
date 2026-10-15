import { NextRequest } from 'next/server';
import { adminDb } from '@/lib/firebase-admin';
import { getServerUser, jsonError, requireRole } from '@/lib/server-auth';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';
const clean = (value: unknown) => String(value || '').normalize('NFKC').trim();

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
    const targets = requestedId ? students.filter(student => student.id === requestedId) : students;
    const limitPerStudent = requestedId ? 20 : 5;
    const histories = await Promise.all(targets.map(async student => {
      const snap = await db.collection('users').doc(student.id).collection('chat_history').orderBy('createdAt', 'desc').limit(limitPerStudent).get();
      return snap.docs.map(doc => ({ id: `${student.id}_${doc.id}`, student_id: student.id, student_name: student.student_name, role: doc.data().role === 'assistant' ? 'assistant' : 'user', content: String(doc.data().content || '').slice(0, 8000), created_at_ms: doc.data().createdAt?.toMillis?.() || 0 }));
    }));
    return Response.json({ ok: true, students, messages: histories.flat().sort((a, b) => b.created_at_ms - a.created_at_ms) }, { headers: { 'Cache-Control': 'private, no-store' } });
  } catch (error) { return jsonError(error); }
}
