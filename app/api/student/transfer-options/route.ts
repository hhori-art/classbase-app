import { NextRequest } from 'next/server';
import { adminDb } from '@/lib/firebase-admin';
import { getServerUser, jsonError, requireRole } from '@/lib/server-auth';
import { enrichCourseOptionsWithShifts } from '@/lib/course-registration-match';
import { canStudentRegisterCourseOption } from '@/lib/course-registration-rules';
import { getCourseSubjectGroup, normalizeCourseText, toAsciiDigits } from '@/lib/course-text';
import { looksLikeZoomUrl, normalizeZoomMeetingId } from '@/lib/zoom-url';

export const runtime = 'nodejs';

const todayKeyInJapan = () => {
  const formatter = new Intl.DateTimeFormat('sv-SE', {
    timeZone: 'Asia/Tokyo',
    year: 'numeric',
    month: '2-digit',
    day: '2-digit',
  });
  return formatter.format(new Date());
};

const normalize = normalizeCourseText;

const normalizeGrade = (value: unknown) => {
  const raw = toAsciiDigits(String(value || ''));
  if (raw.includes('3')) return '中3';
  if (raw.includes('2')) return '中2';
  if (raw.includes('1')) return '中1';
  return raw.trim();
};

const periodFromShift = (shift: any) => {
  if (shift.period !== undefined && shift.period !== null && shift.period !== '') return Number(shift.period);
  const raw = toAsciiDigits(`${shift.note || ''} ${shift.time_slot || ''} ${shift.slot || ''} ${shift.target_detail_subject || ''}`);
  if (raw.includes('1限') || raw.includes('1時間目') || raw.includes('①')) return 1;
  if (raw.includes('2限') || raw.includes('2時間目') || raw.includes('②')) return 2;
  return 0;
};

const getShiftMeetingId = (shift: any) => normalizeZoomMeetingId(
  shift.target_meeting_id ||
  shift.meeting_id ||
  shift.zoom_meeting_id ||
  shift.meetingId ||
  shift.target_url ||
  shift.zoom_url ||
  shift.join_url ||
  shift.meeting_url ||
  shift.url ||
  ''
);

const getShiftJoinUrl = (shift: any) => String(
  shift.target_url ||
  shift.zoom_url ||
  shift.join_url ||
  shift.meeting_url ||
  shift.url ||
  (looksLikeZoomUrl(shift.target_meeting_id) ? shift.target_meeting_id : '') ||
  ''
).trim();

const isStudentVisibleShift = (shift: any) => (
  String(shift.role_type || 'main') === 'main' &&
  !String(shift.teacher_name || '').includes('サポート') &&
  Boolean(getShiftMeetingId(shift) || getShiftJoinUrl(shift))
);

const hasSheetSource = (shift: any) => Boolean(
  String(shift.source_spreadsheet_id || '').trim() ||
  String(shift.sync_source || '').trim() ||
  String(shift.sync_key || '').trim()
);

const preferSheetSyncedShiftsByDatePeriod = (shifts: any[]) => {
  const groups = new Map<string, any[]>();
  shifts.forEach(shift => {
    const key = `${shift.target_date || ''}_${periodFromShift(shift) || ''}`;
    if (!groups.has(key)) groups.set(key, []);
    groups.get(key)!.push(shift);
  });
  return Array.from(groups.values()).flatMap(group => {
    const sheetSynced = group.filter(hasSheetSource);
    return sheetSynced.length > 0 ? sheetSynced : group;
  });
};

const uniqueValues = (values: unknown[]) => Array.from(new Set(
  values.map(value => String(value || '').trim()).filter(Boolean)
));

const mergeTransferOptions = (options: any[]) => {
  const groups = new Map<string, any[]>();
  options.forEach(item => {
    const key = [
      item.target_date || '',
      item.period || '',
      String(item.meeting_id || '').replace(/\D/g, '') || item.id,
    ].join('__');
    if (!groups.has(key)) groups.set(key, []);
    groups.get(key)!.push(item);
  });

  return Array.from(groups.values()).map(group => {
    const first = group[0];
    if (group.length === 1) return first;
    const courseNames = uniqueValues(group.map(item => item.course_name));
    const subjects = uniqueValues(group.map(item => item.subject));
    const units = uniqueValues(group.map(item => item.unit));
    return {
      ...first,
      id: first.id,
      course_name: courseNames.join(' / '),
      subject: courseNames.length > 0 ? courseNames.join(' / ') : subjects.join(' / ') || first.subject,
      unit: units.join(' / '),
      title: `${first.target_date || ''} ${first.period ? `${first.period}限 ` : ''}${courseNames.join(' / ') || subjects.join(' / ') || first.subject || ''}`.trim(),
      merged_shift_ids: uniqueValues(group.map(item => item.id)),
    };
  });
};

