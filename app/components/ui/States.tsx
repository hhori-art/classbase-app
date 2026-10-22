import type { ReactNode } from 'react';
import { AlertTriangle, Inbox, Loader2, RefreshCw, type LucideIcon } from 'lucide-react';
import { cn } from '@/lib/cn';
import { Phrase, phrased } from '@/app/components/ui/Phrase';

/** 読み込み中（ボタンや小さな場所用）。 */
export function Spinner({ label = '読み込み中', size = 20, className }: { label?: string; size?: number; className?: string }) {
  return (
    <span role="status" className={cn('inline-flex items-center gap-2 text-sm text-fg-muted', className)}>
      <Loader2 size={size} className="animate-spin text-accent" aria-hidden />
      <span className="sr-only">{label}</span>
    </span>
  );
}

/** 一覧・カードの読み込み中に置く、灰色の仮の形。 */
export function Skeleton({ className }: { className?: string }) {
  return <div aria-hidden className={cn('animate-pulse rounded-btn bg-slate-200/70', className)} />;
}

/** 一覧の読み込み中（行の形を数本出す）。 */
export function ListSkeleton({ rows = 3 }: { rows?: number }) {
  return (
    <div role="status" aria-label="読み込み中" className="flex flex-col gap-3">
      {Array.from({ length: rows }, (_, index) => <Skeleton key={index} className="h-16 w-full" />)}
    </div>
  );
}

/** データが0件のとき。 */
export function EmptyState({ icon: Icon = Inbox, title, description, action, className }: {
  icon?: LucideIcon;
  title: string;
  description?: ReactNode;
  action?: ReactNode;
  className?: string;
}) {
  return (
    <div className={cn('flex flex-col items-center gap-2 rounded-card border-2 border-dashed border-line px-6 py-10 text-center', className)}>
      <Icon size={28} className="text-fg-muted/60" aria-hidden />
      <p className="text-sm font-bold text-fg"><Phrase>{title}</Phrase></p>
      {description && <p className="max-w-sm text-sm text-fg-muted">{phrased(description)}</p>}
      {action && <div className="mt-2">{action}</div>}
    </div>
  );
}

/**
 * 読み込みに失敗したとき。「データがない」と見分けがつくように、必ずこちらを出す。
 * onRetry を渡すと「もう一度読み込む」ボタンが出る。
 */
export function ErrorState({ title = '読み込めませんでした', message = '通信状態を確認して、もう一度お試しください。', onRetry, className }: {
  title?: string;
  message?: ReactNode;
  onRetry?: () => void;
  className?: string;
}) {
  return (
    <div role="alert" className={cn('flex flex-col items-center gap-2 rounded-card border border-danger/20 bg-danger-soft px-6 py-8 text-center', className)}>
      <AlertTriangle size={26} className="text-danger" aria-hidden />
      <p className="text-sm font-bold text-danger"><Phrase>{title}</Phrase></p>
      {message && <p className="max-w-sm text-sm text-fg-muted">{phrased(message)}</p>}
      {onRetry && (
        <button
          type="button"
          onClick={onRetry}
          className="mt-2 inline-flex min-h-10 items-center gap-1.5 rounded-btn bg-surface px-4 text-sm font-bold text-danger ring-1 ring-danger/30 hover:bg-white focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-danger"
        >
          <RefreshCw size={15} aria-hidden />もう一度読み込む
        </button>
      )}
    </div>
  );
}
