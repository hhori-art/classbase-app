'use client';

import SharedNewsList from '@/app/components/news/SharedNewsList';

export default function StudentNewsListPage() {
  return (
    <SharedNewsList 
      role="student" 
      basePath="/student/news" 
      dashboardPath="/student"  // ← ここを修正 (/student/dashboard だと404になる場合があるため)
    />
  );
}