const timestampValue = (value: any) => {
  if (!value) return 0;
  if (typeof value.seconds === 'number') return value.seconds;
  const date = value.toDate ? value.toDate() : new Date(value);
  return Number.isNaN(date.getTime()) ? 0 : Math.floor(date.getTime() / 1000);
};

const isActiveRegistration = (item: any) => {
  const status = String(item.status || 'active').toLowerCase();
  return !['cancelled', 'canceled', 'rejected', 'withdrawn', 'inactive', 'archived'].includes(status);
};

const getSelectedCourseIds = (registration: any) => {
  const ids = new Set<string>();
  const addId = (value: unknown) => {
    if (!value) return;
    if (typeof value === 'object') {
      [
        (value as any).id,
        (value as any).course_id,
        (value as any).course_option_id,
        (value as any).parent_course_option_id,
        (value as any).fallback_curriculum_option_id,
      ].forEach(addId);
      return;
    }
    ids.add(String(value));
  };
  [
    registration.selected_course_ids,
    registration.selected_courses,
    registration.course_ids,
    registration.course_option_ids,
  ].forEach(value => {
    if (Array.isArray(value)) value.forEach(addId);
  });
  [
    registration.selected_course_id,
    registration.course_id,
    registration.course_option_id,
  ].forEach(addId);
  return ids;
};

const selectedIdMatchesOption = (selectedIds: Set<string>, option: any) => (
  selectedIds.has(String(option.id || '')) ||
  selectedIds.has(String(option.parent_course_option_id || '')) ||
  selectedIds.has(String(option.fallback_curriculum_option_id || ''))
);

const optionMatchesShift = (option: any, shift: any) => {
  const gradeOk = !option.grade || !shift.target_grade || normalizeGrade(option.grade) === normalizeGrade(shift.target_grade);
  const optionSubject = normalize(option.subject);
  const shiftSubject = normalize([shift.target_subject, shift.target_detail_subject, shift.subject].filter(Boolean).join(' '));
  const optionSubjectGroup = getCourseSubjectGroup(option.subject);
  const shiftSubjectGroup = getCourseSubjectGroup([shift.target_subject, shift.target_detail_subject, shift.subject].filter(Boolean).join(' '));
  const subjectOk = !optionSubject || !shiftSubject ||
    (optionSubjectGroup && shiftSubjectGroup ? optionSubjectGroup === shiftSubjectGroup : (
      optionSubject === shiftSubject ||
      optionSubject.includes(shiftSubject) ||
      shiftSubject.includes(optionSubject)
    ));
  const course = normalize(option.course_name || option.title);
  const detail = normalize(shift.target_detail_subject || shift.target_subject);
  const unit = normalize(option.resolved_unit || option.unit || option.matched_units?.[0]);
  const shiftUnit = normalize(shift.unit);
  const courseOk = !course || !detail || course === detail || course.includes(detail) || detail.includes(course);
  const unitOk = !unit || !shiftUnit || unit === shiftUnit || unit.includes(shiftUnit) || shiftUnit.includes(unit);
  return gradeOk && subjectOk && (courseOk || unitOk);
};

