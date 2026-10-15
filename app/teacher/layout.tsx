'use client';

import TeacherBottomNav from '@/app/components/TeacherBottomNav';
import { useEffect } from 'react';
import { usePathname, useRouter } from 'next/navigation';
import { useAuth } from '@/app/context/AuthContext';
import { isDedicatedAttendanceApproverProfile, isDedicatedProfile, isSemiDedicatedProfile } from '@/lib/employment-category';
import { hasScienceSocialProgram } from '@/lib/teacher-programs';

export default function TeacherLayout({ children }: { children: React.ReactNode }) {
  const pathname = usePathname();
  const router = useRouter();
  const { profile, loading } = useAuth();
  const isStudentPreview = pathname.startsWith('/teacher/student-preview');
  const hasScienceSocial = hasScienceSocialProgram(profile);
  const dedicatedScienceSocial = Boolean(profile && isDedicatedProfile(profile) && hasScienceSocial);
  const semiDedicatedScienceSocial = Boolean(profile && isSemiDedicatedProfile(profile) && hasScienceSocial);
  const attendancePaths = ['/teacher/attendance', '/teacher/attendance-approvals', '/teacher/settings', '/teacher/notifications'];
  const isAttendancePath = attendancePaths.some(path => pathname === path || pathname.startsWith(`${path}/`));
  const isShiftManagementPath = pathname === '/teacher/shift-management' || pathname.startsWith('/teacher/shift-management/');
  const canOpenShiftManagement = Boolean(profile && isDedicatedAttendanceApproverProfile(profile));
  const canOpenPath = loading || !profile || (
    isShiftManagementPath
      ? canOpenShiftManagement
      : semiDedicatedScienceSocial || isAttendancePath || (dedicatedScienceSocial && pathname.startsWith('/teacher/school-students'))
  );

  useEffect(() => {
    if (loading || !profile || canOpenPath) return;
    router.replace(dedicatedScienceSocial ? '/teacher/school-students' : '/teacher/attendance');
  }, [canOpenPath, dedicatedScienceSocial, loading, profile, router]);

  if (!canOpenPath) return <div className="min-h-screen bg-slate-50" aria-busy="true" />;

  return (
    <div className="min-h-screen bg-[#F0F4F8]">
      {/* メインコンテンツ (ボトムナビの高さ分だけ下に余白を確保) */}
      <div className={`${isStudentPreview ? '' : isShiftManagementPath ? 'w-full pb-[calc(7.5rem+env(safe-area-inset-bottom))]' : 'mx-auto max-w-5xl pb-[calc(7.5rem+env(safe-area-inset-bottom))]'} min-h-screen relative`}>
        {children}
      </div>
      
      {/* 常に表示されるボトムナビ */}
      {!isStudentPreview && <TeacherBottomNav />}
    </div>
  );
}
