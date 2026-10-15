import { NextRequest } from 'next/server';
import { adminDb } from '@/lib/firebase-admin';
import { getServerUser, jsonError, requireRole } from '@/lib/server-auth';
import { getAllQueryDocuments } from '@/lib/server/firestore-pagination';

export const runtime = 'nodejs';

const cleanList = (value: unknown) => Array.isArray(value)
  ? value.map(item => String(item || '').trim()).filter(Boolean)
  : [];

const serialize = (snapshot: FirebaseFirestore.DocumentSnapshot) => ({
  id: snapshot.id,
  ...(snapshot.data() || {}),
});

const isAssignedToStudent = (assignment: any, grade: string, subjects: string[]) => {
  if (assignment.archived === true || assignment.status === 'archived') return false;
  if (!grade || String(assignment.target_grade || '').trim() !== grade) return false;
  const subject = String(assignment.subject || '').trim();
  return !subject || subjects.length === 0 || subjects.includes(subject);
};

export async function GET(request: NextRequest) {
  try {
    const user = await getServerUser(request);
    requireRole(user, ['student']);
    const params = Object.fromEntries(request.nextUrl.searchParams.entries());

    const grade = String(user.profile.grade || '').trim();
    const subjects = cleanList(user.profile.subjects);
    if (!grade) return Response.json({ ok: true, assignments: [] });

    const db = adminDb();
    const id = String(params.id || '').trim();
    if (id) {
      const [snapshot] = await db.getAll(db.collection('homework_assignments').doc(id));
      if (!snapshot?.exists || !isAssignedToStudent(snapshot.data(), grade, subjects)) {
        return Response.json({ ok: false, error: 'not found' }, { status: 404 });
      }
      return Response.json({ ok: true, assignment: serialize(snapshot) });
    }

    const start = String(params.start || '').trim();
    const end = String(params.end || '').trim();
    const max = Math.min(Math.max(Number(params.limit || 200) || 200, 1), 300);
    if ((start && !/^\d{4}-\d{2}-\d{2}$/.test(start)) || (end && !/^\d{4}-\d{2}-\d{2}$/.test(end))) {
      return Response.json({ ok: false, error: 'invalid date range' }, { status: 400 });
    }

    let query: FirebaseFirestore.Query = db.collection('homework_assignments')
      .where('target_grade', '==', grade);
    if (start) query = query.where('deadline', '>=', start);
    if (end) query = query.where('deadline', '<=', end);
    query = query.orderBy('deadline', start ? 'asc' : 'desc');

    const documents = await getAllQueryDocuments(query, Math.min(max, 300));
    const assignments = documents
      .map(serialize)
      .filter(item => isAssignedToStudent(item, grade, subjects))
      .slice(0, max);
    return Response.json({ ok: true, assignments });
  } catch (error) {
    return jsonError(error);
  }
}
