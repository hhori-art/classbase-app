import { NextRequest } from 'next/server';
import { FieldValue } from 'firebase-admin/firestore';
import { adminDb } from '@/lib/firebase-admin';
import {
  canManageAttendanceSchool,
  canManageAttendanceShiftPlans,
  getServerUser,
  jsonError,
  type ServerUser,
} from '@/lib/server-auth';
import { attendanceSchoolName, resolveAttendanceSchoolCode, resolveAttendanceSchoolEntry } from '@/lib/attendance-schools';
import {
  addDateDays,
  dateDiffDays,
  DATE_KEY_PATTERN,
  normalizeShiftEmploymentCategory,
  validateAttendanceShiftPlan,
  type AttendanceShiftCategory,
  type AttendanceShiftPlan,
} from '@/lib/attendance-shift-plan';
import { getAllQueryDocuments } from '@/lib/server/firestore-pagination';
import { accessibleTeacherStudents } from '@/lib/server/teacher-student-access';

export const runtime = 'nodejs';
const COLLECTION = 'attendance_shift_plans';
const ROOM_SETTINGS_COLLECTION = 'attendance_shift_room_settings';
const clean = (value: unknown, max = 300) => String(value || '').trim().slice(0, max);
const getDocument = (ref: FirebaseFirestore.DocumentReference) => ref.get();
const withoutUndefined = <T extends Record<string, unknown>>(value: T) => Object.fromEntries(
  Object.entries(value).filter(([, item]) => item !== undefined),
) as T;

const profileSchool = (profile: Record<string, any>) => resolveAttendanceSchoolCode(
  profile.school_id || profile.school_code || profile.school_name || profile.school || profile.classroom ||
  (Array.isArray(profile.school_ids) ? profile.school_ids[0] : '')
);

const actorSchool = (actor: ServerUser, requested?: unknown) => {
  const schoolId = resolveAttendanceSchoolCode(requested) || profileSchool(actor.profile);
  if (!schoolId || !canManageAttendanceSchool(actor, schoolId)) throw new Error('forbidden');
  return schoolId;
};

const canUseManagerView = (actor: ServerUser) => canManageAttendanceShiftPlans(actor);

const staffForSchool = async (schoolId: string) => {
  const docs = await getAllQueryDocuments(adminDb().collection('users').where('role', '==', 'teacher'));
  return docs.map(doc => ({ id: doc.id, ...(doc.data() || {}) } as Record<string, any>))
    .filter(profile => !['suspended', 'withdrawn', 'archived'].includes(String(profile.account_status || profile.status || '')))
    .filter(profile => profileSchool(profile) === schoolId)
    .map(profile => ({
      id: profile.id,
      name: profile.name || profile.teacher_name || profile.display_name || profile.lifetime_id || '氏名未設定',
      login_id: profile.lifetime_id || profile.initial_login_id || '',
      employment_category: normalizeShiftEmploymentCategory(profile),
      school_id: schoolId,
    }))
    .sort((left, right) => String(left.name).localeCompare(String(right.name), 'ja'));
};

const studentsForSchool = async (actor: ServerUser, schoolId: string) => {
  return (await accessibleTeacherStudents(actor))
    .filter(profile => profileSchool(profile as Record<string, any>) === schoolId)
    .map(profile => ({
      id: profile.id,
      name: String(profile.student_name || profile.name || profile.lifetime_id || '氏名未設定'),
      login_id: String(profile.lifetime_id || ''),
      grade: clean(profile.grade, 20),
      classroom: clean(profile.classroom, 80),
    }))
    .sort((left, right) => `${left.grade} ${left.name}`.localeCompare(`${right.grade} ${right.name}`, 'ja'));
};

