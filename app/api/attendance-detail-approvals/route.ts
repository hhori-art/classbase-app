import { NextRequest } from 'next/server';
import { FieldValue } from 'firebase-admin/firestore';
import { adminDb } from '@/lib/firebase-admin';
import { canManageAttendance, canManageAttendanceSchool, canManageAttendanceSystem, getServerUser, jsonError, type ServerUser } from '@/lib/server-auth';
import { writeAuditLog } from '@/lib/server/audit-log';
import { preparedMessageOr } from '@/lib/api-error';
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
import { getAllQueryDocuments } from '@/lib/server/firestore-pagination';
import { attendanceSchoolName, isAttendanceSchool, resolveAttendanceSchoolCode } from '@/lib/attendance-schools';
import { isDedicatedProfile, isSemiDedicatedProfile } from '@/lib/employment-category';
import { shiftPlanToAttendanceSegment } from '@/lib/attendance-shift-plan';

export const runtime = 'nodejs';
type SelectedApprovalItem = { recordId: string; segmentId: string };
const EDITABLE_SEGMENT_TYPES = new Set(['lesson', 'individual', 'office', 'support', 'other', 'break', 'breakthrough_lesson', 'breakthrough_office']);
const TIME_PATTERN = /^(?:[01]\d|2[0-3]):[0-5]\d$/;
const isFiveMinuteLabel = (value: string) => TIME_PATTERN.test(value) && Number(value.slice(3, 5)) % 5 === 0;
const isFiveMinuteDate = (value: Date) => {
  const parts = new Intl.DateTimeFormat('en-GB', {
    timeZone: 'Asia/Tokyo', hour: '2-digit', minute: '2-digit', second: '2-digit', hourCycle: 'h23',
  }).formatToParts(value);
  const part = (type: Intl.DateTimeFormatPartTypes) => Number(parts.find(item => item.type === type)?.value || 0);
  return part('minute') % 5 === 0 && part('second') === 0 && value.getMilliseconds() === 0;
};

const cleanText = (value: unknown, maxLength = 300) => String(value || '').trim().slice(0, maxLength);

const normalizeEditedSegment = (value: unknown, id: string): AttendanceWorkSegment => {
  const source = value && typeof value === 'object' ? value as Record<string, unknown> : {};
  const type = cleanText(source.type, 40);
  if (!EDITABLE_SEGMENT_TYPES.has(type)) throw new Error('業務区分が正しくありません。');
  const segment = normalizeAttendanceSegment({
    id,
    start: cleanText(source.start, 5),
    end: cleanText(source.end, 5),
    type,
    note: cleanText(source.note, 500),
    program: type === 'break' ? 'normal' : segmentProgram(source),
    grade: cleanText(source.grade, 20) || undefined,
    lesson_format: type === 'individual' ? 'individual' : type === 'lesson' ? 'group' : undefined,
    individual_level: normalizeIndividualLevel(source.individual_level),
    individual_ratio: individualLevelNeedsRatio(source.individual_level) && ['1:1', '1:2', '1:3'].includes(String(source.individual_ratio || '')) ? source.individual_ratio as '1:1' | '1:2' | '1:3' : undefined,
    office_task: cleanText(source.office_task, 60) || undefined,
    school_id: resolveAttendanceSchoolCode(source.school_id) || undefined,
    approval_status: 'pending' as const,
  });
  if (!attendanceSegmentNeedsSchool(segment)) delete segment.school_id;
  if (attendanceSegmentNeedsSchool(segment) && !isAttendanceSchool(segment.school_id)) throw new Error('勤務校舎を選択肢から選んでください。');
  if (!isFiveMinuteLabel(segment.start) || !isFiveMinuteLabel(segment.end) || segment.start >= segment.end) throw new Error('開始・終了時刻は5分単位で正しく入力してください。');
  const validationError = validateAttendanceSegment(segment);
  if (validationError) throw new Error(validationError);
  return segment;
};

const normalizeTransportation = (value: unknown) => {
  if (!Array.isArray(value)) return [];
  if (value.length > 20) throw new Error('交通費は20件以内で入力してください。');
  return value.map(raw => {
    const source = raw && typeof raw === 'object' ? raw as Record<string, unknown> : {};
    const cost = Number(source.cost ?? 0);
    if (!Number.isFinite(cost) || cost < 0 || cost > 1_000_000) throw new Error('交通費の金額が正しくありません。');
    const from = cleanText(source.from, 100);
    const to = cleanText(source.to, 100);
    if (!from || !to) throw new Error('交通費の出発地と到着地を入力してください。');
    return Object.fromEntries(Object.entries({
      transport_type: cleanText(source.transport_type, 50) || 'train',
      route_line: cleanText(source.route_line, 100) || undefined,
      from,
      to,
      trip_type: source.trip_type === 'one_way' ? 'one_way' : 'round_trip',
      cost: Math.round(cost),
      one_way_fare: Number.isFinite(Number(source.one_way_fare)) ? Math.max(0, Math.round(Number(source.one_way_fare))) : undefined,
      fare_source: cleanText(source.fare_source, 50) || undefined,
      commuter_pass_applied: source.commuter_pass_applied === true ? true : undefined,
      commuter_pass_count: Number.isFinite(Number(source.commuter_pass_count)) ? Math.max(0, Math.round(Number(source.commuter_pass_count))) : undefined,
    }).filter(([, item]) => item !== undefined));
  });
};

const normalizedTransportationInput = (body: Record<string, unknown>) => {
  const status = body.transportation_status === 'none' ? 'none' : 'entered';
  const transportation = status === 'none' ? [] : normalizeTransportation(body.transportation);
  return {
    transportation,
    transportationStatus: status === 'none' ? 'none' : transportation.length ? 'entered' : 'unset',
  };
};

