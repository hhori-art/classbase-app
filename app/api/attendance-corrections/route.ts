import { NextRequest } from 'next/server';
import { FieldValue } from 'firebase-admin/firestore';
import { adminDb } from '@/lib/firebase-admin';
import { canManageAttendance, getServerUser, jsonError, requireRole } from '@/lib/server-auth';
import { writeLearningEvent } from '@/lib/events';

const toDateKey = (value?: string | null) => {
  if (!value) return '';
  const directDate = String(value).match(/^(\d{4}-\d{2}-\d{2})/);
  if (directDate) return directDate[1];
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
      requireRole(user, ['teacher', 'attendance_admin']);
      const db = adminDb();
      const workRecordId = String(body.work_record_id || '').trim();
      const requestedStartTime = body.requested_start_time || null;
      const requestedEndTime = body.requested_end_time || null;
      let targetDate = String(body.target_date || toDateKey(requestedStartTime) || toDateKey(requestedEndTime) || '').trim();

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
        targetDate = String(workRecord.date || targetDate || '').trim();
        // 出勤・退勤を同時に修正する場合、元の打刻値ではなく、承認後に保存される組み合わせで判定する。
        // 以前は元の出勤/退勤とも個別比較していたため、古い打刻値が不整合な記録を直せなかった。
        const effectiveStartTime = requestedStartTime || String(workRecord.start_time || '').trim() || null;
        const effectiveEndTime = requestedEndTime || String(workRecord.end_time || '').trim() || null;
        ensureValidRange(effectiveStartTime, effectiveEndTime);
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

      let previousRequests: FirebaseFirestore.QueryDocumentSnapshot[] = [];
      if (targetDate) {
        const existingRequestSnap = await db.collection('attendance_correction_requests')
          .where('teacher_id', '==', user.uid)
          .where('target_date', '==', targetDate)
          .limit(50)
          .get();
        previousRequests = existingRequestSnap.docs;
      }

      const correctionRef = db.collection('attendance_correction_requests').doc();
      const batch = db.batch();
      previousRequests
        .filter(doc => String(doc.data()?.status || 'pending') === 'pending')
        .forEach(doc => {
          batch.set(doc.ref, {
            status: 'superseded',
            superseded_by: correctionRef.id,
            superseded_at: FieldValue.serverTimestamp(),
          }, { merge: true });
        });
      batch.set(correctionRef, {
        work_record_id: workRecordId || null,
        request_type: requestType,
        teacher_id: user.uid,
        teacher_name: teacherName || '未設定の講師',
        target_date: targetDate || null,
        requested_start_time: requestedStartTime,
        requested_end_time: requestedEndTime,
        reason: String(body.reason || '').slice(0, 500),
        status: 'pending',
        revision_number: previousRequests.length + 1,
        previous_request_id: previousRequests.length
          ? previousRequests
              .slice()
              .sort((a, b) => {
                const aMillis = a.data()?.created_at?.toMillis?.() || 0;
                const bMillis = b.data()?.created_at?.toMillis?.() || 0;
                return bMillis - aMillis;
              })[0].id
          : null,
        created_at: FieldValue.serverTimestamp(),
      });
      await batch.commit();

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

    if (!canManageAttendance(user)) throw new Error('forbidden');
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
    if (String(correction.status || 'pending') !== 'pending') {
      return Response.json({ ok: false, error: 'request is no longer pending' }, { status: 409 });
    }
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
        const existingSnap = await db.collection('work_records')
          .where('teacher_id', '==', correction.teacher_id)
          .where('date', '==', targetDate)
          .limit(1)
          .get();
        if (!existingSnap.empty) {
          await correctionRef.set({
            status: 'rejected',
            reviewed_by: user.uid,
            reviewed_at: FieldValue.serverTimestamp(),
            review_note: '同じ講師・同じ日付の勤務記録が既に存在するため自動却下',
          }, { merge: true });
          return Response.json({ ok: false, error: 'work record already exists for target_date' }, { status: 400 });
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

export async function GET(request: NextRequest) {
  try {
    const user = await getServerUser(request);
    const db = adminDb();
    const mode = String(request.nextUrl.searchParams.get('scope') || '');
    const teacherId = String(request.nextUrl.searchParams.get('teacher_id') || '').trim();
    const status = String(request.nextUrl.searchParams.get('status') || '').trim();
    const month = String(request.nextUrl.searchParams.get('month') || '').trim();
    const max = Math.min(Number(request.nextUrl.searchParams.get('limit') || 30) || 30, 100);

    let q: FirebaseFirestore.Query = db.collection('attendance_correction_requests');
    if (mode === 'admin') {
      if (!canManageAttendance(user)) throw new Error('forbidden');
      if (teacherId) q = q.where('teacher_id', '==', teacherId);
    } else {
      requireRole(user, ['teacher', 'attendance_admin']);
      q = q.where('teacher_id', '==', user.uid);
    }
    if (status) q = q.where('status', '==', status);

    const snap = await q.limit(300).get();
    const requests = snap.docs.map(doc => {
      const data = doc.data() || {};
      const created = data.created_at;
      const reviewed = data.reviewed_at;
      return {
        id: doc.id,
        ...data,
        created_at: created?.toDate ? created.toDate().toISOString() : created || null,
        reviewed_at: reviewed?.toDate ? reviewed.toDate().toISOString() : reviewed || null,
      };
    }).filter((item: any) => {
      if (!month) return true;
      const targetDate = String(item.target_date || '').slice(0, 7);
      const createdMonth = String(item.created_at || '').slice(0, 7);
      return targetDate === month || (!targetDate && createdMonth === month);
    }).sort((a: any, b: any) => String(b.target_date || b.created_at || '').localeCompare(String(a.target_date || a.created_at || ''))).slice(0, max);

    return Response.json({ ok: true, requests });
  } catch (error) {
    return jsonError(error);
  }
}
