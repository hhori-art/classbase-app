'use client';

import { useCallback, useEffect, useState } from 'react';
import Link from 'next/link';
import { AlertTriangle, ArrowRight, CheckSquare, Inbox, KeyRound, MessageCircle, MessagesSquare, RefreshCw, ShoppingBag, type LucideIcon } from 'lucide-react';
import { auth } from '@/lib/firebase';
import AdminPageHeader from '@/app/components/master/AdminPageHeader';
import { Button, ButtonLink, Card, EmptyState, ErrorState, ListSkeleton, SectionTitle, StatusPill, type StatusTone } from '@/app/components/ui';
import { formatDateTime } from '@/lib/format';
import { userErrorMessage } from '@/lib/user-error';

type GroupKey = 'parentInquiries' | 'requests' | 'safetyAlerts' | 'community' | 'rewardShipments' | 'passwordRecovery';
type Item = { id: string; status: string; title: string; summary: string; at: string | null; href: string };
type Group = { key: GroupKey; items: Item[]; error?: boolean };

const GROUPS: Record<GroupKey, { title: string; icon: LucideIcon; href: string; empty: string }> = {
  safetyAlerts: { title: 'AIチャット安全アラート', icon: AlertTriangle, href: '/master/safety-alerts', empty: '未対応のアラートはありません' },
  parentInquiries: { title: '教室への連絡', icon: MessageCircle, href: '/master/parent-inquiries', empty: '未返信の連絡はありません' },
  requests: { title: '生徒・保護者からの申請', icon: CheckSquare, href: '/master/requests', empty: '未対応の申請はありません' },
  community: { title: '掲示板の承認待ち', icon: MessagesSquare, href: '/master/community', empty: '承認待ちの投稿はありません' },
  rewardShipments: { title: '景品の発送待ち', icon: ShoppingBag, href: '/master/rewards?tab=shipments', empty: '発送待ちの景品はありません' },
  passwordRecovery: { title: 'パスワード再設定の依頼', icon: KeyRound, href: '/master/accounts/recovery', empty: '未対応の依頼はありません' },
};
const ORDER: GroupKey[] = ['safetyAlerts', 'parentInquiries', 'requests', 'passwordRecovery', 'community', 'rewardShipments'];

const STATUS: Record<string, { label: string; tone: StatusTone }> = {
  unread: { label: '未読', tone: 'warning' },
  open: { label: '未対応', tone: 'warning' },
  pending: { label: '未対応', tone: 'warning' },
  in_progress: { label: '対応中', tone: 'info' },
  preparing: { label: '準備中', tone: 'info' },
};
const statusOf = (group: GroupKey, status: string) => {
  if (group === 'parentInquiries' && status === 'open') return { label: '未返信', tone: 'warning' as StatusTone };
  if (group === 'community') return { label: '承認待ち', tone: 'warning' as StatusTone };
  if (group === 'rewardShipments' && status === 'pending') return { label: '受付', tone: 'accent' as StatusTone };
  return STATUS[status] || { label: '未対応', tone: 'warning' as StatusTone };
};

/** 対応待ち（マスター専用）。教室への連絡・申請・安全アラート・掲示板・景品の発送を種類ごとに新しい順で並べる。 */
export default function AdminInboxPage() {
  const [groups, setGroups] = useState<Group[] | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState('');

  const load = useCallback(async () => {
    setLoading(true);
    setError('');
    try {
      const token = await auth.currentUser?.getIdToken();
      const response = await fetch('/api/admin/inbox', { headers: { Authorization: `Bearer ${token}` }, cache: 'no-store' });
      const body = await response.json().catch(() => ({}));
      if (!response.ok || body.ok === false) throw new Error(body.error || '対応待ちを読み込めませんでした。');
      setGroups(body.groups || []);
    } catch (loadError) {
      setError(userErrorMessage(loadError, '対応待ちを読み込めませんでした。'));
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => { void load(); }, [load]);

  const byKey = new Map((groups || []).map(group => [group.key, group]));
  const total = (groups || []).reduce((sum, group) => sum + group.items.length, 0);

  return (
    <div>
      <AdminPageHeader
        icon={Inbox}
        description="対応が必要なものを種類ごとに新しい順で最大10件ずつ表示します。開くとそれぞれの画面で対応できます。"
        actions={<Button variant="secondary" icon={<RefreshCw size={16} aria-hidden />} loading={loading} onClick={() => void load()}>最新にする</Button>}
      />

      {!groups && loading ? (
        <ListSkeleton rows={5} />
      ) : !groups && error ? (
        <ErrorState message={error} onRetry={() => void load()} />
      ) : (
        <div className="space-y-5">
          {error && <ErrorState title="最新の状態を読み込めませんでした" message={error} onRetry={() => void load()} />}
          {total === 0 && !(groups || []).some(group => group.error) && (
            <EmptyState icon={Inbox} title="いま対応待ちはありません" description="新しい連絡や申請が届くと、ここに表示されます。" />
          )}
          {ORDER.map(key => {
            const group = byKey.get(key);
            if (!group) return null;
            const meta = GROUPS[key];
            return (
              <Card key={key}>
                <SectionTitle
                  icon={meta.icon}
                  title={meta.title}
                  description={group.error ? undefined : group.items.length > 0 ? `新しい順に${group.items.length}件${group.items.length >= 10 ? '（11件目以降は画面で確認）' : ''}` : undefined}
                  trailing={<ButtonLink href={meta.href} variant="ghost" size="sm">画面を開く<ArrowRight size={14} aria-hidden /></ButtonLink>}
                />
                {group.error ? (
                  <ErrorState title={`${meta.title}を読み込めませんでした`} message="時間をおいて「最新にする」を押してください。" />
                ) : group.items.length === 0 ? (
                  <p className="rounded-btn bg-slate-50 px-4 py-3 text-sm font-medium text-fg-muted">{meta.empty}</p>
                ) : (
                  <ul className="divide-y divide-line">
                    {group.items.map(item => {
                      const status = statusOf(key, item.status);
                      return (
                        <li key={item.id}>
                          <Link href={item.href} className="group flex min-h-14 items-center gap-3 rounded-btn px-2 py-2.5 transition hover:bg-accent-soft focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-accent">
                            <StatusPill tone={status.tone}>{status.label}</StatusPill>
                            <span className="min-w-0 flex-1">
                              <span className="block truncate text-sm font-bold text-fg">{item.title}</span>
                              {item.summary && <span className="block truncate text-xs text-fg-muted">{item.summary}</span>}
                            </span>
                            <span className="hidden shrink-0 text-xs font-medium text-fg-muted sm:block">{item.at ? formatDateTime(item.at) : ''}</span>
                            <ArrowRight size={15} className="shrink-0 text-slate-300 transition group-hover:translate-x-0.5 group-hover:text-accent" aria-hidden />
                          </Link>
                        </li>
                      );
                    })}
                  </ul>
                )}
              </Card>
            );
          })}
        </div>
      )}
    </div>
  );
}
