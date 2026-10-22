'use client';

import { useCallback, useState, useEffect } from 'react';
import { Bell, ChevronRight, Calendar } from 'lucide-react';
import Link from 'next/link';
import { loadAnnouncements } from '@/lib/client-announcements';
import { EmptyState, ErrorState, ListSkeleton, PageHeader } from '@/app/components/ui';
import { formatDate } from '@/lib/format';

// タグ定義
const LABELS: {[key: string]: { label: string, color: string, bar: string }} = {
  important: { label: '重要', color: 'bg-rose-50 text-rose-700 border-rose-200', bar: 'bg-rose-400' },
  event:     { label: 'イベント', color: 'bg-amber-50 text-amber-700 border-amber-200', bar: 'bg-amber-400' },
  info:      { label: 'お知らせ', color: 'bg-sky-50 text-sky-700 border-sky-200', bar: 'bg-sky-400' },
  alert:     { label: '緊急', color: 'bg-amber-50 text-amber-800 border-amber-300', bar: 'bg-amber-500' },
};

export default function TeacherNewsPage() {
  const [list, setList] = useState<any[]>([]);
  const [loading, setLoading] = useState(true);
  const [loadError, setLoadError] = useState(false);

  const fetchNews = useCallback(async () => {
    setLoading(true);
    setLoadError(false);
    try {
      const allData = await loadAnnouncements(50);

      // ★フィルタリング: 「全員宛」または「講師宛」のみ抽出
      const myNews = allData.filter((item: any) => 
        !item.target || item.target === 'all' || item.target === 'teacher'
      );

      setList(myNews);
    } catch (error) {
      console.error(error);
      setLoadError(true);
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    fetchNews();
  }, [fetchNews]);

  return (
    <div className="px-4 py-5 sm:px-6">
      <div className="mx-auto max-w-3xl space-y-6">
        
        <PageHeader tone="plain" title="運営からのお知らせ" icon={Bell} backHref="/teacher" />

        {/* リスト表示 */}
        <div className="space-y-4">
          {loading ? (
            <ListSkeleton rows={4} />
          ) : loadError ? (
            <ErrorState title="お知らせを読み込めませんでした" onRetry={fetchNews} />
          ) : list.length === 0 ? (
            <EmptyState icon={Bell} title="お知らせはありません" />
          ) : (
            list.map((item) => {
              const labelKey = item.label || 'info';
              const labelInfo = LABELS[labelKey] || LABELS.info;
              const date = item.publish_at || item.created_at;

              return (
                <Link key={item.id} href={`/teacher/news/${item.id}`} className="group block rounded-card focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-accent">
                  <div className="cb-card relative overflow-hidden p-5 transition-shadow hover:shadow-md">
                    
                    <div className={`absolute bottom-0 left-0 top-0 w-1.5 ${labelInfo.bar}`}></div>

                    <div className="mb-2 flex items-start justify-between pl-2">
                      <div className="flex items-center gap-2">
                        <span className={`rounded-input border px-2 py-0.5 text-xs font-bold ${labelInfo.color}`}>
                          {labelInfo.label}
                        </span>
                        <span className="flex items-center gap-1 text-xs text-fg-muted">
                          <Calendar size={12} aria-hidden />
                          {date ? formatDate(date, { withYear: true }) || '-' : '-'}
                        </span>
                      </div>
                      <ChevronRight size={16} className="text-slate-300 transition-colors group-hover:text-accent" aria-hidden />
                    </div>

                    <h3 className="mb-1 line-clamp-1 pl-2 text-base font-bold text-fg transition-colors group-hover:text-accent">
                      {item.title}
                    </h3>
                    
                    <p className="line-clamp-2 pl-2 text-sm leading-relaxed text-fg-muted">
                      {item.content}
                    </p>
                  </div>
                </Link>
              );
            })
          )}
        </div>
      </div>
    </div>
  );
}
