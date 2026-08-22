import { NextRequest } from 'next/server';
import { FieldValue } from 'firebase-admin/firestore';
import { adminDb } from '@/lib/firebase-admin';
import { getServerUser, jsonError, requireRole } from '@/lib/server-auth';
import { enrichCourseOptionsWithShifts } from '@/lib/course-registration-match';
import { canStudentRegisterCourseOption } from '@/lib/course-registration-rules';
import { getCourseSubjectGroup, normalizeCourseText, toAsciiDigits } from '@/lib/course-text';
import { buildZoomJoinUrl, hasZoomPasswordToken, looksLikeZoomUrl, normalizeZoomMeetingId } from '@/lib/zoom-url';
import { fetchOfficialZoomJoinUrl } from '@/lib/zoom-meeting';
import { weekdayFromDateKey } from '@/lib/date-key';

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
    if (shift.id) {
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
  return sheetSynced.length > 0 ? sheetSynced : shifts;
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

const selectedIdMatchesOption = (selectedIds: Set<string>, option: any) => (
  selectedIds.has(String(option.id || '')) ||
  selectedIds.has(String(option.parent_course_option_id || '')) ||
  selectedIds.has(String(option.fallback_curriculum_option_id || ''))
);

export async function GET(request: NextRequest) {
  try {
    const user = await getServerUser(request);

    const params = request.nextUrl.searchParams;
    const previewMode = params.get('preview') === 'teacher';
    const betaTransferMode = params.get('beta_transfer') === '1' || params.get('beta_transfer') === 'true';
    if (previewMode) requireRole(user, ['teacher', 'master', 'admin']);
    else requireRole(user, ['student']);

    const targetDate = todayKeyInJapan();
    const period = Number(params.get('period') || 0);
    const db = adminDb();

    const [shiftSnap, registrationSnap, optionSnap, curriculumSnap, requestSnap] = await Promise.all([
      db.collection('shift_assignments').where('target_date', '==', targetDate).limit(80).get(),
      previewMode
        ? Promise.resolve({ docs: [] as any[] })
        : db.collection('course_registrations').where('student_id', '==', user.uid).limit(50).get(),
      db.collection('course_registration_options').limit(1000).get(),
      db.collection('annual_curriculum_schedules').limit(1500).get(),
      previewMode
        ? Promise.resolve({ docs: [] as any[] })
        : db.collection('requests').where('student_id', '==', user.uid).limit(100).get(),
    ]);

    const rawShifts = shiftSnap.docs
      .map(doc => ({ id: doc.id, ...doc.data() }))
      .filter(isStudentVisibleShift)
      .filter((shift: any) => !period || periodFromShift(shift) === period);
    const shifts = preferSheetSyncedShifts(rawShifts);

    const optionDocs = optionSnap.docs
      .map(doc => ({ id: doc.id, ...doc.data() }))
      .filter((option: any) => option.is_active !== false)
      .filter((option: any) => canStudentRegisterCourseOption(user.profile.grade, option));
    const curriculumDocs = curriculumSnap.docs.map(doc => ({ id: doc.id, ...doc.data() }));
    const enrichedOptions = enrichCourseOptionsWithShifts(optionDocs, curriculumDocs, shifts);

    const registrations = registrationSnap.docs
      .map(doc => ({ id: doc.id, ...doc.data() }))
      .filter(isActiveRegistration)
      .sort((a: any, b: any) => timestampValue(b.updated_at || b.created_at) - timestampValue(a.updated_at || a.created_at));

    const selectedIds = new Set<string>();
    const currentRegistration = registrations.find((registration: any) => registration.is_current === true || registration.current === true)
      || registrations.find((registration: any) => String(registration.status || '').toLowerCase() === 'active')
      || registrations[0];
    if (currentRegistration) {
      getSelectedCourseIds(currentRegistration).forEach(id => selectedIds.add(id));
    } else if (Array.isArray(user.profile.selected_course_ids)) {
      user.profile.selected_course_ids.forEach((id: unknown) => selectedIds.add(String(id)));
    }

    const eligibleShiftIds = new Set<string>();
    const eligibleReasons = new Map<string, string>();
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
      return Response.json({ ok: true, date: targetDate, period, classes, preview: true });
    }

    if (betaTransferMode) {
      const studentGrade = normalizeGrade(user.profile.grade);
      const candidateShifts = pickStudentFacingTransferShifts(shifts
        .filter((shift: any) => canStudentRegisterCourseOption(studentGrade, {
          grade: shift.target_grade,
          subject: shift.target_subject,
          course_name: shift.target_detail_subject,
          unit: shift.unit,
        }))
      );
      const classes = mergeClassCandidates(await Promise.all(candidateShifts
        .map(async (shift: any) => ({
          id: shift.id,
          url: await resolveStudentZoomUrl(shift),
          meeting_id: getShiftMeetingId(shift),
          grade: normalizeGrade(shift.target_grade || shift.grade),
          subject: shift.target_detail_subject || shift.target_subject || shift.subject || '授業',
          course_name: shift.target_detail_subject || '',
          unit: shift.unit || '',
          period: periodFromShift(shift),
          target_date: shift.target_date || targetDate,
          source: 'beta_transfer',
          match_reason: `${studentGrade || '同学年'}の振替参加候補`,
        }))));
      return Response.json({ ok: true, date: targetDate, period, classes, beta_transfer: true });
    }

    const matchedClasses = shifts
      .map((shift: any) => ({
        shift,
        source: transferRequests.some((req: any) => [req.transfer_shift_id, req.target_shift_id, req.shift_assignment_id].includes(shift.id))
          ? 'transfer'
          : eligibleShiftIds.has(shift.id)
            ? 'course_registration'
            : 'unmatched',
      }))
      .filter(item => eligibleShiftIds.has(item.shift.id));
    const classes = mergeClassCandidates(await Promise.all(matchedClasses
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
      }))));

    return Response.json({ ok: true, date: targetDate, period, classes });
  } catch (error) {
    return jsonError(error);
  }
}
