'use client';

import { useCallback, useEffect, useState } from 'react';
import { Flag } from 'lucide-react';
import { useAuth } from '@/app/context/AuthContext';
import { Button, Card, EmptyState, ErrorState, ListSkeleton, SectionTitle, StatusPill, useToast } from '@/app/components/ui';
import { formatDateTime } from '@/lib/format';

type ReportGroup = {
  key: string;
  target_type: 'topic' | 'comment';
  topic_id: string;
  excerpt: string;
  reasons: string[];
  report_ids: string[];
  latest_at: string | null;
};

/** 生徒からの通報（未対応）。同じ投稿への通報はまとめて表示し、確認したら「対応済み」か「問題なし」にする。 */
export default function CommunityReportsPanel() {
  const { user } = useAuth();
  const toast = useToast();
  const [groups, setGroups] = useState<ReportGroup[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState(false);
  const [busyKey, setBusyKey] = useState('');

  const load = useCallback(async () => {
    if (!user) return;
    setLoading(true);
    setError(false);
    try {
      const response = await fetch('/api/admin/community-reports', { headers: { Authorization: `Bearer ${await user.getIdToken()}` }, cache: 'no-store' });
      const data = await response.json().catch(() => ({}));
      if (!response.ok || !data.ok) throw new Error(data.error || 'failed');
      setGroups(Array.isArray(data.groups) ? data.groups : []);
    } catch (loadError) {
      console.error('掲示板の通報を読み込めませんでした', loadError);
      setError(true);
    } finally {
      setLoading(false);
    }
  }, [user]);

  useEffect(() => { void load(); }, [load]);

  const review = async (group: ReportGroup, status: 'resolved' | 'dismissed') => {
    if (!user) return;
    setBusyKey(group.key);
    try {
      const response = await fetch('/api/admin/community-reports', {
        method: 'PATCH',
        headers: { Authorization: `Bearer ${await user.getIdToken()}`, 'Content-Type': 'application/json' },
        body: JSON.stringify({ report_ids: group.report_ids, status }),
      });
      const data = await response.json().catch(() => ({}));
      if (!response.ok || !data.ok) throw new Error(data.error || 'failed');
      setGroups(current => current.filter(item => item.key !== group.key));
      toast.success(status === 'resolved' ? '対応済みにしました' : '問題なしにしました');
    } catch {
      toast.error('更新できませんでした。もう一度お試しください。');
    } finally {
      setBusyKey('');
    }
  };

  return (
    // 掲示板の管理画面は高さ固定の2カラムなので、通報が多くても下の一覧を押しつぶさないよう高さを抑えてスクロールさせる。
    <Card className="mb-4 shrink-0">
      <SectionTitle
        icon={Flag}
        title="生徒からの通報"
        description="通報された投稿は自動では隠れません。内容を確認し、必要なら下の一覧から投稿を非表示・コメントを削除してから「対応済み」にしてください。"
        trailing={groups.length > 0 ? <StatusPill tone="warning">未対応 {groups.length}件</StatusPill> : undefined}
      />
      {loading ? <ListSkeleton rows={2} /> : error ? <ErrorState onRetry={load} /> : groups.length === 0 ? (
        <EmptyState icon={Flag} title="未対応の通報はありません" />
      ) : (
        <ul className="flex max-h-60 flex-col gap-3 overflow-y-auto pr-1">
          {groups.map(group => (
            <li key={group.key} className="flex flex-col gap-3 rounded-btn border border-line p-4 sm:flex-row sm:items-start sm:justify-between">
              <div className="min-w-0">
                <div className="flex flex-wrap items-center gap-2">
                  <StatusPill tone="danger">{group.target_type === 'comment' ? 'コメント' : '投稿'}</StatusPill>
                  <span className="text-xs text-fg-muted">通報 {group.report_ids.length}件{group.latest_at ? ` ・ 最新 ${formatDateTime(group.latest_at)}` : ''}</span>
                </div>
                <p className="mt-2 break-words text-sm font-bold text-fg">「{group.excerpt || '（内容を取得できませんでした）'}」</p>
                <p className="mt-1 text-xs text-fg-muted">理由：{group.reasons.join('、') || '—'}</p>
              </div>
              <div className="flex shrink-0 gap-2">
                <Button size="sm" variant="secondary" loading={busyKey === group.key} onClick={() => review(group, 'dismissed')}>問題なし</Button>
                <Button size="sm" loading={busyKey === group.key} onClick={() => review(group, 'resolved')}>対応済み</Button>
              </div>
            </li>
          ))}
        </ul>
      )}
    </Card>
  );
}
