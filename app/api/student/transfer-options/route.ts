import { NextRequest } from 'next/server';
import { isWithinAbsenceWindow } from '@/lib/absence-window';
import { adminDb } from '@/lib/firebase-admin';
import { getServerUser, jsonError, requireRole } from '@/lib/server-auth';
import { canonicalPeriodForGradeSubject, enrichCourseOptionsWithShifts, fixedPeriodForGradeCourse } from '@/lib/course-registration-match';
import { courseOptionMatchesSelection, currentCourseTermIds, selectEffectiveCourseRegistration } from '@/lib/course-registration-selection';
import { canStudentUseTransferOption } from '@/lib/course-registration-rules';
import { getCourseSubjectGroup, normalizeCourseText, toAsciiDigits } from '@/lib/course-text';
import { isZoomHostStartUrl, looksLikeZoomUrl, normalizeZoomMeetingId } from '@/lib/zoom-url';
import { loadStudentClassMasters } from '@/lib/server/student-class-masters';
import { issueTransferOptionToken } from '@/lib/server/transfer-option-token';
import { normalizeClassButtonSettings } from '@/lib/class-button-settings';
import { lessonDayEnded } from '@/lib/lesson-deadline';
import { weekdayFromDateKey } from '@/lib/date-key';
import { periodFromShift as periodFromScheduleShift } from '@/lib/student-course-schedule';
import {
  loadTodayLessonSources,
  periodTimes,
  todayGradeTransferCandidates,
  todayPeriodEnded,
} from '@/lib/server/student-today-lessons';

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
  const fixed = fixedPeriodForGradeCourse(
    shift.target_grade || shift.grade,
    shift.target_detail_subject || shift.detail_subject,
  );
  if (fixed) return fixed;
  if (String(shift.target_date || '') === '2026-09-11') {
    const canonical = canonicalPeriodForGradeSubject(
      shift.target_grade || shift.grade,
      shift.target_subject || shift.subject,
      shift.target_detail_subject || shift.detail_subject,
    );
    if (canonical) return canonical;
  }
  if (shift.period !== undefined && shift.period !== null && shift.period !== '') return Number(shift.period);
  const raw = toAsciiDigits(`${shift.note || ''} ${shift.time_slot || ''} ${shift.slot || ''} ${shift.target_detail_subject || ''}`);
  if (raw.includes('1限') || raw.includes('1時間目') || raw.includes('①')) return 1;
  if (raw.includes('2限') || raw.includes('2時間目') || raw.includes('②')) return 2;
  return 0;
};

