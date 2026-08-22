import 'server-only';

import { adminDb } from '@/lib/firebase-admin';
import { canManageAdminApp } from '@/lib/admin-app-access';
import { type ServerUser } from '@/lib/server-auth';

const activeEnrollment = (data: FirebaseFirestore.DocumentData) =>
  data.program_id === 'eiken' && data.status === 'active';

const profilePrograms = (profile: FirebaseFirestore.DocumentData) =>
  Array.isArray(profile.enabled_programs)
    ? profile.enabled_programs.map((value: unknown) => String(value))
    : [];

export async function listStudentEikenEnrollments(studentId: string) {
  const snapshot = await adminDb()
    .collection('course_enrollments')
    .where('user_id', '==', studentId)
    .get();

  return snapshot.docs
    .map(doc => ({ id: doc.id, ...doc.data() } as Record<string, any>))
    .filter(activeEnrollment);
}

export async function listLinkedStudentIds(user: ServerUser) {
  if (user.role !== 'parent') return [];
  const ids = new Set<string>(
    Array.isArray(user.profile.student_ids)
      ? user.profile.student_ids.map((value: unknown) => String(value)).filter(Boolean)
      : [],
  );

  const linked = await adminDb()
    .collection('users')
    .where('parent_uid', '==', user.uid)
    .get()
    .catch(() => null);
  linked?.docs.forEach(doc => ids.add(doc.id));
  return Array.from(ids);
}

export async function listTeacherEikenAssignments(teacherId: string) {
  const snapshot = await adminDb()
    .collection('eiken_teacher_assignments')
    .where('teacher_id', '==', teacherId)
    .get();
  return snapshot.docs
    .map(doc => ({ id: doc.id, ...doc.data() } as Record<string, any>))
    .filter(item => item.status === 'active');
}

export async function canAccessEiken(user: ServerUser) {
  if (user.role === 'master') return true;
  const programs = profilePrograms(user.profile);

  if (user.role === 'student') {
    return (await listStudentEikenEnrollments(user.uid)).length > 0;
  }
  if (user.role === 'parent') {
    const studentIds = await listLinkedStudentIds(user);
    const enrollments = await Promise.all(studentIds.map(listStudentEikenEnrollments));
    return enrollments.some(items => items.length > 0);
  }
  if (user.role === 'teacher') {
    return user.profile.eiken_teacher === true ||
      programs.includes('eiken') ||
      (await listTeacherEikenAssignments(user.uid)).length > 0;
  }
  return user.role === 'admin' && canManageAdminApp(user, 'eiken');
}

export async function requireEikenAccess(user: ServerUser) {
  if (!(await canAccessEiken(user))) throw new Error('eiken-forbidden');
}

export async function canManageEikenCourse(user: ServerUser, courseId: string) {
  if (user.role === 'master') return true;
  if (user.role === 'admin') {
    if (!canManageAdminApp(user, 'eiken')) return false;
    const course = await adminDb().collection('eiken_courses').doc(courseId).get();
    if (!course.exists) return false;
    const schoolId = String(course.data()?.school_id || '');
    return canManageEikenSchool(user, schoolId);
  }
  if (user.role === 'teacher') {
    const assignments = await listTeacherEikenAssignments(user.uid);
    return assignments.some(item => item.course_id === courseId);
  }
  return false;
}

export function canManageEikenSchool(user: ServerUser, schoolId?: string | null) {
  if (user.role === 'master') return true;
  if (user.role !== 'admin' || !canManageAdminApp(user, 'eiken')) return false;

  const targetSchool = String(schoolId || '').trim();
  if (!targetSchool) return true;
  if (targetSchool === 'all') return false;
  return user.school_ids.includes(targetSchool);
}

export async function requireStudentEnrollment(user: ServerUser, courseId?: string) {
  if (user.role !== 'student') throw new Error('forbidden');
  const enrollments = await listStudentEikenEnrollments(user.uid);
  const matched = courseId
    ? enrollments.find(item => item.course_id === courseId)
    : enrollments[0];
  if (!matched) throw new Error('eiken-enrollment-required');
  return matched;
}

export async function canReadEikenStudent(user: ServerUser, studentId: string, courseId?: string) {
  if (user.role === 'student') return user.uid === studentId;
  if (user.role === 'parent') return (await listLinkedStudentIds(user)).includes(studentId);
  if (user.role === 'master' || (user.role === 'admin' && canManageAdminApp(user, 'eiken'))) {
    if (user.role === 'master') return true;
    const student = await adminDb().collection('users').doc(studentId).get();
    const school = String(student.data()?.school_id || student.data()?.school || '');
    return !school || user.school_ids.includes(school);
  }
  if (user.role === 'teacher') {
    const enrollments = await listStudentEikenEnrollments(studentId);
    const assignments = await listTeacherEikenAssignments(user.uid);
    return enrollments.some(enrollment =>
      (!courseId || enrollment.course_id === courseId) &&
      assignments.some(assignment => assignment.course_id === enrollment.course_id),
    );
  }
  return false;
}
