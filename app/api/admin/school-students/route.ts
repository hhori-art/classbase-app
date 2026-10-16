import { NextRequest } from 'next/server';
import { adminDb } from '@/lib/firebase-admin';
import { canViewSchoolStudents, getServerUser, jsonError } from '@/lib/server-auth';
import { attendanceSchoolName, resolveAttendanceSchoolCode } from '@/lib/attendance-schools';
import { courseOptionMatchesSelection, currentCourseTermIds, legacyCourseSelectionLabel, selectEffectiveCourseRegistration, summarizeSelectedCourseLabels } from '@/lib/course-registration-selection';
import { getAllQueryDocuments } from '@/lib/server/firestore-pagination';
import { aggregateStudentParticipation, buildParticipationWeeksSince, buildRecentParticipationWeeks } from '@/lib/student-weekly-participation';

export const runtime = 'nodejs';

const currentCourseYear = () => {
  const today = todayInJapan();
  const year = Number(today.slice(0, 4));
  return Number(today.slice(5, 7)) >= 4 ? year : year - 1;
};

const todayInJapan = () => new Intl.DateTimeFormat('sv-SE', {
  timeZone: 'Asia/Tokyo', year: 'numeric', month: '2-digit', day: '2-digit',
}).format(new Date());

const timestampToIso = (value: any) => {
  if (!value) return null;
  if (typeof value.toDate === 'function') return value.toDate().toISOString();
  if (value instanceof Date) return value.toISOString();
  const date = new Date(value);
  return Number.isNaN(date.getTime()) ? null : date.toISOString();
};

const normalizeSlot = (value: any) => {
  const text = String(value || '').normalize('NFKC').trim();
  if (!text) return '';
  if (/^1$|1限|1時間目|1時限|1コマ/.test(text)) return '1限';
  if (/^2$|2限|2時間目|2時限|2コマ/.test(text)) return '2限';
  return text.replace('時間目', '限');
};

const normalizeLabelText = (value: any) => String(value || '')
  .normalize('NFKC')
  .replace(/\s+/g, '')
  .trim();

const compactLabelParts = (...values: any[]) => {
  const parts: string[] = [];
  values.forEach(value => {
    const text = String(value || '').trim();
    if (!text) return;
    const normalized = normalizeLabelText(text);
    if (!normalized || normalized === '講座') return;
    if (parts.some(part => normalizeLabelText(part) === normalized)) return;
    parts.push(text);
  });
  return parts;
};

const courseLabel = (option: any) => {
  const day = String(option.resolved_day || option.day || option.day_of_week || '').replace('曜日', '').trim();
  const slot = normalizeSlot(option.resolved_slot || option.slot || option.time_slot || option.period);
  const units = [
    option.resolved_unit,
    option.unit,
    ...(Array.isArray(option.matched_units) ? option.matched_units : []),
    ...(Array.isArray(option.curriculum_units) ? option.curriculum_units : []),
  ].map(value => String(value || '').trim()).filter(Boolean);
  const unitSummary = Array.from(new Set(units)).slice(0, 2).join(' / ');
  const name = compactLabelParts(
    option.grade,
    option.subject || option.target_subject,
    option.course_name || option.title || option.detail_subject || option.target_detail_subject,
  ).join(' ');
  const schedule = [day && `${day}曜`, slot].filter(Boolean).join(' ');
  return [name || '講座', schedule, unitSummary].filter(Boolean).join(' / ');
};

const buildCourseCatalog = (optionRows: any[]) => {
  // 登録済みの講座IDには学年・科目・曜日・時限が含まれる。表示だけのために
  // 年間数千件の講師配置を読む必要はない。
  const options = optionRows.filter((option: any) => option.is_active !== false);

  const labels = options.reduce((map, option: any) => {
    const label = courseLabel(option);
    [option.id, option.parent_course_option_id, option.fallback_curriculum_option_id]
      .map(value => String(value || '').trim())
      .filter(Boolean)
      .forEach(id => {
        if (!map.has(id)) map.set(id, label);
      });
    return map;
  }, new Map<string, string>());
  return { options, labels };
};

