import { NextRequest } from 'next/server';
import { FieldValue } from 'firebase-admin/firestore';
import { adminDb } from '@/lib/firebase-admin';
import { getServerUser, jsonError, requireRole } from '@/lib/server-auth';
import { buildAttendanceWarnings } from '@/lib/attendance-diagnostics';
import { canClockOutAttendanceRecord } from '@/lib/attendance-date';
import {
  SCIENCE_SOCIAL_WORKPLACE_ID,
  SCIENCE_SOCIAL_WORKPLACE_LABEL,
  attendanceSchoolName,
  isAttendanceSchool,
  resolveAttendanceSchoolCode,
} from '@/lib/attendance-schools';

export const runtime = 'nodejs';

const JST_OFFSET_MS = 9 * 60 * 60 * 1000;

function nowJstParts() {
  const now = new Date();
  const jst = new Date(now.getTime() + JST_OFFSET_MS);
  return {
    now,
    dateKey: jst.toISOString().slice(0, 10),
    hour: jst.getUTCHours(),
    minute: jst.getUTCMinutes(),
  };
}

function isClockBlocked() {
  const { hour } = nowJstParts();
  return hour >= 23;
}

export async function POST(request: NextRequest) {
  try {
    const user = await getServerUser(request);
    requireRole(user, ['teacher', 'attendance_admin']);

    const body = await request.json();
    const action = String(body.action || '');
    const { now, dateKey } = nowJstParts();
    const requestedSchool = action === 'clock_in' ? body.school_id : '';
    const isScienceSocialWorkplace = requestedSchool === SCIENCE_SOCIAL_WORKPLACE_ID;
    if (action === 'clock_in' && !isScienceSocialWorkplace && !isAttendanceSchool(requestedSchool)) {
      return Response.json({ ok: false, error: '勤務校舎を選択してください。' }, { status: 400 });
    }
    const schoolId = isScienceSocialWorkplace ? '' : resolveAttendanceSchoolCode(
      requestedSchool || user.profile.school_id || user.profile.school_code || user.profile.school_name || user.profile.school || user.school
    );
    const schoolName = isScienceSocialWorkplace ? SCIENCE_SOCIAL_WORKPLACE_LABEL : attendanceSchoolName(schoolId);

    if (isClockBlocked()) {
      return Response.json({
        ok: false,
        error: 'clocking is closed after 23:00',
      }, { status: 400 });
    }

    const db = adminDb();

    if (action === 'clock_in') {
      const teacherName = String(user.profile.name || user.profile.teacher_name || user.profile.display_name || '未設定の講師');
      const attendanceKind = body.attendance_kind === 'breakthrough' ? 'breakthrough' : 'normal';
      const ref = db.collection('work_records').doc();
      await db.runTransaction(async tx => {
        const existingQuery = db.collection('work_records')
          .where('teacher_id', '==', user.uid)
          .where('date', '==', dateKey)
          .limit(5);
        const existingSnap = await tx.get(existingQuery);
        const records = existingSnap.docs.map(doc => ({ id: doc.id, ...(doc.data() || {}) as any }));
        if (records.some((record: any) => !record.end_time)) {
          throw new Error('active work record already exists');
        }
        if (records.some((record: any) => record.end_time)) {
          throw new Error('work record already completed today');
        }

        tx.create(ref, {
          teacher_id: user.uid,
          teacher_name: teacherName,
          school_id: schoolId || null,
          school_name: schoolName || null,
          date: dateKey,
          start_time: now.toISOString(),
          end_time: null,
          status: 'pending',
          attendance_kind: attendanceKind,
          default_program: isScienceSocialWorkplace ? 'science_social' : attendanceKind === 'breakthrough' ? 'breakthrough' : 'normal',
          workplace_type: isScienceSocialWorkplace ? 'science_social' : 'school',
          work_segments: [],
          transportation: [],
          created_by_api: true,
          created_at: now.toISOString(),
          created_at_server: FieldValue.serverTimestamp(),
        });
      });

      return Response.json({ ok: true, record_id: ref.id });
    }

    if (action === 'clock_out') {
      const recordId = String(body.work_record_id || '').trim();
      if (!recordId) return Response.json({ ok: false, error: 'work_record_id is required' }, { status: 400 });

      const ref = db.collection('work_records').doc(recordId);
      let warnings: ReturnType<typeof buildAttendanceWarnings> = [];
      await db.runTransaction(async transaction => {
        const snap = await transaction.get(ref);
        if (!snap.exists) throw new Error('work record not found');
        const record = snap.data() || {};
        if (record.teacher_id !== user.uid) throw new Error('forbidden');
        if (record.status === 'approved') throw new Error('approved work records cannot be changed');
        if (record.end_time) throw new Error('work record already clocked out');
        if (!canClockOutAttendanceRecord(record.date, dateKey)) {
          throw new Error('work record belongs to another date');
        }

        const currentSegments = Array.isArray(record.work_segments) ? record.work_segments : [];
        warnings = buildAttendanceWarnings({
          ...record,
          end_time: now.toISOString(),
          work_segments: currentSegments,
        });
        transaction.set(ref, {
          end_time: now.toISOString(),
          attendance_warnings: warnings,
          updated_at: now.toISOString(),
          updated_at_server: FieldValue.serverTimestamp(),
        }, { merge: true });
      });

      return Response.json({ ok: true, warnings });
    }

    return Response.json({ ok: false, error: 'invalid action' }, { status: 400 });
  } catch (error) {
    console.error('[attendance-clock] failed', {
      message: error instanceof Error ? error.message : String(error),
      code: error && typeof error === 'object' && 'code' in error ? String(error.code) : '',
    });
    return jsonError(error);
  }
}