const monthRange = (month: string) => {
  const safe = /^\d{4}-\d{2}$/.test(month) ? month : new Date().toISOString().slice(0, 7);
  return { month: safe, start: `${safe}-01`, end: `${safe}-31` };
};

const canUseApprovalCenter = (actor: ServerUser) => canManageAttendance(actor);

const profileSchool = (profile: Record<string, any>) =>
  resolveAttendanceSchoolCode(profile.school_id || profile.school_code || profile.school_name || profile.school) ||
  String(profile.school_id || profile.school_code || profile.school_name || profile.school || '').trim();

const canEditClock = (actor: ServerUser, profile: Record<string, any>) =>
  (canManageAttendanceSystem(actor) && canManageAttendanceSchool(actor, profileSchool(profile))) ||
  (actor.role === 'teacher' &&
    isDedicatedProfile(actor.profile) &&
    actor.profile.attendance_school_manager === true &&
    isSemiDedicatedProfile(profile) &&
    canManageAttendanceSchool(actor, profileSchool(profile)));

const canCreateRecordFor = (actor: ServerUser, profile: Record<string, any>) =>
  canEditClock(actor, profile);

const canListStaffForCreation = (actor: ServerUser, profile: Record<string, any>) => {
  if (!canCreateRecordFor(actor, profile)) return false;
  if (actor.role === 'master') return true;
  const actorSchool = profileSchool(actor.profile);
  return Boolean(actorSchool && actorSchool === profileSchool(profile));
};

const clockLabel = (value: unknown) => {
  const date = new Date(String(value || ''));
  return Number.isNaN(date.getTime()) ? '' : date.toLocaleTimeString('en-GB', { timeZone: 'Asia/Tokyo', hour: '2-digit', minute: '2-digit', hour12: false });
};

const shiftTimeRange = (shift: Record<string, any>) => {
  const explicit = String(shift.requested_time_range || '').normalize('NFKC').match(/(\d{1,2}):(\d{2})\s*[〜~～-]\s*(\d{1,2}):(\d{2})/);
  if (explicit) return { start: `${explicit[1].padStart(2, '0')}:${explicit[2]}`, end: `${explicit[3].padStart(2, '0')}:${explicit[4]}` };
  const period = Number(String(shift.period || shift.slot || shift.period_label || shift.note || '').normalize('NFKC').match(/([12])/)?.[1] || 0);
  if (period === 1) return { start: '19:20', end: '20:25' };
  if (period === 2) return { start: '20:35', end: '21:40' };
  return null;
};

const rangesOverlap = (left: { start: string; end: string }, right: { start: string; end: string }) =>
  left.start < right.end && right.start < left.end;

const effectiveSchool = (segment: Partial<AttendanceWorkSegment>, record: Record<string, any>, profile: Record<string, any>) =>
  resolveAttendanceSchoolCode(segment.school_id || record.school_id || profile.school_id || profile.school_code || profile.school_name || profile.school) ||
  String(segment.school_id || record.school_id || profile.school_id || profile.school_code || profile.school_name || profile.school || '').trim();

const segmentStatus = (segment: Partial<AttendanceWorkSegment>, record: Record<string, any>) => {
  if (segment.type === 'break') return 'approved';
  if (['pending', 'approved', 'rejected'].includes(String(segment.approval_status || ''))) return String(segment.approval_status);
  return record.status === 'approved' ? 'approved' : 'pending';
};

const canReviewSegment = (
  actor: ServerUser,
  segment: Partial<AttendanceWorkSegment>,
  record: Record<string, any>,
  profile: Record<string, any>,
) => {
  if (segment.type === 'break') return false;
  // 自分の勤務実績は自分で承認しない（マスター以外。ほかの承認者が承認する）。
  if (actor.role !== 'master' && String(record.teacher_id || '') === actor.uid) return false;
  if (actor.role === 'teacher' && segmentProgram(segment) === 'science_social') return false;
  return canManageAttendanceSchool(actor, effectiveSchool(segment, record, profile));
};

// 休憩は承認の対象ではないが、講師が間違えて入れた休憩（自動で入った休憩を含む）は、その校舎の承認者が直せる。
const canEditBreakSegment = (
  actor: ServerUser,
  segment: Partial<AttendanceWorkSegment>,
  record: Record<string, any>,
  profile: Record<string, any>,
) => {
  if (actor.role !== 'master' && String(record.teacher_id || '') === actor.uid) return false;
  return canManageAttendanceSchool(actor, effectiveSchool(segment, record, profile));
};

const recordSegments = (record: Record<string, any>) =>
  Array.isArray(record.work_segments) ? record.work_segments as Array<Record<string, any>> : [];

// 打刻の編集・削除・明細の全件置換は、個別承認より影響範囲が広い。
// 校舎承認者が理社講座を「通常」に置換したり、実績ごと削除する迂回経路も塞ぐ。
const canManageWholeRecord = (actor: ServerUser, record: Record<string, any>, profile: Record<string, any>) =>
  canEditClock(actor, profile) && recordSegments(record).every(segment =>
    segment.type === 'break' || canReviewSegment(actor, segment, record, profile)
  );

const hasApprovedWork = (record: Record<string, any>) =>
  String(record.status || '') === 'approved' || recordSegments(record).some(segment =>
    segment.type !== 'break' && segmentStatus(segment, record) === 'approved'
  );

const summarizeStatus = (segments: Array<Record<string, any>>) => {
  const work = segments.filter(segment => segment.type !== 'break');
  if (!work.length) return 'pending';
  if (work.some(segment => segment.approval_status === 'rejected')) return 'rejected';
  if (work.every(segment => segment.approval_status === 'approved')) return 'approved';
  return 'pending';
};

