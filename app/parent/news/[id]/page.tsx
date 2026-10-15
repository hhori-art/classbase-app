'use client';
import { useParams } from 'next/navigation';
import SharedNewsDetail from '@/app/components/news/SharedNewsDetail';
export default function ParentNewsDetailPage() { const params = useParams(); return <SharedNewsDetail id={params.id as string} backLink="/parent/news" />; }
