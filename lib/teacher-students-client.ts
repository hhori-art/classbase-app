import { auth } from '@/lib/firebase';
import type { SafeTeacherStudent } from '@/lib/teacher-students';

export async function fetchTeacherStudents(): Promise<SafeTeacherStudent[]> {
  const currentUser = auth.currentUser;
  if (!currentUser) throw new Error('not-authenticated');

  const token = await currentUser.getIdToken();
  const res = await fetch('/api/teacher/students', {
    headers: { Authorization: `Bearer ${token}` },
    cache: 'no-store',
  });
  const data = await res.json().catch(() => ({}));
  if (!res.ok || !data.ok) throw new Error(data.error || 'students-fetch-failed');
  return data.students || [];
}
