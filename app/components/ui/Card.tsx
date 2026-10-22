import type { ElementType, ReactNode } from 'react';
import type { LucideIcon } from 'lucide-react';
import { cn } from '@/lib/cn';
import { Phrase, phrased } from '@/app/components/ui/Phrase';

/** 白いカード。角の丸み・影・余白は設定値（生徒は見た目の設定）に従う。 */
export function Card({ as: Tag = 'section', className, padded = true, children }: {
  as?: ElementType;
  className?: string;
  padded?: boolean;
  children: ReactNode;
}) {
  return <Tag className={cn('cb-card', padded && 'p-card', className)}>{children}</Tag>;
}

/** カード内の小見出し。 */
export function SectionTitle({ icon: Icon, title, description, trailing, className }: {
  icon?: LucideIcon;
  title: string;
  description?: ReactNode;
  trailing?: ReactNode;
  className?: string;
}) {
  return (
    <div className={cn('mb-4 flex items-start justify-between gap-3', className)}>
      <div className="flex min-w-0 items-start gap-3">
        {Icon && (
          <span className="flex h-9 w-9 shrink-0 items-center justify-center rounded-btn bg-accent-soft text-accent">
            <Icon size={18} aria-hidden />
          </span>
        )}
        <div className="min-w-0">
          <h2 className="text-base font-bold text-fg"><Phrase>{title}</Phrase></h2>
          {description && <p className="mt-0.5 text-sm text-fg-muted">{phrased(description)}</p>}
        </div>
      </div>
      {trailing && <div className="shrink-0">{trailing}</div>}
    </div>
  );
}
