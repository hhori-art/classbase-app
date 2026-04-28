import { NextRequest } from 'next/server';
import { FieldValue } from 'firebase-admin/firestore';
import { adminDb } from '@/lib/firebase-admin';
import { getServerUser, isAdminLike, jsonError } from '@/lib/server-auth';
import { writeLearningEvent } from '@/lib/events';

export const runtime = 'nodejs';

export async function POST(request: NextRequest) {
  try {
    const user = await getServerUser(request);
    if (!isAdminLike(user)) throw new Error('forbidden');

    const body = await request.json();
    const action = String(body.action || 'create');
    const db = adminDb();

    if (action === 'delete') {
      const scheduleId = String(body.schedule_id || '');
      if (!scheduleId) return Response.json({ ok: false, error: 'schedule_id is required' }, { status: 400 });
      const scheduleSnap = await db.collection('monthly_schedules').doc(scheduleId).get();
      if (!scheduleSnap.exists) return Response.json({ ok: false, error: 'schedule not found' }, { status: 404 });
      const schedule = scheduleSnap.data() || {};
      const scheduleSchool = schedule.school_id || schedule.school || null;
      if (user.role !== 'master') {
        if (!scheduleSchool || !user.school_ids.includes(String(scheduleSchool))) throw new Error('forbidden');
      }
      await db.collection('monthly_schedules').doc(scheduleId).set({
        archived: true,
        archived_at: FieldValue.serverTimestamp(),
        archived_by: user.uid,
      }, { merge: true });
      const eventId = await writeLearningEvent({
        actor_id: user.uid,
        actor_role: user.role,
        type: 'monthly_schedule_archived',
        target_id: scheduleId,
        target_type: 'monthly_schedule',
        school: user.school,
      });
      return Response.json({ ok: true, event_id: eventId });
    }

    const title = String(body.title || '').trim();
    const startDate = String(body.start_date || body.target_date || '').trim();
    const endDate = String(body.end_date || body.target_date || startDate).trim();
    if (!title) return Response.json({ ok: false, error: 'title is required' }, { status: 400 });
    if (!/^\d{4}-\d{2}-\d{2}$/.test(startDate)) return Response.json({ ok: false, error: 'start_date must be YYYY-MM-DD' }, { status: 400 });
    if (!/^\d{4}-\d{2}-\d{2}$/.test(endDate)) return Response.json({ ok: false, error: 'end_date must be YYYY-MM-DD' }, { status: 400 });
    if (endDate < startDate) return Response.json({ ok: false, error: 'end_date must be after start_date' }, { status: 400 });

    let schoolId = String(body.school_id || body.school || '').trim() || null;
    if (user.role !== 'master') {
      const managedSchool = user.school_ids[0] || user.school || '';
      if (!managedSchool) throw new Error('forbidden');
      if (schoolId && schoolId !== managedSchool) throw new Error('forbidden');
      schoolId = managedSchool;
    }
    const grades = Array.isArray(body.grades)
      ? body.grades.map((item: unknown) => String(item).trim()).filter(Boolean)
      : String(body.grades || '').split(',').map(v => v.trim()).filter(Boolean);

    if (action === 'update') {
      const scheduleId = String(body.schedule_id || '');
      if (!scheduleId) return Response.json({ ok: false, error: 'schedule_id is required' }, { status: 400 });
      const scheduleRef = db.collection('monthly_schedules').doc(scheduleId);
      const scheduleSnap = await scheduleRef.get();
      if (!scheduleSnap.exists) return Response.json({ ok: false, error: 'schedule not found' }, { status: 404 });
      const schedule = scheduleSnap.data() || {};
      const currentSchool = schedule.school_id || schedule.school || null;
      if (user.role !== 'master' && (!currentSchool || !user.school_ids.includes(String(currentSchool)))) throw new Error('forbidden');
      await scheduleRef.set({
        title,
        target_date: startDate,
        start_date: startDate,
        end_date: endDate,
        description: String(body.description || '').slice(0, 1000),
        category: String(body.category || 'general'),
        audience: String(body.audience || 'all'),
        school_id: schoolId,
        grades,
        archived: false,
        updated_at: FieldValue.serverTimestamp(),
        updated_by: user.uid,
      }, { merge: true });
      const eventId = await writeLearningEvent({
        actor_id: user.uid,
        actor_role: user.role,
        type: 'monthly_schedule_updated',
        target_id: scheduleId,
        target_type: 'monthly_schedule',
        school: schoolId || user.school,
        metadata: { start_date: startDate, end_date: endDate, category: body.category || 'general', audience: body.audience || 'all' },
      });
      return Response.json({ ok: true, schedule_id: scheduleId, event_id: eventId });
    }

    const ref = await db.collection('monthly_schedules').add({
      title,
      target_date: startDate,
      start_date: startDate,
      end_date: endDate,
      description: String(body.description || '').slice(0, 1000),
      category: String(body.category || 'general'),
      audience: String(body.audience || 'all'),
      school_id: schoolId,
      grades,
      archived: false,
      created_by: user.uid,
      created_by_role: user.role,
      created_at: FieldValue.serverTimestamp(),
      updated_at: FieldValue.serverTimestamp(),
    });

    const eventId = await writeLearningEvent({
      actor_id: user.uid,
      actor_role: user.role,
      type: 'monthly_schedule_created',
      target_id: ref.id,
      target_type: 'monthly_schedule',
      school: schoolId || user.school,
      metadata: { start_date: startDate, end_date: endDate, category: body.category || 'general', audience: body.audience || 'all' },
    });

    return Response.json({ ok: true, schedule_id: ref.id, event_id: eventId });
  } catch (error) {
    return jsonError(error);
  }
}
