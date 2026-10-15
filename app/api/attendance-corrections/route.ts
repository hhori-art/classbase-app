import { NextRequest } from 'next/server';
import { FieldValue } from 'firebase-admin/firestore';
import { adminDb } from '@/lib/firebase-admin';
import { canManageAttendance, canManageAttendanceSchool, getServerUser, jsonError, requireRole } from '@/lib/server-auth';
import { writeLearningEvent } from '@/lib/events';
import {
  SCIENCE_SOCIAL_WORKPLACE_ID,
  SCIENCE_SOCIAL_WORKPLACE_LABEL,
  attendanceSchoolName,
  isAttendanceSchool,
  resolveAttendanceSchoolCode,
} from '@/lib/attendance-schools';
import { attendanceDateKey, ensureAttendanceRangeWithinDate, ensureAttendanceTimeOnDate, normalizeAttendanceTimeToDate } from '@/lib/attendance-date';

const toDateKey = (value?: string | null) => {
  return attendanceDateKey(value);
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

const ensureFiveMinuteTime = (value?: string | null) => {
  if (!value) return;
  const date = new Date(value);
  if (Number.isNaN(date.getTime())) throw new Error('invalid requested time');
  const parts = new Intl.DateTimeFormat('en-GB', {
    timeZone: 'Asia/Tokyo', hour: '2-digit', minute: '2-digit', hourCycle: 'h23',
  }).formatToParts(date);
  const minute = Number(parts.find(part => part.type === 'minute')?.value || 0);
  if (minute % 5 !== 0 || date.getSeconds() !== 0 || date.getMilliseconds() !== 0) {
    throw new Error('requested time must be in 5 minute increments');
  }
};

// 5分制導入前に保存された秒・端数分付き申請も承認不能にしない。
// 画面に表示する分を超えないよう、直前の5分へ切り下げて扱う。
const normalizeLegacyFiveMinuteTime = (value?: string | null) => {
  if (!value) return value || null;
  const date = new Date(value);
  if (Number.isNaN(date.getTime())) throw new Error('invalid requested time');
  date.setSeconds(0, 0);
  date.setMinutes(Math.floor(date.getMinutes() / 5) * 5);
  return date.toISOString();
};

const workRecordSchool = (record: Record<string, any>) => {
  const segments = Array.isArray(record.work_segments) ? record.work_segments : [];
  const isScienceSocial = record.workplace_type === 'science_social'
    || record.default_program === 'science_social'
    || record.school_id === SCIENCE_SOCIAL_WORKPLACE_ID
    || record.school_name === SCIENCE_SOCIAL_WORKPLACE_LABEL;
  if (isScienceSocial) return SCIENCE_SOCIAL_WORKPLACE_ID;
  const raw = String(record.school_id || record.school_code || record.school_name ||
    segments.find((segment: Record<string, any>) => segment?.school_id)?.school_id || '').trim();
  return raw === SCIENCE_SOCIAL_WORKPLACE_ID ? SCIENCE_SOCIAL_WORKPLACE_ID : resolveAttendanceSchoolCode(raw);
};

const correctionSchoolName = (schoolId?: string | null) => schoolId === SCIENCE_SOCIAL_WORKPLACE_ID
  ? SCIENCE_SOCIAL_WORKPLACE_LABEL
  : attendanceSchoolName(schoolId);

export async function POST(request: NextRequest) {
  try {
    const user = await getServerUser(request);
    const body = await request.json();
    const action = String(body.action || 'request');
    const userSchoolId = resolveAttendanceSchoolCode(
      user.profile.school_id || user.profile.school_code || user.profile.school_name || user.profile.school || user.school
    );
    const userSchoolName = attendanceSchoolName(userSchoolId);

    if (action === 'request') {
      requireRole(user, ['teacher', 'attendance_admin']);
      const db = adminDb();
      const workRecordId = String(body.work_record_id || '').trim();
      let requestedStartTime = body.requested_start_time || null;
      let requestedEndTime = body.requested_end_time || null;
      let targetDate = String(body.target_date || toDateKey(requestedStartTime) || toDateKey(requestedEndTime) || '').trim();

      if (!requestedStartTime && !requestedEndTime) {
        return Response.json({ ok: false, error: 'requested time is required' }, { status: 400 });
      }
      let requestType: 'time_correction' | 'missing_clock' = 'time_correction';
      let teacherName = '';
      let requestSchoolId = userSchoolId;

      if (workRecordId) {
        const workRecordSnap = await db.collection('work_records').doc(workRecordId).get();
        if (!workRecordSnap.exists) return Response.json({ ok: false, error: 'work record not found' }, { status: 404 });
        const workRecord = workRecordSnap.data() || {};
        if (workRecord.teacher_id !== user.uid) throw new Error('forbidden');
        // 承認済み実績の直接編集は禁止したまま、管理者の再承認を必須とする
        // 打刻修正依頼は受け付ける。ここで拒否すると、誤った承認済み打刻を
        // 正式な監査経路で訂正できなくなる。
        targetDate = String(workRecord.date || targetDate || '').trim();
        requestSchoolId = workRecordSchool(workRecord) || userSchoolId;
        if (requestedStartTime) ensureAttendanceTimeOnDate(requestedStartTime, targetDate);
        if (requestedEndTime) ensureAttendanceTimeOnDate(requestedEndTime, targetDate);
        if (requestedStartTime) requestedStartTime = normalizeAttendanceTimeToDate(requestedStartTime, targetDate);
        if (requestedEndTime) requestedEndTime = normalizeAttendanceTimeToDate(requestedEndTime, targetDate);
        // 出勤・退勤を同時に修正する場合、元の打刻値ではなく、承認後に保存される組み合わせで判定する。
        // 以前は元の出勤/退勤とも個別比較していたため、古い打刻値が不整合な記録を直せなかった。
        const effectiveStartTime = normalizeAttendanceTimeToDate(requestedStartTime || String(workRecord.start_time || '').trim() || null, targetDate);
        const effectiveEndTime = normalizeAttendanceTimeToDate(requestedEndTime || String(workRecord.end_time || '').trim() || null, targetDate);
        ensureValidRange(effectiveStartTime, effectiveEndTime);
        if (effectiveStartTime && effectiveEndTime) ensureAttendanceRangeWithinDate(effectiveStartTime, effectiveEndTime, targetDate);
        requestedStartTime = effectiveStartTime;
        requestedEndTime = effectiveEndTime;
        teacherName = String(workRecord.teacher_name || teacherName || '');
      } else {
        requestType = 'missing_clock';
        if (!targetDate || !isIsoLikeDate(targetDate)) {
          return Response.json({ ok: false, error: 'target_date is required' }, { status: 400 });
        }
        if (!requestedStartTime || !requestedEndTime) {
          return Response.json({ ok: false, error: 'missing clock request requires start and end time' }, { status: 400 });
        }
        const rawRequestedSchool = String(body.school_id || '').trim();
        requestSchoolId = rawRequestedSchool === SCIENCE_SOCIAL_WORKPLACE_ID
          ? SCIENCE_SOCIAL_WORKPLACE_ID
          : resolveAttendanceSchoolCode(rawRequestedSchool);
        if (!requestSchoolId || (requestSchoolId !== SCIENCE_SOCIAL_WORKPLACE_ID && !isAttendanceSchool(requestSchoolId))) {
          return Response.json({ ok: false, error: 'work school is required' }, { status: 400 });
        }
        ensureAttendanceTimeOnDate(requestedStartTime, targetDate);
        ensureAttendanceTimeOnDate(requestedEndTime, targetDate);
        requestedStartTime = normalizeAttendanceTimeToDate(requestedStartTime, targetDate);
        requestedEndTime = normalizeAttendanceTimeToDate(requestedEndTime, targetDate);
        ensureValidRange(requestedStartTime, requestedEndTime);
        ensureAttendanceRangeWithinDate(requestedStartTime, requestedEndTime, targetDate);
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
      ensureFiveMinuteTime(requestedStartTime);
      ensureFiveMinuteTime(requestedEndTime);

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
        school_id: requestSchoolId || null,
        school_name: correctionSchoolName(requestSchoolId) || userSchoolName || null,
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
        school: requestSchoolId || undefined,
      }).catch(error => {
        console.error('attendance correction request event write failed', error);
        return null;
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
    // 新規実績が不要な承認では未使用になるが、IDの予約は読み取りを発生させない。
    const createdWorkRecordRef = status === 'approved' ? db.collection('work_records').doc() : null;
    await db.runTransaction(async transaction => {
      // 二重承認や、承認中に別操作が入った場合でも、申請状態と勤務実績を必ず同じトランザクションで確定する。
      const latestCorrectionSnap = await transaction.get(correctionRef);
      if (!latestCorrectionSnap.exists) throw new Error('request not found');
      const latestCorrection = latestCorrectionSnap.data() || {};
      if (String(latestCorrection.status || 'pending') !== 'pending') throw new Error('request is no longer pending');
      const targetTeacherSnap = latestCorrection.teacher_id
        ? await transaction.get(db.collection('users').doc(String(latestCorrection.teacher_id)))
        : null;
      const targetTeacher = targetTeacherSnap?.data() || {};
      const latestWorkRecordId = String(latestCorrection.work_record_id || latestCorrection.workRecordId || latestCorrection.record_id || '').trim();
      const existingWorkRecordSnap = latestWorkRecordId
        ? await transaction.get(db.collection('work_records').doc(latestWorkRecordId))
        : null;
      const existingWorkRecord = existingWorkRecordSnap?.data() || {};
      const targetSchool = workRecordSchool(existingWorkRecord) || resolveAttendanceSchoolCode(latestCorrection.school_id) ||
        resolveAttendanceSchoolCode(targetTeacher.school_id || targetTeacher.school);
      if (!canManageAttendanceSchool(user, targetSchool)) throw new Error('forbidden');

      const reviewUpdate = {
        status,
        reviewed_by: user.uid,
        reviewed_at: FieldValue.serverTimestamp(),
      };
      if (status === 'rejected') {
        transaction.set(correctionRef, reviewUpdate, { merge: true });
        return;
      }

      const latestRequestType = String(latestCorrection.request_type || '').trim();
      const latestIsMissing = latestRequestType === 'missing_clock' || !latestWorkRecordId;
      const latestTargetDate = String(latestCorrection.target_date || toDateKey(latestCorrection.requested_start_time) || '').trim();
      if (!latestTargetDate || !isIsoLikeDate(latestTargetDate)) throw new Error('target_date is missing on correction request');

      if (latestIsMissing) {
        if (!latestCorrection.requested_start_time || !latestCorrection.requested_end_time) {
          throw new Error('missing clock request requires requested time');
        }
        // 旧画面では対象日だけが変わり、日時入力が前回の日付のまま残ることがあった。
        // 時刻だけを対象日へ付け替えると別日に勤務を作ってしまうため、承認時にも元値を照合する。
        const legacySafeStart = normalizeLegacyFiveMinuteTime(String(latestCorrection.requested_start_time));
        const legacySafeEnd = normalizeLegacyFiveMinuteTime(String(latestCorrection.requested_end_time));
        ensureAttendanceTimeOnDate(String(legacySafeStart), latestTargetDate);
        ensureAttendanceTimeOnDate(String(legacySafeEnd), latestTargetDate);
        const normalizedStartTime = normalizeAttendanceTimeToDate(legacySafeStart, latestTargetDate);
        const normalizedEndTime = normalizeAttendanceTimeToDate(legacySafeEnd, latestTargetDate);
        ensureValidRange(normalizedStartTime, normalizedEndTime);
        if (normalizedStartTime && normalizedEndTime) ensureAttendanceRangeWithinDate(normalizedStartTime, normalizedEndTime, latestTargetDate);
        const duplicateQuery = db.collection('work_records')
          .where('teacher_id', '==', latestCorrection.teacher_id)
          .where('date', '==', latestTargetDate)
          .limit(1);
        const duplicateSnap = await transaction.get(duplicateQuery);
        if (!duplicateSnap.empty) throw new Error('work record already exists for target_date');
        if (!createdWorkRecordRef) throw new Error('work record reference could not be created');
        const now = new Date().toISOString();
        transaction.set(createdWorkRecordRef, {
          teacher_id: latestCorrection.teacher_id,
          teacher_name: latestCorrection.teacher_name || '未設定の講師',
          school_id: targetSchool,
          school_name: correctionSchoolName(targetSchool),
          date: latestTargetDate,
          start_time: normalizedStartTime,
          end_time: normalizedEndTime,
          status: 'pending',
          work_segments: [],
          transportation: [],
          created_from_correction_request_id: requestId,
          time_correction_approved_at: FieldValue.serverTimestamp(),
          time_correction_approved_by: user.uid,
          created_at: now,
          updated_at: now,
        });
        transaction.set(correctionRef, { ...reviewUpdate, work_record_id: createdWorkRecordRef.id }, { merge: true });
        return;
      }

      const workRecordRef = db.collection('work_records').doc(latestWorkRecordId);
      if (!existingWorkRecordSnap?.exists) throw new Error('work record not found');
      const workRecord = existingWorkRecord;
      if (String(workRecord.teacher_id || '') !== String(latestCorrection.teacher_id || '')) throw new Error('work record teacher mismatch');
      if (String(workRecord.date || '') !== latestTargetDate) throw new Error('work record date mismatch');

      const legacySafeRequestedStart = normalizeLegacyFiveMinuteTime(latestCorrection.requested_start_time || null);
      const legacySafeRequestedEnd = normalizeLegacyFiveMinuteTime(latestCorrection.requested_end_time || null);
      if (legacySafeRequestedStart) ensureAttendanceTimeOnDate(legacySafeRequestedStart, latestTargetDate);
      if (legacySafeRequestedEnd) ensureAttendanceTimeOnDate(legacySafeRequestedEnd, latestTargetDate);

      const nextStart = normalizeAttendanceTimeToDate(
        legacySafeRequestedStart || String(workRecord.start_time || '').trim() || null,
        latestTargetDate,
      );
      const nextEnd = normalizeAttendanceTimeToDate(
        legacySafeRequestedEnd || String(workRecord.end_time || '').trim() || null,
        latestTargetDate,
      );
      ensureValidRange(nextStart, nextEnd);
      if (nextStart && nextEnd) ensureAttendanceRangeWithinDate(nextStart, nextEnd, latestTargetDate);
      transaction.set(workRecordRef, {
        start_time: nextStart,
        end_time: nextEnd,
        updated_at: new Date().toISOString(),
        time_correction_approved_at: FieldValue.serverTimestamp(),
        time_correction_approved_by: user.uid,
      }, { merge: true });
      transaction.set(correctionRef, reviewUpdate, { merge: true });
    });

    const eventId = await writeLearningEvent({
      actor_id: user.uid,
      actor_role: user.role,
      type: `attendance_correction_${status}`,
      target_id: requestId,
      target_type: 'attendance_correction_request',
      school: userSchoolId || undefined,
    }).catch(error => {
      console.error('attendance correction review event write failed', error);
      return null;
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
    const linkedRecordIds = mode === 'admin' ? Array.from(new Set(snap.docs
      .map(doc => String(doc.data()?.work_record_id || doc.data()?.workRecordId || doc.data()?.record_id || '').trim())
      .filter(Boolean))) : [];
    const linkedRecords = new Map((await Promise.all(linkedRecordIds.map(async id => {
      const record = await db.collection('work_records').doc(id).get();
      return [id, record.data() || {}] as const;
    }))));
    const requests = snap.docs.filter(doc => {
      if (mode !== 'admin') return true;
      const recordId = String(doc.data()?.work_record_id || doc.data()?.workRecordId || doc.data()?.record_id || '').trim();
      const targetSchool = workRecordSchool(linkedRecords.get(recordId) || {}) || resolveAttendanceSchoolCode(doc.data()?.school_id);
      // 旧申請に校舎情報がない場合、全体管理者以外には表示せず、他校舎申請の混入を防ぐ。
      if (!targetSchool) return user.role === 'master';
      return canManageAttendanceSchool(user, targetSchool);
    }).map(doc => {
      const data = doc.data() || {};
      const recordId = String(data.work_record_id || data.workRecordId || data.record_id || '').trim();
      const effectiveSchoolId = workRecordSchool(linkedRecords.get(recordId) || {}) || resolveAttendanceSchoolCode(data.school_id);
      const created = data.created_at;
      const reviewed = data.reviewed_at;
      return {
        id: doc.id,
        ...data,
        work_record_date: linkedRecords.get(recordId)?.date || null,
        current_start_time: linkedRecords.get(recordId)?.start_time || null,
        current_end_time: linkedRecords.get(recordId)?.end_time || null,
        current_teacher_name: linkedRecords.get(recordId)?.teacher_name || null,
        requested_start_time: normalizeLegacyFiveMinuteTime(data.requested_start_time),
        requested_end_time: normalizeLegacyFiveMinuteTime(data.requested_end_time),
        school_id: effectiveSchoolId || data.school_id || null,
        school_name: correctionSchoolName(effectiveSchoolId) || data.school_name || null,
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