// 合併された授業（lib/shift-merge.ts）は、合併先の会議に参加する。
const getShiftMeetingId = (shift: any) => normalizeZoomMeetingId(
  shift.merge_meeting_id ||
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

// ホスト開始用のURL（/s/・zak=）は生徒に渡さない。開くとホストのアカウントの名前で入ってしまう。
const getShiftJoinUrl = (shift: any) => [
  shift.merge_join_url,
  shift.target_url,
  shift.zoom_url,
  shift.join_url,
  shift.meeting_url,
  shift.url,
  looksLikeZoomUrl(shift.target_meeting_id) ? shift.target_meeting_id : '',
]
  .map(value => String(value || '').trim())
  .find(value => value && !isZoomHostStartUrl(value)) || '';

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

// 同じ日・時限・Zoomの候補は1つにまとめて表示する。
// まとめた表示用の文字列（講座名の連結など）は署名に使わず、代表シフトの raw_* をそのまま署名する。
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

const selectedIdMatchesOption = (selectedIds: Set<string>, option: any) => courseOptionMatchesSelection(option, selectedIds);

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

/** 生徒本人の、振替がまだ決まっていない欠席連絡（新しい日付順・最大80件から）。 */
async function loadOpenAbsences(db: FirebaseFirestore.Firestore, studentId: string) {
  const absenceSnap = await db.collection('requests')
    .where('student_id', '==', studentId)
    .where('type', '==', 'absence')
    .limit(80)
    .get();
  return absenceSnap.docs
    .map(doc => ({ id: doc.id, ...doc.data() }) as any)
    .filter((item: any) => item.status !== 'cancelled' && item.status !== 'rejected')
    .filter((item: any) => item.absence_type !== 'late')
    .filter((item: any) => item.transfer_status !== 'registered')
    .sort((a: any, b: any) => String(b.target_date || '').localeCompare(String(a.target_date || '')));
}

export async function GET(request: NextRequest) {
  try {
    const user = await getServerUser(request);
    requireRole(user, ['student', 'parent']);

    const db = adminDb();
    const params = request.nextUrl.searchParams;
    if (params.get('scope') === 'today_grade') return await todayGradeCandidates(db, user, Number(params.get('period') || 0));
    const requestedStudentId = String(params.get('student_id') || '').trim();
    const studentId = user.role === 'student' ? user.uid : requestedStudentId;
    if (!studentId) return Response.json({ ok: false, error: 'student_id is required' }, { status: 400 });
    const studentSnap = user.role === 'student'
      ? null
      : (await db.getAll(db.collection('users').doc(studentId)))[0];
    if (user.role === 'parent' && !studentSnap?.exists) throw new Error('student-not-found');
    const studentProfile = user.role === 'student' ? user.profile : studentSnap?.data() || {};
    if (user.role === 'parent') {
      const linkedIds = Array.isArray(user.profile.student_ids) ? user.profile.student_ids.map(String) : [];
      if (!linkedIds.includes(studentId) && String(studentProfile.parent_uid || '') !== user.uid) throw new Error('forbidden');
    }
    const absenceId = String(params.get('absence_id') || '').trim();
    const requestedAbsenceDate = String(params.get('absence_date') || '').trim().slice(0, 10);
    const requiredOnly = params.get('required_only') === '1' || params.get('required_only') === 'true';
    const today = todayKeyInJapan();

    const absences = user.role === 'parent'
      ? []
      : (await loadOpenAbsences(db, studentId))
          .filter((item: any) => !requiredOnly || item.transfer_selection_mode === 'student' || item.transfer_required_by_parent === true || item.transfer_status === 'waiting_student_selection');

    // 欠席連絡を先に登録していない場合も、選択した元授業日を一時的な欠席として扱う。
    // 確定時は署名済みトークンを検証したうえで、欠席と振替を同一トランザクションで作成する。
    // さかのぼって振替を選べるのは3か月前の授業日まで（それより前の日は候補を出さない）。
    const pendingRequestedAbsence = /^\d{4}-\d{2}-\d{2}$/.test(requestedAbsenceDate) && isWithinAbsenceWindow(requestedAbsenceDate, today)
      ? { id: `pending:${studentId}:${requestedAbsenceDate}`, student_id: studentId, type: 'absence', target_date: requestedAbsenceDate }
      : null;
    const selectedAbsence = pendingRequestedAbsence || absences.find((item: any) => item.id === absenceId) || absences[0] || null;
    if (!selectedAbsence) return Response.json({ ok: true, absences: [], absent_lessons: [], options: [] });

    const [registrationSnap, shiftSnap, sharedMasters, classButtonSnap] = await Promise.all([
      db.collection('course_registrations').where('student_id', '==', studentId).limit(50).get(),
      db.collection('shift_assignments').where('target_date', '>=', today).limit(1000).get(),
      loadStudentClassMasters(),
      db.collection('settings').doc('class_button').get(),
    ]);
    const classTimes = normalizeClassButtonSettings(classButtonSnap.data() || {});
    // 今日の授業のうち、時限の終了時刻（日本時間）を過ぎたものは振替先にできない。
    const shiftAlreadyEnded = (shift: any) => {
      const date = String(shift.target_date || '').slice(0, 10);
      if (date !== today) return false;
      return lessonDayEnded(date, periodFromShift(shift) === 1 ? classTimes.period1_end : classTimes.period2_end);
    };

    const registrations = registrationSnap.docs
      .map(doc => ({ id: doc.id, ...doc.data() }))
      .filter(isActiveRegistration)
      .sort((a: any, b: any) => timestampValue(b.updated_at || b.created_at) - timestampValue(a.updated_at || a.created_at));
    const selectedIds = new Set<string>();
    const courseYear = Number(today.slice(5, 7)) >= 4 ? Number(today.slice(0, 4)) : Number(today.slice(0, 4)) - 1;
    const currentTerms = currentCourseTermIds(sharedMasters.optionDocs.map(doc => doc.data), courseYear, today);
    const regularRegistrations = registrations.filter((registration: any) => String(registration.registration_type || 'regular') === 'regular');
    const currentRegularRegistration = selectEffectiveCourseRegistration(regularRegistrations, courseYear, currentTerms, studentProfile);
    const testPrepRegistrations = registrations.filter((registration: any) => registration.registration_type === 'test_prep');
    const activeTestPrepId = String(studentProfile.active_test_prep_course_registration_id || '');
    const currentTestPrepRegistration = testPrepRegistrations.find((registration: any) => activeTestPrepId && registration.id === activeTestPrepId)
      || testPrepRegistrations.find((registration: any) => registration.is_current === true || registration.current === true)
      || testPrepRegistrations[0];
    [currentRegularRegistration, currentTestPrepRegistration].filter(Boolean).forEach((registration: any) => {
      getSelectedCourseIds(registration).forEach(id => selectedIds.add(id));
    });

    const futureShifts = preferSheetSyncedShiftsByDatePeriod(shiftSnap.docs
      .map(doc => ({ id: doc.id, ...doc.data() }))
      .filter(isStudentVisibleShift)
      .filter((shift: any) => !shiftAlreadyEnded(shift))
      .filter((shift: any) => canStudentUseTransferOption(studentProfile.grade, {
        grade: shift.target_grade,
        subject: shift.target_subject,
        course_name: shift.target_detail_subject,
        unit: shift.unit,
      })));
    const optionDocs = sharedMasters.optionDocs
      .map(doc => ({ id: doc.id, ...doc.data }))
      .filter((option: any) => option.is_active !== false)
      .filter((option: any) => canStudentUseTransferOption(studentProfile.grade, option));
    const enrichedOptions = enrichCourseOptionsWithShifts(
      optionDocs,
      sharedMasters.curriculumDocs.map(doc => ({ id: doc.id, ...doc.data })),
      futureShifts,
    );
    const registeredOptions = enrichedOptions.filter((option: any) => selectedIdMatchesOption(selectedIds, option));

    const absentShiftSnap = await db.collection('shift_assignments')
      .where('target_date', '==', String((selectedAbsence as any).target_date || '').slice(0, 10))
      .limit(120)
      .get();
    const absentLessons = preferSheetSyncedShiftsByDatePeriod(absentShiftSnap.docs
      .map(doc => ({ id: doc.id, ...doc.data() }))
      .filter(isStudentVisibleShift)
      .filter((shift: any) => canStudentUseTransferOption(studentProfile.grade, {
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
        // 確定時にシフトの値と照合するため、署名にはシフトの値をそのまま使う。
        raw_subject: shift.target_subject || '',
        raw_course_name: shift.target_detail_subject || shift.target_subject || '',
        raw_unit: shift.unit || '',
      }))
      .sort((a: any, b: any) => `${a.target_date}_${a.period}_${a.subject}`.localeCompare(`${b.target_date}_${b.period}_${b.subject}`, 'ja')))
      .map(({ raw_subject, raw_course_name, raw_unit, ...option }: any) => ({
        ...option,
        transfer_token: issueTransferOptionToken({
          actor_id: user.uid,
          student_id: studentId,
          absence_id: String((selectedAbsence as any).id),
          shift_id: String(option.id),
          target_date: String(option.target_date || ''),
          unit: String(raw_unit || ''),
          subject: String(raw_subject || ''),
          course_name: String(raw_course_name || ''),
          period: Number(option.period) || 0,
        }),
      }));

    return Response.json({ ok: true, absences, selected_absence: selectedAbsence, absent_lessons: absentLessons, options });
  } catch (error) {
    return jsonError(error);
  }
}

// ---------------------------------------------------------------------------
// 生徒ホームの「振替で参加する（ここから選ぶ）」：今日・同じ学年・まだ参加ボタンが出ていない授業へ振替する。
// 通常の振替（休んだ授業と同じ単元の候補）とは別の経路で、生徒本人だけが使える。
// ---------------------------------------------------------------------------

const TODAY_GRADE_PAST_DAYS = 60;
const TODAY_GRADE_FUTURE_DAYS = 30;
const TODAY_GRADE_ABSENCE_PAST_DAYS = 30;

const shiftDateKey = (dateKey: string, days: number) => {
  const date = new Date(`${dateKey}T12:00:00+09:00`);
  date.setUTCDate(date.getUTCDate() + days);
  return new Intl.DateTimeFormat('sv-SE', { timeZone: 'Asia/Tokyo', year: 'numeric', month: '2-digit', day: '2-digit' }).format(date);
};

const toCandidate = (shift: any, times: { start: string; end: string }) => ({
  id: String(shift.id),
  subject: String(shift.target_subject || shift.subject || ''),
  course_name: String(shift.target_detail_subject || shift.target_subject || shift.subject || ''),
  unit: String(shift.unit || ''),
  period: periodFromScheduleShift(shift),
  start_time: times.start,
  end_time: times.end,
  teacher_name: String(shift.teacher_name || '').trim() || null,
});

async function todayGradeCandidates(db: FirebaseFirestore.Firestore, user: Awaited<ReturnType<typeof getServerUser>>, period: number) {
  requireRole(user, ['student']);
  if (period !== 1 && period !== 2) return Response.json({ ok: false, error: 'period is required' }, { status: 400 });
  const [sources, absences] = await Promise.all([
    loadTodayLessonSources(db, { studentId: user.uid, period }),
    loadOpenAbsences(db, user.uid),
  ]);
  const today = sources.targetDate;
  const times = periodTimes(sources.masters, period);
  const candidates = todayGradeTransferCandidates({ sources, profile: user.profile, period })
    .map(shift => toCandidate(shift, times))
    .sort((a, b) => `${a.subject}_${a.course_name}`.localeCompare(`${b.subject}_${b.course_name}`, 'ja'));
  const minAbsence = shiftDateKey(today, -TODAY_GRADE_ABSENCE_PAST_DAYS);
  const maxDate = shiftDateKey(today, TODAY_GRADE_FUTURE_DAYS);
  // 同じ日の授業には振替できないので、今日の欠席は選択肢に出さない。
  const seenDates = new Set<string>();
  const openAbsences = absences
    .map((item: any) => ({ id: String(item.id), target_date: String(item.target_date || '').slice(0, 10) }))
    .filter(item => /^\d{4}-\d{2}-\d{2}$/.test(item.target_date) && item.target_date !== today)
    .filter(item => item.target_date >= minAbsence && item.target_date <= maxDate)
    .filter(item => (seenDates.has(item.target_date) ? false : (seenDates.add(item.target_date), true)))
    .sort((a, b) => a.target_date.localeCompare(b.target_date));
  return Response.json({
    ok: true,
    date: today,
    period,
    candidates,
    absences: openAbsences,
    min_date: shiftDateKey(today, -TODAY_GRADE_PAST_DAYS),
    max_date: maxDate,
  }, { headers: { 'Cache-Control': 'private, no-store' } });
}

/**
 * 選んだ授業1件に対して、振替の署名を発行する（生徒本人だけ）。
 * サーバー側でもう一度、今日・同じ学年・この時限が終わっていない・生徒向けの授業・まだ参加できない授業であることを確認する。
 * 元の授業日は pending:{生徒}:{日付} で署名し、確定（/api/parent/absence-requests）で欠席と振替を同時に作る。
 */
export async function POST(request: NextRequest) {
  try {
    const user = await getServerUser(request);
    requireRole(user, ['student']);
    const body = await request.json().catch(() => ({}));
    if (String(body?.scope || '') !== 'today_grade') return Response.json({ ok: false, error: 'unsupported scope' }, { status: 400 });
    const shiftId = String(body?.shift_id || '').trim().slice(0, 128);
    const absenceDate = String(body?.absence_date || '').trim().slice(0, 10);
    if (!shiftId || shiftId.includes('/')) return Response.json({ ok: false, error: 'transfer option is required' }, { status: 400 });

    const db = adminDb();
    // 時限は配置そのものから決める（クライアントの指定は信用しない）。
    const sources = await loadTodayLessonSources(db, { studentId: user.uid, period: 0 });
    const today = sources.targetDate;
    if (!/^\d{4}-\d{2}-\d{2}$/.test(absenceDate) || !weekdayFromDateKey(absenceDate) ||
        absenceDate < shiftDateKey(today, -TODAY_GRADE_PAST_DAYS) || absenceDate > shiftDateKey(today, TODAY_GRADE_FUTURE_DAYS)) {
      return Response.json({ ok: false, error: 'student_id and target_date are required' }, { status: 400 });
    }
    if (absenceDate === today) return Response.json({ ok: false, error: 'transfer date must differ from absence date' }, { status: 400 });

    const target = sources.rawShifts.find((shift: any) => String(shift.id) === shiftId);
    const period = target ? periodFromScheduleShift(target) : 0;
    if (!target || (period !== 1 && period !== 2)) throw new Error('transfer option not found');
    if (todayPeriodEnded(sources.masters, today, period)) {
      return Response.json({ ok: false, error: 'transfer-target-ended' }, { status: 400 });
    }
    const allowed = todayGradeTransferCandidates({
      sources: { ...sources, rawShifts: sources.rawShifts.filter((shift: any) => periodFromScheduleShift(shift) === period) },
      profile: user.profile,
      period,
    });
    if (!allowed.some((shift: any) => String(shift.id) === shiftId)) throw new Error('transfer option not found');

    const absenceId = `pending:${user.uid}:${absenceDate}`;
    const transferToken = issueTransferOptionToken({
      actor_id: user.uid,
      student_id: user.uid,
      absence_id: absenceId,
      shift_id: shiftId,
      target_date: String(target.target_date || '').slice(0, 10),
      // 確定時にシフトの値と照合するため、署名にはシフトの値をそのまま使う。
      unit: String(target.unit || ''),
      subject: String(target.target_subject || ''),
      course_name: String(target.target_detail_subject || target.target_subject || ''),
      period,
      scope: 'grade',
    });
    return Response.json({
      ok: true,
      shift_id: shiftId,
      absence_id: absenceId,
      absence_date: absenceDate,
      transfer_token: transferToken,
    }, { headers: { 'Cache-Control': 'private, no-store' } });
  } catch (error) {
    return jsonError(error);
  }
}
