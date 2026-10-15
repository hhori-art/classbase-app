import 'server-only';
import { adminDb } from '@/lib/firebase-admin';
import type { ServerUser } from '@/lib/server-auth';
import { toSafeTeacherStudent, type SafeTeacherStudent } from '@/lib/teacher-students';

const clean = (value: unknown) => String(value || '').normalize('NFKC').trim();
const chunks = <T,>(values: T[], size: number) => Array.from({ length: Math.ceil(values.length / size) }, (_, i) => values.slice(i * size, (i + 1) * size));

export async function accessibleTeacherStudents(user: ServerUser): Promise<SafeTeacherStudent[]> {
  const db = adminDb();
  if (user.role === 'master') {
    const snap = await db.collection('users').where('role', '==', 'student').limit(5000).get();
    return snap.docs.map(doc => toSafeTeacherStudent(doc.id, doc.data()));
  }

  const allowedSchools = Array.from(new Set([user.school, ...user.school_ids].map(clean).filter(Boolean)));
  const explicitIds = Array.from(new Set([
    ...(Array.isArray(user.profile.student_ids) ? user.profile.student_ids : []),
    ...(Array.isArray(user.profile.assigned_student_ids) ? user.profile.assigned_student_ids : []),
  ].map(clean).filter(Boolean))).slice(0, 500);
  const explicitIdSet = new Set(explicitIds);
  const docs = new Map<string, FirebaseFirestore.QueryDocumentSnapshot | FirebaseFirestore.DocumentSnapshot>();
  const queries = chunks(allowedSchools, 10).flatMap(group => ['school_id', 'school', 'classroom'].map(field =>
    db.collection('users').where(field, 'in', group).limit(1500).get()
  ));
  const [querySnaps, explicitSnaps] = await Promise.all([
    Promise.all(queries),
    Promise.all(explicitIds.map(id => db.collection('users').doc(id).get())),
  ]);
  querySnaps.forEach(snap => snap.docs.forEach(doc => docs.set(doc.id, doc)));
  explicitSnaps.filter(doc => doc.exists).forEach(doc => docs.set(doc.id, doc));
  return [...docs.values()]
    .filter(doc => {
      const data = doc.data() || {};
      if (data.role !== 'student') return false;
      if (explicitIdSet.has(doc.id)) return true;
      const storedSchools = Array.from(new Set([
        data.school_id, data.school_code, data.school_name, data.school, data.classroom,
      ].map(clean).filter(Boolean)));
      return storedSchools.length > 0 && storedSchools.every(school => allowedSchools.includes(school));
    })
    .map(doc => toSafeTeacherStudent(doc.id, doc.data() || {}));
}

export async function requireAccessibleStudent(user: ServerUser, studentId: string) {
  const target = clean(studentId);
  if (!target) throw new Error('student-required');
  const students = await accessibleTeacherStudents(user);
  const student = students.find(item => item.id === target || item.uid === target);
  if (!student) throw new Error('forbidden');
  return student;
}