const shiftPayload = (
  input: Record<string, any>,
  staff: { id: string; name: string; employment_category: string | null },
  schoolId: string,
  students: Array<{ id: string; name: string }> = [],
): Omit<AttendanceShiftPlan, 'id'> => withoutUndefined({
  date: clean(input.date, 10),
  start: clean(input.start, 5),
  end: clean(input.end, 5),
  category: clean(input.category, 20) as AttendanceShiftCategory,
  teacher_id: staff.id,
  teacher_name: staff.name,
  student_ids: Array.isArray(input.student_ids) ? input.student_ids.map((id: unknown) => clean(id, 160)).filter(Boolean).slice(0, 6) : [],
  student_names: Array.isArray(input.student_ids) ? input.student_ids.map((id: unknown) => students.find(student => student.id === clean(id, 160))?.name).filter((name): name is string => Boolean(name)).slice(0, 6) : [],
  employment_category: staff.employment_category as AttendanceShiftPlan['employment_category'],
  school_id: schoolId,
  school_name: attendanceSchoolName(schoolId),
  title: clean(input.title, 100),
  grade: clean(input.grade, 20),
  subject: clean(input.subject, 60),
  individual_ratio: ['1:1', '1:2', '1:3'].includes(String(input.individual_ratio || '')) ? input.individual_ratio : undefined,
  individual_level: input.individual_level === 'advanced' ? 'advanced' : 'standard',
  office_task: clean(input.office_task, 60),
  room: clean(input.room, 80),
  note: clean(input.note, 500),
  reflect_to_attendance: input.reflect_to_attendance !== false,
});

const serialize = (doc: FirebaseFirestore.QueryDocumentSnapshot | FirebaseFirestore.DocumentSnapshot): AttendanceShiftPlan & Record<string, any> => ({
  id: doc.id,
  ...(doc.data() || {}),
} as AttendanceShiftPlan & Record<string, any>);

export async function GET(request: NextRequest) {
  try {
    const actor = await getServerUser(request);
    const manager = canUseManagerView(actor);
    const ownOnly = request.nextUrl.searchParams.get('scope') === 'mine';
    if (!manager && actor.role !== 'teacher') throw new Error('forbidden');
    const start = clean(request.nextUrl.searchParams.get('start'), 10);
    const end = clean(request.nextUrl.searchParams.get('end'), 10);
    if (!DATE_KEY_PATTERN.test(start) || !DATE_KEY_PATTERN.test(end) || start > end) {
      return Response.json({ ok: false, error: '表示期間を確認してください。' }, { status: 400 });
    }
    const schoolId = manager ? actorSchool(actor, request.nextUrl.searchParams.get('school_id')) : profileSchool(actor.profile);
    const includeStudents = request.nextUrl.searchParams.get('include_students') === 'true';
    const docs = await getAllQueryDocuments(
      adminDb().collection(COLLECTION).where('date', '>=', start).where('date', '<=', end).limit(5000)
    );
    const shifts = docs.map(serialize).filter(item => item.school_id === schoolId && ((manager && !ownOnly) || item.teacher_id === actor.uid));
    const schoolEntry = resolveAttendanceSchoolEntry(schoolId);
    const individualViewEnabled = true;
    const roomSettingsPromise = getDocument(adminDb().collection(ROOM_SETTINGS_COLLECTION).doc(schoolId));
    const [staff, students, roomSettings] = manager && !ownOnly
      ? await Promise.all([staffForSchool(schoolId), includeStudents ? studentsForSchool(actor, schoolId) : Promise.resolve([]), roomSettingsPromise])
      : [[], [], await roomSettingsPromise];
    return Response.json({
      ok: true,
      school: { id: schoolId, name: attendanceSchoolName(schoolId), mode: schoolEntry?.group === '個別' ? 'individual' : 'group' },
      settings: { allow_individual_view: individualViewEnabled },
      staff,
      students,
      shifts,
      rooms: roomSettings.exists ? roomSettings.data()?.rooms || {} : {},
    });
  } catch (error) {
    return jsonError(error);
  }
}

