import { NextRequest } from 'next/server';
import { FieldValue } from 'firebase-admin/firestore';
import { adminDb } from '@/lib/firebase-admin';
import { getServerUser, isAdminLike, jsonError } from '@/lib/server-auth';
import { normalizeAttendanceName } from '@/lib/attendance-diagnostics';

export const runtime = 'nodejs';

export async function POST(request: NextRequest) {
  try {
    const user = await getServerUser(request);
    if (!isAdminLike(user)) throw new Error('forbidden');

    const body = await request.json();
    const targetDate = String(body.target_date || '').trim();
    const startDate = String(body.start_date || targetDate || '').trim();
    const endDate = String(body.end_date || targetDate || '').trim();
    if (!startDate || !endDate) {
      return Response.json({ ok: false, error: 'target_date or date range is required' }, { status: 400 });
    }

    const db = adminDb();
    const teacherSnap = await db.collection('users').where('role', '==', 'teacher').get();
    const teacherMap = new Map<string, { id: string; name: string }>();
    teacherSnap.docs.forEach(doc => {
      const data = doc.data();
      const name = String(data.name || data.student_name || data.display_name || data.teacher_name || '').trim();
      const normalized = normalizeAttendanceName(name);
      if (normalized && !teacherMap.has(normalized)) teacherMap.set(normalized, { id: doc.id, name });
    });

    const shiftSnap = await db.collection('shift_assignments')
      .where('target_date', '>=', startDate)
      .where('target_date', '<=', endDate)
      .limit(1000)
      .get();

    let updated = 0;
    let alreadyLinked = 0;
    let unresolved = 0;
    let batch = db.batch();
    let batchCount = 0;

    const commit = async () => {
      if (!batchCount) return;
      await batch.commit();
      batch = db.batch();
      batchCount = 0;
    };

    for (const doc of shiftSnap.docs) {
      const data = doc.data();
      const teacherName = String(data.teacher_name || '').trim();
      const normalized = normalizeAttendanceName(teacherName);
      const teacher = normalized ? teacherMap.get(normalized) : null;
      if (!teacher) {
        unresolved++;
        continue;
      }
      if (data.user_id === teacher.id && data.teacher_name === teacher.name) {
        alreadyLinked++;
        continue;
      }
      batch.set(doc.ref, {
        user_id: teacher.id,
        teacher_name: teacher.name,
        relinked_by: user.uid,
        relinked_at: FieldValue.serverTimestamp(),
        updated_at: FieldValue.serverTimestamp(),
      }, { merge: true });
      updated++;
      batchCount++;
      if (batchCount >= 400) await commit();
    }
    await commit();

    return Response.json({
      ok: true,
      scanned: shiftSnap.size,
      updated,
      already_linked: alreadyLinked,
      unresolved,
      start_date: startDate,
      end_date: endDate,
    });
  } catch (error) {
    return jsonError(error);
  }
}
