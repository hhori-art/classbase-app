import { NextRequest } from 'next/server';
import { FieldValue } from 'firebase-admin/firestore';
import { adminDb } from '@/lib/firebase-admin';
import { canManageSchool, getServerUser, isAdminLike, jsonError } from '@/lib/server-auth';
import { writeLearningEvent } from '@/lib/events';

export const runtime = 'nodejs';

export async function POST(request: NextRequest) {
  try {
    const actor = await getServerUser(request);
    if (!isAdminLike(actor)) throw new Error('forbidden');
    const body = await request.json();
    const school = String(body.school_id || body.school || actor.school_ids[0] || actor.school || '').trim();
    const title = String(body.title || '').trim();
    const middleSchool = String(body.middle_school || '').trim();
    const eventDate = String(body.event_date || '').slice(0, 10);
    const targetStudentIds: string[] = Array.isArray(body.target_student_ids) ? body.target_student_ids.map(String).filter(Boolean) : [];
    const message = String(body.message || `${title}を登録しました。`).slice(0, 1000);

    if (!school) return Response.json({ ok: false, error: 'school is required' }, { status: 400 });
    if (!title) return Response.json({ ok: false, error: 'title is required' }, { status: 400 });
    if (!canManageSchool(actor, school)) throw new Error('forbidden');

    const db = adminDb();
    let studentIds: string[] = targetStudentIds;
    if (studentIds.length === 0 && middleSchool) {
      const snap = await db.collection('users')
        .where('role', '==', 'student')
        .where('school_id', '==', school)
        .where('middle_school', '==', middleSchool)
        .limit(500)
        .get();
      studentIds = snap.docs.map(doc => doc.id);
    }
    if (studentIds.length === 0) return Response.json({ ok: false, error: 'target students not found' }, { status: 400 });

    const eventRef = db.collection('test_prep_events').doc();
    const batch = db.batch();
    batch.set(eventRef, {
      id: eventRef.id,
      school_id: school,
      school,
      title,
      middle_school: middleSchool || null,
      event_date: eventDate || null,
      description: String(body.description || '').slice(0, 2000),
      target_student_ids: studentIds,
      created_by: actor.uid,
      created_at: FieldValue.serverTimestamp(),
      updated_at: FieldValue.serverTimestamp(),
    });

    studentIds.forEach(studentId => {
      const notificationRef = db.collection('user_notifications').doc();
      batch.set(notificationRef, {
        user_id: studentId,
        role: 'student',
        title: 'テスト対策講座のお知らせ',
        message,
        kind: 'test_prep',
        test_prep_event_id: eventRef.id,
        read: false,
        created_at: FieldValue.serverTimestamp(),
      });
    });
    await batch.commit();

    const eventId = await writeLearningEvent({
      actor_id: actor.uid,
      actor_role: actor.role,
      type: 'test_prep_event_created',
      target_id: eventRef.id,
      target_type: 'test_prep_event',
      school,
      metadata: { target_count: studentIds.length, middle_school: middleSchool, event_date: eventDate },
    });

    return Response.json({ ok: true, id: eventRef.id, target_count: studentIds.length, event_id: eventId });
  } catch (error) {
    return jsonError(error);
  }
}

export async function GET(request: NextRequest) {
  try {
    const actor = await getServerUser(request);
    if (!isAdminLike(actor)) throw new Error('forbidden');
    const school = String(request.nextUrl.searchParams.get('school') || actor.school_ids[0] || actor.school || '').trim();
    if (!canManageSchool(actor, school)) throw new Error('forbidden');
    const snap = await adminDb().collection('test_prep_events').where('school_id', '==', school).limit(50).get();
    const events = snap.docs
      .map(doc => ({ id: doc.id, ...doc.data() }))
      .sort((a: any, b: any) => String(b.created_at || '').localeCompare(String(a.created_at || '')));
    return Response.json({ ok: true, events });
  } catch (error) {
    return jsonError(error);
  }
}
