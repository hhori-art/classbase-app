import { NextRequest } from 'next/server';
import { adminDb } from '@/lib/firebase-admin';
import { canManageAttendance, jsonError, getServerUser, requireRole } from '@/lib/server-auth';
import {
  buildAttendanceWarnings,
  normalizeAttendanceName,
  shiftMatchesTeacher,
} from '@/lib/attendance-diagnostics';
import { normalizePersonCode, overlapMinutes, type RegularAttendanceInterval } from '@/lib/attendance-payroll';

export const runtime = 'nodejs';

const todayJst = () => new Date(Date.now() + 9 * 60 * 60 * 1000).toISOString().slice(0, 10);

const monthRange = (month: string) => {
  const safeMonth = /^\d{4}-\d{2}$/.test(month) ? month : todayJst().slice(0, 7);
  const [year, m] = safeMonth.split('-').map(Number);
  const lastDay = new Date(year, m, 0).getDate();
  return { month: safeMonth, start: `${safeMonth}-01`, end: `${safeMonth}-${String(lastDay).padStart(2, '0')}` };
};

const teacherNameFromProfile = (profile: any) =>
  String(profile?.name || profile?.teacher_name || profile?.student_name || profile?.display_name || profile?.email || '未設定の講師');

const personCodeFromProfile = (profile: any) => normalizePersonCode(
  profile?.lifetime_id || profile?.staff_id || profile?.staffId || profile?.employee_id || profile?.employeeId || profile?.teacher_code || ''
);

function clockTime(value: any) {
  if (!value) return '';
  const raw = String(value || '');
  const match = raw.match(/^(\d{1,2}):(\d{2})/);
  if (match) return `${match[1].padStart(2, '0')}:${match[2]}`;
  const date = typeof value?.toDate === 'function' ? value.toDate() : new Date(value);
  if (Number.isNaN(date.getTime())) return '';
  return new Intl.DateTimeFormat('ja-JP', {
    timeZone: 'Asia/Tokyo', hour: '2-digit', minute: '2-digit', hourCycle: 'h23',
  }).format(date);
}

function recordIntervals(record: any) {
  const segments = Array.isArray(record.work_segments)
    ? record.work_segments.filter((segment: any) => segment?.type !== 'break').map((segment: any) => ({
      start: clockTime(segment.start || segment.start_time),
      end: clockTime(segment.end || segment.end_time),
      label: String(segment.note || segment.type || '勤務'),
    })).filter((segment: any) => segment.start && segment.end)
    : [];
  if (segments.length > 0) return segments;
  const start = clockTime(record.start_time);
  const end = clockTime(record.end_time);
  return start && end ? [{ start, end, label: '勤務' }] : [];
}

function flattenRegularAttendance(docs: FirebaseFirestore.QueryDocumentSnapshot[]) {
  return docs.flatMap(doc => {
    const data = doc.data();
    if (!data.compacted || !Array.isArray(data.intervals)) {
      return [{ id: doc.id, ...data } as RegularAttendanceInterval & Record<string, unknown>];
    }
    return data.intervals.map((interval: Record<string, unknown>, index: number) => ({
      id: `${doc.id}_${index}`,
      person_code: String(data.person_code || ''),
      person_name: String(data.person_name || ''),
      normalized_name: String(data.normalized_name || ''),
      date: String(interval.date || ''),
      start_time: String(interval.start_time || ''),
      end_time: String(interval.end_time || ''),
      work_type: String(interval.work_type || ''),
      source_name: String(data.source_name || ''),
      source_type: String(data.source_type || 'manual_import'),
    }));
  });
}

