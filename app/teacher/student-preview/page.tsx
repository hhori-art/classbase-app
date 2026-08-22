'use client';

import { useEffect } from 'react';
import { useAuth } from '@/app/context/AuthContext';
import StudentDashboard from '@/app/student/page';
import { Loader2 } from 'lucide-react';

export default function TeacherStudentPreviewPage() {
  const { profile, loading } = useAuth();

  useEffect(() => {
    if (!loading && profile && profile.role !== 'teacher') {
      window.location.href = profile.role === 'student' ? '/student' : '/';
    }
  }, [loading, profile]);

  if (loading || !profile) {
    return (
      <div className="flex min-h-screen items-center justify-center bg-slate-50">
        <Loader2 className="animate-spin text-indigo-600" size={36} />
      </div>
    );
  }

  if (profile.role !== 'teacher') return null;

  return <StudentDashboard />;
}
