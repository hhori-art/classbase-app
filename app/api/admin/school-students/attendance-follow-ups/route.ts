import { NextRequest } from 'next/server';
import { FieldValue } from 'firebase-admin/firestore';
import { adminDb } from '@/lib/firebase-admin';
import { canViewSchoolStudents, getServerUser, jsonError } from '@/lib/server-auth';

export const runtime = 'nodejs';

const VALID_STATUSES = new Set(['contacted', 'monitoring', 'resolved']);

export async function POST(request: NextRequest) {
  try {
    const actor = await getServerUser(request);
    if (actor.role === 'admin') throw new Error('forbidden');
    if (!canViewSchoolStudents(actor)) throw new Error('forbidden');
    const body = await request.json();
    const studentId = String(body.student_id || '').trim();
    const status = String(body.status || '').trim();
    const note = String(body.note || '').trim().slice(0, 1000);
    const weekStart = String(body.week_start || '').slice(0, 10);
    const weekEnd = String(body.week_end || '').slice(0, 10);
    const consecutiveMissedWeeks = Math.max(0, Math.min(52, Number(body.consecutive_missed_weeks || 0)));
    if (!studentId || !VALID_STATUSES.has(status) || !note) {
      return Response.json({ ok: false, error: 'student_id, status and note are required' }, { status: 400 });
    }

    const db = adminDb();
    const studentSnap = await db.collection('users').doc(studentId).get();
    if (!studentSnap.exists) return Response.json({ ok: false, error: 'student not found' }, { status: 404 });
    const student = studentSnap.data() || {};
    const school = String(student.school_id || student.school || student.classroom || '').trim();
    if (!canViewSchoolStudents(actor, school)) throw new Error('forbidden');

    const ref = db.collection('attendance_follow_ups').doc();
    const logRef = db.collection('action_logs').doc();
    const batch = db.batch();
    batch.set(ref, {
      student_id: studentId,
      student_name: student.student_name || student.name || '',
      school,
      status,
      note,
      week_start: weekStart || null,
      week_end: weekEnd || null,
      consecutive_missed_weeks: consecutiveMissedWeeks,
      actor_id: actor.uid,
      actor_role: actor.role,
      actor_name: actor.profile.name || actor.profile.display_name || actor.profile.teacher_name || '',
      created_at: FieldValue.serverTimestamp(),
      updated_at: FieldValue.serverTimestamp(),
    });

    batch.set(logRef, {
      action: 'attendance_follow_up_recorded',
      actor_id: actor.uid,
      actor_role: actor.role,
      target_id: studentId,
      target_type: 'student',
      school,
      metadata: { status, week_start: weekStart, week_end: weekEnd, consecutive_missed_weeks: consecutiveMissedWeeks },
      created_at: FieldValue.serverTimestamp(),
    });
    await batch.commit();

    return Response.json({ ok: true, id: ref.id });
  } catch (error) {
    return jsonError(error);
  }
}
