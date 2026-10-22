import type { ReactNode } from 'react';
import { cn } from '@/lib/cn';

export type StatusTone = 'neutral' | 'accent' | 'success' | 'warning' | 'danger' | 'info';

const TONES: Record<StatusTone, string> = {
  neutral: 'bg-slate-100 text-slate-600',
  accent: 'bg-accent-soft text-accent',
  success: 'bg-success-soft text-success',
  warning: 'bg-warning-soft text-warning',
  danger: 'bg-danger-soft text-danger',
  info: 'bg-info-soft text-info',
};

/** 状態を表す小さなラベル（未対応・対応中・対応済み など）。 */
export function StatusPill({ tone = 'neutral', icon, children, className }: {
  tone?: StatusTone;
  icon?: ReactNode;
  children: ReactNode;
  className?: string;
}) {
  return (
    <span className={cn('inline-flex items-center gap-1 whitespace-nowrap rounded-full px-2.5 py-0.5 text-xs font-bold', TONES[tone], className)}>
      {icon}
      {children}
    </span>
  );
}
