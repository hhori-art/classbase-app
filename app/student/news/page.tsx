'use client';

import { useState, useEffect, useCallback } from 'react';
import { Bell, ChevronRight, Calendar } from 'lucide-react';
import Link from 'next/link';
import { loadAnnouncements } from '@/lib/client-announcements';
import { EmptyState, ErrorState, ListSkeleton, PageHeader } from '@/app/components/ui';
import { formatDate } from '@/lib/format';

// タグ定義 (管理者側と合わせる)
const LABELS: { [key: string]: { label: string; color: string; bar: string } } = {
  important: { label: '重要', color: 'bg-danger-soft text-danger border-danger/20', bar: 'bg-danger' },
  event:     { label: 'イベント', color: 'bg-accent-soft text-accent border-accent/30', bar: 'bg-accent' },
  info:      { label: 'お知らせ', color: 'bg-info-soft text-info border-info/20', bar: 'bg-info' },
  alert:     { label: '緊急', color: 'bg-warning-soft text-warning border-warning/30', bar: 'bg-warning' },
};

export default function StudentNewsPage() {
  const [list, setList] = useState<any[]>([]);
  const [loading, setLoading] = useState(true);
  const [loadError, setLoadError] = useState(false);

  const fetchNews = useCallback(async () => {
    setLoading(true);
    setLoadError(false);
    try {
      // 全てのお知らせを取得 (日付順)
      const allData = await loadAnnouncements(50);

      // ★フィルタリング: 「全員宛」または「生徒宛」のみ抽出
      const myNews = allData.filter((item: any) =>
        !item.target || item.target === 'all' || item.target === 'student'
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
    void fetchNews();
  }, [fetchNews]);

  return (
    <div className="mx-auto max-w-3xl space-y-5 px-4 py-6">
      <PageHeader tone="hero" title="お知らせ一覧" description="教室からのお知らせです。" icon={Bell} backHref="/student" />

      <div className="space-y-4">
        {loading ? (
          <ListSkeleton rows={4} />
        ) : loadError ? (
          <ErrorState title="お知らせを読み込めませんでした" onRetry={() => void fetchNews()} />
        ) : list.length === 0 ? (
          <EmptyState icon={Bell} title="お知らせはありません" />
        ) : (
          list.map((item) => {
            // タグ情報取得 (ない場合は info)
            const labelKey = item.label || 'info';
            const labelInfo = LABELS[labelKey] || LABELS.info;
            const dateText = item.publish_at || item.created_at ? formatDate(item.publish_at || item.created_at, { withYear: true }) : '';

            return (
              <Link key={item.id} href={`/student/news/${item.id}`} className="group block rounded-card focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-accent">
                <div className="cb-card relative overflow-hidden p-card transition-shadow hover:shadow-md">
                  {/* 左側のアクセントバー */}
                  <div className={`absolute bottom-0 left-0 top-0 w-1.5 ${labelInfo.bar}`} aria-hidden />

                  <div className="mb-2 flex items-start justify-between pl-2">
                    <div className="flex items-center gap-2">
                      <span className={`rounded-md border px-2 py-0.5 text-xs font-bold ${labelInfo.color}`}>
                        {labelInfo.label}
                      </span>
                      <span className="flex items-center gap-1 text-xs text-fg-muted">
                        <Calendar size={12} aria-hidden />
                        {dateText || '-'}
                      </span>
                    </div>
                    <ChevronRight size={16} aria-hidden className="text-fg-muted/60 transition-colors group-hover:text-accent" />
                  </div>

                  <h3 className="mb-1 line-clamp-1 pl-2 text-base font-bold text-fg transition-colors group-hover:text-accent">
                    {item.title}
                  </h3>

                  <p className="line-clamp-2 pl-2 text-xs leading-relaxed text-fg-muted">
                    {item.content}
                  </p>
                </div>
              </Link>
            );
          })
        )}
      </div>
    </div>
  );
}
