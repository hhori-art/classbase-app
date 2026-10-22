'use client';
import SharedNewsList from '@/app/components/news/SharedNewsList';
export default function ParentNewsPage() { return <SharedNewsList role="parent" basePath="/parent/news" dashboardPath="/parent" padded={false} />; }
