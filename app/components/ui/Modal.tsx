'use client';

import { useEffect, useId, useRef, type ReactNode } from 'react';
import { X } from 'lucide-react';
import { cn } from '@/lib/cn';
import { Phrase, phrased } from '@/app/components/ui/Phrase';

// 重なって開いたポップアップのうち、いちばん上だけが Esc・Tab を受け取る。
const openStack: string[] = [];

const FOCUSABLE = 'a[href],button:not([disabled]),input:not([disabled]),select:not([disabled]),textarea:not([disabled]),[tabindex]:not([tabindex="-1"])';

/**
 * 共通のポップアップ。背景・閉じ方（×・背景・Esc）・スクロール固定・フォーカスを統一する。
 * スマホでは画面下から出るシート、PCでは中央の窓になる。
 */
export function Modal({ open, onClose, title, description, children, footer, size = 'md', dismissible = true, closeOnBackdrop = true }: {
  open: boolean;
  onClose: () => void;
  title: string;
  description?: ReactNode;
  children?: ReactNode;
  /** 下部のボタン列。 */
  footer?: ReactNode;
  /** xl は表やカレンダーを並べる大きな編集画面だけに使う。 */
  size?: 'sm' | 'md' | 'lg' | 'xl';
  /** false にすると背景クリック・Esc・×で閉じない（必須の選択など）。 */
  dismissible?: boolean;
  /** false にすると背景のクリックでは閉じない（入力フォーム：うっかり閉じて入力が消えるのを防ぐ）。×・Esc では閉じる。 */
  closeOnBackdrop?: boolean;
}) {
  const panelRef = useRef<HTMLDivElement>(null);
  const titleId = useId();
  const descriptionId = useId();
  const closeRef = useRef(onClose);
  closeRef.current = onClose;

  useEffect(() => {
    if (!open) return;
    const previousFocus = document.activeElement as HTMLElement | null;
    const previousOverflow = document.body.style.overflow;
    document.body.style.overflow = 'hidden';
    const panel = panelRef.current;
    (panel?.querySelector<HTMLElement>('[data-autofocus]') || panel?.querySelector<HTMLElement>(FOCUSABLE) || panel)?.focus();

    openStack.push(titleId);
    const onKey = (event: KeyboardEvent) => {
      if (openStack[openStack.length - 1] !== titleId) return;
      if (event.key === 'Escape' && dismissible) {
        event.stopPropagation();
        closeRef.current();
      }
      if (event.key === 'Tab' && panel) {
        const items = Array.from(panel.querySelectorAll<HTMLElement>(FOCUSABLE));
        if (items.length === 0) return;
        const first = items[0];
        const last = items[items.length - 1];
        if (event.shiftKey && document.activeElement === first) { event.preventDefault(); last.focus(); }
        else if (!event.shiftKey && document.activeElement === last) { event.preventDefault(); first.focus(); }
      }
    };
    document.addEventListener('keydown', onKey);
    return () => {
      const index = openStack.lastIndexOf(titleId);
      if (index >= 0) openStack.splice(index, 1);
      document.removeEventListener('keydown', onKey);
      document.body.style.overflow = previousOverflow;
      previousFocus?.focus?.();
    };
  }, [open, dismissible, titleId]);

  if (!open) return null;
  return (
    <div className="fixed inset-0 z-overlay flex items-end justify-center bg-slate-950/50 p-0 sm:items-center sm:p-4" onMouseDown={event => { if (event.target === event.currentTarget && dismissible && closeOnBackdrop) onClose(); }}>
      <div
        ref={panelRef}
        role="dialog"
        aria-modal="true"
        aria-labelledby={titleId}
        aria-describedby={description ? descriptionId : undefined}
        tabIndex={-1}
        className={cn(
          'flex max-h-[90dvh] w-full flex-col overflow-hidden bg-surface shadow-2xl outline-none',
          'rounded-t-hero pb-[env(safe-area-inset-bottom)] sm:rounded-card sm:pb-0',
          size === 'sm' ? 'sm:max-w-sm' : size === 'lg' ? 'sm:max-w-2xl' : size === 'xl' ? 'sm:max-w-6xl' : 'sm:max-w-lg',
        )}
      >
        <div className="flex items-start justify-between gap-3 border-b border-line px-5 py-4">
          <div className="min-w-0">
            <h2 id={titleId} className="text-base font-bold text-fg"><Phrase>{title}</Phrase></h2>
            {description && <p id={descriptionId} className="mt-1 text-sm text-fg-muted">{phrased(description)}</p>}
          </div>
          {dismissible && (
            <button type="button" onClick={onClose} aria-label="閉じる" className="-mr-2 -mt-1 inline-flex h-10 w-10 shrink-0 items-center justify-center rounded-btn text-fg-muted hover:bg-canvas focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-accent">
              <X size={20} aria-hidden />
            </button>
          )}
        </div>
        {children && <div className="min-h-0 flex-1 overflow-y-auto px-5 py-4 text-sm text-fg">{children}</div>}
        {footer && <div className="flex flex-col-reverse gap-2 border-t border-line px-5 py-3 sm:flex-row sm:justify-end">{footer}</div>}
      </div>
    </div>
  );
}
