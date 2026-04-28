import { NextRequest } from 'next/server';
import { FieldValue } from 'firebase-admin/firestore';
import { adminDb } from '@/lib/firebase-admin';
import { getServerUser, isAdminLike, jsonError, requireRole } from '@/lib/server-auth';
import { writeLearningEvent } from '@/lib/events';

export async function POST(request: NextRequest) {
  try {
    const user = await getServerUser(request);
    const body = await request.json();
    const action = String(body.action || 'request');

    if (action === 'request') {
      requireRole(user, ['teacher']);
      const workRecordId = String(body.work_record_id || '');
      if (!workRecordId) return Response.json({ ok: false, error: 'work_record_id is required' }, { status: 400 });
      const db = adminDb();
      const workRecordSnap = await db.collection('work_records').doc(workRecordId).get();
      if (!workRecordSnap.exists) return Response.json({ ok: false, error: 'work record not found' }, { status: 404 });
      const workRecord = workRecordSnap.data() || {};
      if (workRecord.teacher_id !== user.uid) throw new Error('forbidden');
      if (workRecord.status === 'approved') {
        return Response.json({ ok: false, error: 'approved work records cannot be changed by teacher' }, { status: 400 });
      }

      const correctionRef = await db.collection('attendance_correction_requests').add({
        work_record_id: workRecordId,
        teacher_id: user.uid,
        requested_start_time: body.requested_start_time || null,
        requested_end_time: body.requested_end_time || null,
        reason: String(body.reason || '').slice(0, 500),
        status: 'pending',
        created_at: FieldValue.serverTimestamp(),
      });

      const eventId = await writeLearningEvent({
        actor_id: user.uid,
        actor_role: user.role,
        type: 'attendance_correction_requested',
        target_id: correctionRef.id,
        target_type: 'attendance_correction_request',
        school: user.school,
      });

      return Response.json({ ok: true, request_id: correctionRef.id, event_id: eventId });
    }

    if (!isAdminLike(user)) throw new Error('forbidden');
    const requestId = String(body.request_id || '');
    const status = String(body.status || '');
    if (!requestId || !['approved', 'rejected'].includes(status)) {
      return Response.json({ ok: false, error: 'invalid request_id/status' }, { status: 400 });
    }

    const db = adminDb();
    const correctionRef = db.collection('attendance_correction_requests').doc(requestId);
    const correctionSnap = await correctionRef.get();
    if (!correctionSnap.exists) return Response.json({ ok: false, error: 'request not found' }, { status: 404 });
    const correction = correctionSnap.data() || {};
    const workRecordId = String(correction.work_record_id || correction.workRecordId || correction.record_id || '').trim();
    if (status === 'approved' && !workRecordId) {
      return Response.json({ ok: false, error: 'work_record_id is missing on correction request' }, { status: 400 });
    }

    await correctionRef.set({
      status,
      reviewed_by: user.uid,
      reviewed_at: FieldValue.serverTimestamp(),
    }, { merge: true });

    if (status === 'approved') {
      const update: Record<string, unknown> = {
        updated_at: new Date().toISOString(),
        time_correction_approved_at: FieldValue.serverTimestamp(),
        time_correction_approved_by: user.uid,
      };
      if (correction.requested_start_time) update.start_time = correction.requested_start_time;
      if (correction.requested_end_time) update.end_time = correction.requested_end_time;
      await db.collection('work_records').doc(workRecordId).set(update, { merge: true });
    }

    const eventId = await writeLearningEvent({
      actor_id: user.uid,
      actor_role: user.role,
      type: `attendance_correction_${status}`,
      target_id: requestId,
      target_type: 'attendance_correction_request',
      school: user.school,
    });

    return Response.json({ ok: true, event_id: eventId });
  } catch (error) {
    return jsonError(error);
  }
}
