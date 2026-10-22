'use client';
import { useCallback, useEffect, useState } from 'react';
import { Calendar, Download, Megaphone, Paperclip } from 'lucide-react';
import { Card, EmptyState, ErrorState, PageHeader, Skeleton, useToast } from '@/app/components/ui';
import { NewsLabelPill } from '@/app/components/news/NewsLabelPill';
import { loadAnnouncement } from '@/lib/client-announcements';
import { auth } from '@/lib/firebase';
import { formatDateTime } from '@/lib/format';
import { TERMS } from '@/lib/glossary';
import { cn } from '@/lib/cn';

type Props = {
  id: string;
  backLink: string;
  /** レイアウトが余白を持つ画面（保護者など）では false。 */
  padded?: boolean;
};

/** 本文中の URL をリンクにする。 */
const formatContent = (text: string) => {
  if (!text) return null;
  const urlRegex = /(https?:\/\/[^\s]+)/g;
  return text.split(urlRegex).map((part, index) => (
    part.match(urlRegex)
      ? <a key={index} href={part} target="_blank" rel="noopener noreferrer" className="break-all font-medium text-accent underline hover:text-accent-hover">{part}</a>
      : part
  ));
};

/** お知らせの詳細（各アプリのレイアウトの中に置く）。 */
export default function SharedNewsDetail({ id, backLink, padded = true }: Props) {
  const toast = useToast();
  const [news, setNews] = useState<any>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState(false);
  const [downloadingId, setDownloadingId] = useState('');

  const downloadAttachment = async (file: any) => {
    setDownloadingId(String(file.id || ''));
    try {
      const token = await auth.currentUser?.getIdToken();
      if (!token) throw new Error('認証情報を取得できません');
      const response = await fetch(`/api/announcements/${encodeURIComponent(id)}/attachments/${encodeURIComponent(file.id)}`, { headers: { Authorization: `Bearer ${token}` } });
      if (!response.ok) throw new Error('ダウンロードに失敗しました');
      const url = URL.createObjectURL(await response.blob());
      const anchor = document.createElement('a');
      anchor.href = url; anchor.download = file.name || 'attachment'; anchor.click();
      setTimeout(() => URL.revokeObjectURL(url), 1000);
    } catch (error: any) {
      toast.error(error.message || 'ダウンロードに失敗しました');
    } finally {
      setDownloadingId('');
    }
  };

  const fetchNewsDetail = useCallback(async () => {
    if (!id) return;
    setLoading(true);
    setError(false);
    try {
      const item = await loadAnnouncement(id);
      setNews(item);
    } catch (e) {
      console.error(e);
      setError(true);
    } finally {
      setLoading(false);
    }
  }, [id]);

  useEffect(() => { void fetchNewsDetail(); }, [fetchNewsDetail]);

  const tone = backLink.startsWith('/teacher') ? 'plain' : 'hero';
  const wrapper = cn('mx-auto w-full max-w-3xl space-y-5', padded && 'px-4 py-6');
  const publishedAt = news ? news.publish_at || news.created_at : null;

  if (loading) {
    return (
      <div className={wrapper} role="status" aria-label="読み込み中">
        <Skeleton className="h-32 w-full rounded-hero" />
        <Skeleton className="h-64 w-full rounded-card" />
      </div>
    );
  }

  if (error || !news) {
    return (
      <div className={wrapper}>
        <PageHeader tone={tone} icon={Megaphone} title={TERMS.news} backHref={backLink} />
        {error
          ? <ErrorState message="お知らせを読み込めませんでした。通信状態を確認して、もう一度お試しください。" onRetry={() => void fetchNewsDetail()} />
          : <EmptyState icon={Megaphone} title="お知らせが見つかりませんでした" description="公開が終わったか、削除された可能性があります。" />}
      </div>
    );
  }

  return (
    <div className={wrapper}>
      <PageHeader tone={tone} eyebrow={TERMS.news} title={news.title || TERMS.news} backHref={backLink} />

      <Card className="sm:p-8">
        <div className="mb-5 flex flex-wrap items-center gap-2 border-b border-line pb-5">
          {publishedAt && (
            <span className="inline-flex items-center gap-1.5 text-sm text-fg-muted">
              <Calendar size={14} aria-hidden />{formatDateTime(publishedAt, { withYear: true })}
            </span>
          )}
          <NewsLabelPill label={news.label} />
        </div>

        <div className="whitespace-pre-wrap break-words text-base leading-loose text-fg">
          {formatContent(news.content)}
        </div>

        {Array.isArray(news.attachments) && news.attachments.length > 0 && (
          <div className="mt-8 border-t border-line pt-6">
            <p className="mb-3 flex items-center gap-2 text-sm font-bold text-fg"><Paperclip size={16} aria-hidden /> 添付ファイル</p>
            <ul className="space-y-2">
              {news.attachments.map((file: any) => (
                <li key={file.id}>
                  <button
                    type="button"
                    onClick={() => downloadAttachment(file)}
                    disabled={downloadingId === String(file.id || '')}
                    className="flex min-h-12 w-full items-center justify-between gap-3 rounded-btn bg-accent-soft px-4 py-3 text-left text-sm font-bold text-accent hover:bg-accent-soft/70 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-accent disabled:opacity-60"
                  >
                    <span className="flex min-w-0 items-center gap-2"><Download size={16} aria-hidden className="shrink-0" /><span className="truncate">{file.name}</span></span>
                    <span className="shrink-0 text-xs font-medium text-fg-muted">{Math.ceil(Number(file.size || 0) / 1024)} KB</span>
                  </button>
                </li>
              ))}
            </ul>
          </div>
        )}
      </Card>
    </div>
  );
}
