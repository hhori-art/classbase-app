import Link from 'next/link';
import type { ReactNode } from 'react';
import { ChevronLeft, type LucideIcon } from 'lucide-react';
import { cn } from '@/lib/cn';
import { Phrase, phrased } from '@/app/components/ui/Phrase';

/**
 * 各ページ上部の見出し（全アプリ共通）。
 * - tone="plain"：管理・講師向け。白地に見出し。
 * - tone="hero"：保護者・生徒向け。差し色の帯に白文字。
 * 戻るリンクは backHref を渡したときだけ出す（文言は「戻る」）。
 */
export function PageHeader({ title, eyebrow, description, icon: Icon, backHref, backLabel = '戻る', actions, tone = 'plain', className }: {
  title: string;
  /** 見出しの上の小さな分類名（日本語）。 */
  eyebrow?: string;
  description?: ReactNode;
  icon?: LucideIcon;
  backHref?: string;
  backLabel?: string;
  actions?: ReactNode;
  tone?: 'plain' | 'hero';
  className?: string;
}) {
  const hero = tone === 'hero';
  return (
    <header
      className={cn(
        'flex flex-col gap-4 sm:flex-row sm:items-end sm:justify-between',
        hero ? 'rounded-hero bg-accent px-6 py-6 text-accent-ink shadow-card' : 'border-b border-line pb-5',
        className,
      )}
    >
      <div className="min-w-0">
        {backHref && (
          <Link
            href={backHref}
            className={cn(
              'mb-3 inline-flex min-h-9 items-center gap-1 rounded-btn pr-2 text-sm font-bold',
              hero ? 'text-accent-ink/80 hover:text-accent-ink' : 'text-fg-muted hover:text-accent',
            )}
          >
            <ChevronLeft size={18} aria-hidden />{backLabel}
          </Link>
        )}
        <div className="flex items-start gap-3">
          {Icon && (
            <span className={cn(
              'mt-0.5 hidden h-11 w-11 shrink-0 items-center justify-center rounded-btn sm:flex',
              hero ? 'bg-white/15 text-accent-ink' : 'bg-accent-soft text-accent',
            )}>
              <Icon size={22} aria-hidden />
            </span>
          )}
          <div className="min-w-0">
            {eyebrow && <p className={cn('text-xs font-bold tracking-wide', hero ? 'text-accent-ink/75' : 'text-accent')}><Phrase>{eyebrow}</Phrase></p>}
            <h1 className="mt-0.5 text-2xl font-black leading-tight [text-wrap-style:balance]"><Phrase>{title}</Phrase></h1>
            {description && <p className={cn('mt-2 max-w-2xl text-sm leading-relaxed', hero ? 'text-accent-ink/80' : 'text-fg-muted')}>{phrased(description)}</p>}
          </div>
        </div>
      </div>
      {actions && <div className="flex shrink-0 flex-wrap gap-2">{actions}</div>}
    </header>
  );
}
