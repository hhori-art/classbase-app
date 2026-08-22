import { NextRequest } from 'next/server';
import { adminDb } from '@/lib/firebase-admin';
import { getServerUser, isAdminLike, jsonError } from '@/lib/server-auth';
import { enrichCourseOptionsWithShifts } from '@/lib/course-registration-match';

export const runtime = 'nodejs';

const currentCourseYear = () => {
  const now = new Date();
  return now.getMonth() + 1 >= 4 ? now.getFullYear() : now.getFullYear() - 1;
};

const courseYearDateRange = (year: number) => ({
  start: `${year}-04-01`,
  end: `${year + 1}-03-31`,
});

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

const buildCourseLabelMap = async (db: FirebaseFirestore.Firestore, year: number) => {
  const range = courseYearDateRange(year);
  const [optionSnap, curriculumSnap, shiftSnap] = await Promise.all([
    db.collection('course_registration_options').limit(1000).get().catch(() => null),
    db.collection('annual_curriculum_schedules').limit(1500).get().catch(() => null),
    db.collection('shift_assignments')
      .where('target_date', '>=', range.start)
      .where('target_date', '<=', range.end)
      .orderBy('target_date', 'asc')
      .limit(5000)
      .get()
      .catch(() => null),
  ]);

  const options = enrichCourseOptionsWithShifts(
    optionSnap?.docs.map(doc => ({ id: doc.id, ...doc.data() })).filter((option: any) => option.is_active !== false) || [],
    curriculumSnap?.docs.map(doc => ({ id: doc.id, ...doc.data() })) || [],
    shiftSnap?.docs.map(doc => ({ id: doc.id, ...doc.data() })) || [],
  );

  return options.reduce((map, option: any) => {
    const label = courseLabel(option);
    [option.id, option.parent_course_option_id, option.fallback_curriculum_option_id]
      .map(value => String(value || '').trim())
      .filter(Boolean)
      .forEach(id => {
        if (!map.has(id)) map.set(id, label);
      });
    return map;
  }, new Map<string, string>());
};

const pickCurrentRegistration = (registrations: any[]) => {
  return registrations
    .sort((a: any, b: any) => {
      const left = timestampToIso(b.updated_at || b.created_at) || '';
      const right = timestampToIso(a.updated_at || a.created_at) || '';
      return left.localeCompare(right);
    })
    .find((item: any) => item.is_current || item.current) ||
    registrations.find((item: any) => item.status === 'active') ||
    registrations[0] ||
    null;
};

const chunk = <T,>(values: T[], size: number) => {
  const chunks: T[][] = [];
  for (let index = 0; index < values.length; index += size) {
    chunks.push(values.slice(index, index + size));
  }
  return chunks;
};

const buildCurrentRegistrationMap = async (db: FirebaseFirestore.Firestore, studentIds: string[]) => {
  const map = new Map<string, any>();
  const uniqueIds = Array.from(new Set(studentIds.map(id => String(id || '').trim()).filter(Boolean)));
  if (uniqueIds.length === 0) return map;

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
    const current = pickCurrentRegistration(registrations);
    if (current) map.set(studentId, current);
  });

  return map;
};

const buildSelectedCourseLabels = (registration: any, student: any, labelMap: Map<string, string>) => {
  const explicitLabels = Array.isArray(registration?.selected_course_labels)
    ? registration.selected_course_labels.map((value: any) => String(value || '').trim()).filter(Boolean)
    : Array.isArray(student?.selected_course_labels)
      ? student.selected_course_labels.map((value: any) => String(value || '').trim()).filter(Boolean)
    : [];
  if (explicitLabels.length > 0) return Array.from(new Set(explicitLabels));

  const ids = Array.isArray(registration?.selected_course_ids)
    ? registration.selected_course_ids
    : Array.isArray(student?.selected_course_ids)
      ? student.selected_course_ids
      : [];
  const labels = (ids as any[])
    .map((id: any) => String(id || '').trim())
    .filter(Boolean)
    .map((id: string) => labelMap.get(id) || id)
    .filter(Boolean);
  return Array.from(new Set(labels));
};

