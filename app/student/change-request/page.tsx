'use client';

import { useMemo } from 'react';
import { ListChecks } from 'lucide-react';
import { useAuth } from '@/app/context/AuthContext';
import { PageHeader } from '@/app/components/ui';
import CourseChangeFlow from '@/app/components/course-registration/CourseChangeFlow';

/** 生徒本人の受講講座の登録・変更。保存すると、つながっている保護者へ通知される。 */
export default function StudentChangeRequestPage() {
  const { user, profile } = useAuth();
  const student = useMemo(() => (user && profile ? { ...profile, id: user.uid } : null), [user, profile]);

  return (
    <CourseChangeFlow
      student={student}
      viewer="student"
      header={(
        <PageHeader
          tone="hero"
          title="受講講座の登録・変更"
          description="変更内容は保存後すぐに反映されます"
          icon={ListChecks}
          backHref="/student"
        />
      )}
    />
  );
}
