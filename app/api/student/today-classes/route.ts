import { NextRequest } from 'next/server';
import { FieldValue } from 'firebase-admin/firestore';
import { adminDb } from '@/lib/firebase-admin';
import { getServerUser, jsonError, requireRole } from '@/lib/server-auth';
import { canonicalPeriodForGradeSubject, enrichCourseOptionsWithShifts, fixedPeriodForGradeCourse } from '@/lib/course-registration-match';
import { courseOptionMatchesSelection, currentCourseTermIds, resolveSelectedCourseOptionIds, selectEffectiveCourseRegistration } from '@/lib/course-registration-selection';
import { canStudentRegisterCourseOption } from '@/lib/course-registration-rules';
import { getCourseSubjectGroup, normalizeCourseText, toAsciiDigits } from '@/lib/course-text';
import { buildZoomJoinUrl, hasZoomPasswordToken, looksLikeZoomUrl, normalizeZoomMeetingId } from '@/lib/zoom-url';
import { fetchOfficialZoomJoinUrl } from '@/lib/zoom-meeting';
import { weekdayFromDateKey } from '@/lib/date-key';
import {
  canStudentSeeTestPrepGrade,
  isTestPrepShift,
  normalizeClassButtonSettings,
} from '@/lib/class-button-settings';
import {
  buildTestPrepRegistrationOptions,
  normalizeTestPrepDefinition,
  shouldUseTestPrepVisibilityFallback,
} from '@/lib/test-prep-registration';
import { loadStudentClassMasters } from '@/lib/server/student-class-masters';
import { issueClassParticipationToken } from '@/lib/server/class-participation-token';

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

