import { NextRequest } from 'next/server';
import { FieldValue } from 'firebase-admin/firestore';
import { adminDb } from '@/lib/firebase-admin';
import { getServerUser, jsonError, requireRole } from '@/lib/server-auth';
import {
  attendanceSegmentNeedsSchool,
  normalizeAttendanceSegment,
  segmentProgram,
  validateAttendanceSegment,
  validateAttendanceSegmentCoverage,
  type AttendanceWorkSegment,
  individualLevelNeedsRatio,
  normalizeIndividualLevel,
} from '@/lib/attendance-work-detail';
import {
  ATTENDANCE_SCHOOL_DIRECTORY,
  ATTENDANCE_SCHOOL_OPTION_GROUPS,
  isAttendanceSchool,
  resolveAttendanceSchoolCode,
} from '@/lib/attendance-schools';

export const runtime = 'nodejs';

const SEGMENT_TYPES = new Set([
  'lesson', 'individual', 'office', 'support', 'break', 'other',
  'breakthrough_lesson', 'breakthrough_office',
]);
const TIME_PATTERN = /^(?:[01]\d|2[0-3]):[0-5]\d$/;

export async function GET(request: NextRequest) {
  try {
    const actor = await getServerUser(request);
    requireRole(actor, ['teacher', 'attendance_admin']);
    return Response.json({ ok: true, schools: ATTENDANCE_SCHOOL_DIRECTORY, groups: ATTENDANCE_SCHOOL_OPTION_GROUPS });
  } catch (error) {
    return jsonError(error);
  }
}

function cleanText(value: unknown, maxLength = 300) {
  return String(value || '').trim().slice(0, maxLength);
}

function normalizeSegments(value: unknown): AttendanceWorkSegment[] {
  if (!Array.isArray(value) || value.length === 0 || value.length > 100) {
    throw new Error('業務内訳を1件以上100件以内で入力してください。');
  }

  const segments = value.map(raw => {
    const source = raw && typeof raw === 'object' ? raw as Record<string, unknown> : {};
    const type = cleanText(source.type, 40);
    if (!SEGMENT_TYPES.has(type)) throw new Error('業務区分が正しくありません。');

    const segment = normalizeAttendanceSegment({
      id: cleanText(source.id, 120) || crypto.randomUUID(),
      start: cleanText(source.start, 5),
      end: cleanText(source.end, 5),
      type,
      note: cleanText(source.note, 500),
      isAuto: source.isAuto === true,
      program: segmentProgram(source),
      grade: cleanText(source.grade, 20) || undefined,
      lesson_format: source.lesson_format === 'individual' ? 'individual' : source.lesson_format === 'group' ? 'group' : undefined,
      individual_level: normalizeIndividualLevel(source.individual_level),
      individual_ratio: individualLevelNeedsRatio(source.individual_level) && ['1:1', '1:2', '1:3'].includes(String(source.individual_ratio || '')) ? source.individual_ratio as '1:1' | '1:2' | '1:3' : undefined,
      office_task: cleanText(source.office_task, 60) || undefined,
      school_id: resolveAttendanceSchoolCode(source.school_id) || undefined,
      approval_status: 'pending',
    });

    if (!attendanceSegmentNeedsSchool(segment)) delete segment.school_id;
    if (attendanceSegmentNeedsSchool(segment) && !isAttendanceSchool(segment.school_id)) {
      throw new Error('勤務校舎を選択肢から選んでください。');
    }

    if (!TIME_PATTERN.test(segment.start) || !TIME_PATTERN.test(segment.end) || segment.start >= segment.end) {
      throw new Error('業務内訳の開始・終了時刻を正しく入力してください。');
    }
    const validationError = validateAttendanceSegment(segment);
    if (validationError) throw new Error(validationError);
    return segment;
  }).sort((a, b) => a.start.localeCompare(b.start));

  for (let index = 1; index < segments.length; index += 1) {
    if (segments[index].start < segments[index - 1].end) {
      throw new Error('業務内訳の時間帯が重複しています。');
    }
  }
  return segments;
}

