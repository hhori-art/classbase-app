import { canonicalPeriodForGradeSubject, enrichCourseOptionsWithShifts, fixedPeriodForGradeCourse } from '@/lib/course-registration-match';
import { courseOptionMatchesSelection, currentCourseTermIds, resolveSelectedCourseOptionIds, selectEffectiveCourseRegistration } from '@/lib/course-registration-selection';
import { canStudentRegisterCourseOption } from '@/lib/course-registration-rules';
import { getCourseSubjectGroup, normalizeCourseText, toAsciiDigits } from '@/lib/course-text';
import { normalizeZoomMeetingId, looksLikeZoomUrl } from '@/lib/zoom-url';
import { weekdayFromDateKey } from '@/lib/date-key';
import {
  canStudentSeeTestPrepGrade,
  isTestPrepShift,
  normalizeClassButtonSettings,
  type ClassButtonSettings,
} from '@/lib/class-button-settings';
import {
  buildTestPrepRegistrationOptions,
  normalizeTestPrepDefinition,
  shouldUseTestPrepVisibilityFallback,
} from '@/lib/test-prep-registration';

/**
 * 生徒の「受講登録 → 講師配置（shift_assignments）」の対応づけ。
 * 今日の授業ボタン（/api/student/today-classes）と時間割（/api/student/timetable・/api/parent/timetable）が
 * 同じ判定を使うよう、業務ルールはここだけに置く。
 */

const normalize = normalizeCourseText;

export const normalizeGrade = (value: unknown) => {
  const raw = toAsciiDigits(String(value || ''));
  if (raw.includes('3')) return '中3';
  if (raw.includes('2')) return '中2';
  if (raw.includes('1')) return '中1';
  return raw.trim();
};

