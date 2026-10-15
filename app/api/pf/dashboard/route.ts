import { NextRequest } from 'next/server';
import { adminDb } from '@/lib/firebase-admin';
import { getServerUser, jsonError, requireRole } from '@/lib/server-auth';
import { aggregatePfStudent, pfDateRange } from '@/lib/pf-analytics';
import { getAllQueryDocuments } from '@/lib/server/firestore-pagination';
import { unstable_cache } from 'next/cache';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

const clean = (value: unknown) => String(value || '').trim();
const schoolOf = (data: Record<string, any>) => clean(data.school_id || data.school || data.classroom || data.classroom_name);
const gradeOf = (data: Record<string, any>) => clean(data.grade || data.target_grade || data.class_grade).normalize('NFKC');
const nameOf = (data: Record<string, any>) => clean(data.student_name || data.name || data.display_name || data.displayName);

const rate = (completed: number, total: number) => total ? Math.round((completed / total) * 100) : null;

const loadPfStudentRoster = unstable_cache(async () => {
  const docs = await getAllQueryDocuments(adminDb().collection('users').where('role', '==', 'student'));
  return docs.map(doc => ({ id: doc.id, ...doc.data() } as any));
}, ['pf-student-roster-v1'], { revalidate: 300, tags: ['users', 'pf-student-roster'] });

async function loadLinkedParentStudents(parentId: string, listedIds: string[]) {
  const db = adminDb();
  const [listed, reverseLinked] = await Promise.all([
    Promise.all(Array.from(new Set(listedIds.filter(Boolean))).slice(0, 20).map(id => db.collection('users').doc(id).get())),
    getAllQueryDocuments(db.collection('users').where('parent_uid', '==', parentId)),
  ]);
  const students = new Map<string, any>();
  [...listed, ...reverseLinked].forEach(doc => {
    if (!doc.exists) return;
    const data = doc.data() || {};
    if (data.role !== 'student') return;
    if (clean(data.parent_uid) !== parentId && !listedIds.includes(doc.id)) return;
    students.set(doc.id, { id: doc.id, ...data });
  });
  return Array.from(students.values());
}

