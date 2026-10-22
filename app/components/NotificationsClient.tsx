'use client';

import { useCallback, useEffect, useState } from 'react';
import { useRouter } from 'next/navigation';
import { Bell, CheckCheck, ChevronRight } from 'lucide-react';
import { NOTIFICATIONS_CHANGED_EVENT } from '@/app/components/NotificationBell';
import { useAuth } from '@/app/context/AuthContext';
import { Button, EmptyState, ErrorState, ListSkeleton, PageHeader, StatusPill, useToast } from '@/app/components/ui';
import { formatDateTime } from '@/lib/format';
import { TERMS } from '@/lib/glossary';
import { cn } from '@/lib/cn';

type NotificationItem = {
  id: string;
  title?: string;
  message?: string;
  kind?: string;
  read?: boolean;
  created_at?: any;
  link?: string;
};

/** 通知の種類（保存されているコード）を画面の言葉にする。知らないコードはそのまま出さない。 */
const KIND_LABELS: Record<string, string> = {
  attendance: '出欠',
  class_start: '授業の開始',
  homework: TERMS.homework,
  announcements: TERMS.news,
  registration: '受講登録',
  course_registration_changed: '受講講座の変更',
  shift: 'シフト',
  shift_unassigned: 'シフト',
  substitution: '代講',
  system: 'システム',
  safety_alert: '見守り',
  parent_inquiry: TERMS.parentContact,
  parent_inquiry_answered: `${TERMS.parentContact}の返信`,
  parent_absence_submitted: TERMS.absenceContact,
  student_absence_submitted: TERMS.absenceContact,
  absence_transfer_required: '振替のお願い',
  student_transfer_confirmed: '振替の確定',
  teacher_chat: '講師チャット',
  test_prep: 'テスト対策',
  monoxer_study_counts: TERMS.homework,
  course_analytics_report: '講座のレポート',
  parent_absence_cancelled: `${TERMS.absenceContact}の取り消し`,
  student_absence_cancelled: `${TERMS.absenceContact}の取り消し`,
  community_report: '掲示板の通報',
};

export function notificationKindLabel(kind?: string) {
  const key = String(kind || '').trim();
  return key ? KIND_LABELS[key] || '' : '';
}

/** Firestore の Timestamp を JSON にした形（{ _seconds }）も読めるようにしてから表示する。 */
function dateLabel(value: any) {
  if (!value) return '';
  if (typeof value === 'object' && !(value instanceof Date) && typeof value.toDate !== 'function') {
    const seconds = Number(value._seconds ?? value.seconds);
    return Number.isFinite(seconds) && seconds > 0 ? formatDateTime(seconds * 1000) : '';
  }
  return formatDateTime(value);
}

/**
 * 自分宛ての通知の一覧（生徒・保護者・講師・管理で共通）。
 * 各アプリのレイアウトの中に置く。保護者のようにレイアウトが余白を持つときは padded={false}。
 */
