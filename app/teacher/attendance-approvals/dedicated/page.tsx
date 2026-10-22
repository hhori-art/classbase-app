'use client';

import { ArrowLeft } from 'lucide-react';
import Link from 'next/link';
import DedicatedAttendanceAdmin from '@/app/components/DedicatedAttendanceAdmin';
import { EmptyState } from '@/app/components/ui';
import { useAuth } from '@/app/context/AuthContext';
import { isDedicatedAttendanceApproverProfile } from '@/lib/employment-category';

/** 専任の校舎承認者が、自分の校舎の専任の時間外の予定・報告・月の報告書を承認する。 */
export default function TeacherDedicatedApprovalsPage() {
  const { profile } = useAuth();
  if (profile && !isDedicatedAttendanceApproverProfile(profile)) {
    return <main className="px-4 py-5"><EmptyState title="専任の承認は、校舎の承認者だけが使えます" /></main>;
  }
  return (
    <main className="space-y-3 px-4 py-5 sm:px-6">
      <Link href="/teacher/attendance/dedicated" className="inline-flex min-h-11 items-center gap-1.5 text-sm font-bold text-fg-muted hover:text-fg"><ArrowLeft size={16} aria-hidden />専任勤怠へ戻る</Link>
      <DedicatedAttendanceAdmin title="専任の承認" />
    </main>
  );
}
