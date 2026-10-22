'use client';
import { useCallback, useEffect, useState } from 'react';
import Link from 'next/link';
import { ChevronRight, Megaphone } from 'lucide-react';
import { EmptyState, ErrorState, ListSkeleton, PageHeader } from '@/app/components/ui';
import { NewsLabelPill } from '@/app/components/news/NewsLabelPill';
import { loadAnnouncements } from '@/lib/client-announcements';
import { formatDate } from '@/lib/format';
import { TERMS } from '@/lib/glossary';
import { cn } from '@/lib/cn';

type Props = {
  role: 'student' | 'teacher' | 'parent';
  basePath: string;
  dashboardPath: string;
  /** レイアウトが余白を持つ画面（保護者など）では false。 */
  padded?: boolean;
};

/** 教室からのお知らせの一覧（各アプリのレイアウトの中に置く）。 */
export default function SharedNewsList({ role, basePath, dashboardPath, padded = true }: Props) {
  const [newsList, setNewsList] = useState<any[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState(false);

  const fetchNews = useCallback(async () => {
    setLoading(true);
    setError(false);
    try {
      const allData = await loadAnnouncements(50);
      const filtered = allData.filter((item: any) => item.target === 'all' || item.target === role);
      setNewsList(filtered);
    } catch (e) {
      console.error(e);
      setError(true);
    } finally {
      setLoading(false);
    }
  }, [role]);

  useEffect(() => { void fetchNews(); }, [fetchNews]);

  return (
    <div className={cn('mx-auto w-full max-w-3xl space-y-5', padded && 'px-4 py-6')}>
      <PageHeader
        tone={role === 'teacher' ? 'plain' : 'hero'}
        icon={Megaphone}
        eyebrow="教室から"
        title={TERMS.news}
        description="教室からの正式なご案内です。"
        backHref={dashboardPath}
      />

      {loading ? (
        <ListSkeleton rows={4} />
      ) : error ? (
        <ErrorState message="お知らせを読み込めませんでした。通信状態を確認して、もう一度お試しください。" onRetry={() => void fetchNews()} />
      ) : newsList.length === 0 ? (
        <EmptyState icon={Megaphone} title="お知らせはありません" description="教室からのご案内が届くと、ここに表示されます。" />
      ) : (
        <ul className="space-y-3">
          {newsList.map(item => (
            <li key={item.id}>
              <Link
                href={`${basePath}/${item.id}`}
                className="group block rounded-card border border-line bg-surface p-4 shadow-card transition-colors hover:border-accent/40 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-accent sm:p-5"
              >
                <div className="mb-2 flex flex-wrap items-center gap-2">
                  <span className="text-xs text-fg-muted">{formatDate(item.publish_at || item.created_at, { withYear: true }) || '-'}</span>
                  <NewsLabelPill label={item.label} />
                </div>
                <div className="flex items-center justify-between gap-3">
                  <h2 className="line-clamp-2 flex-1 text-base font-bold text-fg group-hover:text-accent">{item.title}</h2>
                  <ChevronRight size={18} className="shrink-0 text-fg-muted group-hover:text-accent" aria-hidden />
                </div>
                {item.content && <p className="mt-1 line-clamp-1 text-sm text-fg-muted">{item.content}</p>}
              </Link>
            </li>
          ))}
        </ul>
      )}
    </div>
  );
}