export default function NotificationsClient({ backHref, embedded = false, padded = true }: { backHref: string; embedded?: boolean; padded?: boolean }) {
  const { user } = useAuth();
  const router = useRouter();
  const toast = useToast();
  const [items, setItems] = useState<NotificationItem[]>([]);
  const [loading, setLoading] = useState(true);
  const [loadError, setLoadError] = useState('');
  const [serverUnread, setServerUnread] = useState<number | null>(null);
  const [markingAll, setMarkingAll] = useState(false);

  const load = useCallback(async () => {
    setLoading(true);
    setLoadError('');
    try {
      if (!user) return;
      const token = await user.getIdToken();
      const res = await fetch('/api/notifications?limit=80', {
        headers: { Authorization: `Bearer ${token}` },
      });
      const data = await res.json().catch(() => ({}));
      if (!res.ok || !data.ok) throw new Error(data.error || 'notifications-load-failed');
      setItems(data.notifications || []);
      const count = Number(data.unread_count);
      setServerUnread(Number.isFinite(count) && count >= 0 ? count : null);
    } catch (loadError) {
      console.error(loadError);
      setItems([]);
      setLoadError('通知を読み込めませんでした。通信状態を確認して、もう一度お試しください。');
    } finally {
      setLoading(false);
    }
  }, [user]);

  useEffect(() => {
    if (!user) return;
    load();
  }, [user, load]);

  const markRead = async (item: NotificationItem) => {
    if (item.read) return;
    setItems(prev => prev.map(current => current.id === item.id ? { ...current, read: true } : current));
    try {
      if (!user) return;
      const token = await user.getIdToken();
      const response = await fetch('/api/notifications', {
        method: 'PATCH',
        headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${token}` },
        body: JSON.stringify({ id: item.id, read: true }),
      });
      const data = await response.json().catch(() => ({}));
      if (!response.ok || !data.ok) throw new Error(data.error || 'notification-update-failed');
      setServerUnread(current => current === null ? null : Math.max(0, current - 1));
      window.dispatchEvent(new Event(NOTIFICATIONS_CHANGED_EVENT));
    } catch {
      setItems(prev => prev.map(current => current.id === item.id ? { ...current, read: false } : current));
      toast.error('既読状態を保存できませんでした。再度お試しください。');
    }
  };

  /** 自分宛ての未読をまとめて既読にする（サーバーは1回に最大200件。残りがあれば続けて押せる）。 */
  const markAllRead = async () => {
    if (!user || markingAll) return;
    setMarkingAll(true);
    try {
      const token = await user.getIdToken();
      const response = await fetch('/api/notifications', {
        method: 'PATCH',
        headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${token}` },
        body: JSON.stringify({ all: true }),
      });
      const data = await response.json().catch(() => ({}));
      if (!response.ok || !data.ok) throw new Error(data.error || 'notification-update-failed');
      window.dispatchEvent(new Event(NOTIFICATIONS_CHANGED_EVENT));
      if (data.remaining) {
        await load();
        toast.info('既読にしました。まだ未読が残っているので、もう一度押してください。');
      } else {
        setItems(prev => prev.map(current => ({ ...current, read: true })));
        setServerUnread(0);
        toast.success('すべて既読にしました。');
      }
    } catch {
      toast.error('既読にできませんでした。通信状態を確認して、もう一度お試しください。');
    } finally {
      setMarkingAll(false);
    }
  };

  const openNotification = async (item: NotificationItem) => {
    await markRead(item);
    if (item.link?.startsWith('/') && !item.link.startsWith('//')) router.push(item.link);
  };

  // 未読数はサーバーが自分宛てすべてを数えた値（一覧は最新80件まで）。
  const unreadCount = Math.max(serverUnread ?? 0, items.filter(item => !item.read).length);
  // 管理・講師は白地の見出し、生徒・保護者は差し色の帯（docs/ui-guidelines.md）。
  const plain = embedded || backHref.startsWith('/teacher') || backHref.startsWith('/master');

  return (
    <div className={cn('mx-auto w-full max-w-3xl space-y-5', padded && !embedded && 'px-4 py-6')}>
      <PageHeader
        tone={plain ? 'plain' : 'hero'}
        icon={Bell}
        eyebrow={embedded ? undefined : '自分宛て'}
        title={embedded ? '自分への通知' : TERMS.notification}
        description={!loading && !loadError && items.length > 0 ? (unreadCount > 0 ? `未読 ${unreadCount}件` : 'すべて既読です') : undefined}
        backHref={embedded ? undefined : backHref}
      />

      {!loading && !loadError && unreadCount > 0 && (
        <div className="flex justify-end">
          <Button variant="secondary" onClick={() => void markAllRead()} loading={markingAll} icon={<CheckCheck size={17} aria-hidden />}>
            すべて既読にする
          </Button>
        </div>
      )}

      {loading ? (
        <ListSkeleton rows={4} />
      ) : loadError ? (
        <ErrorState message={loadError} onRetry={() => void load()} />
      ) : items.length === 0 ? (
        <EmptyState icon={Bell} title="通知はまだありません" description="あなた宛ての連絡が届くと、ここに表示されます。" />
      ) : (
        <ul className="space-y-3">
          {items.map(item => {
            const kindLabel = notificationKindLabel(item.kind);
            const linked = Boolean(item.link?.startsWith('/') && !item.link.startsWith('//'));
            return (
              <li key={item.id}>
                <button
                  type="button"
                  onClick={() => void openNotification(item)}
                  className={cn(
                    'w-full rounded-card border p-4 text-left shadow-card transition-colors',
                    'focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-accent',
                    item.read ? 'border-line bg-surface hover:bg-canvas' : 'border-accent/25 bg-accent-soft hover:border-accent/40',
                  )}
                >
                  <div className="flex items-start justify-between gap-3">
                    <div className="min-w-0">
                      <div className="mb-2 flex flex-wrap items-center gap-2">
                        <StatusPill tone={item.read ? 'neutral' : 'accent'}>{item.read ? '既読' : '未読'}</StatusPill>
                        {kindLabel && <span className="inline-flex items-center gap-1 whitespace-nowrap rounded-full px-2.5 py-0.5 text-xs font-bold bg-surface text-fg-muted ring-1 ring-line">{kindLabel}</span>}
                        <span className="text-xs text-fg-muted">{dateLabel(item.created_at)}</span>
                      </div>
                      <h2 className={cn('text-base text-fg', item.read ? 'font-medium' : 'font-bold')}>{item.title || TERMS.notification}</h2>
                      {item.message && <p className="mt-1.5 whitespace-pre-wrap text-sm leading-relaxed text-fg-muted">{item.message}</p>}
                    </div>
                    {linked && <ChevronRight className="mt-1 shrink-0 text-fg-muted" size={18} aria-hidden />}
                  </div>
                </button>
              </li>
            );
          })}
        </ul>
      )}
    </div>
  );
}
