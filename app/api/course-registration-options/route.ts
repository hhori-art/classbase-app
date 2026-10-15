import { NextRequest } from 'next/server';
import { unstable_cache } from 'next/cache';
import { adminDb } from '@/lib/firebase-admin';
import { getServerUser, jsonError } from '@/lib/server-auth';
import { enrichCourseOptionsWithShifts } from '@/lib/course-registration-match';
import { canStudentRegisterCourseOption, normalizeCourseGrade } from '@/lib/course-registration-rules';
import { getAllQueryDocuments } from '@/lib/server/firestore-pagination';
import { isTestPrepShift } from '@/lib/class-button-settings';
import { buildTestPrepRegistrationOptions, canStudentUseTestPrepDefinition, normalizeTestPrepDefinition, testPrepTermRanges } from '@/lib/test-prep-registration';
import { getCourseOptionStableKey } from '@/lib/course-registration-selection';
import { issueCourseRegistrationToken } from '@/lib/server/course-registration-token';
import { canIssueCourseRegistrationGrant } from '@/lib/course-registration-window';

export const runtime = 'nodejs';

const toAsciiDigits = (value: string) => value.replace(/[０-９]/g, char => String.fromCharCode(char.charCodeAt(0) - 0xfee0));

const currentCourseYear = () => {
  const now = new Date();
  return now.getMonth() + 1 >= 4 ? now.getFullYear() : now.getFullYear() - 1;
};

const courseYearDateRange = (year: number) => ({
  start: `${year}-04-01`,
  end: `${year + 1}-03-31`,
});

const todayInJapan = () => new Intl.DateTimeFormat('sv-SE', {
  timeZone: 'Asia/Tokyo',
  year: 'numeric',
  month: '2-digit',
  day: '2-digit',
}).format(new Date());

const getOptionTermKey = (option: any) => {
  if (!option) return '';
  const year = Number(option.year || new Date().getFullYear());
  const term = String(option.term || option.term_label || 'term').trim() || 'term';
  return `${year}__${term}`;
};

const normalizeDateKey = (value: any) => {
  if (!value) return '';
  if (typeof value?.toDate === 'function') return value.toDate().toISOString().slice(0, 10);
  const raw = String(value || '').slice(0, 10);
  return /^\d{4}-\d{2}-\d{2}$/.test(raw) ? raw : '';
};

const normalizeWeekKey = (value: any) => toAsciiDigits(String(value || '').normalize('NFKC')).trim();

const pickFields = (row: any, fields: readonly string[]) => Object.fromEntries(fields
  .filter(field => row?.[field] !== undefined)
  .map(field => [field, row[field]]));

// Next.js の data cache は1件2MBまで。同期用メタデータや会議情報は受講候補の
// 照合には不要なため、キャッシュへ入れる前に必要な列だけへ射影する。
const compactCourseOptionSource = (row: any) => pickFields(row, [
  'id', 'is_active', 'year', 'term', 'term_label', 'grade', 'subject',
  'course_name', 'title', 'day', 'day_of_week', 'slot', 'time_slot',
  'period', 'unit', 'month_label',
]);

const compactCurriculumSource = (row: any) => ({
  ...pickFields(row, [
    'id', 'year', 'term', 'term_label', 'grade', 'subject', 'course_name',
    'title', 'unit', 'month_label', 'week_no', 'lesson_no', 'start_date',
    'end_date', 'target_date', 'notes', 'curriculum_order', 'source_row',
  ]),
  ...(
    row?.curriculum_order === undefined &&
    row?.source_row === undefined &&
    row?.raw?.row !== undefined
      ? { curriculum_order: row.raw.row }
      : {}
  ),
});

const compactLessonSource = (row: any) => pickFields(row, [
  'id', 'year', 'week_no', 'lesson_no', 'start_date', 'end_date', 'target_date',
]);

const compactTestPrepSource = (row: any) => pickFields(row, [
  'id', 'year', 'title', 'grade', 'subject', 'course_name', 'units', 'unit',
  'start_date', 'end_date', 'registration_open_date', 'registration_close_date',
  'registration_opens_at', 'registration_closes_at', 'allowed_student_grades', 'is_active',
]);

const compactShiftSource = (row: any) => pickFields(row, [
  'id', 'target_date', 'target_grade', 'grade', 'class_grade', 'student_grade',
  'target_class', 'target_subject', 'subject', 'class_subject', 'course_subject',
  'target_detail_subject', 'detail_subject', 'course_name', 'class', 'title',
  'unit', 'role_type', 'role', 'assignment_role', 'period', 'target_period',
  'time_period', 'class_period', 'period_number', 'lesson_period', 'slot',
  'time_slot', 'note', 'source_spreadsheet_id', 'sync_source',
]);

