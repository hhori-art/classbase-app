'use client';

import Link from 'next/link';
import {
  AlertTriangle, ArrowRight, CheckCircle2, CheckSquare, ClipboardCheck, Inbox, KeyRound, Megaphone, MessageCircle, ShoppingBag, Video,
  type LucideIcon,
} from 'lucide-react';
import { ButtonLink, Card, ErrorState, SectionTitle, Skeleton } from '@/app/components/ui';
import { cn } from '@/lib/cn';
import { useAdminInboxCounts, type AdminInboxCounts } from '@/app/components/master/useAdminInboxCounts';

type CountKey = keyof AdminInboxCounts;

// 並び順は急ぎの度合い（安全アラートを先頭）。件数はサーバーが見られる画面の分だけ返す。
const CARDS: Array<{ key: CountKey; title: string; note: string; href: string; icon: LucideIcon }> = [
  { key: 'safetyAlerts', title: 'AIチャット安全アラート', note: '未対応・対応中', href: '/master/safety-alerts', icon: AlertTriangle },
  { key: 'parentInquiries', title: '教室への連絡', note: '未返信', href: '/master/parent-inquiries', icon: MessageCircle },
  { key: 'requests', title: '生徒・保護者からの申請', note: '未対応（欠席・振替の連絡は除く）', href: '/master/requests', icon: CheckSquare },
  { key: 'detailApprovals', title: '勤務実績の承認', note: '今月の承認待ち（目安）・打刻修正', href: '/master/attendance-approvals', icon: ClipboardCheck },
  { key: 'recordings', title: '要確認の録画', note: '直近7日で自動アップを保留', href: '/master/recordings', icon: Video },
  { key: 'substitutions', title: '代行依頼', note: '募集中', href: '/master/substitutions', icon: Megaphone },
  { key: 'rewards', title: '景品の発送', note: '受付・準備中', href: '/master/rewards?tab=shipments', icon: ShoppingBag },
  { key: 'passwordRecovery', title: 'パスワード再設定の依頼', note: '「メールが使えない」の未対応', href: '/master/accounts/recovery', icon: KeyRound },
];

/** 管理画面ホームの「今日の対応」。見られる画面の対応待ち件数をカードで出し、それぞれの画面へ移れる。 */
export default function TodayTasks({ isMaster }: { isMaster: boolean }) {
  const { counts, error, loading, reload } = useAdminInboxCounts();
  const cards = CARDS.filter(card => counts && Object.hasOwn(counts, card.key));

  if (!counts && error) {
    return (
      <Card className="mb-5">
        <SectionTitle icon={Inbox} title="今日の対応" />
        <ErrorState title="対応待ちの件数を読み込めませんでした" message={error} onRetry={() => void reload()} />
      </Card>
    );
  }
  if (!counts) {
    return (
      <Card className="mb-5">
        <SectionTitle icon={Inbox} title="今日の対応" />
        <div role="status" aria-label="読み込み中" className="grid gap-3 sm:grid-cols-2 xl:grid-cols-4">
          {Array.from({ length: 4 }, (_, index) => <Skeleton key={index} className="h-24" />)}
        </div>
      </Card>
    );
  }
  if (cards.length === 0) return null;

  const total = cards.reduce((sum, card) => sum + (counts[card.key] || 0), 0);
  return (
    <Card className="mb-5">
      <SectionTitle
        icon={Inbox}
        title="今日の対応"
        description={total > 0 ? `対応待ちが ${total}件 あります。` : 'いま対応待ちはありません。'}
        trailing={isMaster ? <ButtonLink href="/master/inbox" variant="secondary" size="sm">対応待ちの一覧</ButtonLink> : undefined}
      />
      <div className={cn('grid gap-3 sm:grid-cols-2 xl:grid-cols-4', loading && 'opacity-80')}>
        {cards.map(card => {
          const value = counts[card.key];
          const Icon = card.icon;
          const pending = typeof value === 'number' && value > 0;
          return (
            <Link
              key={card.key}
              href={card.href}
              className={cn(
                'group flex min-h-24 flex-col justify-between gap-2 rounded-btn border px-4 py-3 transition focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-accent',
                pending ? 'border-warning/30 bg-warning-soft hover:border-warning/60' : 'border-line bg-slate-50/60 hover:border-accent/30 hover:bg-accent-soft',
              )}
            >
              <span className="flex items-center gap-2 text-sm font-bold text-slate-800">
                <Icon size={16} className={pending ? 'text-warning' : 'text-slate-500'} aria-hidden />
                <span className="min-w-0 flex-1 truncate">{card.title}</span>
                <ArrowRight size={15} className="shrink-0 text-slate-300 transition group-hover:translate-x-0.5 group-hover:text-accent" aria-hidden />
              </span>
              <span className="flex items-end justify-between gap-2">
                <span className="text-xs font-medium text-slate-500">{card.note}</span>
                {value === null || value === undefined ? (
                  <span className="text-xs font-bold text-danger">確認できません</span>
                ) : value === 0 ? (
                  <span className="inline-flex shrink-0 items-center gap-1 whitespace-nowrap text-sm font-bold text-success"><CheckCircle2 size={15} aria-hidden />なし</span>
                ) : (
                  <span className="text-2xl font-black leading-none text-fg">{value}<span className="ml-0.5 text-xs font-bold text-fg-muted">件</span></span>
                )}
              </span>
            </Link>
          );
        })}
      </div>
    </Card>
  );
}