export async function GET(request: NextRequest) {
  try {
    const user = await getServerUser(request);
    requireRole(user, ['student']);

    const db = adminDb();
    const params = request.nextUrl.searchParams;
    const absenceId = String(params.get('absence_id') || '').trim();
    const requiredOnly = params.get('required_only') === '1' || params.get('required_only') === 'true';
    const today = todayKeyInJapan();

    const [absenceSnap, registrationSnap, optionSnap, curriculumSnap, shiftSnap] = await Promise.all([
      db.collection('requests').where('student_id', '==', user.uid).where('type', '==', 'absence').limit(80).get(),
      db.collection('course_registrations').where('student_id', '==', user.uid).limit(50).get(),
      db.collection('course_registration_options').limit(1000).get(),
      db.collection('annual_curriculum_schedules').limit(1500).get(),
      db.collection('shift_assignments').where('target_date', '>=', today).limit(1000).get(),
    ]);

    const absences = absenceSnap.docs
      .map(doc => ({ id: doc.id, ...doc.data() }))
      .filter((item: any) => item.status !== 'cancelled' && item.status !== 'rejected')
      .filter((item: any) => item.absence_type !== 'late')
      .filter((item: any) => item.transfer_status !== 'registered')
      .filter((item: any) => !requiredOnly || item.transfer_selection_mode === 'student' || item.transfer_required_by_parent === true || item.transfer_status === 'waiting_student_selection')
      .sort((a: any, b: any) => String(b.target_date || '').localeCompare(String(a.target_date || '')));

    const selectedAbsence = absences.find((item: any) => item.id === absenceId) || absences[0] || null;
    if (!selectedAbsence) return Response.json({ ok: true, absences: [], absent_lessons: [], options: [] });

    const registrations = registrationSnap.docs
      .map(doc => ({ id: doc.id, ...doc.data() }))
      .filter(isActiveRegistration)
      .sort((a: any, b: any) => timestampValue(b.updated_at || b.created_at) - timestampValue(a.updated_at || a.created_at));
    const selectedIds = new Set<string>();
    registrations.forEach((registration: any) => {
      getSelectedCourseIds(registration).forEach(id => selectedIds.add(id));
    });

    const futureShifts = preferSheetSyncedShiftsByDatePeriod(shiftSnap.docs
      .map(doc => ({ id: doc.id, ...doc.data() }))
      .filter(isStudentVisibleShift)
      .filter((shift: any) => canStudentRegisterCourseOption(user.profile.grade, {
        grade: shift.target_grade,
        subject: shift.target_subject,
        course_name: shift.target_detail_subject,
        unit: shift.unit,
      })));
    const optionDocs = optionSnap.docs
      .map(doc => ({ id: doc.id, ...doc.data() }))
      .filter((option: any) => option.is_active !== false)
      .filter((option: any) => canStudentRegisterCourseOption(user.profile.grade, option));
    const enrichedOptions = enrichCourseOptionsWithShifts(optionDocs, curriculumSnap.docs.map(doc => ({ id: doc.id, ...doc.data() })), futureShifts);
    const registeredOptions = enrichedOptions.filter((option: any) => selectedIdMatchesOption(selectedIds, option));

    const absentShiftSnap = await db.collection('shift_assignments')
      .where('target_date', '==', String((selectedAbsence as any).target_date || '').slice(0, 10))
      .limit(120)
      .get();
    const absentLessons = preferSheetSyncedShiftsByDatePeriod(absentShiftSnap.docs
      .map(doc => ({ id: doc.id, ...doc.data() }))
      .filter(isStudentVisibleShift)
      .filter((shift: any) => canStudentRegisterCourseOption(user.profile.grade, {
        grade: shift.target_grade,
        subject: shift.target_subject,
        course_name: shift.target_detail_subject,
        unit: shift.unit,
      }))
      .filter((shift: any) => registeredOptions.length === 0 || registeredOptions.some((option: any) => optionMatchesShift(option, shift)))
      .filter((shift: any) => normalize(shift.unit)))
      .map((shift: any) => ({
        id: shift.id,
        target_date: shift.target_date,
        subject: shift.target_subject || '',
        course_name: shift.target_detail_subject || shift.target_subject || '',
        unit: shift.unit || '',
        period: periodFromShift(shift),
      }));

    const unitKeys = new Set(absentLessons.map(lesson => normalize(lesson.unit)).filter(Boolean));
    const options = mergeTransferOptions(futureShifts
      .filter((shift: any) => unitKeys.has(normalize(shift.unit)))
      .filter((shift: any) => shift.target_date !== (selectedAbsence as any).target_date)
      .map((shift: any) => ({
        id: shift.id,
        target_date: shift.target_date,
        subject: shift.target_subject || '',
        course_name: shift.target_detail_subject || shift.target_subject || '',
        unit: shift.unit || '',
        period: periodFromShift(shift),
        meeting_id: getShiftMeetingId(shift),
        title: `${shift.target_date || ''} ${periodFromShift(shift) ? `${periodFromShift(shift)}限 ` : ''}${shift.target_subject || ''} ${shift.target_detail_subject || ''}`.trim(),
      }))
      .sort((a: any, b: any) => `${a.target_date}_${a.period}_${a.subject}`.localeCompare(`${b.target_date}_${b.period}_${b.subject}`, 'ja')));

    return Response.json({ ok: true, absences, selected_absence: selectedAbsence, absent_lessons: absentLessons, options });
  } catch (error) {
    return jsonError(error);
  }
}