const buildTermDateRanges = (curriculumRows: any[], lessonRows: any[]) => {
  const datesByWeek = lessonRows.reduce((acc, row) => {
    const week = normalizeWeekKey(row.week_no || row.lesson_no);
    const dates = [
      row.start_date,
      row.end_date,
      row.target_date,
    ].map(normalizeDateKey).filter(Boolean);
    if (!week || dates.length === 0) return acc;
    if (!acc[week]) acc[week] = [];
    acc[week].push(...dates);
    return acc;
  }, {} as Record<string, string[]>);

  const rangeDates = curriculumRows.reduce((acc, row) => {
    const key = getOptionTermKey(row);
    if (!key) return acc;
    const week = normalizeWeekKey(row.week_no || row.lesson_no);
    const dates = [
      row.start_date,
      row.end_date,
      row.target_date,
      ...(datesByWeek[week] || []),
    ].map(normalizeDateKey).filter(Boolean);
    if (dates.length === 0) return acc;
    if (!acc[key]) acc[key] = [];
    acc[key].push(...dates);
    return acc;
  }, {} as Record<string, string[]>);

  return Object.fromEntries((Object.entries(rangeDates) as [string, string[]][]).map(([key, dates]) => {
    const sorted = Array.from(new Set(dates)).sort();
    return [key, { start: sorted[0], end: sorted[sorted.length - 1] }];
  })) as Record<string, { start: string; end: string }>;
};

const getRowsForYear = async (collectionName: string, year: number, rowLimit: number) => {
  const db = adminDb();
  const yearSnap = await db.collection(collectionName)
    .where('year', '==', year)
    .limit(rowLimit)
    .get();
  if (!yearSnap.empty) return yearSnap.docs.map(doc => ({ id: doc.id, ...doc.data() }));

  // 年度フィールドがない旧データだけが残っている環境向けの互換処理。
  const legacySnap = await db.collection(collectionName).limit(rowLimit).get();
  return legacySnap.docs
    .map(doc => ({ id: doc.id, ...doc.data() } as any))
    .filter(row => !row.year || Number(row.year) === year);
};

const getCachedCourseSourceData = unstable_cache(async (year: number) => {
    const range = courseYearDateRange(year);
    const db = adminDb();
    const [allOptions, allCurriculumRows, lessonRows, testPrepRows] = await Promise.all([
      getRowsForYear('course_registration_options', year, 1000),
      getRowsForYear('annual_curriculum_schedules', year, 2000),
      getRowsForYear('annual_lesson_schedules', year, 2000),
      getRowsForYear('test_prep_course_options', year, 500),
    ]);

    const today = todayInJapan();
    const shiftRange = { start: today, end: range.end };
    const shiftDocs = await getAllQueryDocuments(db.collection('shift_assignments')
      .where('target_date', '>=', shiftRange.start)
      .where('target_date', '<=', shiftRange.end)
      .orderBy('target_date', 'asc'));
    return {
      allOptions: allOptions.map(compactCourseOptionSource),
      allCurriculumRows: allCurriculumRows.map(compactCurriculumSource),
      lessonRows: lessonRows.map(compactLessonSource),
      testPrepRows: testPrepRows.map(compactTestPrepSource),
      shiftRange,
      allShiftRows: shiftDocs.map(doc => compactShiftSource({ id: doc.id, ...doc.data() })),
    };
}, ['course-registration-source-v2-compact'], {
  revalidate: 300,
  tags: ['course-registration-options'],
});

