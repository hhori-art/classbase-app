'use client';

import { useCallback, useEffect, useRef, type KeyboardEvent, type ReactNode } from 'react';
import type { LucideIcon } from 'lucide-react';
import { cn } from '@/lib/cn';

export type AdminTab<T extends string = string> = {
  id: T;
  label: ReactNode;
  icon?: LucideIcon;
  /** タブ名の横に出す件数など。 */
  badge?: ReactNode;
  disabled?: boolean;
};

/**
 * 管理画面のタブ（共通）。role="tablist" で、← → キーでも移動できる。
 * urlParam を渡すと、選んだタブを ?tab= などの URL に残す（再読み込み・共有しても同じタブが開く）。
 * 中身の切り替えは呼び出し側が value を見て行う。
 */
export default function AdminTabs<T extends string>({
  tabs,
  value,
  onChange,
  urlParam,
  ariaLabel,
  size = 'md',
  className,
}: {
  tabs: ReadonlyArray<AdminTab<T>>;
  value: T;
  onChange: (value: T) => void;
  /** 例：'tab'。URL の検索パラメータと同期する。 */
  urlParam?: string;
  ariaLabel?: string;
  size?: 'sm' | 'md';
  className?: string;
}) {
  const listRef = useRef<HTMLDivElement>(null);
  const initialized = useRef(false);

  // 初回だけ URL のタブを反映する。
  useEffect(() => {
    if (!urlParam || initialized.current) return;
    initialized.current = true;
    try {
      const fromUrl = new URLSearchParams(window.location.search).get(urlParam);
      const match = tabs.find(tab => tab.id === fromUrl && !tab.disabled);
      if (match && match.id !== value) onChange(match.id);
    } catch { /* URL を読めない環境では既定のタブ */ }
  }, [onChange, tabs, urlParam, value]);

  const select = useCallback((id: T) => {
    onChange(id);
    if (!urlParam) return;
    try {
      const url = new URL(window.location.href);
      url.searchParams.set(urlParam, id);
      window.history.replaceState(window.history.state, '', url.toString());
    } catch { /* noop */ }
  }, [onChange, urlParam]);

  const onKeyDown = (event: KeyboardEvent<HTMLButtonElement>) => {
    if (event.key !== 'ArrowRight' && event.key !== 'ArrowLeft') return;
    const enabled = tabs.filter(tab => !tab.disabled);
    const index = enabled.findIndex(tab => tab.id === value);
    if (index < 0) return;
    event.preventDefault();
    const next = enabled[(index + (event.key === 'ArrowRight' ? 1 : -1) + enabled.length) % enabled.length];
    select(next.id);
    listRef.current?.querySelector<HTMLButtonElement>(`[data-tab-id="${CSS.escape(next.id)}"]`)?.focus();
  };

  return (
    <div className={cn('-mx-1 overflow-x-auto px-1', className)}>
      <div ref={listRef} role="tablist" aria-label={ariaLabel} className="inline-flex min-w-full gap-1 rounded-btn border border-line bg-surface p-1 shadow-sm sm:min-w-0">
        {tabs.map(tab => {
          const active = tab.id === value;
          const Icon = tab.icon;
          return (
            <button
              key={tab.id}
              type="button"
              role="tab"
              data-tab-id={tab.id}
              aria-selected={active}
              tabIndex={active ? 0 : -1}
              disabled={tab.disabled}
              onClick={() => select(tab.id)}
              onKeyDown={onKeyDown}
              className={cn(
                'inline-flex shrink-0 items-center justify-center gap-1.5 whitespace-nowrap rounded-input font-bold transition-colors',
                'focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-accent',
                'disabled:pointer-events-none disabled:opacity-50',
                size === 'sm' ? 'min-h-9 px-3 text-xs' : 'min-h-10 px-4 text-sm',
                active ? 'bg-accent text-accent-ink shadow-sm' : 'text-fg-muted hover:bg-accent-soft hover:text-accent',
              )}
            >
              {Icon && <Icon size={size === 'sm' ? 14 : 16} aria-hidden />}
              {tab.label}
              {tab.badge !== undefined && tab.badge !== null && tab.badge !== false && (
                <span className={cn('rounded-full px-1.5 text-xs font-bold', active ? 'bg-white/20 text-accent-ink' : 'bg-slate-100 text-fg-muted')}>{tab.badge}</span>
              )}
            </button>
          );
        })}
      </div>
    </div>
  );
}