const chunk = <T,>(values: T[], size: number) => {
  const chunks: T[][] = [];
  for (let index = 0; index < values.length; index += size) {
    chunks.push(values.slice(index, index + size));
  }
  return chunks;
};

const buildRegistrationMaps = async (db: FirebaseFirestore.Firestore, studentIds: string[]) => {
  const historyMap = new Map<string, any[]>();
  const uniqueIds = Array.from(new Set(studentIds.map(id => String(id || '').trim()).filter(Boolean)));
  if (uniqueIds.length === 0) return historyMap;

  const snapshots = await Promise.all(chunk(uniqueIds, 30).map(ids => (
    db.collection('course_registrations')
      .where('student_id', 'in', ids)
      .limit(300)
      .get()
      .catch(() => null)
  )));

  const grouped = new Map<string, any[]>();
  snapshots.forEach(snap => {
    snap?.docs.forEach(doc => {
      const data = { id: doc.id, ...doc.data() };
      const studentId = String((data as any).student_id || '').trim();
      if (!studentId) return;
      if (!grouped.has(studentId)) grouped.set(studentId, []);
      grouped.get(studentId)!.push(data);
    });
  });

  grouped.forEach((registrations, studentId) => {
    historyMap.set(studentId, registrations);
  });

  return historyMap;
};

const buildParentMap = async (db: FirebaseFirestore.Firestore, studentDocs: FirebaseFirestore.QueryDocumentSnapshot[]) => {
  const parentIds = Array.from(new Set(studentDocs.map(doc => {
    const data = doc.data();
    return String(data.parent_uid || (Array.isArray(data.parent_ids) ? data.parent_ids[0] : '') || '').trim();
  }).filter(Boolean)));
  const snapshots = await Promise.all(chunk(parentIds, 100).map(ids => db.getAll(...ids.map(id => db.collection('users').doc(id)))));
  return new Map(snapshots.flat().filter(snap => snap.exists).map(snap => [snap.id, snap.data() || {}]));
};

const buildWeeklyAttendanceMap = async (db: FirebaseFirestore.Firestore, studentIds: string[]) => {
  const map = new Map<string, Record<string, string>>();
  const uniqueIds = Array.from(new Set(studentIds.map(id => String(id || '').trim()).filter(Boolean)));
  if (uniqueIds.length === 0) return map;
  const snapshots = await Promise.all(chunk(uniqueIds, 30).map(ids => (
    db.collection('pf_records').where('student_id', 'in', ids).limit(2000).get().catch(() => null)
  )));
  snapshots.forEach(snap => snap?.docs.forEach(doc => {
    const data = doc.data();
    const studentId = String(data.student_id || '').trim();
    const rawWeek = String(data.week_number || data.period || '').normalize('NFKC').trim();
    const summerMatch = rawWeek.match(/(?:夏期|summer)[^0-9]*([1-5])/i);
    const week = summerMatch ? `summer${summerMatch[1]}` : rawWeek.replace(/[^0-9]/g, '');
    if (!studentId || !week || (!week.startsWith('summer') && (Number(week) < 1 || Number(week) > 36))) return;
    const status = String(data.attendance_status || '').trim();
    if (!map.has(studentId)) map.set(studentId, {});
    if (status) map.get(studentId)![week] = status;
  }));
  return map;
};