export async function GET(request: NextRequest) {
  try {
    const user = await getServerUser(request);
    const mode = String(request.nextUrl.searchParams.get('scope') || '');
    const { month, start, end } = monthRange(String(request.nextUrl.searchParams.get('month') || ''));
    const db = adminDb();

    const adminMode = mode === 'admin' && canManageAttendance(user);
    if (!adminMode) requireRole(user, ['teacher']);

    const teacherSnap = adminMode
      ? await db.collection('users').where('role', '==', 'teacher').get()
      : null;
    const teacherMap = new Map<string, any>();
    if (teacherSnap) {
      teacherSnap.docs.forEach(doc => teacherMap.set(doc.id, { id: doc.id, ...doc.data(), name: teacherNameFromProfile(doc.data()) }));
    } else {
      teacherMap.set(user.uid, { id: user.uid, ...user.profile, name: teacherNameFromProfile(user.profile) });
    }

    let recordsQuery: FirebaseFirestore.Query = db.collection('work_records')
      .where('date', '>=', start)
      .where('date', '<=', end);
    if (!adminMode) recordsQuery = recordsQuery.where('teacher_id', '==', user.uid);

    const [recordSnap, shiftSnap, regularSnap] = await Promise.all([
      recordsQuery.get(),
      db.collection('shift_assignments').where('target_date', '>=', start).where('target_date', '<=', end).limit(2000).get(),
      db.collection('attendance_regular_imports').where('date', '>=', start).where('date', '<=', end).limit(5000).get(),
    ]);

    const records = recordSnap.docs.map(doc => ({ id: doc.id, ...doc.data() }));
    const shifts = shiftSnap.docs.map(doc => ({ id: doc.id, ...doc.data() }));
    const regularAttendance = flattenRegularAttendance(regularSnap.docs);
    const recordKeySet = new Set(records.map((record: any) => `${record.teacher_id}_${record.date}`));
    const recordsByTeacherDate = new Map<string, any[]>();
    (records as any[]).forEach(record => {
      const key = `${record.teacher_id}\u001f${record.date}`;
      const list = recordsByTeacherDate.get(key) || [];
      list.push(record);
      recordsByTeacherDate.set(key, list);
    });
    const nowDate = todayJst();

    const diagnostics: any[] = [];

    recordsByTeacherDate.forEach((sameDayRecords, key) => {
      if (sameDayRecords.length <= 1) return;
      const [teacherId, date] = key.split('\u001f');
      const teacher = teacherMap.get(teacherId) || { id: teacherId, name: sameDayRecords[0]?.teacher_name || '未設定の講師' };
      diagnostics.push({
        type: 'duplicate_work_record',
        date,
        teacher_id: teacherId,
        teacher_name: sameDayRecords[0]?.teacher_name || teacher.name,
        work_record_id: sameDayRecords[0]?.id,
        related_work_record_ids: sameDayRecords.map(record => record.id),
        warning_count: 1,
        record_summary: sameDayRecords.map(record => ({
          id: record.id,
          start_time: record.start_time || null,
          end_time: record.end_time || null,
          status: record.status || 'pending',
        })),
        warnings: [{
          code: 'duplicate_work_record',
          label: '同日二重打刻',
          severity: 'danger',
          detail: `同じ講師の同じ日付に勤務記録が${sameDayRecords.length}件あります。片方が誤作成でないか確認してください。`,
        }],
      });
    });

    for (const record of records as any[]) {
      const teacher = teacherMap.get(record.teacher_id) || { id: record.teacher_id, name: record.teacher_name || '未設定の講師' };
      const matchedShifts = shifts.filter((shift: any) =>
        shift.target_date === record.date &&
        shiftMatchesTeacher(shift, { uid: record.teacher_id, name: record.teacher_name || teacher.name })
      );
      const warnings = buildAttendanceWarnings(record, matchedShifts);
      if (warnings.length > 0) {
        diagnostics.push({
          type: 'work_record_warning',
          date: record.date,
          teacher_id: record.teacher_id,
          teacher_name: record.teacher_name || teacher.name,
          work_record_id: record.id,
          warning_count: warnings.length,
          shift_summary: matchedShifts.map((shift: any) => ({
            id: shift.id,
            teacher_name: shift.teacher_name || '',
            user_id: shift.user_id || '',
            target_date: shift.target_date || '',
            role_type: shift.role_type || '',
            note: shift.note || '',
            school: shift.school || shift.location || shift.work_location || '',
          })),
          record_summary: [{
            id: record.id,
            start_time: record.start_time || null,
            end_time: record.end_time || null,
            status: record.status || 'pending',
            work_segments_count: Array.isArray(record.work_segments) ? record.work_segments.length : 0,
            transportation_count: Array.isArray(record.transportation) ? record.transportation.length : 0,
          }],
          warnings,
        });
      }

      const teacherCode = personCodeFromProfile(teacher);
      const teacherName = normalizeAttendanceName(record.teacher_name || teacher.name);
      const overlapping = regularAttendance.flatMap(external => {
        if (external.date !== record.date) return [];
        const externalCode = normalizePersonCode(external.person_code);
        const externalName = normalizeAttendanceName(external.person_name || external.normalized_name);
        const samePerson = teacherCode && externalCode ? teacherCode === externalCode : Boolean(teacherName && externalName && teacherName === externalName);
        if (!samePerson) return [];
        return recordIntervals(record).flatMap((segment: { start: string; end: string; label: string }) => {
          const minutes = overlapMinutes(segment.start, segment.end, external.start_time, external.end_time);
          return minutes > 0 ? [{ external, segment, minutes }] : [];
        });
      });
      if (overlapping.length > 0) {
        const uniqueExternal = [...new Map(overlapping.map(item => [String(item.external.id), item.external])).values()];
        diagnostics.push({
          type: 'external_attendance_overlap',
          date: record.date,
          teacher_id: record.teacher_id,
          teacher_name: record.teacher_name || teacher.name,
          work_record_id: record.id,
          warning_count: overlapping.length,
          record_summary: [{
            id: record.id,
            start_time: record.start_time || null,
            end_time: record.end_time || null,
            status: record.status || 'pending',
            work_segments_count: Array.isArray(record.work_segments) ? record.work_segments.length : 0,
            transportation_count: Array.isArray(record.transportation) ? record.transportation.length : 0,
          }],
          external_record_summary: uniqueExternal.map(external => ({
            id: external.id,
            person_code: external.person_code || '',
            person_name: external.person_name || '',
            start_time: external.start_time,
            end_time: external.end_time,
            work_type: external.work_type || '',
            source_name: external.source_name || '通常勤怠',
          })),
          warnings: overlapping.map(({ external, segment, minutes }) => ({
            code: 'external_attendance_overlap',
            label: '通常勤怠との時間重複',
            severity: 'danger',
            detail: `${segment.start}〜${segment.end}（${segment.label}）と、${external.source_name || '通常勤怠'}の${external.start_time}〜${external.end_time}が${minutes}分重複しています。`,
          })),
        });
      }
    }

    const targetShifts = adminMode
      ? shifts
      : shifts.filter((shift: any) => shiftMatchesTeacher(shift, { uid: user.uid, name: teacherNameFromProfile(user.profile) }));

    targetShifts.forEach((shift: any) => {
      const teacherByName = [...teacherMap.values()].find((teacher: any) =>
        normalizeAttendanceName(shift.teacher_name) === normalizeAttendanceName(teacher.name)
      );
      const teacherById = shift.user_id ? teacherMap.get(shift.user_id) : null;
      const teacherEntry = teacherByName || teacherById;
      const teacherId = teacherEntry?.id || shift.user_id || '';
      if (!teacherId) return;
      const key = `${teacherId}_${shift.target_date}`;
      if (recordKeySet.has(key)) return;
      if (String(shift.target_date || '') > nowDate) return;
      diagnostics.push({
        type: 'missing_work_record',
        date: shift.target_date,
        teacher_id: teacherId,
        teacher_name: shift.teacher_name || teacherEntry?.name || '未設定の講師',
        shift_assignment_id: shift.id,
        warning_count: 1,
        shift_summary: [{
          id: shift.id,
          teacher_name: shift.teacher_name || '',
          user_id: shift.user_id || '',
          target_date: shift.target_date || '',
          role_type: shift.role_type || '',
          note: shift.note || '',
          school: shift.school || shift.location || shift.work_location || '',
        }],
        record_summary: [],
        warnings: [{
          code: 'missing_work_record',
          label: '勤務記録なし',
          severity: 'warning',
          detail: '講師配置がありますが、該当日の勤怠記録がありません。',
        }],
      });
    });

    diagnostics.sort((a, b) => String(b.date).localeCompare(String(a.date)));

    return Response.json({
      ok: true,
      month,
      diagnostics,
      summary: {
        total: diagnostics.length,
        danger: diagnostics.filter(d => d.warnings.some((w: any) => w.severity === 'danger')).length,
        warning: diagnostics.filter(d => d.warnings.some((w: any) => w.severity === 'warning')).length,
        overlap: diagnostics.filter(d => d.type === 'external_attendance_overlap').length,
      },
    });
  } catch (error) {
    return jsonError(error);
  }
}