export async function GET(request: NextRequest) {
  try {
    const actor = await getServerUser(request);
    requireRole(actor, ['master', 'admin', 'teacher', 'parent']);
    const params = request.nextUrl.searchParams;
    const period = params.get('period') === 'month' ? 'month' : 'week';
    const range = pfDateRange(period, params.get('anchor'));
    const requestedSchool = clean(params.get('school'));
    const requestedStudent = clean(params.get('student_id'));
    const db = adminDb();

    const parentListedIds = Array.isArray(actor.profile.student_ids) ? actor.profile.student_ids.map(String) : [];
    const allStudents = actor.role === 'parent'
      ? await loadLinkedParentStudents(actor.uid, parentListedIds)
      : await loadPfStudentRoster();
    let scopedStudents = allStudents;
    let classes: Array<{ key: string; label: string; grade: string; subject: string; school: string }> = [];

    if (actor.role === 'parent') {
      const linked = new Set(parentListedIds);
      scopedStudents = allStudents.filter(student => linked.has(student.id) || clean(student.parent_uid) === actor.uid);
      if (requestedStudent) scopedStudents = scopedStudents.filter(student => student.id === requestedStudent);
    } else if (actor.role === 'teacher') {
      const explicitIds = new Set([
        ...(Array.isArray(actor.profile.student_ids) ? actor.profile.student_ids : []),
        ...(Array.isArray(actor.profile.assigned_student_ids) ? actor.profile.assigned_student_ids : []),
        ...(Array.isArray(actor.profile.teacher_student_ids) ? actor.profile.teacher_student_ids : []),
      ].map(String));
      const teacherNames = [actor.profile.name, actor.profile.teacher_name, actor.profile.display_name, actor.profile.displayName]
        .map(clean).filter(Boolean);
      const [idShiftDocs, ...nameShiftGroups] = await Promise.all([
        getAllQueryDocuments(db.collection('shift_assignments').where('user_id', '==', actor.uid)),
        ...teacherNames.slice(0, 2).map(name => getAllQueryDocuments(db.collection('shift_assignments').where('teacher_name', '==', name))),
      ]);
      const shiftMap = new Map<string, any>();
      [...idShiftDocs, ...nameShiftGroups.flat()].forEach(doc => shiftMap.set(doc.id, { id: doc.id, ...doc.data() }));
      const relevantShifts = Array.from(shiftMap.values()).filter(shift => {
        const date = clean(shift.target_date);
        return (!date || (range.start <= date && date <= range.end)) && clean(shift.role_type || 'main') !== 'general';
      });
      const grades = new Set(relevantShifts.map(gradeOf).filter(Boolean));
      const schools = new Set(relevantShifts.map(schoolOf).filter(Boolean));
      const profileSchools = new Set([...(actor.school_ids || []), actor.school].map(clean).filter(Boolean));
      const targetSchools = schools.size ? schools : profileSchools;
      classes = Array.from(new Map(relevantShifts.map(shift => {
        const grade = gradeOf(shift);
        const subject = clean(shift.target_detail_subject || shift.target_subject || shift.subject || '担当授業');
        const school = schoolOf(shift);
        const key = [school, grade, subject].join('_');
        return [key, { key, label: [school, grade, subject].filter(Boolean).join(' '), grade, subject, school }];
      })).values());
      scopedStudents = allStudents.filter(student => {
        if (explicitIds.has(student.id)) return true;
        const schoolOk = targetSchools.size > 0 && targetSchools.has(schoolOf(student));
        const gradeOk = grades.size === 0 ? false : grades.has(gradeOf(student));
        return schoolOk && gradeOk;
      });
    } else {
      const allowedSchools = actor.role === 'master'
        ? null
        : new Set([...(actor.school_ids || []), actor.school].map(clean).filter(Boolean));
      if (actor.role === 'admin' && (!allowedSchools || allowedSchools.size === 0)) throw new Error('forbidden');
      if (requestedSchool && allowedSchools && !allowedSchools.has(requestedSchool)) throw new Error('forbidden');
      scopedStudents = allStudents.filter(student => {
        const school = schoolOf(student);
        if (allowedSchools && allowedSchools.size > 0 && !allowedSchools.has(school)) return false;
        return !requestedSchool || school === requestedSchool;
      });
    }

    const studentIds = new Set(scopedStudents.map(student => student.id));
    const [attendanceDocs, learningDocs] = actor.role === 'parent'
      ? await Promise.all([
          Promise.all(scopedStudents.map(student => getAllQueryDocuments(db.collection('attendance').where('student_id', '==', student.id))))
            .then(groups => groups.flat().filter(doc => {
              const date = clean(doc.data()?.target_date || doc.data()?.date);
              return range.start <= date && date <= range.end;
            })),
          Promise.all(scopedStudents.map(student => getAllQueryDocuments(db.collection('pf_learning_records').where('student_id', '==', student.id))))
            .then(groups => groups.flat().filter(doc => {
              const date = clean(doc.data()?.date);
              return range.start <= date && date <= range.end;
            })),
        ])
      : await Promise.all([
          getAllQueryDocuments(db.collection('attendance')
            .where('target_date', '>=', range.start)
            .where('target_date', '<=', range.end)),
          getAllQueryDocuments(db.collection('pf_learning_records')
            .where('date', '>=', range.start)
            .where('date', '<=', range.end)),
        ]);

    const attendanceByStudent = new Map<string, Map<string, any>>();
    attendanceDocs.forEach(doc => {
      const record = { id: doc.id, ...doc.data() } as any;
      const studentId = clean(record.user_id || record.student_id);
      if (!studentIds.has(studentId)) return;
      if (!attendanceByStudent.has(studentId)) attendanceByStudent.set(studentId, new Map());
      const key = clean(record.target_date || record.date) || doc.id;
      attendanceByStudent.get(studentId)!.set(key, record);
    });
    const learningByStudent = new Map<string, any[]>();
    learningDocs.forEach(doc => {
      const record = { id: doc.id, ...doc.data() } as any;
      const studentId = clean(record.student_id || record.user_id);
      if (!studentIds.has(studentId)) return;
      if (!learningByStudent.has(studentId)) learningByStudent.set(studentId, []);
      learningByStudent.get(studentId)!.push(record);
    });

    const students = scopedStudents.map(student => ({
      id: student.id,
      student_name: nameOf(student) || '氏名未設定',
      lifetime_id: clean(student.lifetime_id || student.login_id),
      grade: gradeOf(student),
      school: schoolOf(student),
      day_of_week: clean(student.day_of_week),
      ...aggregatePfStudent(
        student.id,
        Array.from(attendanceByStudent.get(student.id)?.values() || []),
        learningByStudent.get(student.id) || [],
      ),
    })).sort((a, b) => `${a.school}_${a.grade}_${a.student_name}`.localeCompare(`${b.school}_${b.grade}_${b.student_name}`, 'ja', { numeric: true }));

    const totals = students.reduce((sum, student) => ({
      attendanceCompleted: sum.attendanceCompleted + student.attendance_present + student.attendance_late,
      attendanceTotal: sum.attendanceTotal + student.attendance_total,
      homeworkCompleted: sum.homeworkCompleted + student.homework_completed,
      homeworkTotal: sum.homeworkTotal + student.homework_total,
      quizCompleted: sum.quizCompleted + student.quiz_completed,
      quizTotal: sum.quizTotal + student.quiz_total,
      alerts: sum.alerts + student.alert_count,
    }), { attendanceCompleted: 0, attendanceTotal: 0, homeworkCompleted: 0, homeworkTotal: 0, quizCompleted: 0, quizTotal: 0, alerts: 0 });
    const schoolSource = actor.role === 'master'
      ? allStudents
      : actor.role === 'admin'
        ? allStudents.filter(student => actor.school_ids.includes(schoolOf(student)) || actor.school === schoolOf(student))
        : scopedStudents;
    const visibleSchools = Array.from(new Set(schoolSource
      .map(schoolOf).filter(Boolean))).sort((a, b) => a.localeCompare(b, 'ja'));

    return Response.json({
      ok: true,
      audience: actor.role,
      period,
      range,
      schools: visibleSchools,
      classes,
      students,
      summary: {
        student_count: students.length,
        attendance_rate: rate(totals.attendanceCompleted, totals.attendanceTotal),
        homework_rate: rate(totals.homeworkCompleted, totals.homeworkTotal),
        quiz_rate: rate(totals.quizCompleted, totals.quizTotal),
        alert_count: totals.alerts,
      },
    }, { headers: { 'Cache-Control': 'private, no-store' } });
  } catch (error) {
    return jsonError(error);
  }
}