function normalizeTransportation(value: unknown) {
  if (!Array.isArray(value)) return [];
  if (value.length > 50) throw new Error('交通費は50件以内で入力してください。');
  return value.map(raw => {
    const source = raw && typeof raw === 'object' ? raw as Record<string, unknown> : {};
    const cost = Number(source.cost || 0);
    if (!Number.isFinite(cost) || cost < 0 || cost > 1_000_000) throw new Error('交通費の金額が正しくありません。');
    return Object.fromEntries(Object.entries({
      from: cleanText(source.from, 100),
      to: cleanText(source.to, 100),
      cost,
      trip_type: source.trip_type === 'one_way' ? 'one_way' : 'round_trip',
      transport_type: cleanText(source.transport_type, 50) || undefined,
      route_line: cleanText(source.route_line, 100) || undefined,
      one_way_fare: Number.isFinite(Number(source.one_way_fare)) ? Math.max(0, Number(source.one_way_fare)) : undefined,
      fare_source: cleanText(source.fare_source, 50) || undefined,
      fare_provider: cleanText(source.fare_provider, 100) || undefined,
      commuter_pass_applied: typeof source.commuter_pass_applied === 'boolean' ? source.commuter_pass_applied : undefined,
      commuter_pass_count: Number.isFinite(Number(source.commuter_pass_count)) ? Math.max(0, Number(source.commuter_pass_count)) : undefined,
    }).filter(([, field]) => field !== undefined));
  });
}

export async function POST(request: NextRequest) {
  try {
    const actor = await getServerUser(request);
    requireRole(actor, ['teacher', 'attendance_admin']);
    const body = await request.json();
    const recordId = cleanText(body.work_record_id, 160);
    if (!recordId) return Response.json({ ok: false, error: '勤務記録を確認できませんでした。' }, { status: 400 });

    const segments = normalizeSegments(body.work_segments);
    let transportation = normalizeTransportation(body.transportation);
    const transportationNone = body.transportation_status === 'none';
    // 「交通費なし」のときは行を見ない。行に足りない所があれば、何行目かを示す。
    const incompleteRow = transportationNone ? -1 : transportation.findIndex(item => !String(item.from || '').trim() || !String(item.to || '').trim());
    if (incompleteRow >= 0) {
      return Response.json({ ok: false, error: `交通費の${incompleteRow + 1}行目の出発地と到着地を入力してください（使わない行は消してください）。` }, { status: 400 });
    }
    if (transportationNone) transportation = [];
    const transportationStatus = transportationNone ? 'none' : transportation.length ? 'entered' : 'unset';
    const attendanceKind = segments.some(segment => segmentProgram(segment) === 'breakthrough') ? 'breakthrough' : 'normal';
    const db = adminDb();
    const ref = db.collection('work_records').doc(recordId);
    // 承認APIと同時に走っても承認を上書きしないよう、確認と書き込みを同じトランザクションで行う。
    const rejection = await db.runTransaction(async tx => {
      const snapshot = await tx.get(ref);
      if (!snapshot.exists) return { status: 404, error: '勤務記録が見つかりません。' };
      const record = snapshot.data() || {};
      if (String(record.teacher_id || '') !== actor.uid) throw new Error('forbidden');
      const existingSegments = Array.isArray(record.work_segments) ? record.work_segments : [];
      if (record.status === 'approved' || existingSegments.some((segment: Record<string, unknown>) => segment.approval_status === 'approved')) {
        return { status: 409, error: '承認済みの勤務実績があるため変更できません。マスター管理者に承認解除を依頼してください。' };
      }
      if (!record.end_time) {
        return { status: 409, error: '退勤打刻後に勤務詳細を保存してください。' };
      }
      const coverageError = validateAttendanceSegmentCoverage(segments, record.start_time, record.end_time);
      if (coverageError) return { status: 400, error: coverageError };

      const now = new Date().toISOString();
      tx.set(ref, {
        attendance_kind: attendanceKind,
        work_segments: segments,
        transportation,
        transportation_status: transportationStatus,
        detail_approval_status: 'pending',
        status: 'pending',
        detail_submitted_at: now,
        detail_submitted_by: actor.uid,
        updated_at: now,
        updated_at_server: FieldValue.serverTimestamp(),
      }, { merge: true });
      return null;
    });
    if (rejection) return Response.json({ ok: false, error: rejection.error }, { status: rejection.status });

    return Response.json({ ok: true, work_record_id: recordId, segment_count: segments.length });
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error);
    const log = ['missing-token', 'profile-not-found', 'forbidden'].includes(message)
      ? console.warn
      : console.error;
    log('[teacher/attendance-details] save failed', { error: message });
    return jsonError(error);
  }
}
