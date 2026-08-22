import { NextRequest } from 'next/server';
import { FieldValue } from 'firebase-admin/firestore';
import { adminDb } from '@/lib/firebase-admin';
import { getServerUser, jsonError, requireRole } from '@/lib/server-auth';
import { buildAttendanceWarnings } from '@/lib/attendance-diagnostics';

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
          date: dateKey,
          start_time: now.toISOString(),
          end_time: null,
          status: 'pending',
          attendance_kind: attendanceKind,
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
      const snap = await ref.get();
      if (!snap.exists) return Response.json({ ok: false, error: 'work record not found' }, { status: 404 });
      const record = snap.data() || {};
      if (record.teacher_id !== user.uid) throw new Error('forbidden');
      if (record.status === 'approved') {
        return Response.json({ ok: false, error: 'approved work records cannot be changed' }, { status: 400 });
      }
      if (record.end_time) {
        return Response.json({ ok: false, error: 'work record already clocked out' }, { status: 400 });
      }

      const currentSegments = Array.isArray(record.work_segments) ? record.work_segments : [];
      const nextRecord = {
        ...record,
        end_time: now.toISOString(),
        work_segments: currentSegments,
      };
      const warnings = buildAttendanceWarnings(nextRecord);

      await ref.set({
        end_time: now.toISOString(),
        attendance_warnings: warnings,
        updated_at: now.toISOString(),
        updated_at_server: FieldValue.serverTimestamp(),
      }, { merge: true });

      return Response.json({ ok: true, warnings });
    }

    return Response.json({ ok: false, error: 'invalid action' }, { status: 400 });
  } catch (error) {
    return jsonError(error);
  }
}