const buildParticipationMaps = async (
  db: FirebaseFirestore.Firestore,
  studentIds: string[],
  allHistory: boolean,
  earliestCourseStart: string,
) => {
  const recentWeeks = buildRecentParticipationWeeks(todayInJapan(), 8);
  const studentIdSet = new Set(studentIds);
  const [attendanceDocs, followUpSnaps] = await Promise.all([
    allHistory
      ? Promise.all(chunk(studentIds, 30).flatMap(ids => [
        getAllQueryDocuments(db.collection('attendance').where('user_id', 'in', ids)),
        getAllQueryDocuments(db.collection('attendance').where('student_id', 'in', ids)),
      ])).then(results => Array.from(new Map(results.flat().map(doc => [doc.id, doc])).values()))
      : getAllQueryDocuments(db.collection('attendance').where('target_date', '>=', recentWeeks[0].start_date)),
    Promise.all(chunk(studentIds, 30).map(ids => db.collection('attendance_follow_ups')
      .where('student_id', 'in', ids)
      .limit(2000)
      .get()
      .catch(() => null))),
  ]);
  const earliestAttendance = allHistory ? attendanceDocs
    .map(doc => String(doc.data().target_date || doc.data().date || '').slice(0, 10))
    .filter(value => /^\d{4}-\d{2}-\d{2}$/.test(value))
    .sort()[0] || '' : '';
  const earliest = [earliestAttendance, earliestCourseStart].filter(Boolean).sort()[0] || '';
  const weeks = allHistory ? buildParticipationWeeksSince(todayInJapan(), earliest) : recentWeeks;
  const attendanceByStudent = new Map<string, any[]>();
  attendanceDocs.forEach(doc => {
    const data = { id: doc.id, ...doc.data() };
    const studentId = String((data as any).student_id || (data as any).user_id || '').trim();
    if (!studentIdSet.has(studentId)) return;
    if (!attendanceByStudent.has(studentId)) attendanceByStudent.set(studentId, []);
    attendanceByStudent.get(studentId)!.push(data);
  });

  const followUpsByStudent = new Map<string, any[]>();
  followUpSnaps.forEach(followUpSnap => followUpSnap?.docs.forEach(doc => {
    const data: any = { id: doc.id, ...doc.data() };
    const studentId = String(data.student_id || '').trim();
    if (!studentIdSet.has(studentId)) return;
    if (!followUpsByStudent.has(studentId)) followUpsByStudent.set(studentId, []);
    followUpsByStudent.get(studentId)!.push({
      id: doc.id,
      status: String(data.status || 'contacted'),
      note: String(data.note || ''),
      week_start: String(data.week_start || ''),
      week_end: String(data.week_end || ''),
      consecutive_missed_weeks: Number(data.consecutive_missed_weeks || 0),
      actor_name: String(data.actor_name || ''),
      created_at: timestampToIso(data.created_at),
    });
  }));
  followUpsByStudent.forEach(items => items.sort((a, b) => String(b.created_at || '').localeCompare(String(a.created_at || ''))));
  return { weeks, attendanceByStudent, followUpsByStudent };
};

const buildSelectedCourseLabels = (registration: any, catalog: { options: any[]; labels: Map<string, string> }) => {
  if (!registration) return [];
  const explicitLabels = Array.isArray(registration?.selected_course_labels)
    ? registration.selected_course_labels.map((value: any) => String(value || '').trim()).filter(Boolean)
    : [];
  const ids = Array.isArray(registration?.selected_course_ids)
    ? registration.selected_course_ids
    : [];
  const selectedIds = ids.map((id: any) => String(id || '').trim()).filter(Boolean);
  const legacyLabels = summarizeSelectedCourseLabels(selectedIds.map(legacyCourseSelectionLabel).filter(Boolean));
  const unresolvedIds = selectedIds.filter((id: string) => !legacyCourseSelectionLabel(id));
  const matched = summarizeSelectedCourseLabels(catalog.options
    .filter(option => String(option.term || option.term_id || '') === String(registration.term || ''))
    .filter(option => courseOptionMatchesSelection(option, unresolvedIds))
    .map(courseLabel));
  const explicit = summarizeSelectedCourseLabels(explicitLabels);
  const fallback = summarizeSelectedCourseLabels(unresolvedIds
    .map((id: string) => catalog.labels.get(id) || legacyCourseSelectionLabel(id) || id));
  const resolved = summarizeSelectedCourseLabels([...legacyLabels, ...matched]);
  if (explicit.length >= resolved.length && explicit.length > 0) return explicit;
  if (resolved.length > 0) return resolved;
  return explicit.length >= fallback.length ? explicit : fallback;
};

