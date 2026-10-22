'use client';

import { useEffect } from 'react';
import { useAuth } from '@/app/context/AuthContext';
import StudentDashboard from '@/app/student/page';
import { Spinner } from '@/app/components/ui';

export default function TeacherStudentPreviewPage() {
  const { profile, loading } = useAuth();

  useEffect(() => {
    if (!loading && profile && profile.role !== 'teacher') {
      window.location.href = profile.role === 'student' ? '/student' : '/';
    }
  }, [loading, profile]);

  if (loading || !profile) {
    return (
      <div className="flex min-h-[60vh] items-center justify-center">
        <Spinner size={36} />
      </div>
    );
  }

  if (profile.role !== 'teacher') return null;

  return <StudentDashboard />;
}