export async function GET(request: NextRequest) {
  try {
    const actor = await getServerUser(request);
    if (!isAdminLike(actor)) throw new Error('forbidden');

    const db = adminDb();
    const courseYear = currentCourseYear();
    const requestedSchool = request.nextUrl.searchParams.get('school') || '';
    const school = actor.role === 'master' ? requestedSchool : actor.school_ids[0] || actor.school || '';

    if (!school && actor.role !== 'master') {
      return Response.json({ ok: true, school: '', students: [] });
    }

    let snap: FirebaseFirestore.QuerySnapshot;
    if (actor.role === 'master' && !school) {
      snap = await db.collection('users').where('role', '==', 'student').limit(500).get();
    } else {
      snap = await db.collection('users').where('role', '==', 'student').where('school_id', '==', school).limit(500).get();
      if (snap.empty) {
        snap = await db.collection('users').where('role', '==', 'student').where('school', '==', school).limit(500).get();
      }
    }

    const currentRegistrationMap = await buildCurrentRegistrationMap(db, snap.docs.map(doc => doc.id));
    const needsCourseLabelMap = snap.docs.some(doc => {
      const data = doc.data();
      const currentRegistration = currentRegistrationMap.get(doc.id);
      const explicitLabels = Array.isArray(currentRegistration?.selected_course_labels)
        ? currentRegistration.selected_course_labels
        : Array.isArray(data.selected_course_labels)
          ? data.selected_course_labels
          : [];
      const selectedIds = Array.isArray(currentRegistration?.selected_course_ids)
        ? currentRegistration.selected_course_ids
        : Array.isArray(data.selected_course_ids)
          ? data.selected_course_ids
          : [];
      return explicitLabels.length === 0 && selectedIds.length > 0;
    });
    const courseLabelMap = needsCourseLabelMap ? await buildCourseLabelMap(db, courseYear) : new Map<string, string>();

    const students = await Promise.all(snap.docs.map(async doc => {
      const data = doc.data();
      const currentRegistration: any = currentRegistrationMap.get(doc.id) || null;
      const selectedCourseLabels = buildSelectedCourseLabels(currentRegistration, data, courseLabelMap);
      const selectedCourseIds = Array.isArray(currentRegistration?.selected_course_ids)
        ? currentRegistration.selected_course_ids.map((id: any) => String(id || '').trim()).filter(Boolean)
        : Array.isArray(data.selected_course_ids)
          ? data.selected_course_ids.map((id: any) => String(id || '').trim()).filter(Boolean)
          : [];
      const parentId = data.parent_uid || (Array.isArray(data.parent_ids) ? data.parent_ids[0] : '');
      let parent: any = null;
      if (parentId) {
        const parentSnap = await db.collection('users').doc(parentId).get().catch(() => null);
        if (parentSnap?.exists) {
          const parentData = parentSnap.data() || {};
          parent = {
            uid: parentSnap.id,
            parent_name: parentData.parent_name || parentData.name || '',
            lifetime_id: parentData.lifetime_id || parentData.initial_login_id || '',
            initial_password: parentData.initial_password || parentData.raw_password || '',
            isFirstLogin: parentData.isFirstLogin,
            email: parentData.email || '',
          };
        }
      }
      return {
        id: doc.id,
        uid: doc.id,
        role: data.role || 'student',
        student_name: data.student_name || data.name || '',
        grade: data.grade || '',
        school_id: data.school_id || data.school || '',
        classroom: data.classroom || '',
        middle_school: data.middle_school || data.junior_high_school || '',
        course_start_month: data.course_start_month || '',
        sibling_ids: Array.isArray(data.sibling_ids) ? data.sibling_ids : [],
        twin_sibling_ids: Array.isArray(data.twin_sibling_ids) ? data.twin_sibling_ids : [],
        trial_event_ids: Array.isArray(data.trial_event_ids) ? data.trial_event_ids : [],
        trial_continued: Boolean(data.trial_continued),
        enrollment_cancel_month: data.enrollment_cancel_month || '',
        enrollment_cancel_reason: data.enrollment_cancel_reason || '',
        day_of_week: data.day_of_week || '',
        subject_science: data.subject_science || data.science_subject || '',
        subject_social: data.subject_social || data.social_subject || '',
        selected_course_ids: selectedCourseIds,
        selected_course_labels: selectedCourseLabels,
        active_course_registration_id: currentRegistration?.id || data.active_course_registration_id || '',
        course_registration_status: currentRegistration?.status || data.course_registration_status || '',
        course_registration_year: currentRegistration?.year || data.course_registration_year || courseYear,
        course_registration_term: currentRegistration?.term || data.course_registration_term || '',
        course_registration_term_label: currentRegistration?.term_label || data.course_registration_term_label || '',
        course_registration_updated_at: timestampToIso(currentRegistration?.updated_at || data.course_registration_updated_at),
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
        created_at: data.created_at?.toDate ? data.created_at.toDate().toISOString() : data.created_at || null,
      };
    }));

    return Response.json({ ok: true, school, students });
  } catch (error) {
    return jsonError(error);
  }
}
