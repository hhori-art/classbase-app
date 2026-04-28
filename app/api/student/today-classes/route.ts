import { NextRequest } from 'next/server';
import { adminDb } from '@/lib/firebase-admin';
import { getServerUser, jsonError, requireRole } from '@/lib/server-auth';
import { enrichCourseOptionsWithShifts } from '@/lib/course-registration-match';

export const runtime = 'nodejs';

const toAsciiDigits = (value: string) => value.replace(/[０-９]/g, char => String.fromCharCode(char.charCodeAt(0) - 0xfee0));

const normalize = (value: unknown) => toAsciiDigits(String(value || '').normalize('NFKC'))
  .toLowerCase()
  .replace(/\s+/g, '')
  .replace(/[（）()【】\[\]第・,，、]/g, '')
  .trim();

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

const buildZoomUrl = (shift: any) => {
  if (shift.zoom_url) return String(shift.zoom_url);
  if (!shift.target_meeting_id) return '';
  const cleanId = String(shift.target_meeting_id).replace(/[\s-]/g, '');
  if (!cleanId) return '';
  const url = new URL(`https://zoom.us/j/${cleanId}`);
  if (shift.target_password) url.searchParams.set('pwd', String(shift.target_password));
  return url.toString();
};

const timestampValue = (value: any) => {
  if (!value) return 0;
  if (typeof value.seconds === 'number') return value.seconds;
  const date = value.toDate ? value.toDate() : new Date(value);
  return Number.isNaN(date.getTime()) ? 0 : Math.floor(date.getTime() / 1000);
};

const selectedSubjectFallback = (student: any, shift: any) => {
  const studentSubjects = [
    ...(Array.isArray(student.subjects) ? student.subjects : []),
    student.subject_science,
    student.subject_social,
  ].map(normalize).filter(Boolean);
  const shiftSubject = normalize(`${shift.target_subject || ''}${shift.target_detail_subject || ''}`);
  return studentSubjects.some(subject => shiftSubject.includes(subject) || subject.includes(shiftSubject));
};

const optionMatchesShift = (option: any, shift: any) => {
  const gradeOk = !option.grade || !shift.target_grade || normalizeGrade(option.grade) === normalizeGrade(shift.target_grade);
  const subjectOk = !option.subject || !shift.target_subject || normalize(option.subject) === normalize(shift.target_subject);
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

    const params = request.nextUrl.searchParams;
    const today = new Date().toISOString().slice(0, 10);
    const targetDate = String(params.get('date') || today).slice(0, 10);
    const period = Number(params.get('period') || 0);
    const db = adminDb();

    const [shiftSnap, registrationSnap, optionSnap, curriculumSnap, requestSnap] = await Promise.all([
      db.collection('shift_assignments').where('target_date', '==', targetDate).limit(80).get(),
      db.collection('course_registrations').where('student_id', '==', user.uid).limit(50).get(),
      db.collection('course_registration_options').limit(1000).get(),
      db.collection('annual_curriculum_schedules').limit(1500).get(),
      db.collection('requests').where('student_id', '==', user.uid).limit(100).get(),
    ]);

    const shifts = shiftSnap.docs
      .map(doc => ({ id: doc.id, ...doc.data() }))
      .filter((shift: any) => shift.role_type !== 'sub')
      .filter((shift: any) => !String(shift.teacher_name || '').includes('サポート'))
      .filter((shift: any) => !period || periodFromShift(shift) === period);

    const optionDocs = optionSnap.docs
      .map(doc => ({ id: doc.id, ...doc.data() }))
      .filter((option: any) => option.is_active !== false)
      .filter((option: any) => !option.grade || normalizeGrade(option.grade) === normalizeGrade(user.profile.grade));
    const curriculumDocs = curriculumSnap.docs.map(doc => ({ id: doc.id, ...doc.data() }));
    const enrichedOptions = enrichCourseOptionsWithShifts(optionDocs, curriculumDocs, shifts);

    const registrations = registrationSnap.docs
      .map(doc => ({ id: doc.id, ...doc.data() }))
      .filter((item: any) => item.status !== 'cancelled')
      .sort((a: any, b: any) => timestampValue(b.updated_at || b.created_at) - timestampValue(a.updated_at || a.created_at));

    const selectedIds = new Set<string>();
    registrations.forEach((registration: any) => {
      if (Array.isArray(registration.selected_course_ids)) {
        registration.selected_course_ids.forEach((id: unknown) => selectedIds.add(String(id)));
      }
    });

    const eligibleShiftIds = new Set<string>();
    enrichedOptions
      .filter((option: any) => selectedIds.has(option.id) || selectedIds.has(option.parent_course_option_id))
      .forEach((option: any) => {
        if (Array.isArray(option.matched_shift_ids)) option.matched_shift_ids.forEach((id: unknown) => eligibleShiftIds.add(String(id)));
        shifts.filter((shift: any) => optionMatchesShift(option, shift)).forEach((shift: any) => eligibleShiftIds.add(shift.id));
      });

    const transferRequests = requestSnap.docs
      .map(doc => ({ id: doc.id, ...doc.data() }))
      .filter((item: any) => item.type === 'transfer')
      .filter((item: any) => item.target_date === targetDate)
      .filter((item: any) => item.status !== 'rejected' && item.status !== 'cancelled');

    transferRequests.forEach((item: any) => {
      const shiftId = item.transfer_shift_id || item.target_shift_id || item.shift_assignment_id;
      if (shiftId) eligibleShiftIds.add(String(shiftId));
    });

    const hasStrictRegistration = selectedIds.size > 0 || transferRequests.length > 0;
    const classes = shifts
      .map((shift: any) => ({
        shift,
        url: buildZoomUrl(shift),
        source: transferRequests.some((req: any) => [req.transfer_shift_id, req.target_shift_id, req.shift_assignment_id].includes(shift.id))
          ? 'transfer'
          : eligibleShiftIds.has(shift.id)
            ? 'course_registration'
            : 'profile_subject',
      }))
      .filter(item => item.url)
      .filter(item => eligibleShiftIds.has(item.shift.id) || (!hasStrictRegistration && selectedSubjectFallback(user.profile, item.shift)))
      .map(item => ({
        id: item.shift.id,
        url: item.url,
        meeting_id: item.shift.target_meeting_id || '',
        subject: item.shift.target_detail_subject || item.shift.target_subject || item.shift.subject || '授業',
        course_name: item.shift.target_detail_subject || '',
        unit: item.shift.unit || '',
        period: periodFromShift(item.shift),
        target_date: item.shift.target_date || targetDate,
        source: item.source,
      }));

    return Response.json({ ok: true, date: targetDate, period, classes });
  } catch (error) {
    return jsonError(error);
  }
}