const visibleTransportation = (items: unknown) => Array.isArray(items) ? items.map(item => {
  const source = item && typeof item === 'object' ? item as Record<string, unknown> : {};
  return {
    transport_type: String(source.transport_type || ''),
    route_line: String(source.route_line || ''),
    from: String(source.from || ''),
    to: String(source.to || ''),
    trip_type: source.trip_type === 'one_way' ? 'one_way' : 'round_trip',
    cost: Math.max(0, Number(source.cost) || 0),
    one_way_fare: Math.max(0, Number(source.one_way_fare) || 0),
    fare_source: String(source.fare_source || ''),
    commuter_pass_applied: source.commuter_pass_applied === true,
    commuter_pass_count: Math.max(0, Number(source.commuter_pass_count) || 0),
  };
}) : [];

export async function GET(request: NextRequest) {
  try {
    const actor = await getServerUser(request);
    if (!canUseApprovalCenter(actor)) throw new Error('forbidden');
    const { month, start, end } = monthRange(String(request.nextUrl.searchParams.get('month') || ''));
    const db = adminDb();
    if (request.nextUrl.searchParams.get('staff_only') === '1') {
      const staffDocs = (await Promise.all(['teacher', 'attendance_admin', 'attendance_only', 'attendance_manager'].map(role =>
        getAllQueryDocuments(db.collection('users').where('role', '==', role))
      ))).flat();
      const staff = Array.from(new Map<string, Record<string, any>>(staffDocs.map(doc => [doc.id, { id: doc.id, ...(doc.data() || {}) }])).values())
        .filter(item => !['suspended', 'withdrawn', 'archived'].includes(String(item.account_status || item.status || '')))
        .filter(item => canListStaffForCreation(actor, item))
        .map(item => ({
          id: item.id,
          name: item.name || item.teacher_name || item.display_name || item.lifetime_id || '氏名未設定',
          login_id: item.lifetime_id || item.initial_login_id || '',
          school_id: profileSchool(item),
          school_name: attendanceSchoolName(profileSchool(item)) || item.school_name || item.school || '',
        }))
        .sort((a, b) => String(a.name).localeCompare(String(b.name), 'ja'));
      return Response.json({ ok: true, staff });
    }
    const [recordDocs, shiftDocs] = await Promise.all([
      getAllQueryDocuments(db.collection('work_records').where('date', '>=', start).where('date', '<=', end)),
      // 管理者の月次照合専用。生徒導線の読取予算には含めない。
      actor.role === 'master'
        ? getAllQueryDocuments(db['collection']('shift_assignments').where('target_date', '>=', start).where('target_date', '<=', end))
        : Promise.resolve([]),
    ]);
    const todayInJapan = new Date().toLocaleDateString('sv-SE', { timeZone: 'Asia/Tokyo' });
    const scienceSocialShifts = shiftDocs.map(doc => ({ id: doc.id, ...(doc.data() || {}) } as Record<string, any>)).filter(shift => {
      const label = [shift.program, shift.target_subject, shift.target_detail_subject, shift.course_name, shift.note].filter(Boolean).join(' ');
      return String(shift.target_date || '') < todayInJapan && /理社|理科|社会/.test(label);
    });
    const teacherIds = Array.from(new Set([
      ...recordDocs.map(doc => String(doc.data()?.teacher_id || '')),
      ...scienceSocialShifts.map(shift => String(shift.user_id || '')),
    ].filter(Boolean)));
    const profiles = new Map((await Promise.all(teacherIds.map(async uid => {
      const snap = await db.collection('users').doc(uid).get();
      return [uid, snap.data() || {}] as const;
    }))));


    const records = recordDocs.map(doc => ({ id: doc.id, ...doc.data() } as Record<string, any>))
      .map(record => {
        const profile = profiles.get(String(record.teacher_id)) || {};
        const schoolId = profileSchool(profile);
        const workSegments = (Array.isArray(record.work_segments) ? record.work_segments : []).map((raw: Record<string, any>, index: number) => {
          const schoolId = effectiveSchool(raw, record, profile);
          return {
            ...raw,
            id: String(raw.id || `${record.id}:${index}`),
            // 承認画面ではプログラム種別にかかわらず、認可に使用した勤務校舎を表示する。
            school_id: schoolId || undefined,
            school_name: schoolId ? attendanceSchoolName(schoolId) : undefined,
            approval_status: segmentStatus(raw, record),
            can_review: canReviewSegment(actor, raw, record, profile),
            ...(raw.type === 'break' ? { can_edit: canEditBreakSegment(actor, raw, record, profile) } : {}),
          };
        });
        const detailMissing = !workSegments.some((segment: Record<string, any>) => segment.type !== 'break');
        return {
          id: record.id,
          teacher_id: record.teacher_id,
          teacher_name: record.teacher_name || profile.name || '講師未設定',
          date: record.date,
          start_time: record.start_time,
          end_time: record.end_time,
          school_id: schoolId || undefined,
          school_name: schoolId ? attendanceSchoolName(schoolId) : undefined,
          can_edit_clock: canManageWholeRecord(actor, record, profile) && !hasApprovedWork(record),
          attendance_kind: record.attendance_kind || 'normal',
          transportation: visibleTransportation(record.transportation),
          transportation_status: record.transportation_status === 'none' ? 'none' : record.transportation_status === 'entered' ? 'entered' : 'unset',
          work_segments: workSegments,
          detail_missing: detailMissing,
          detail_approval_status: summarizeStatus(workSegments),
        };
      })
      .filter(record =>
        canManageAttendanceSchool(actor, record.school_id) ||
        record.can_edit_clock ||
        record.work_segments.some((segment: Record<string, any>) => segment.can_review)
      )
      .sort((a, b) => String(b.date).localeCompare(String(a.date)));

    const recordByTeacherDate = new Map(records.map(record => [`${record.teacher_id}\u0000${record.date}`, record]));
    const shiftsByTeacherDate = new Map<string, Array<Record<string, any>>>();
    scienceSocialShifts.forEach(shift => {
      const teacherId = String(shift.user_id || '');
      const date = String(shift.target_date || '');
      const profile = profiles.get(teacherId) || {};
      if (!teacherId || !date || !canListStaffForCreation(actor, profile)) return;
      const key = `${teacherId}\u0000${date}`;
      shiftsByTeacherDate.set(key, [...(shiftsByTeacherDate.get(key) || []), shift]);
    });
    const reconciliationAlertMap = new Map<string, Record<string, unknown>>();
    shiftsByTeacherDate.forEach((dayShifts, key) => {
      const firstShift = dayShifts[0];
      const teacherId = String(firstShift.user_id || '');
      const date = String(firstShift.target_date || '');
      const profile = profiles.get(teacherId) || {};
      const record = recordByTeacherDate.get(key);
      const base = { shift_id: firstShift.id, teacher_id: teacherId, teacher_name: firstShift.teacher_name || profile.name || '講師未設定', date };
      if (!record) {
        reconciliationAlertMap.set(key, { ...base, code: 'missing_record', message: '理社講座の講師配置がありますが、勤務実績が未登録です。' });
        return;
      }
      const workSegments = record.work_segments.filter((segment: Record<string, any>) => segment.type !== 'break');
      if (workSegments.length === 0) {
        reconciliationAlertMap.set(key, { ...base, record_id: record.id, code: 'missing_detail', message: '打刻はありますが、勤務詳細が未登録です。' });
        return;
      }
      const timedShifts = dayShifts.map(shift => ({ shift, range: shiftTimeRange(shift) })).filter(item => item.range);
      const scienceSegments = workSegments.filter((segment: Record<string, any>) => segmentProgram(segment) === 'science_social');
      // 配置時間が取得できない旧データは、同日の理社明細の有無で後方互換判定する。
      if (!timedShifts.length) {
        if (!scienceSegments.length) reconciliationAlertMap.set(key, { ...base, record_id: record.id, code: 'missing_science_social_detail', message: '理社講座の講師配置がありますが、理社講座の勤務詳細が未登録です。' });
        return;
      }
      const uncovered = timedShifts.filter(item => !scienceSegments.some((segment: Record<string, any>) =>
        rangesOverlap(item.range!, { start: String(segment.start || ''), end: String(segment.end || '') })
      ));
      if (!uncovered.length) return;
      const normalOverlapsAssignment = uncovered.some(item => workSegments.some((segment: Record<string, any>) =>
        segmentProgram(segment) !== 'science_social' && rangesOverlap(item.range!, { start: String(segment.start || ''), end: String(segment.end || '') })
      ));
      if (normalOverlapsAssignment) {
        reconciliationAlertMap.set(key, { ...base, record_id: record.id, code: 'wrong_program', message: '理社講座の配置時間と重なる勤務詳細が「通常」で登録されています。' });
        return;
      }
      reconciliationAlertMap.set(key, {
        ...base,
        record_id: record.id,
        code: scienceSegments.length ? 'science_social_time_mismatch' : 'missing_science_social_detail',
        message: scienceSegments.length
          ? '理社講座の配置時間と勤務詳細の時間が一致しません。'
          : '理社講座の配置時間に該当する勤務詳細が未登録です。',
      });
    });
    const reconciliationAlerts = Array.from(reconciliationAlertMap.values());

    return Response.json({
      ok: true,
      month,
      records,
      can_reject: actor.role === 'master',
      can_unlock: actor.role === 'master',
      reconciliation_alerts: reconciliationAlerts,
    });
  } catch (error) {
    return jsonError(error);
  }
}