const getCachedCourseOptions = unstable_cache(async (requestedGrade: string, year: number) => {
    const {
      allOptions,
      allCurriculumRows,
      lessonRows,
      testPrepRows,
      shiftRange,
      allShiftRows,
    } = await getCachedCourseSourceData(year);

    const rawOptions = allOptions
      .filter((option: any) => option.is_active !== false);
    const curriculumRows = allCurriculumRows
      .filter((row: any) => !requestedGrade || canStudentRegisterCourseOption(requestedGrade, row));
    const regularTermRanges = buildTermDateRanges(
      curriculumRows.filter((row: any) => canStudentRegisterCourseOption(requestedGrade, row)),
      lessonRows,
    );
    const testPrepDefinitions = testPrepRows
      .map((row: any) => normalizeTestPrepDefinition(String(row.id || ''), row))
      .filter(definition => definition.is_active);
    const termRanges = { ...regularTermRanges, ...testPrepTermRanges(testPrepDefinitions) };
    const shiftRows = allShiftRows
      .filter((row: any) => !requestedGrade || canStudentRegisterCourseOption(requestedGrade, row));
    const regularShifts = shiftRows.filter((row: any) => !isTestPrepShift(row));
    // 対策講座の学年跨ぎは専用設定の allowed_student_grades を正とする。
    const testPrepShifts = allShiftRows.filter((row: any) => isTestPrepShift(row));
    const regularOptions = enrichCourseOptionsWithShifts(rawOptions, curriculumRows, regularShifts, regularTermRanges)
      .filter((option: any) => canStudentRegisterCourseOption(requestedGrade, option));
    const testPrepOptions = buildTestPrepRegistrationOptions(testPrepDefinitions, testPrepShifts, requestedGrade);
    const options = [...regularOptions.map((option: any) => ({ ...option, registration_type: 'regular' })), ...testPrepOptions];

    const payload = {
      ok: true,
      grade: requestedGrade,
      year,
      options,
      test_prep_definitions: testPrepDefinitions
        .filter(definition => canStudentUseTestPrepDefinition(requestedGrade, definition)),
      term_ranges: termRanges,
      source_counts: {
        options: rawOptions.length,
        curriculum: curriculumRows.length,
        lessons: lessonRows.length,
        test_prep_definitions: testPrepDefinitions.length,
        test_prep_shifts: testPrepShifts.length,
        shifts: shiftRows.length,
        shifts_before_grade_filter: allShiftRows.length,
        shift_range: shiftRange,
        returned: options.length,
        returned_regular: regularOptions.length,
        returned_test_prep: testPrepOptions.length,
      },
    };
    return payload;
}, ['course-registration-options-v25-explicit-period'], {
  revalidate: 300,
  tags: ['course-registration-options'],
});

