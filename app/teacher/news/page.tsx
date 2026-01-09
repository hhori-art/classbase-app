'use client';

import SharedNewsList from '@/app/components/news/SharedNewsList';

export default function TeacherNewsListPage() {
  return (
    <SharedNewsList 
      role="teacher" 
      basePath="/teacher/news" 
      dashboardPath="/teacher" // ← ここを修正
    />
  );
}