export async function GET(request: NextRequest) {
  try {
    const actor = await getServerUser(request);
    if (!canViewSchoolStudents(actor)) throw new Error('forbidden');

    const db = adminDb();
    const courseYear = currentCourseYear();
    const allAttendanceHistory = request.nextUrl.searchParams.get('attendance_history') === 'all';
    const includePfAttendance = request.nextUrl.searchParams.get('include_pf') !== 'false';
    const requestedSchool = String(request.nextUrl.searchParams.get('school') || '').trim();
    let schoolOptions = actor.role === 'teacher'
      ? [String(actor.school || actor.profile.school_name || actor.profile.school_id || '').trim()].filter(Boolean)
      : Array.from(new Set([
        ...actor.school_ids,
        actor.school || '',
      ].map(value => String(value || '').trim()).filter(Boolean))).sort((a, b) => a.localeCompare(b, 'ja', { numeric: true }));
    let allStudentDocs: FirebaseFirestore.QueryDocumentSnapshot[] | null = null;

    if (actor.role === 'master') {
      allStudentDocs = await getAllQueryDocuments(db.collection('users').where('role', '==', 'student'));
      schoolOptions = Array.from(new Set(allStudentDocs
        .map(doc => String(doc.data().school_id || doc.data().school || '').trim())
        .filter(Boolean)))
        .sort((a, b) => a.localeCompare(b, 'ja', { numeric: true }));
    }

    const school = requestedSchool || schoolOptions[0] || '';

    if (!school) {
      return Response.json({ ok: true, school: '', schools: schoolOptions, students: [] });
    }
    if (!canViewSchoolStudents(actor, school)) throw new Error('forbidden');

    let studentDocs: FirebaseFirestore.QueryDocumentSnapshot[];
    if (allStudentDocs) {
      studentDocs = allStudentDocs.filter(doc => String(doc.data().school_id || doc.data().school || '').trim() === school);
    } else {
      const schoolCode = resolveAttendanceSchoolCode(school) || school;
      const schoolAliases = Array.from(new Set([school, schoolCode, attendanceSchoolName(schoolCode)].filter(Boolean)));
      const schoolQueries = schoolAliases.flatMap(alias => [
        getAllQueryDocuments(db.collection('users').where('role', '==', 'student').where('school_id', '==', alias)),
        getAllQueryDocuments(db.collection('users').where('role', '==', 'student').where('school', '==', alias)),
      ]);
      const schoolDocs = await Promise.all(schoolQueries);
      studentDocs = Array.from(new Map(schoolDocs.flat().map(doc => [doc.id, doc])).values());
    }

    const studentIds = studentDocs.map(doc => doc.id);
    const earliestCourseStart = studentDocs.map(doc => String(doc.data().course_start_month || '').slice(0, 7))
      .filter(value => /^\d{4}-\d{2}$/.test(value)).sort()[0];
    const [registrationHistoryMap, weeklyAttendanceMap, participationMaps, optionSnap, parentMap] = await Promise.all([
      buildRegistrationMaps(db, studentIds),
      includePfAttendance ? buildWeeklyAttendanceMap(db, studentIds) : Promise.resolve(new Map<string, Record<string, string>>()),
      buildParticipationMaps(db, studentIds, allAttendanceHistory, earliestCourseStart ? `${earliestCourseStart}-01` : ''),
      db.collection('course_registration_options').limit(1000).get(),
      buildParentMap(db, studentDocs),
    ]);
    const optionRows: any[] = optionSnap.docs.map(doc => ({ id: doc.id, ...doc.data() }));
    const currentTerms = currentCourseTermIds(optionRows, courseYear, todayInJapan());
    const currentTerm = Array.from(currentTerms)[0] || '';
    const currentTermLabel = String(optionRows.find(option => String(option.term || option.term_id || '') === currentTerm)?.term_label || currentTerm);
    const courseCatalog = buildCourseCatalog(optionRows);

    const students = studentDocs.map(doc => {
      const data = doc.data();
      const registrationHistory = registrationHistoryMap.get(doc.id) || [];
      const regularRegistrationHistory = registrationHistory.filter(registration => String(registration.registration_type || 'regular') !== 'test_prep');
      const currentRegistration: any = selectEffectiveCourseRegistration(regularRegistrationHistory, courseYear, currentTerms, data);
      const activeTestPrepRegistrationId = String(data.active_test_prep_course_registration_id || '').trim();
      const testPrepHistory = registrationHistory.filter(registration => String(registration.registration_type || 'regular') === 'test_prep');
      const currentTestPrepRegistration: any = testPrepHistory.find(registration => registration.id === activeTestPrepRegistrationId) ||
        testPrepHistory.filter(registration => registration.is_current !== false && registration.current !== false && String(registration.status || 'active') === 'active')
          .sort((a, b) => String(b.updated_at?.seconds || b.created_at?.seconds || 0).localeCompare(String(a.updated_at?.seconds || a.created_at?.seconds || 0)))[0] || null;
      const courseRegistrations = registrationHistory.map(registration => ({
        id: registration.id,
        year: Number(registration.year || 0) || null,
        term: String(registration.term || ''),
        term_label: String(registration.term_label || registration.term || ''),
        status: String(registration.status || ''),
        registration_type: String(registration.registration_type || 'regular'),
        selected_course_ids: Array.isArray(registration.selected_course_ids) ? registration.selected_course_ids.map(String).filter(Boolean) : [],
        selected_course_labels: Array.isArray(registration.selected_course_labels) ? registration.selected_course_labels.map(String).filter(Boolean) : [],
        updated_at: timestampToIso(registration.updated_at || registration.created_at),
      }));
      const selectedCourseLabels = buildSelectedCourseLabels(currentRegistration, courseCatalog);
      const selectedCourseIds = Array.isArray(currentRegistration?.selected_course_ids)
        ? currentRegistration.selected_course_ids.map((id: any) => String(id || '').trim()).filter(Boolean)
        : [];
      const parentId = data.parent_uid || (Array.isArray(data.parent_ids) ? data.parent_ids[0] : '');
      const currentCourseLabel = selectedCourseLabels.join(' / ');
      const attendanceRequired = Boolean(currentCourseLabel) && !['suspended', 'withdrawn', 'archived'].includes(String(data.account_status || data.status || 'active'));
      const participation = aggregateStudentParticipation(
        participationMaps.attendanceByStudent.get(doc.id) || [],
        participationMaps.weeks,
        currentCourseLabel || '科目不明',
        attendanceRequired
          ? (data.course_start_month ? `${String(data.course_start_month).slice(0, 7)}-01` : '')
          : '9999-12-31',
      );
      const parentData = parentMap.get(String(parentId || ''));
      const parent = parentData ? {
        uid: parentId,
        parent_name: parentData.parent_name || parentData.name || '',
        lifetime_id: parentData.lifetime_id || parentData.initial_login_id || '',
        initial_password: parentData.initial_password || parentData.raw_password || '',
        isFirstLogin: parentData.isFirstLogin,
        email: parentData.email || '',
      } : null;
      return {
        id: doc.id,
        uid: doc.id,
        role: data.role || 'student',
        student_name: data.student_name || data.name || '',
        student_name_kana: data.student_name_kana || data.name_kana || '',
        grade: data.grade || '',
        school_id: data.school_id || data.school || '',
        classroom: data.classroom || '',
        middle_school: data.middle_school || data.junior_high_school || '',
        course_start_month: data.course_start_month || '',
        sibling_ids: Array.isArray(data.sibling_ids) ? data.sibling_ids : [],
        twin_sibling_ids: Array.isArray(data.twin_sibling_ids) ? data.twin_sibling_ids : [],
        trial_event_ids: Array.isArray(data.trial_event_ids) ? data.trial_event_ids : [],
        trial_continued: Boolean(data.trial_continued),
        member_type: data.member_type === 'general' ? 'general' : 'enrolled',
        summer_course_status: data.summer_course_status === 'attending' ? 'attending' : 'none',
        summer_only: Boolean(data.summer_only),
        enrollment_cancel_month: data.enrollment_cancel_month || '',
        enrollment_cancel_reason: data.enrollment_cancel_reason || '',
        day_of_week: data.day_of_week || '',
        subject_science: data.subject_science || data.science_subject || '',
        subject_social: data.subject_social || data.social_subject || '',
        selected_course_ids: selectedCourseIds,
        selected_course_labels: selectedCourseLabels,
        current_course_label: currentCourseLabel,
        active_course_registration_id: currentRegistration?.id || '',
        course_registration_status: currentRegistration?.status || 'unregistered',
        course_registration_year: courseYear,
        course_registration_term: currentRegistration?.term || currentTerm,
        course_registration_term_label: currentRegistration?.term_label || currentTermLabel,
        course_registration_updated_at: timestampToIso(currentRegistration?.updated_at),
        course_registrations: courseRegistrations,
        selected_test_prep_course_ids: Array.isArray(currentTestPrepRegistration?.selected_course_ids) ? currentTestPrepRegistration.selected_course_ids.map(String).filter(Boolean) : [],
        selected_test_prep_course_labels: Array.isArray(currentTestPrepRegistration?.selected_course_labels) ? currentTestPrepRegistration.selected_course_labels.map(String).filter(Boolean) : [],
        test_prep_course_registration_status: currentTestPrepRegistration?.status || 'unregistered',
        test_prep_course_registration_year: Number(currentTestPrepRegistration?.year || 0) || null,
        test_prep_course_registration_term: String(currentTestPrepRegistration?.term || ''),
        test_prep_course_registration_updated_at: timestampToIso(currentTestPrepRegistration?.updated_at || currentTestPrepRegistration?.created_at),
        weekly_attendance: weeklyAttendanceMap.get(doc.id) || {},
        weekly_participation: participation.weeks,
        consecutive_missed_weeks: participation.consecutive_missed_weeks,
        attendance_warning: participation.warning,
        attendance_follow_ups: participationMaps.followUpsByStudent.get(doc.id) || [],
        lifetime_id: data.lifetime_id || data.initial_login_id || '',
        initial_password: data.initial_password || data.raw_password || '',
        isFirstLogin: data.isFirstLogin,
        email: data.email || '',
        phone_number: data.phone_number || '',
        camera_off_requested: Boolean(data.camera_off_requested),
        absence_call_not_required: Boolean(data.absence_call_not_required),
        parent_uid: parentId || '',
        parent_name: parent?.parent_name || '',
        parent_login_id: parent?.lifetime_id || '',
        parent_initial_password: parent?.initial_password || '',
        parent_isFirstLogin: parent?.isFirstLogin,
        parent_email: parent?.email || '',
        account_status: data.account_status || data.status || 'active',
        last_login_at: timestampToIso(data.last_login_at || data.last_login),
        last_login: timestampToIso(data.last_login || data.last_login_at),
        created_at: data.created_at?.toDate ? data.created_at.toDate().toISOString() : data.created_at || null,
      };
    });

    return Response.json({ ok: true, school, schools: schoolOptions, attendance_weeks: participationMaps.weeks, students });
  } catch (error) {
    return jsonError(error);
  }
}