export async function POST(request: NextRequest) {
  try {
    const actor = await getServerUser(request);
    if (!canUseApprovalCenter(actor)) throw new Error('forbidden');
    const body = await request.json();
    const recordId = String(body.work_record_id || '').trim();
    if (String(body.action || '') === 'create_record') {
      const teacherId = cleanText(body.teacher_id, 128);
      const date = cleanText(body.date, 10);
      const requestedStart = cleanText(body.start, 5);
      const requestedEnd = cleanText(body.end, 5);
      if (!teacherId || !/^\d{4}-\d{2}-\d{2}$/.test(date) || !isFiveMinuteLabel(requestedStart) || !isFiveMinuteLabel(requestedEnd) || requestedStart >= requestedEnd) {
        return Response.json({ ok: false, error: '職員・日付・出勤時刻・退勤時刻を正しく入力してください。' }, { status: 400 });
      }
      const db = adminDb();
      const profileSnap = await db.doc(`users/${teacherId}`).get();
      if (!profileSnap.exists) return Response.json({ ok: false, error: '対象職員が見つかりません。' }, { status: 404 });
      const targetProfile = profileSnap.data() || {};
      if (!canListStaffForCreation(actor, targetProfile)) throw new Error('forbidden');
      const schoolId = resolveAttendanceSchoolCode(body.school_id || profileSchool(targetProfile));
      if (!schoolId || !canManageAttendanceSchool(actor, schoolId)) throw new Error('forbidden');
      let transportationInput: ReturnType<typeof normalizedTransportationInput>;
      try {
        transportationInput = normalizedTransportationInput(body);
      } catch (error) {
        return Response.json({ ok: false, error: preparedMessageOr(error, '交通費を確認してください。') }, { status: 400 });
      }

      let segments: AttendanceWorkSegment[] = [];
      if (body.use_shift_base === true) {
        const shiftDocs = await getAllQueryDocuments(db.collection('attendance_shift_plans').where('date', '==', date).limit(250));
        segments = shiftDocs
          .map(doc => ({ id: doc.id, ...(doc.data() || {}) } as Record<string, any>))
          .filter(shift => String(shift.teacher_id || '') === teacherId && shift.reflect_to_attendance !== false && resolveAttendanceSchoolCode(shift.school_id) === schoolId)
          .map(shift => normalizeAttendanceSegment({ ...shiftPlanToAttendanceSegment(shift), id: crypto.randomUUID() }) as AttendanceWorkSegment);
      }
      if (!segments.length && body.clock_only !== true) {
        let segment: AttendanceWorkSegment;
        try {
          segment = normalizeEditedSegment(body.segment || { start: requestedStart, end: requestedEnd, type: 'office', office_task: 'lesson_preparation', school_id: schoolId }, crypto.randomUUID());
        } catch (error) {
          return Response.json({ ok: false, error: preparedMessageOr(error, '勤務詳細を確認してください。') }, { status: 400 });
        }
        segments = [segment];
      }
      segments.sort((a, b) => a.start.localeCompare(b.start));
      const ref = db.collection('work_records').doc();
      const startTime = new Date(`${date}T${requestedStart}:00+09:00`).toISOString();
      const endTime = new Date(`${date}T${requestedEnd}:00+09:00`).toISOString();
      await db.runTransaction(async transaction => {
        const duplicate = await transaction.get(db.collection('work_records').where('teacher_id', '==', teacherId).where('date', '==', date).limit(1));
        if (!duplicate.empty) throw new Error('この職員・日付の勤務実績は既に存在します。');
        transaction.create(ref, {
          teacher_id: teacherId,
          teacher_name: targetProfile.name || targetProfile.teacher_name || targetProfile.display_name || '氏名未設定',
          school_id: schoolId,
          school_name: attendanceSchoolName(schoolId),
          date, start_time: startTime, end_time: endTime,
          status: 'pending', detail_approval_status: 'pending', attendance_kind: 'normal',
          default_program: 'normal', workplace_type: 'school', work_segments: segments,
          transportation: transportationInput.transportation, transportation_status: transportationInput.transportationStatus,
          manager_created_by: actor.uid, manager_created_at: FieldValue.serverTimestamp(),
          creation_source: body.use_shift_base === true ? 'shift_base' : body.clock_only === true ? 'manager_clock_only' : 'manual',
          created_at: new Date().toISOString(), updated_at: new Date().toISOString(),
        });
        transaction.create(db.collection('attendance_record_edits').doc(), {
          work_record_id: ref.id, teacher_id: teacherId, school_id: schoolId,
          edited_by: actor.uid, edited_at: FieldValue.serverTimestamp(), source: body.use_shift_base === true ? 'shift_base_create' : 'manager_create',
        });
      });
      console.log(JSON.stringify({
        level: 'info', message: 'attendance record created', route: '/api/attendance-detail-approvals',
        action: 'create_record', record_id: ref.id, teacher_id: teacherId, school_id: schoolId, date,
        actor_id: actor.uid, segment_count: segments.length, request_id: request.headers.get('x-vercel-id') || '',
      }));
      return Response.json({ ok: true, record_id: ref.id, segment_count: segments.length });
    }
    if (String(body.action || '') === 'save_transportation') {
      if (!recordId) return Response.json({ ok: false, error: '勤務実績を確認できません。' }, { status: 400 });
      let transportationInput: ReturnType<typeof normalizedTransportationInput>;
      try {
        transportationInput = normalizedTransportationInput(body);
      } catch (error) {
        return Response.json({ ok: false, error: preparedMessageOr(error, '交通費を確認してください。') }, { status: 400 });
      }
      const db = adminDb();
      const ref = db.doc(`work_records/${recordId}`);
      await db.runTransaction(async transaction => {
        const snap = await transaction.get(ref);
        if (!snap.exists) throw new Error('work record not found');
        const record = snap.data() || {};
        const profile = record.teacher_id ? (await transaction.get(db.collection('users').doc(String(record.teacher_id)))).data() || {} : {};
        if (!canManageWholeRecord(actor, record, profile)) throw new Error('forbidden');
        if (hasApprovedWork(record)) throw new Error('承認済みの勤務は、先に承認を解除してください。');
        transaction.create(db.collection('attendance_record_edits').doc(), {
          work_record_id: recordId,
          teacher_id: record.teacher_id || null,
          previous_transportation: visibleTransportation(record.transportation),
          previous_transportation_status: record.transportation_status || 'unset',
          updated_transportation: transportationInput.transportation,
          updated_transportation_status: transportationInput.transportationStatus,
          edited_by: actor.uid,
          edited_at: FieldValue.serverTimestamp(),
          source: 'attendance_approval_center_transportation',
        });
        transaction.set(ref, {
          transportation: transportationInput.transportation,
          transportation_status: transportationInput.transportationStatus,
          manager_edited_by: actor.uid,
          manager_edited_at: FieldValue.serverTimestamp(),
          updated_at: new Date().toISOString(),
        }, { merge: true });
      });
      return Response.json({ ok: true, ...transportationInput });
    }
    if (String(body.action || '') === 'save_segments') {
      if (!recordId || !Array.isArray(body.segments) || body.segments.length > 100) {
        return Response.json({ ok: false, error: '勤務詳細を確認してください。' }, { status: 400 });
      }
      let requestedSegments: AttendanceWorkSegment[];
      try {
        requestedSegments = body.segments.map((segment: unknown) => {
          const source = segment && typeof segment === 'object' ? segment as Record<string, unknown> : {};
          return normalizeEditedSegment(source, cleanText(source.id, 160) || crypto.randomUUID());
        }).sort((a: AttendanceWorkSegment, b: AttendanceWorkSegment) => a.start.localeCompare(b.start));
        for (let index = 1; index < requestedSegments.length; index += 1) {
          if (requestedSegments[index].start < requestedSegments[index - 1].end) throw new Error('勤務詳細の時間帯が重複しています。');
        }
      } catch (error) {
        return Response.json({ ok: false, error: preparedMessageOr(error, '勤務詳細を確認してください。') }, { status: 400 });
      }
      const db = adminDb();
      const ref = db.doc(`work_records/${recordId}`);
      await db.runTransaction(async transaction => {
        const snap = await transaction.get(ref);
        if (!snap.exists) throw new Error('work record not found');
        const record = snap.data() || {};
        const profile = record.teacher_id ? (await transaction.get(db.collection('users').doc(String(record.teacher_id)))).data() || {} : {};
        if (!canManageWholeRecord(actor, record, profile)) throw new Error('forbidden');
        if (requestedSegments.some(segment => segment.type !== 'break' && !canReviewSegment(actor, segment, record, profile))) throw new Error('forbidden');
        const start = clockLabel(record.start_time);
        const end = clockLabel(record.end_time);
        if (requestedSegments.some(segment => segment.start < start || segment.end > end)) throw new Error(`勤務詳細は打刻時間（${start}〜${end}）内で入力してください。`);
        const coverageError = validateAttendanceSegmentCoverage(requestedSegments, record.start_time, record.end_time);
        if (coverageError) throw new Error(coverageError);
        if (hasApprovedWork(record)) {
          throw new Error('承認済みの勤務があるため、先に承認を解除してください。');
        }
        transaction.set(db.collection('attendance_detail_edits').doc(), {
          work_record_id: recordId, teacher_id: record.teacher_id || null,
          previous_segments: record.work_segments || [], updated_segments: requestedSegments,
          edited_by: actor.uid, edited_at: FieldValue.serverTimestamp(), source: 'attendance_approval_center_batch',
        });
        transaction.set(ref, { work_segments: requestedSegments, detail_approval_status: 'pending', status: 'pending', updated_at: new Date().toISOString() }, { merge: true });
      });
      return Response.json({ ok: true, work_segments: requestedSegments });
    }
    if (String(body.action || '') === 'delete_record') {
      if (!recordId) return Response.json({ ok: false, error: '勤務実績を確認できません。' }, { status: 400 });
      const db = adminDb();
      const ref = db.doc(`work_records/${recordId}`);
      let deleted: FirebaseFirestore.DocumentData = {};
      await db.runTransaction(async transaction => {
        const snap = await transaction.get(ref);
        if (!snap.exists) throw new Error('work record not found');
        const record = snap.data() || {};
        deleted = record;
        const profile = record.teacher_id ? (await transaction.get(db.collection('users').doc(String(record.teacher_id)))).data() || {} : {};
        if (!canManageWholeRecord(actor, record, profile)) throw new Error('forbidden');
        if (hasApprovedWork(record)) throw new Error('承認済みの勤務は、先に承認を解除してください。');
        transaction.create(db.collection('attendance_record_edits').doc(), { work_record_id: recordId, teacher_id: record.teacher_id || null, deleted_record: record, edited_by: actor.uid, edited_at: FieldValue.serverTimestamp(), source: 'attendance_manager_delete' });
        transaction.delete(ref);
      });
      await writeAuditLog({
        actor,
        action: 'attendance_record_delete',
        target_type: 'work_record',
        target_id: recordId,
        target_label: [deleted.teacher_name, deleted.date].filter(Boolean).join(' '),
        school_id: String(deleted.school_id || ''),
        details: { teacher_id: deleted.teacher_id || null, date: deleted.date || null },
      });
      return Response.json({ ok: true });
    }
    if (String(body.action || '') === 'edit_segment') {
      const requestedSegmentId = String(body.segment_id || '').trim();
      if (!recordId || !requestedSegmentId) return Response.json({ ok: false, error: 'invalid request' }, { status: 400 });
      let requestedSegment: AttendanceWorkSegment;
      try {
        requestedSegment = normalizeEditedSegment(body.segment, requestedSegmentId);
      } catch (error) {
        return Response.json({ ok: false, error: preparedMessageOr(error, '入力内容を確認してください。') }, { status: 400 });
      }

      const db = adminDb();
      const ref = db.collection('work_records').doc(recordId);
      const auditRef = db.collection('attendance_detail_edits').doc();
      await db.runTransaction(async transaction => {
        const snap = await transaction.get(ref);
        if (!snap.exists) throw new Error('work record not found');
        const record = snap.data() || {};
        const profile = record.teacher_id
          ? (await transaction.get(db.collection('users').doc(String(record.teacher_id)))).data() || {}
          : {};
        const segments: Array<Record<string, any>> = Array.isArray(record.work_segments)
          ? record.work_segments.map((segment: Record<string, any>, index: number) => ({ ...segment, id: String(segment.id || `${recordId}:${index}`) }))
          : [];
        const index = segments.findIndex(segment => segment.id === requestedSegmentId);
        if (index < 0) throw new Error('work segment not found');
        const previous = segments[index];
        const canEdit = (segment: Partial<AttendanceWorkSegment>) => segment.type === 'break'
          ? canEditBreakSegment(actor, segment, record, profile)
          : canReviewSegment(actor, segment, record, profile);
        if (!canEdit(previous)) throw new Error('forbidden');
        if (!canEdit(requestedSegment)) throw new Error('forbidden');
        // 休憩はいつも「承認済み」扱いなので、承認の解除はいらない。
        if (previous.type !== 'break' && segmentStatus(previous, record) === 'approved') throw new Error('承認済みの勤務は、先に承認を解除してください。');
        const clockStart = clockLabel(record.start_time);
        const clockEnd = clockLabel(record.end_time);
        if (clockStart && clockEnd && (requestedSegment.start < clockStart || requestedSegment.end > clockEnd)) {
          throw new Error(`勤務詳細は打刻時間（${clockStart}〜${clockEnd}）内で入力してください。`);
        }

        const nextSegment = { ...requestedSegment } as Record<string, any>;
        segments[index] = nextSegment;
        segments.sort((a, b) => String(a.start || '').localeCompare(String(b.start || '')));
        for (let itemIndex = 1; itemIndex < segments.length; itemIndex += 1) {
          if (String(segments[itemIndex].start || '') < String(segments[itemIndex - 1].end || '')) {
            throw new Error('勤務詳細の時間帯が重複しています。');
          }
        }
        const updatedAt = new Date().toISOString();
        const detailStatus = summarizeStatus(segments.map(segment => ({ ...segment, approval_status: segmentStatus(segment, record) })));
        transaction.set(auditRef, {
          work_record_id: recordId,
          segment_id: requestedSegmentId,
          teacher_id: record.teacher_id || null,
          previous_segment: JSON.parse(JSON.stringify(previous)),
          updated_segment: JSON.parse(JSON.stringify(nextSegment)),
          edited_by: actor.uid,
          edited_at: FieldValue.serverTimestamp(),
          source: 'attendance_approval_center',
        });
        transaction.set(ref, {
          work_segments: segments,
          detail_approval_status: detailStatus,
          // 休憩だけを直したときは、承認済みの日を承認待ちに戻さない。
          status: detailStatus === 'approved' ? 'approved' : 'pending',
          updated_at: updatedAt,
        }, { merge: true });
      });
      return Response.json({ ok: true });
    }
    if (String(body.action || '') === 'approve_selected') {
      const rawItems: unknown[] = Array.isArray(body.items) ? body.items : [];
      const items: SelectedApprovalItem[] = rawItems.map((item: unknown): SelectedApprovalItem => {
        const source = item && typeof item === 'object' ? item as Record<string, unknown> : {};
        return {
          recordId: String(source.work_record_id || '').trim(),
          segmentId: String(source.segment_id || '').trim(),
        };
      }).filter(item => item.recordId && item.segmentId);
      if (!items.length || items.length > 200) {
        return Response.json({ ok: false, error: '承認対象を1件以上200件以内で選択してください。' }, { status: 400 });
      }
      const uniqueItems: SelectedApprovalItem[] = Array.from(new Map<string, SelectedApprovalItem>(items.map(item => [`${item.recordId}\u0000${item.segmentId}`, item])).values());
      const db = adminDb();
      let approvedCount = 0;
      await db.runTransaction(async transaction => {
        const recordIds = Array.from(new Set(uniqueItems.map(item => item.recordId)));
        const recordSnaps = await Promise.all(recordIds.map(id => transaction.get(db.collection('work_records').doc(id))));
        const records = new Map(recordSnaps.map(snap => [snap.id, snap]));
        const teacherIds = Array.from(new Set(recordSnaps.map(snap => String(snap.data()?.teacher_id || '')).filter(Boolean)));
        const profileSnaps = await Promise.all(teacherIds.map(id => transaction.get(db.collection('users').doc(id))));
        const profiles = new Map(profileSnaps.map(snap => [snap.id, snap.data() || {}]));
        const selectedByRecord = new Map<string, Set<string>>();
        uniqueItems.forEach(item => {
          const selected = selectedByRecord.get(item.recordId) || new Set<string>();
          selected.add(item.segmentId);
          selectedByRecord.set(item.recordId, selected);
        });
        const reviewedAt = new Date().toISOString();

        for (const [id, selectedIds] of selectedByRecord) {
          const snap = records.get(id);
          if (!snap?.exists) throw new Error('work record not found');
          const record = snap.data() || {};
          const profile = profiles.get(String(record.teacher_id || '')) || {};
          const segments: Array<Record<string, any>> = Array.isArray(record.work_segments)
            ? record.work_segments.map((segment: Record<string, any>, index: number) => ({
                ...segment,
                id: String(segment.id || `${id}:${index}`),
                approval_status: segmentStatus(segment, record),
              }))
            : [];
          for (const segmentId of selectedIds) {
            const segment = segments.find(item => item.id === segmentId);
            if (!segment) throw new Error('work segment not found');
            if (!canReviewSegment(actor, segment, record, profile)) throw new Error('forbidden');
            if (segment.approval_status !== 'pending') throw new Error('selected work segment is not pending');
            segment.approval_status = 'approved';
            segment.review_note = '';
            segment.reviewed_by = actor.uid;
            segment.reviewed_at = reviewedAt;
            approvedCount += 1;
          }
          const detailStatus = summarizeStatus(segments);
          transaction.set(snap.ref, {
            work_segments: segments,
            detail_approval_status: detailStatus,
            status: detailStatus === 'approved' ? 'approved' : 'pending',
            updated_at: reviewedAt,
          }, { merge: true });
        }
      });
      await writeAuditLog({
        actor,
        action: 'attendance_approve',
        target_type: 'work_record',
        target_id: uniqueItems[0]?.recordId || '',
        target_label: `${approvedCount}件の勤務実績`,
        details: { count: approvedCount, work_record_ids: Array.from(new Set(uniqueItems.map(item => item.recordId))).slice(0, 30) },
      });
      return Response.json({ ok: true, updated: approvedCount });
    }
    if (String(body.action || '') === 'edit_clock') {
      const requestedStart = new Date(String(body.start_time || ''));
      const requestedEnd = new Date(String(body.end_time || ''));
      if (!recordId || Number.isNaN(requestedStart.getTime()) || Number.isNaN(requestedEnd.getTime()) || requestedStart >= requestedEnd) {
        return Response.json({ ok: false, error: '出勤・退勤時刻を正しく入力してください。' }, { status: 400 });
      }
      if (!isFiveMinuteDate(requestedStart) || !isFiveMinuteDate(requestedEnd)) {
        return Response.json({ ok: false, error: '出勤・退勤時刻は5分単位で入力してください。' }, { status: 400 });
      }
      if (requestedEnd.getTime() - requestedStart.getTime() > 24 * 60 * 60 * 1000) {
        return Response.json({ ok: false, error: '勤務時間は24時間以内で入力してください。' }, { status: 400 });
      }

      const db = adminDb();
      const ref = db.collection('work_records').doc(recordId);
      const auditRef = db.collection('attendance_record_edits').doc();
      await db.runTransaction(async transaction => {
        const snap = await transaction.get(ref);
        if (!snap.exists) throw new Error('work record not found');
        const record = snap.data() || {};
        const profile = record.teacher_id
          ? (await transaction.get(db.collection('users').doc(String(record.teacher_id)))).data() || {}
          : {};
        if (!canManageWholeRecord(actor, record, profile)) throw new Error('forbidden');
        if (hasApprovedWork(record)) throw new Error('承認済みの勤務は、先に承認を解除してください。');
        const recordDate = String(record.date || '');
        const startDate = requestedStart.toLocaleDateString('sv-SE', { timeZone: 'Asia/Tokyo' });
        const endDate = requestedEnd.toLocaleDateString('sv-SE', { timeZone: 'Asia/Tokyo' });
        if (!recordDate || startDate !== recordDate || endDate !== recordDate) {
          throw new Error('clock time must match work date');
        }
        const nextStart = requestedStart.toISOString();
        const nextEnd = requestedEnd.toISOString();
        transaction.set(auditRef, {
          work_record_id: recordId,
          teacher_id: record.teacher_id || null,
          teacher_name: record.teacher_name || profile.name || null,
          school_id: profileSchool(profile) || null,
          previous_start_time: record.start_time || null,
          previous_end_time: record.end_time || null,
          updated_start_time: nextStart,
          updated_end_time: nextEnd,
          edited_by: actor.uid,
          edited_at: FieldValue.serverTimestamp(),
          source: 'attendance_school_manager',
        });
        transaction.set(ref, {
          start_time: nextStart,
          end_time: nextEnd,
          manager_edited_by: actor.uid,
          manager_edited_at: FieldValue.serverTimestamp(),
          updated_at: new Date().toISOString(),
        }, { merge: true });
      });
      return Response.json({ ok: true });
    }
    const requestedSegmentId = String(body.segment_id || '').trim();
    const status = String(body.status || '');
    if (!recordId || !requestedSegmentId || !['approved', 'rejected', 'pending'].includes(status)) {
      return Response.json({ ok: false, error: 'invalid request' }, { status: 400 });
    }
    if ((status === 'pending' || status === 'rejected') && actor.role !== 'master') throw new Error('forbidden');

    const db = adminDb();
    const ref = db.collection('work_records').doc(recordId);
    let reviewed: FirebaseFirestore.DocumentData = {};
    await db.runTransaction(async transaction => {
      const snap = await transaction.get(ref);
      if (!snap.exists) throw new Error('work record not found');
      const record = snap.data() || {};
      reviewed = record;
      const profile = record.teacher_id
        ? (await transaction.get(db.collection('users').doc(String(record.teacher_id)))).data() || {}
        : {};
      const segments: Array<Record<string, any>> = Array.isArray(record.work_segments) ? record.work_segments.map((segment: Record<string, any>) => ({
        ...segment,
        approval_status: segmentStatus(segment, record),
      })) : [];
      const index = segments.findIndex((segment: Record<string, any>, itemIndex: number) =>
        String(segment.id || `${recordId}:${itemIndex}`) === requestedSegmentId
      );
      if (index < 0) throw new Error('work segment not found');
      const target = segments[index];
      if (!canReviewSegment(actor, target, record, profile)) throw new Error('forbidden');

      target.id = String(target.id || crypto.randomUUID());
      target.approval_status = status;
      if (status === 'pending') {
        delete target.review_note;
        delete target.reviewed_by;
        delete target.reviewed_at;
      } else {
        target.review_note = String(body.review_note || '').slice(0, 500);
        target.reviewed_by = actor.uid;
        target.reviewed_at = new Date().toISOString();
      }
      const detailStatus = summarizeStatus(segments.map((segment: Record<string, any>) => ({
        ...segment,
        approval_status: segmentStatus(segment, record),
      })));
      transaction.set(ref, {
        work_segments: segments,
        detail_approval_status: detailStatus,
        status: detailStatus === 'approved' ? 'approved' : 'pending',
        updated_at: new Date().toISOString(),
      }, { merge: true });
    });
    await writeAuditLog({
      actor,
      action: 'attendance_review',
      target_type: 'work_record',
      target_id: recordId,
      target_label: [reviewed.teacher_name, reviewed.date].filter(Boolean).join(' '),
      school_id: String(reviewed.school_id || ''),
      details: { segment_id: requestedSegmentId, status },
    });
    return Response.json({ ok: true });
  } catch (error) {
    console.error(JSON.stringify({
      level: 'error', message: 'attendance approval request failed', route: '/api/attendance-detail-approvals',
      error: error instanceof Error ? error.message : String(error), request_id: request.headers.get('x-vercel-id') || '',
    }));
    return jsonError(error);
  }
}