const addDaysToDateKey = (dateKey: string, days: number) => {
  const date = new Date(`${dateKey}T12:00:00+09:00`);
  date.setUTCDate(date.getUTCDate() + days);
  return new Intl.DateTimeFormat('sv-SE', {
    timeZone: 'Asia/Tokyo', year: 'numeric', month: '2-digit', day: '2-digit',
  }).format(date);
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
  const explicitValues = [
    shift.period, shift.target_period, shift.time_period, shift.class_period,
    shift.period_number, shift.lesson_period, shift.slot, shift.time_slot, shift.note,
  ];
  for (const value of explicitValues) {
    const raw = toAsciiDigits(String(value || '').normalize('NFKC').trim());
    if (/^1$/.test(raw) || raw.includes('1限') || raw.includes('1時間目') || raw.includes('1時限') || raw.includes('1コマ')) return 1;
    if (/^2$/.test(raw) || raw.includes('2限') || raw.includes('2時間目') || raw.includes('2時限') || raw.includes('2コマ')) return 2;
  }
  const fixed = fixedPeriodForGradeCourse(
    shift.target_grade || shift.grade,
    shift.target_detail_subject || shift.detail_subject,
  );
  if (fixed) return fixed;
  const canonical = canonicalPeriodForGradeSubject(
    shift.target_grade || shift.grade,
    shift.target_subject || shift.subject,
    shift.target_detail_subject || shift.detail_subject,
  );
  if (canonical) return canonical;
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

const getShiftJoinUrl = (shift: any) => {
  const meetingId = getShiftMeetingId(shift);
  const candidates = [
    shift.target_join_url,
    shift.zoom_join_url,
    shift.target_url,
    shift.zoom_url,
    shift.join_url,
    shift.meeting_url,
    shift.url,
    looksLikeZoomUrl(shift.target_meeting_id) ? shift.target_meeting_id : '',
  ]
    .map(value => String(value || '').trim())
    .filter(value => looksLikeZoomUrl(value));

  // 講師配置の会議IDが変わった場合、以前取得した参加URLを誤って使わない。
  return candidates.find(url => !meetingId || normalizeZoomMeetingId(url) === meetingId) || '';
};

const buildZoomUrl = (shift: any) => {
  return buildZoomJoinUrl({
    meetingId: getShiftMeetingId(shift),
    joinUrl: getShiftJoinUrl(shift),
  });
};

const resolveStudentZoomUrl = async (shift: any) => {
  const existingUrl = buildZoomUrl(shift);
  if (hasZoomPasswordToken(existingUrl)) return existingUrl;

  const meetingId = getShiftMeetingId(shift);
  if (!meetingId) return existingUrl;

  try {
    const officialJoinUrl = await fetchOfficialZoomJoinUrl(meetingId);
    if (!officialJoinUrl) return existingUrl;
    if (shift.id && !shift._schedule_fallback) {
      await adminDb().collection('shift_assignments').doc(String(shift.id)).set({
        target_join_url: officialJoinUrl,
        zoom_join_url_updated_at: FieldValue.serverTimestamp(),
      }, { merge: true });
    }
    return officialJoinUrl;
  } catch (error) {
    console.warn('[today-classes] Zoom join URL refresh failed', {
      shift_id: shift.id || null,
      meeting_id: meetingId,
      error: error instanceof Error ? error.message : String(error),
    });
    return existingUrl;
  }
};

const isStudentVisibleShift = (shift: any) => (
  String(shift.role_type || 'main') === 'main' &&
  !String(shift.teacher_name || '').includes('サポート') &&
  Boolean(getShiftMeetingId(shift) || getShiftJoinUrl(shift))
);

const uniqueValues = (values: unknown[]) => Array.from(new Set(
  values.map(value => String(value || '').trim()).filter(Boolean)
));

const mergeClassCandidates = (classes: any[]) => {
  const groups = new Map<string, any[]>();
  classes.forEach(item => {
    const meetingKey = String(item.meeting_id || '').replace(/\D/g, '');
    const key = [
      item.target_date || '',
      item.period || '',
      meetingKey || item.url || item.id,
    ].join('__');
    if (!groups.has(key)) groups.set(key, []);
    groups.get(key)!.push(item);
  });

  return Array.from(groups.values()).map(group => {
    const first = group[0];
    if (group.length === 1) return first;
    const subjects = uniqueValues(group.map(item => item.subject));
    const courseNames = uniqueValues(group.map(item => item.course_name));
    const units = uniqueValues(group.map(item => item.unit));
    const reasons = uniqueValues(group.map(item => item.match_reason));
    return {
      ...first,
      id: uniqueValues(group.map(item => item.id)).join('__'),
      subject: courseNames.length > 0 ? courseNames.join(' / ') : subjects.join(' / ') || first.subject,
      course_name: courseNames.join(' / '),
      unit: units.join(' / '),
      match_reason: reasons.join(' / ') || first.match_reason,
      merged_shift_ids: uniqueValues(group.map(item => item.id)),
    };
  });
};

const hasSheetSource = (shift: any) => Boolean(
  String(shift.source_spreadsheet_id || '').trim() ||
  String(shift.sync_source || '').trim() ||
  String(shift.sync_key || '').trim()
);

const preferSheetSyncedShifts = (shifts: any[]) => {
  const sheetSynced = shifts.filter(hasSheetSource);
  if (sheetSynced.length === 0) return shifts;

  // 通常講座はこれまでどおり同期元を正とする。対策講座はGASが一部科目だけ
  // 同期される日があるため、講座単位で同期済みを優先し、未同期科目を補完する。
  const regularShifts = sheetSynced.filter(shift => !isTestPrepShift(shift));
  const testPrepGroups = new Map<string, any[]>();
  shifts.filter(isTestPrepShift).forEach(shift => {
    const course = normalize(shift.target_detail_subject || shift.detail_subject || shift.target_subject || shift.subject)
      .replace(/定期テスト対策|テスト対策|対策/g, '')
      .replace(/(?:[1-9①-⑩Ⅰ-Ⅹ]+|[a-d])$/gi, '');
    const key = [
      shift.target_date || '',
      normalizeGrade(shift.target_grade || shift.grade),
      periodFromShift(shift),
      getCourseSubjectGroup(course),
      course,
    ].join('__');
    if (!testPrepGroups.has(key)) testPrepGroups.set(key, []);
    testPrepGroups.get(key)!.push(shift);
  });
  const testPrepShifts = Array.from(testPrepGroups.values()).flatMap(group => {
    const synced = group.filter(hasSheetSource);
    return synced.length > 0 ? synced : group;
  });
  return [...regularShifts, ...testPrepShifts];
};

const pickStudentFacingTransferShifts = (shifts: any[]) => {
  const groups = new Map<string, any[]>();
  shifts.forEach(shift => {
    const key = [
      shift.target_date || '',
      normalizeGrade(shift.target_grade),
      periodFromShift(shift),
    ].join('__');
    if (!groups.has(key)) groups.set(key, []);
    groups.get(key)!.push(shift);
  });

  return Array.from(groups.values()).flatMap(group => {
    return preferSheetSyncedShifts(group);
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

const getSelectedCourseKeys = (registration: any) => new Set<string>(
  Array.isArray(registration?.selected_course_keys)
    ? registration.selected_course_keys.map((key: unknown) => String(key).trim()).filter(Boolean)
    : [],
);

const recurringShiftFallback = async (targetDate: string, period: number) => {
  const snapshot = await adminDb().collection('shift_assignments')
    .where('target_date', '>=', addDaysToDateKey(targetDate, -35))
    .where('target_date', '<=', addDaysToDateKey(targetDate, 35))
    .orderBy('target_date', 'desc')
    .limit(500)
    .get();
  const weekday = weekdayFromDateKey(targetDate);
  const candidates = snapshot.docs
    .map(doc => ({ id: doc.id, ...doc.data() }))
    .filter(isStudentVisibleShift)
    .filter((shift: any) => shift.target_date !== targetDate)
    .filter((shift: any) => weekdayFromDateKey(shift.target_date) === weekday)
    .filter((shift: any) => !period || periodFromShift(shift) === period);
  const unique = new Map<string, any>();
  preferSheetSyncedShifts(candidates).forEach((shift: any) => {
    const key = [
      normalizeGrade(shift.target_grade),
      normalize(shift.target_subject),
      normalize(shift.target_detail_subject),
      periodFromShift(shift),
      getShiftMeetingId(shift),
    ].join('__');
    if (!unique.has(key)) unique.set(key, {
      ...shift,
      id: `schedule_fallback_${shift.id}_${targetDate}`,
      _source_shift_id: shift.id,
      _schedule_fallback: true,
      target_date: targetDate,
    });
  });
  return Array.from(unique.values());
};

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
  const optionDay = String(option.resolved_day || option.day || option.day_of_week || '').replace('曜日', '').trim();
  const shiftDay = weekdayFromDateKey(shift.target_date);
  const dayOk = !optionDay || !shiftDay || optionDay === shiftDay;
  const optionPeriod = Number(String(option.resolved_slot || option.slot || option.time_slot || '').match(/[12]/)?.[0] || 0);
  const shiftPeriod = periodFromShift(shift);
  const periodOk = !optionPeriod || !shiftPeriod || optionPeriod === shiftPeriod;
  const course = normalize(option.course_name || option.title);
  const detail = normalize(shift.target_detail_subject || shift.target_subject);
  const unit = normalize(option.resolved_unit || option.unit || option.matched_units?.[0]);
  const shiftUnit = normalize(shift.unit);
  const courseOk = Boolean(course && detail && (course === detail || course.includes(detail) || detail.includes(course)));
  const unitOk = Boolean(unit && shiftUnit && (unit === shiftUnit || unit.includes(shiftUnit) || shiftUnit.includes(unit)));
  return gradeOk && subjectOk && dayOk && periodOk && (courseOk || unitOk);
};

const selectedIdMatchesOption = (selectedIds: Set<string>, option: any) => courseOptionMatchesSelection(option, selectedIds);

const attachParticipationTokens = (classes: any[], studentId: string, targetDate: string) => classes.map(item => ({
  ...item,
  participation_token: issueClassParticipationToken({
    student_id: studentId,
    class_id: String(item.id || ''),
    target_date: String(item.target_date || targetDate),
    subject: String(item.subject || '授業'),
    course_name: String(item.course_name || item.subject || '授業'),
  }),
}));

export async function GET(request: NextRequest) {
  try {
    const user = await getServerUser(request);

    const params = request.nextUrl.searchParams;
    const previewMode = params.get('preview') === 'teacher';
    const betaTransferMode = params.get('beta_transfer') === '1' || params.get('beta_transfer') === 'true';
    if (previewMode) requireRole(user, ['teacher', 'master', 'admin']);
    else requireRole(user, ['student']);
    // 振替候補は、署名付き候補から確定したrequestsの経路だけを信頼する。
    // 同学年だけで参加トークンを発行する旧beta経路は未登録授業への参加を許すため廃止する。
    if (betaTransferMode) {
      return Response.json({ ok: false, error: 'transfer registration is required' }, { status: 400 });
    }

    const targetDate = todayKeyInJapan();
    const period = Number(params.get('period') || 0);
    const db = adminDb();

    const [shiftSnap, registrationSnap, requestSnap, sharedMasters] = await Promise.all([
      db.collection('shift_assignments').where('target_date', '==', targetDate).limit(80).get(),
      previewMode
        ? Promise.resolve({ docs: [] as any[] })
        : db.collection('course_registrations').where('student_id', '==', user.uid).limit(50).get(),
      previewMode
        ? Promise.resolve({ docs: [] as any[] })
        : db.collection('requests').where('student_id', '==', user.uid).limit(100).get(),
      loadStudentClassMasters(),
    ]);

    let rawShifts = shiftSnap.docs
      .map(doc => ({ id: doc.id, ...doc.data() }))
      .filter(isStudentVisibleShift)
      .filter((shift: any) => !period || periodFromShift(shift) === period);
    let scheduleFallbackUsed = false;
    if (rawShifts.length === 0 && previewMode) {
      rawShifts = await recurringShiftFallback(targetDate, period);
      scheduleFallbackUsed = rawShifts.length > 0;
      console.warn('[today-classes] today placement missing; recurring schedule fallback used', {
        target_date: targetDate,
        period,
        fallback_count: rawShifts.length,
      });
    }
    const shifts = preferSheetSyncedShifts(rawShifts);

    const optionDocs = sharedMasters.optionDocs
      .map(doc => ({ id: doc.id, ...doc.data }))
      .filter((option: any) => option.is_active !== false)
      .filter((option: any) => canStudentRegisterCourseOption(user.profile.grade, option));
    const curriculumDocs = sharedMasters.curriculumDocs.map(doc => ({ id: doc.id, ...doc.data }));
    const regularOptions = enrichCourseOptionsWithShifts(optionDocs, curriculumDocs, shifts.filter((shift: any) => !isTestPrepShift(shift)));
    const testPrepDefinitions = sharedMasters.testPrepOptionDocs.map(doc => normalizeTestPrepDefinition(doc.id, doc.data));
    const testPrepOptions = buildTestPrepRegistrationOptions(testPrepDefinitions, shifts, user.profile.grade);
    const classButtonSettings = normalizeClassButtonSettings(sharedMasters.classButtonSettingsData);
    const enrichedOptions = [...regularOptions, ...testPrepOptions];

    const registrations = registrationSnap.docs
      .map(doc => ({ id: doc.id, ...doc.data() }))
      .filter(isActiveRegistration)
      .sort((a: any, b: any) => timestampValue(b.updated_at || b.created_at) - timestampValue(a.updated_at || a.created_at));

    const selectedIds = new Set<string>();
    const courseYear = Number(targetDate.slice(5, 7)) >= 4 ? Number(targetDate.slice(0, 4)) : Number(targetDate.slice(0, 4)) - 1;
    const currentTerms = currentCourseTermIds(sharedMasters.optionDocs.map(doc => doc.data), courseYear, targetDate);
    const regularRegistrations = registrations.filter((registration: any) => String(registration.registration_type || 'regular') === 'regular');
    const testPrepRegistrations = registrations.filter((registration: any) => registration.registration_type === 'test_prep');
    const currentRegistration = selectEffectiveCourseRegistration(regularRegistrations, courseYear, currentTerms, user.profile)
      || regularRegistrations.find((registration: any) => registration.is_current === true || registration.current === true)
      || regularRegistrations.find((registration: any) => String(registration.status || '').toLowerCase() === 'active')
      || regularRegistrations[0];
    if (currentRegistration) {
      getSelectedCourseIds(currentRegistration).forEach(id => selectedIds.add(id));
      getSelectedCourseKeys(currentRegistration).forEach(key => selectedIds.add(key));
    } else {
      (Array.isArray(user.profile.selected_course_ids) ? user.profile.selected_course_ids : [])
        .forEach((id: unknown) => selectedIds.add(String(id)));
      (Array.isArray(user.profile.selected_course_keys) ? user.profile.selected_course_keys : [])
        .forEach((key: unknown) => selectedIds.add(String(key)));
    }
    const activeTestPrepRegistrationId = String(user.profile.active_test_prep_course_registration_id || '');
    const currentTestPrepRegistration = testPrepRegistrations.find((registration: any) => activeTestPrepRegistrationId && registration.id === activeTestPrepRegistrationId)
      || testPrepRegistrations.find((registration: any) => registration.is_current === true || registration.current === true)
      || testPrepRegistrations[0];
    if (currentTestPrepRegistration) {
      getSelectedCourseIds(currentTestPrepRegistration).forEach(id => selectedIds.add(id));
      getSelectedCourseKeys(currentTestPrepRegistration).forEach(key => selectedIds.add(key));
    } else {
      (Array.isArray(user.profile.selected_test_prep_course_ids) ? user.profile.selected_test_prep_course_ids : []).forEach((id: unknown) => selectedIds.add(String(id)));
      (Array.isArray(user.profile.selected_test_prep_course_keys) ? user.profile.selected_test_prep_course_keys : []).forEach((key: unknown) => selectedIds.add(String(key)));
    }

    // 旧元講座IDは、曜日・時限を一意に特定できる場合だけ現在の候補IDへ移行する。
    // 複数時限へ分岐した元IDから全候補を復元すると、1限の重複や2限の欠落になる。
    resolveSelectedCourseOptionIds(enrichedOptions, selectedIds).forEach(id => selectedIds.add(id));

    const eligibleShiftIds = new Set<string>();
    const eligibleReasons = new Map<string, string>();
    const testPrepShiftIds = new Set<string>();
    shifts.forEach((shift: any) => {
      if (selectedIds.has(String(shift.id))) {
        eligibleShiftIds.add(String(shift.id));
        eligibleReasons.set(String(shift.id), '講師配置に直接登録されています');
      }
    });
    enrichedOptions
      .filter((option: any) => selectedIdMatchesOption(selectedIds, option))
      .forEach((option: any) => {
        const reason = [
          option.resolved_day ? `${option.resolved_day}曜` : option.day || option.day_of_week ? `${option.day || option.day_of_week}曜` : '',
          option.resolved_slot || option.slot || option.period || '',
          option.resolved_unit || option.unit || '',
        ].filter(Boolean).join(' / ') || '受講登録と講師配置が一致';
        let matchedByExplicitShift = false;
        if (Array.isArray(option.matched_shift_ids)) {
          option.matched_shift_ids.forEach((id: unknown) => {
            const shiftId = String(id);
            if (shifts.some((shift: any) => String(shift.id) === shiftId)) {
              matchedByExplicitShift = true;
              eligibleShiftIds.add(shiftId);
              eligibleReasons.set(shiftId, reason);
            }
          });
        }
        if (!matchedByExplicitShift) {
          shifts.filter((shift: any) => optionMatchesShift(option, shift)).forEach((shift: any) => {
            eligibleShiftIds.add(shift.id);
            eligibleReasons.set(String(shift.id), reason);
          });
        }
      });

    testPrepOptions
      .filter((option: any) => selectedIdMatchesOption(selectedIds, option))
      .flatMap((option: any) => Array.isArray(option.matched_shift_ids) ? option.matched_shift_ids : [])
      .forEach((id: unknown) => testPrepShiftIds.add(String(id)));

    // 対策専用設定が未作成の講座は、従来の管理画面の学年公開設定を使う。
    // 専用設定済みの講座だけ登録必須にすることで、段階移行中に社会だけ消えるのを防ぐ。
    shifts
      .filter((shift: any) => shouldUseTestPrepVisibilityFallback(testPrepDefinitions, shift, user.profile.grade))
      .filter((shift: any) => canStudentSeeTestPrepGrade(
        normalizeGrade(user.profile.grade),
        normalizeGrade(shift.target_grade || shift.grade),
        classButtonSettings,
      ))
      .forEach((shift: any) => {
        const shiftId = String(shift.id);
        eligibleShiftIds.add(shiftId);
        testPrepShiftIds.add(shiftId);
        eligibleReasons.set(shiftId, '対策講座の公開学年設定により表示');
      });

    const transferRequests = requestSnap.docs
      .map(doc => ({ id: doc.id, ...doc.data() }))
      .filter((item: any) => item.type === 'transfer')
      .filter((item: any) => item.target_date === targetDate)
      .filter((item: any) => item.status !== 'rejected' && item.status !== 'cancelled');

    transferRequests.forEach((item: any) => {
      const shiftId = item.transfer_shift_id || item.target_shift_id || item.shift_assignment_id;
      if (shiftId) {
        eligibleShiftIds.add(String(shiftId));
        eligibleReasons.set(String(shiftId), '振替登録済み');
      }
    });

    if (previewMode) {
      const previewShifts = pickStudentFacingTransferShifts(shifts);
      const classes = mergeClassCandidates(await Promise.all(previewShifts.map(async (shift: any) => ({
        id: shift.id,
        url: await resolveStudentZoomUrl(shift),
        meeting_id: getShiftMeetingId(shift),
        grade: normalizeGrade(shift.target_grade || shift.grade),
        subject: shift.target_detail_subject || shift.target_subject || shift.subject || '授業',
        course_name: shift.target_detail_subject || '',
        unit: shift.unit || '',
        period: periodFromShift(shift),
        target_date: shift.target_date || targetDate,
        source: 'teacher_preview',
        match_reason: 'テスト表示',
      }))));
      return Response.json(
        { ok: true, date: targetDate, period, classes, preview: true, schedule_fallback: scheduleFallbackUsed },
        { headers: { 'Cache-Control': 'private, no-store' } },
      );
    }

    let matchedClasses = shifts
      .map((shift: any) => ({
        shift,
        source: transferRequests.some((req: any) => [req.transfer_shift_id, req.target_shift_id, req.shift_assignment_id].includes(shift.id))
          ? 'transfer'
          : testPrepShiftIds.has(String(shift.id))
            ? 'test_prep'
          : eligibleShiftIds.has(shift.id)
            ? 'course_registration'
            : 'unmatched',
      }))
      .filter(item => eligibleShiftIds.has(item.shift.id));
    const classes = attachParticipationTokens(mergeClassCandidates(await Promise.all(matchedClasses
      .map(async item => ({
        id: item.shift.id,
        url: await resolveStudentZoomUrl(item.shift),
        meeting_id: getShiftMeetingId(item.shift),
        grade: normalizeGrade(item.shift.target_grade || item.shift.grade),
        subject: item.shift.target_detail_subject || item.shift.target_subject || item.shift.subject || '授業',
        course_name: item.shift.target_detail_subject || '',
        unit: item.shift.unit || '',
        period: periodFromShift(item.shift),
        target_date: item.shift.target_date || targetDate,
        source: item.source,
        match_reason: eligibleReasons.get(String(item.shift.id)) || '受講登録と一致',
      })))), user.uid, targetDate);

    return Response.json({
      ok: true,
      date: targetDate,
      period,
      classes,
      matching_mode: 'exact',
      schedule_missing: shifts.length === 0,
      schedule_fallback: scheduleFallbackUsed,
    }, { headers: { 'Cache-Control': 'private, no-store' } });
  } catch (error) {
    return jsonError(error);
  }
}
