import type { ElementType, ReactNode } from 'react';
import type { LucideIcon } from 'lucide-react';
import { Card, EmptyState, PageHeader, type StatusTone } from '@/app/components/ui';
import { cn } from '@/lib/cn';

// 保護者画面の共通パーツ。中身は全アプリ共通の部品（app/components/ui）で、
// 差し色は保護者レイアウトの data-portal="parent"（紺）に従う。

type IconType = LucideIcon;

/** 各ページ上部の見出し（共通の PageHeader の hero）。 */
export function ParentPageHeader({ eyebrow, title, description, icon, backHref, actions }: {
  eyebrow?: string;
  title: string;
  description?: ReactNode;
  icon?: IconType;
  backHref?: string;
  actions?: ReactNode;
}) {
  return <PageHeader tone="hero" eyebrow={eyebrow} title={title} description={description} icon={icon} backHref={backHref} actions={actions} />;
}

/** 白いカード。 */
export function ParentCard({ children, className = '', as }: { children: ReactNode; className?: string; as?: ElementType }) {
  return <Card as={as} className={className}>{children}</Card>;
}

const SECTION_TONES = {
  navy: 'bg-accent-soft text-accent',
  amber: 'bg-warning-soft text-warning',
  emerald: 'bg-success-soft text-success',
  sky: 'bg-info-soft text-info',
  rose: 'bg-danger-soft text-danger',
  violet: 'bg-accent-soft text-accent',
} as const;

/** カード内の小見出し（共通の SectionTitle と同じ形。アイコンの色だけ選べる）。 */
export function ParentSectionTitle({ icon: Icon, title, description, trailing, tone = 'navy' }: {
  icon?: IconType;
  title: string;
  description?: ReactNode;
  trailing?: ReactNode;
  tone?: keyof typeof SECTION_TONES;
}) {
  return (
    <div className="mb-4 flex items-start justify-between gap-3">
      <div className="flex min-w-0 items-start gap-3">
        {Icon && (
          <span className={cn('flex h-9 w-9 shrink-0 items-center justify-center rounded-btn', SECTION_TONES[tone])}>
            <Icon size={18} aria-hidden />
          </span>
        )}
        <div className="min-w-0">
          <h2 className="text-base font-bold text-fg">{title}</h2>
          {description && <p className="mt-0.5 text-sm leading-relaxed text-fg-muted">{description}</p>}
        </div>
      </div>
      {trailing && <div className="shrink-0">{trailing}</div>}
    </div>
  );
}

/** データが無いときの表示（共通の EmptyState）。 */
export function ParentEmpty({ icon, title, description }: { icon: IconType; title: string; description?: string }) {
  return <EmptyState icon={icon} title={title} description={description} />;
}

/** 申請や記録のステータスを保護者にわかる言葉にする。 */
export function parentStatusLabel(status?: string) {
  const value = String(status || '').toLowerCase();
  const labels: Record<string, string> = {
    pending: '確認中', approved: '承認済み', accepted: '承認済み', confirmed: '確定', completed: '完了', done: '完了',
    rejected: '見送り', cancelled: '取消', canceled: '取消', submitted: '提出済み', graded: '確認済み', returned: '返却',
    present: '出席', attended: '出席', absent: '欠席', late: '遅刻', view: '視聴', watched: '視聴', started: '視聴開始', ended: '視聴完了',
  };
  return labels[value] || status || '';
}

/** ステータスの色（StatusPill の tone）。 */
export function parentStatusPillTone(status?: string): StatusTone {
  const value = String(status || '').toLowerCase();
  if (['approved', 'accepted', 'confirmed', 'completed', 'done', 'submitted', 'graded', 'present', 'attended', 'ended', 'watched'].includes(value)) return 'success';
  if (['rejected', 'cancelled', 'canceled', 'absent'].includes(value)) return 'danger';
  if (['pending', 'late', 'returned'].includes(value)) return 'warning';
  return 'neutral';
}

/** 互換用：ステータスの色クラス（新しい画面では StatusPill と parentStatusPillTone を使う）。 */
export function parentStatusTone(status?: string) {
  const tone = parentStatusPillTone(status);
  if (tone === 'success') return 'bg-success-soft text-success ring-success/20';
  if (tone === 'danger') return 'bg-danger-soft text-danger ring-danger/20';
  if (tone === 'warning') return 'bg-warning-soft text-warning ring-warning/20';
  return 'bg-slate-50 text-slate-600 ring-slate-100';
}