export async function POST(request: NextRequest) {
  try {
    const actor = await getServerUser(request);
    if (!canUseManagerView(actor)) throw new Error('forbidden');
    const body = await request.json();
    const action = clean(body.action, 30) || 'create';
    const schoolId = actorSchool(actor, body.school_id);
    const db = adminDb();

    if (action === 'create_room') {
      const category = clean(body.category, 20) as AttendanceShiftCategory;
      const room = clean(body.room, 40);
      if (!['group', 'individual', 'office'].includes(category) || !room) {
        return Response.json({ ok: false, error: '教室名を入力してください。' }, { status: 400 });
      }
      await db.collection(ROOM_SETTINGS_COLLECTION).doc(schoolId).set({
        school_id: schoolId,
        rooms: { [category]: FieldValue.arrayUnion(room) },
        updated_by: actor.uid,
        updated_at: FieldValue.serverTimestamp(),
      }, { merge: true });
      return Response.json({ ok: true, room });
    }

    if (action === 'update_settings') {
      const schoolEntry = resolveAttendanceSchoolEntry(schoolId);
      const allowIndividualView = schoolEntry?.group === '個別' || body.allow_individual_view === true;
      await db.collection('users').doc(actor.uid).set({
        attendance_shift_individual_view: allowIndividualView,
        attendance_shift_view_updated_at: FieldValue.serverTimestamp(),
      }, { merge: true });
      actor.profile.attendance_shift_individual_view = allowIndividualView;
      return Response.json({ ok: true, settings: { allow_individual_view: allowIndividualView } });
    }

    if (action === 'delete') {
      const id = clean(body.id, 160);
      const ref = db.collection(COLLECTION).doc(id);
      const snap = await getDocument(ref);
      if (!snap.exists) return Response.json({ ok: false, error: 'シフトが見つかりません。' }, { status: 404 });
      if (resolveAttendanceSchoolCode(snap.data()?.school_id) !== schoolId) throw new Error('forbidden');
      await ref.delete();
      return Response.json({ ok: true, deleted: id });
    }

    if (action === 'copy') {
      const mode = ['shift', 'day', 'week'].includes(String(body.mode || '')) ? String(body.mode) : 'shift';
      const sourceDate = clean(body.source_date, 10);
      const targetDate = clean(body.target_date, 10);
      if (!DATE_KEY_PATTERN.test(sourceDate) || !DATE_KEY_PATTERN.test(targetDate)) {
        return Response.json({ ok: false, error: 'コピー元・コピー先の日付を確認してください。' }, { status: 400 });
      }
      const sourceStart = mode === 'week' ? addDateDays(sourceDate, -((new Date(`${sourceDate}T00:00:00+09:00`).getDay() + 6) % 7)) : sourceDate;
      const sourceEnd = mode === 'week' ? addDateDays(sourceStart, 6) : sourceDate;
      const sourceDocs = await getAllQueryDocuments(db.collection(COLLECTION).where('date', '>=', sourceStart).where('date', '<=', sourceEnd).limit(500));
      let source = sourceDocs.map(serialize).filter(item => item.school_id === schoolId);
      if (mode === 'shift') source = source.filter(item => item.id === clean(body.id, 160));
      if (!source.length) return Response.json({ ok: false, error: 'コピーするシフトがありません。' }, { status: 400 });
      const offset = dateDiffDays(mode === 'week' ? sourceStart : sourceDate, targetDate);
      const batch = db.batch();
      source.slice(0, 200).forEach(item => {
        const ref = db.collection(COLLECTION).doc();
        const data = { ...item } as Record<string, any>;
        const copiedFrom = String(data.id || '');
        delete data.id;
        delete data.created_at;
        delete data.updated_at;
        batch.create(ref, {
          ...data,
          date: addDateDays(String(item.date), offset),
          copied_from: copiedFrom,
          created_by: actor.uid,
          created_at: FieldValue.serverTimestamp(),
          updated_at: FieldValue.serverTimestamp(),
        });
      });
      await batch.commit();
      return Response.json({ ok: true, copied: Math.min(source.length, 200) });
    }

    const rows = action === 'import' ? (Array.isArray(body.rows) ? body.rows.slice(0, 500) : []) : [body];
    const needsStudents = rows.some((row: Record<string, unknown>) => clean(row.category, 20) === 'individual');
    const [staff, students] = await Promise.all([staffForSchool(schoolId), needsStudents ? studentsForSchool(actor, schoolId) : Promise.resolve([])]);
    const staffMap = new Map(staff.map(item => [item.id, item]));
    const studentMap = new Map<string, (typeof students)[number]>();
    students.forEach(item => {
      studentMap.set(item.id, item);
      if (item.login_id) studentMap.set(item.login_id, item);
    });

    if (action === 'update') {
      const id = clean(body.id, 160);
      const ref = db.collection(COLLECTION).doc(id);
      const snap = await getDocument(ref);
      if (!snap.exists) return Response.json({ ok: false, error: 'シフトが見つかりません。' }, { status: 404 });
      if (resolveAttendanceSchoolCode(snap.data()?.school_id) !== schoolId) throw new Error('forbidden');
      const teacher = staffMap.get(clean(body.teacher_id, 160));
      if (!teacher) throw new Error('forbidden');
      const requestedStudentIds = Array.isArray(body.student_ids) ? body.student_ids.map((id: unknown) => clean(id, 160)).filter(Boolean) : [];
      if (requestedStudentIds.some((id: string) => !studentMap.has(id))) throw new Error('forbidden');
      const payload = shiftPayload({ ...body, student_ids: requestedStudentIds.map((id: string) => studentMap.get(id)?.id) }, teacher, schoolId, students);
      const validation = validateAttendanceShiftPlan(payload);
      if (validation) return Response.json({ ok: false, error: validation }, { status: 400 });
      await ref.set({ ...payload, updated_by: actor.uid, updated_at: FieldValue.serverTimestamp() }, { merge: true });
      return Response.json({ ok: true, shift: { id, ...payload } });
    }

    if (!rows.length) return Response.json({ ok: false, error: '取り込むシフトがありません。' }, { status: 400 });
    const created: string[] = [];
    const batch = db.batch();
    for (const row of rows) {
      const teacher = staffMap.get(clean(row.teacher_id, 160)) || staff.find(item => item.login_id && item.login_id === clean(row.login_id, 160));
      if (!teacher) return Response.json({ ok: false, error: `職員を確認できません: ${clean(row.teacher_name || row.login_id, 80)}` }, { status: 400 });
      const rawStudentIds = Array.isArray(row.student_ids) ? row.student_ids : [];
      const resolvedStudentIds = rawStudentIds.map((id: unknown) => studentMap.get(clean(id, 160))?.id).filter(Boolean);
      if (resolvedStudentIds.length !== rawStudentIds.filter(Boolean).length) {
        return Response.json({ ok: false, error: `${clean(row.date, 10)} ${teacher.name}: 生徒IDを確認してください。` }, { status: 400 });
      }
      const payload = shiftPayload({ ...row, student_ids: resolvedStudentIds }, teacher, schoolId, students);
      const validation = validateAttendanceShiftPlan(payload);
      if (validation) return Response.json({ ok: false, error: `${payload.date} ${teacher.name}: ${validation}` }, { status: 400 });
      const ref = db.collection(COLLECTION).doc();
      created.push(ref.id);
      batch.create(ref, {
        ...payload,
        source: action === 'import' ? 'csv' : 'manual',
        created_by: actor.uid,
        created_at: FieldValue.serverTimestamp(),
        updated_at: FieldValue.serverTimestamp(),
      });
    }
    await batch.commit();
    return Response.json({ ok: true, created, count: created.length });
  } catch (error) {
    return jsonError(error);
  }
}