export async function GET(request: NextRequest) {
  try {
    const user = await getServerUser(request);
    const requestedGrade = normalizeCourseGrade(request.nextUrl.searchParams.get('grade') || user.profile.grade);
    const year = Number(request.nextUrl.searchParams.get('year') || currentCourseYear());
    const [payload, registrationRequestSnap, answeredRegistrationSnap] = await Promise.all([
      getCachedCourseOptions(requestedGrade, year),
      adminDb().collection('registration_requests').where('is_active', '==', true).limit(100).get(),
      adminDb().collection('course_registrations').where('student_id', '==', user.uid).limit(50).get(),
    ]);
    const registrationRequests = registrationRequestSnap.docs
      .map(doc => ({ id: doc.id, ...doc.data() } as any))
      .filter(item => item.request_kind === 'course_registration' || item.type === 'course_registration')
      .filter(item => item.target_audience !== 'grade' || !Array.isArray(item.target_grades) || item.target_grades.map(normalizeCourseGrade).includes(requestedGrade))
      .map(item => ({
        id: item.id,
        title: String(item.title || '受講講座登録'),
        period_start: normalizeDateKey(item.period_start),
        period_end: normalizeDateKey(item.period_end || item.deadline),
        course_option_ids: Array.isArray(item.course_option_ids) ? item.course_option_ids.map(String) : [],
        curriculum_term: String(item.curriculum_term || ''),
        curriculum_month: String(item.curriculum_month || ''),
        course_option_scopes: Array.isArray(item.course_option_scopes) ? item.course_option_scopes.map((scope: any) => ({
          year: Number(scope.year || 0), term: String(scope.term || ''), grade: normalizeCourseGrade(scope.grade),
          subject: String(scope.subject || ''), course_name: String(scope.course_name || ''), month_label: String(scope.month_label || ''),
        })) : [],
      }));
    const today = todayInJapan();
    // is_active が残った過去の受付は、現在期の講座に紐づけない。
    const openRegistrationRequests = registrationRequests.filter(item => (
      Boolean(item.period_start && item.period_end) &&
      item.period_start <= today &&
      today <= item.period_end
    ));
    const answeredRequestIds = Array.from(new Set(answeredRegistrationSnap.docs
      .map(doc => String(doc.data().request_id || doc.data().registration_request_id || ''))
      .filter(Boolean)));
    const registrationSummaries = answeredRegistrationSnap.docs.map(doc => {
      const data = doc.data();
      return {
        id: doc.id,
        year: Number(data.year || 0),
        term: String(data.term || ''),
        registration_type: data.registration_type === 'test_prep' ? 'test_prep' : 'regular',
        status: String(data.status || 'active'),
        is_current: data.is_current === true || data.current === true,
        selected_course_ids: Array.isArray(data.selected_course_ids) ? data.selected_course_ids.map(String) : [],
        selected_course_keys: Array.isArray(data.selected_course_keys) ? data.selected_course_keys.map(String) : [],
        selected_course_labels: Array.isArray(data.selected_course_labels) ? data.selected_course_labels.map(String) : [],
      };
    });
    const requestsByOptionId = new Map<string, (typeof openRegistrationRequests)[number]>();
    openRegistrationRequests.forEach(item => item.course_option_ids.forEach((id: string) => requestsByOptionId.set(id, item)));
    const options = payload.options.map((option: any) => {
      const directRequest = [option.id, option.parent_course_option_id, option.fallback_curriculum_option_id]
        .map(id => requestsByOptionId.get(String(id || '')))
        .find(Boolean);
      const normalizedOptionText = (value: unknown) => String(value || '').normalize('NFKC').replace(/[\s　]/g, '').toLowerCase();
      const descriptorRequest = openRegistrationRequests.find(item => item.course_option_scopes.some((scope: any) => (
        (!scope.year || scope.year === Number(option.year || 0)) &&
        (!scope.term || scope.term === String(option.term || '')) &&
        (!scope.grade || scope.grade === normalizeCourseGrade(option.grade)) &&
        (!scope.subject || normalizedOptionText(scope.subject) === normalizedOptionText(option.subject)) &&
        (!scope.course_name || normalizedOptionText(scope.course_name) === normalizedOptionText(option.course_name || option.title)) &&
        (!scope.month_label || !option.month_label || scope.month_label === String(option.month_label))
      )));
      const scopedRequest = openRegistrationRequests.find(item => {
        // 個別選択済みの依頼をターム全体へ広げない。
        if (item.course_option_ids.length > 0 || item.course_option_scopes.length > 0) return false;
        const requestedTerm = String(item.curriculum_term || '').replace(new RegExp(`^${year}_`), '');
        const optionTerm = String(option.term || '');
        if (!requestedTerm || requestedTerm === 'all' || requestedTerm !== optionTerm) return false;
        const requestedMonth = String(item.curriculum_month || '');
        return !requestedMonth || requestedMonth === 'all' || !option.month_label || requestedMonth === String(option.month_label);
      });
      const activeRequest = directRequest || descriptorRequest || scopedRequest;
      return activeRequest ? {
        ...option,
        registration_request_id: activeRequest.id,
        registration_request_title: activeRequest.title,
        registration_opens_at: activeRequest.period_start,
        registration_closes_at: activeRequest.period_end,
      } : option;
    }).map((option: any) => {
      const termKey = `${Number(option.year || year)}__${String(option.term || option.term_label || 'term')}`;
      const range = payload.term_ranges[termKey];
      const opensAt = normalizeDateKey(option.registration_opens_at);
      // 受付期限が明示されていない現在期は、期の終了日まで有効にする。
      // 開始日を期限にすると、期が始まった翌日から署名発行が失敗して一覧全体が読めなくなる。
      const closesAt = normalizeDateKey(option.registration_closes_at) || range?.end || normalizeDateKey(option.term_start_date) || '';
      const isCurrent = Boolean(range?.start && range?.end && range.start <= today && today <= range.end);
      const isOpen = Boolean(opensAt && closesAt && opensAt <= today && today <= closesAt);
      const registrationType = option.registration_type === 'test_prep' ? 'test_prep' : 'regular';
      if (!canIssueCourseRegistrationGrant(registrationType, isCurrent, isOpen)) return { ...option, registration_token: null };
      return {
        ...option,
        registration_token: issueCourseRegistrationToken({
          actor_id: user.uid,
          grade: requestedGrade,
          option_id: String(option.id || ''),
          stable_key: String(option.stable_course_key || getCourseOptionStableKey(option) || ''),
          year: Number(option.year || year),
          term: String(option.term || option.term_label || 'term'),
          registration_type: registrationType,
          request_id: String(option.registration_request_id || ''),
          day: String(option.resolved_day || option.day || option.day_of_week || ''),
          slot: String(option.resolved_slot || option.slot || option.time_slot || option.period || ''),
          course_text: [option.subject, option.course_name, option.title, option.resolved_unit].filter(Boolean).join(' '),
          registration_closes_at: closesAt,
        }),
      };
    });
    return Response.json({
      ...payload,
      options,
      registration_requests: registrationRequests,
      registration_summaries: registrationSummaries,
      answered_request_ids: answeredRequestIds,
      source_counts: { ...payload.source_counts, active_registration_requests: registrationRequests.length },
    }, {
      // Master course data is already cached by getCachedCourseOptions. This
      // response also includes per-student registration summaries and tokens,
      // which must reflect a just-completed registration immediately.
      headers: { 'Cache-Control': 'private, no-store' },
    });
  } catch (error) {
    return jsonError(error);
  }
}