export const periodFromShift = (shift: any) => {
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

// 授業の合併（lib/shift-merge.ts）：合併された講師配置は、合併先の会議IDを使う（生徒の参加ボタンを1つにまとめる）。
export const getShiftMeetingId = (shift: any) => normalizeZoomMeetingId(
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

export const getShiftJoinUrl = (shift: any) => {
  const meetingId = getShiftMeetingId(shift);
  const candidates = [
    shift.merge_join_url,
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

/** 生徒向けの主授業（サポート講師の配置は除く）。Zoom情報の有無は問わない。 */
export const isMainLessonShift = (shift: any) => (
  String(shift.role_type || 'main') === 'main' &&
  !String(shift.teacher_name || '').includes('サポート')
);

/** 参加ボタンを出せる主授業（Zoom情報あり）。 */
export const isStudentVisibleShift = (shift: any) => (
  isMainLessonShift(shift) &&
  Boolean(getShiftMeetingId(shift) || getShiftJoinUrl(shift))
);

const hasSheetSource = (shift: any) => Boolean(
  String(shift.source_spreadsheet_id || '').trim() ||
  String(shift.sync_source || '').trim() ||
  String(shift.sync_key || '').trim()
);

export const preferSheetSyncedShifts = (shifts: any[]) => {
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

/** 同期元の優先は日付ごとに判定する（複数日の配置をまとめて渡すとき用）。 */
export const preferSheetSyncedShiftsPerDate = (shifts: any[]) => {
  const byDate = new Map<string, any[]>();
  shifts.forEach(shift => {
    const date = String(shift.target_date || '');
    if (!byDate.has(date)) byDate.set(date, []);
    byDate.get(date)!.push(shift);
  });
  return Array.from(byDate.values()).flatMap(preferSheetSyncedShifts);
};

export const timestampValue = (value: any) => {
  if (!value) return 0;
  if (typeof value.seconds === 'number') return value.seconds;
  const date = value.toDate ? value.toDate() : new Date(value);
  return Number.isNaN(date.getTime()) ? 0 : Math.floor(date.getTime() / 1000);
};

export const isActiveRegistration = (item: any) => {
  const status = String(item.status || 'active').toLowerCase();
  return !['cancelled', 'canceled', 'rejected', 'withdrawn', 'inactive', 'archived'].includes(status);
};

export const getSelectedCourseIds = (registration: any) => {
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

export const getSelectedCourseKeys = (registration: any) => new Set<string>(
  Array.isArray(registration?.selected_course_keys)
    ? registration.selected_course_keys.map((key: unknown) => String(key).trim()).filter(Boolean)
    : [],
);

export const optionMatchesShift = (option: any, shift: any) => {
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

/** loadStudentClassMasters() の戻り値と同じ形（テストから素のデータを渡せるよう型だけ定義）。 */
export type StudentClassMasters = {
  optionDocs: { id: string; data: any }[];
  curriculumDocs: { id: string; data: any }[];
  testPrepOptionDocs: { id: string; data: any }[];
  classButtonSettingsData: any;
};

export const courseYearOf = (dateKey: string) => (
  Number(dateKey.slice(5, 7)) >= 4 ? Number(dateKey.slice(0, 4)) : Number(dateKey.slice(0, 4)) - 1
);

/**
 * 今期の通常登録と対策登録から、選択された講座ID・安定キーを集める。
 * 登録が無いときはプロフィールに残っている選択を使う（旧データ互換）。
 */
export function collectSelectedCourseIds(registrationDocs: any[], profile: any, masters: StudentClassMasters, targetDate: string) {
  const registrations = registrationDocs
    .filter(isActiveRegistration)
    .sort((a: any, b: any) => timestampValue(b.updated_at || b.created_at) - timestampValue(a.updated_at || a.created_at));

  const selectedIds = new Set<string>();
  const courseYear = courseYearOf(targetDate);
  const currentTerms = currentCourseTermIds(masters.optionDocs.map(doc => doc.data), courseYear, targetDate);
  const regularRegistrations = registrations.filter((registration: any) => String(registration.registration_type || 'regular') === 'regular');
  const testPrepRegistrations = registrations.filter((registration: any) => registration.registration_type === 'test_prep');
  const currentRegistration = selectEffectiveCourseRegistration(regularRegistrations, courseYear, currentTerms, profile)
    || regularRegistrations.find((registration: any) => registration.is_current === true || registration.current === true)
    || regularRegistrations.find((registration: any) => String(registration.status || '').toLowerCase() === 'active')
    || regularRegistrations[0];
  if (currentRegistration) {
    getSelectedCourseIds(currentRegistration).forEach(id => selectedIds.add(id));
    getSelectedCourseKeys(currentRegistration).forEach(key => selectedIds.add(key));
  } else {
    (Array.isArray(profile?.selected_course_ids) ? profile.selected_course_ids : [])
      .forEach((id: unknown) => selectedIds.add(String(id)));
    (Array.isArray(profile?.selected_course_keys) ? profile.selected_course_keys : [])
      .forEach((key: unknown) => selectedIds.add(String(key)));
  }
  const activeTestPrepRegistrationId = String(profile?.active_test_prep_course_registration_id || '');
  const currentTestPrepRegistration = testPrepRegistrations.find((registration: any) => activeTestPrepRegistrationId && registration.id === activeTestPrepRegistrationId)
    || testPrepRegistrations.find((registration: any) => registration.is_current === true || registration.current === true)
    || testPrepRegistrations[0];
  if (currentTestPrepRegistration) {
    getSelectedCourseIds(currentTestPrepRegistration).forEach(id => selectedIds.add(id));
    getSelectedCourseKeys(currentTestPrepRegistration).forEach(key => selectedIds.add(key));
  } else {
    (Array.isArray(profile?.selected_test_prep_course_ids) ? profile.selected_test_prep_course_ids : []).forEach((id: unknown) => selectedIds.add(String(id)));
    (Array.isArray(profile?.selected_test_prep_course_keys) ? profile.selected_test_prep_course_keys : []).forEach((key: unknown) => selectedIds.add(String(key)));
  }
  return { selectedIds, currentRegistration: currentRegistration || null };
}

export type StudentLessonMatch = {
  selectedIds: Set<string>;
  regularOptions: any[];
  testPrepOptions: any[];
  /** 選択と一致した講座候補（通常＋対策）。曜日・時限は resolved_day / resolved_slot。 */
  selectedOptions: any[];
  eligibleShiftIds: Set<string>;
  eligibleReasons: Map<string, string>;
  testPrepShiftIds: Set<string>;
  classButtonSettings: ClassButtonSettings;
};

/**
 * 受講登録と講師配置を照合し、生徒が受ける配置IDを決める。
 * shifts は preferSheetSyncedShifts 済みのものを渡す。振替は呼び出し側で足す。
 */
export function matchStudentLessons(input: {
  shifts: any[];
  masters: StudentClassMasters;
  profile: any;
  selectedIds: Set<string>;
}): StudentLessonMatch {
  const { shifts, masters, profile } = input;
  const selectedIds = new Set(input.selectedIds);
  const optionDocs = masters.optionDocs
    .map(doc => ({ id: doc.id, ...doc.data }))
    .filter((option: any) => option.is_active !== false)
    .filter((option: any) => canStudentRegisterCourseOption(profile?.grade, option));
  const curriculumDocs = masters.curriculumDocs.map(doc => ({ id: doc.id, ...doc.data }));
  const regularOptions = enrichCourseOptionsWithShifts(optionDocs, curriculumDocs, shifts.filter((shift: any) => !isTestPrepShift(shift)));
  const testPrepDefinitions = masters.testPrepOptionDocs.map(doc => normalizeTestPrepDefinition(doc.id, doc.data));
  const testPrepOptions = buildTestPrepRegistrationOptions(testPrepDefinitions, shifts, profile?.grade);
  const classButtonSettings = normalizeClassButtonSettings(masters.classButtonSettingsData || {});
  const enrichedOptions = [...regularOptions, ...testPrepOptions];

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
  const selectedOptions = enrichedOptions.filter((option: any) => courseOptionMatchesSelection(option, selectedIds));
  selectedOptions
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
    .filter((option: any) => courseOptionMatchesSelection(option, selectedIds))
    .flatMap((option: any) => Array.isArray(option.matched_shift_ids) ? option.matched_shift_ids : [])
    .forEach((id: unknown) => testPrepShiftIds.add(String(id)));

  // 対策専用設定が未作成の講座は、従来の管理画面の学年公開設定を使う。
  // 専用設定済みの講座だけ登録必須にすることで、段階移行中に社会だけ消えるのを防ぐ。
  shifts
    .filter((shift: any) => shouldUseTestPrepVisibilityFallback(testPrepDefinitions, shift, profile?.grade))
    .filter((shift: any) => canStudentSeeTestPrepGrade(
      normalizeGrade(profile?.grade),
      normalizeGrade(shift.target_grade || shift.grade),
      classButtonSettings,
    ))
    .forEach((shift: any) => {
      const shiftId = String(shift.id);
      eligibleShiftIds.add(shiftId);
      testPrepShiftIds.add(shiftId);
      eligibleReasons.set(shiftId, '対策講座の公開学年設定により表示');
    });

  return { selectedIds, regularOptions, testPrepOptions, selectedOptions, eligibleShiftIds, eligibleReasons, testPrepShiftIds, classButtonSettings };
}
