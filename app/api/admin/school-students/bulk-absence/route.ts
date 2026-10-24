import { NextRequest } from 'next/server';
import { FieldValue } from 'firebase-admin/firestore';
import { adminDb } from '@/lib/firebase-admin';
import { canManageSchool, getServerUser, isAdminLike, jsonError } from '@/lib/server-auth';
import { writeLearningEvent } from '@/lib/events';
import { jstDateKey } from '@/lib/date-key';

export const runtime = 'nodejs';

export async function POST(request: NextRequest) {
  try {
    const actor = await getServerUser(request);
    if (!isAdminLike(actor)) throw new Error('forbidden');
    const body = await request.json();
    const school = String(body.school_id || body.school || actor.school_ids[0] || actor.school || '').trim();
    const middleSchool = String(body.middle_school || '').trim();
    const targetDate = String(body.target_date || jstDateKey()).slice(0, 10);
    // 画面で表示していた生徒だけ（指定がなければ従来どおり中学校で絞った全員）。
    const requestedIds = new Set((Array.isArray(body.student_ids) ? body.student_ids : []).map((id: unknown) => String(id).trim()).filter(Boolean));
    const reason = String(body.reason || `${middleSchool} 一括欠席登録`).slice(0, 500);

    if (!school) return Response.json({ ok: false, error: 'school is required' }, { status: 400 });
    if (!middleSchool) return Response.json({ ok: false, error: 'middle_school is required' }, { status: 400 });
    if (!canManageSchool(actor, school)) throw new Error('forbidden');

    const db = adminDb();
    const studentSnap = await db.collection('users')
      .where('role', '==', 'student')
      .where('school_id', '==', school)
      .where('middle_school', '==', middleSchool)
      .limit(500)
      .get();

    const INACTIVE = ['suspended', 'withdrawn', 'archived', 'cancelled', 'inactive'];
    const targets = studentSnap.docs.filter(doc => {
      const data = doc.data() || {};
      if (requestedIds.size && !requestedIds.has(doc.id)) return false;
      return !INACTIVE.includes(String(data.account_status || data.status || ''));
    });
    // すでに出席・欠席の記録がある生徒は上書きしない（出席を欠席にしてしまわないため）。
    const existing = targets.length
      ? await db.getAll(...targets.map(doc => db.collection('attendance').doc(`${doc.id}_${targetDate}`)))
      : [];
    const existingIds = new Set(existing.filter(snap => snap.exists).map(snap => snap.id));
    const toWrite = targets.filter(doc => !existingIds.has(`${doc.id}_${targetDate}`));
    const batch = db.batch();
    toWrite.forEach(doc => {
      const data = doc.data() || {};
      const ref = db.collection('attendance').doc(`${doc.id}_${targetDate}`);
      batch.set(ref, {
        user_id: doc.id,
        student_id: doc.id,
        student_name: data.student_name || data.name || '',
        target_date: targetDate,
        attendance_status: '欠',
        type: 'absent',
        reason,
        middle_school: middleSchool,
        registered_by: actor.uid,
        contacted_by: 'admin_bulk_middle_school',
        updated_at: FieldValue.serverTimestamp(),
        created_at: FieldValue.serverTimestamp(),
      }, { merge: true });
    });
    await batch.commit();

    const eventId = await writeLearningEvent({
      actor_id: actor.uid,
      actor_role: actor.role,
      type: 'bulk_absence_by_middle_school',
      target_type: 'attendance',
      school,
      metadata: { middle_school: middleSchool, target_date: targetDate, count: toWrite.length, skipped: targets.length - toWrite.length },
    });

    return Response.json({ ok: true, count: toWrite.length, skipped: targets.length - toWrite.length, event_id: eventId });
  } catch (error) {
    return jsonError(error);
  }
}
