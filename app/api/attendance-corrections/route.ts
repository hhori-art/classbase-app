import { NextRequest } from 'next/server';
import { FieldValue } from 'firebase-admin/firestore';
import { adminDb } from '@/lib/firebase-admin';
import { getServerUser, isAdminLike, jsonError, requireRole } from '@/lib/server-auth';
import { writeLearningEvent } from '@/lib/events';

const toDateKey = (value?: string | null) => {
  if (!value) return '';
  const date = new Date(value);
  if (Number.isNaN(date.getTime())) return '';
  return date.toISOString().slice(0, 10);
};

const isIsoLikeDate = (value: string) => /^\d{4}-\d{2}-\d{2}$/.test(value);

const ensureValidRange = (startTime?: string | null, endTime?: string | null) => {
  if (!startTime || !endTime) return;
  const start = new Date(startTime);
  const end = new Date(endTime);
  if (Number.isNaN(start.getTime()) || Number.isNaN(end.getTime())) {
    throw new Error('invalid requested time');
  }
  if (start >= end) {
    throw new Error('requested end time must be after start time');
  }
};

export async function POST(request: NextRequest) {
  try {
    const user = await getServerUser(request);
    const body = await request.json();
    const action = String(body.action || 'request');

    if (action === 'request') {
      requireRole(user, ['teacher']);
      const db = adminDb();
      const workRecordId = String(body.work_record_id || '').trim();
      const requestedStartTime = body.requested_start_time || null;
      const requestedEndTime = body.requested_end_time || null;
      const targetDate = String(body.target_date || toDateKey(requestedStartTime) || toDateKey(requestedEndTime) || '').trim();

      if (!requestedStartTime && !requestedEndTime) {
        return Response.json({ ok: false, error: 'requested time is required' }, { status: 400 });
      }
      ensureValidRange(requestedStartTime, requestedEndTime);

      let requestType: 'time_correction' | 'missing_clock' = 'time_correction';
      let teacherName = '';

      if (workRecordId) {
        const workRecordSnap = await db.collection('work_records').doc(workRecordId).get();
        if (!workRecordSnap.exists) return Response.json({ ok: false, error: 'work record not found' }, { status: 404 });
        const workRecord = workRecordSnap.data() || {};
        if (workRecord.teacher_id !== user.uid) throw new Error('forbidden');
        if (workRecord.status === 'approved') {
          return Response.json({ ok: false, error: 'approved work records cannot be changed by teacher' }, { status: 400 });
        }
        if (requestedEndTime && workRecord.start_time) {
          ensureValidRange(String(workRecord.start_time), requestedEndTime);
        }
        if (requestedStartTime && workRecord.end_time) {
          ensureValidRange(requestedStartTime, String(workRecord.end_time));
        }
        teacherName = String(workRecord.teacher_name || teacherName || '');
      } else {
        requestType = 'missing_clock';
        if (!targetDate || !isIsoLikeDate(targetDate)) {
          return Response.json({ ok: false, error: 'target_date is required' }, { status: 400 });
        }
        if (!requestedStartTime || !requestedEndTime) {
          return Response.json({ ok: false, error: 'missing clock request requires start and end time' }, { status: 400 });
        }
        ensureValidRange(requestedStartTime, requestedEndTime);
        const existingSnap = await db.collection('work_records')
          .where('teacher_id', '==', user.uid)
          .where('date', '==', targetDate)
          .limit(1)
          .get();
        if (!existingSnap.empty) {
          return Response.json({ ok: false, error: 'work record already exists for target_date' }, { status: 400 });
        }
        if (!teacherName) {
          const userSnap = await db.collection('users').doc(user.uid).get();
          const userData = userSnap.data() || {};
          teacherName = String(userData.name || userData.student_name || userData.displayName || '未設定の講師');
        }
      }

      const correctionRef = await db.collection('attendance_correction_requests').add({
        work_record_id: workRecordId || null,
        request_type: requestType,
        teacher_id: user.uid,
        teacher_name: teacherName || '未設定の講師',
        target_date: targetDate || null,
        requested_start_time: requestedStartTime,
        requested_end_time: requestedEndTime,
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
    const requestType = String(correction.request_type || '').trim();
    const isMissingClockRequest = requestType === 'missing_clock' || !workRecordId;
    if (status === 'approved' && !workRecordId && !isMissingClockRequest) {
      return Response.json({ ok: false, error: 'work_record_id is missing on correction request' }, { status: 400 });
    }

    await correctionRef.set({
      status,
      reviewed_by: user.uid,
      reviewed_at: FieldValue.serverTimestamp(),
    }, { merge: true });

    if (status === 'approved') {
      if (isMissingClockRequest) {
        const targetDate = String(correction.target_date || toDateKey(correction.requested_start_time) || '').trim();
        if (!targetDate || !isIsoLikeDate(targetDate)) {
          return Response.json({ ok: false, error: 'target_date is missing on correction request' }, { status: 400 });
        }
        if (!correction.requested_start_time && !correction.requested_end_time) {
          return Response.json({ ok: false, error: 'missing clock request requires requested time' }, { status: 400 });
        }
        const createdRef = await db.collection('work_records').add({
          teacher_id: correction.teacher_id,
          teacher_name: correction.teacher_name || '未設定の講師',
          date: targetDate,
          start_time: correction.requested_start_time,
          end_time: correction.requested_end_time || null,
          status: 'pending',
          work_segments: [],
          transportation: [],
          created_from_correction_request_id: requestId,
          time_correction_approved_at: FieldValue.serverTimestamp(),
          time_correction_approved_by: user.uid,
          created_at: new Date().toISOString(),
          updated_at: new Date().toISOString(),
        });
        await correctionRef.set({ work_record_id: createdRef.id }, { merge: true });
      } else {
        const update: Record<string, unknown> = {
          updated_at: new Date().toISOString(),
          time_correction_approved_at: FieldValue.serverTimestamp(),
          time_correction_approved_by: user.uid,
        };
        if (correction.requested_start_time) update.start_time = correction.requested_start_time;
        if (correction.requested_end_time) update.end_time = correction.requested_end_time;
        await db.collection('work_records').doc(workRecordId).set(update, { merge: true });
      }
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
