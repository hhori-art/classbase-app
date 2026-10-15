'use client';

import AttendanceApprovalsWorkspace from '@/app/components/AttendanceApprovalsWorkspace';
import { useAuth } from '@/app/context/AuthContext';
import { hasScienceSocialProgram } from '@/lib/teacher-programs';

export default function AttendanceApprovalsPage() {
  const { profile } = useAuth();
  return <AttendanceApprovalsWorkspace mode="school_manager" backHref={hasScienceSocialProgram(profile) ? '/teacher/work' : '/teacher/attendance/dedicated'} />;
}
