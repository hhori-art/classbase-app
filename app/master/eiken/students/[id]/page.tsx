'use client';

import { useParams, useSearchParams } from 'next/navigation';
import EikenStudentDetail from '@/app/components/eiken/EikenStudentDetail';

export default function EikenAdminStudentDetailPage() {
  const params = useParams<{ id: string }>();
  const searchParams = useSearchParams();
  return (
    <EikenStudentDetail
      studentId={String(params.id || '')}
      courseId={searchParams.get('course_id') || undefined}
      backHref="/master/eiken"
    />
  );
}
