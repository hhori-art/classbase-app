'use client';

import SharedNewsDetail from '@/app/components/news/SharedNewsDetail';
import { useParams } from 'next/navigation';

export default function TeacherNewsDetailPage() {
  const params = useParams();
  const id = params.id as string;

  return (
    <SharedNewsDetail 
      id={id} 
      backLink="/teacher/news" 
    />
  );
}