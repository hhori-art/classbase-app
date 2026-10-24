'use client';

import NotificationsClient from '@/app/components/NotificationsClient';
import { useAuth } from '@/app/context/AuthContext';
import { isDedicatedProfile } from '@/lib/employment-category';
import { hasScienceSocialProgram } from '@/lib/teacher-programs';

export default function TeacherNotificationsPage() {
  const { profile } = useAuth();
  // 「戻る」は、その人が開ける画面へ（勤怠だけの職員は /teacher を開けないため）。
  const backHref = !profile
    ? '/teacher'
    : hasScienceSocialProgram(profile)
      ? (isDedicatedProfile(profile) ? '/teacher/school-students' : '/teacher')
      : isDedicatedProfile(profile) ? '/teacher/attendance/dedicated' : '/teacher/attendance';
  return <NotificationsClient backHref={backHref} />;
}
