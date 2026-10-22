'use client';

import { createContext, useCallback, useContext, useMemo, useRef, useState, type ReactNode } from 'react';
import { AlertTriangle, CheckCircle2, Info, X } from 'lucide-react';
import { Button } from '@/app/components/ui/Button';
import { Modal } from '@/app/components/ui/Modal';
import { cn } from '@/lib/cn';
import { Phrase } from '@/app/components/ui/Phrase';

/*
 * 画面内の通知（トースト）と確認ダイアログ。ブラウザ標準の alert / confirm / prompt の代わりに使う。
 *   const toast = useToast();      toast.success('保存しました');  toast.error('保存できませんでした。…');
 *   const confirm = useConfirm();  if (!(await confirm({ title: '「中2 理科」を削除しますか？', tone: 'danger' }))) return;
 *   const ask = usePrompt();       const reason = await ask({ title: '停止の理由', label: '理由' });  // キャンセルは null
 */

type ToastTone = 'success' | 'error' | 'info';
type ToastItem = { id: number; tone: ToastTone; message: string };

type ConfirmOptions = {
  title: string;
  message?: ReactNode;
  confirmLabel?: string;
  cancelLabel?: string;
  /** danger にすると確定ボタンが赤（削除・停止など）。 */
  tone?: 'default' | 'danger';
};

type PromptOptions = Omit<ConfirmOptions, 'tone'> & {
  label: string;
  defaultValue?: string;
  placeholder?: string;
  type?: 'text' | 'date' | 'number';
  multiline?: boolean;
  /** true なら空欄では確定できない。 */
  required?: boolean;
};

type DialogState =
  | { kind: 'confirm'; options: ConfirmOptions; resolve: (value: boolean) => void }
  | { kind: 'prompt'; options: PromptOptions; resolve: (value: string | null) => void };

type FeedbackContextValue = {
  toast: { success: (message: string) => void; error: (message: string) => void; info: (message: string) => void };
  confirm: (options: ConfirmOptions) => Promise<boolean>;
  prompt: (options: PromptOptions) => Promise<string | null>;
};

const FeedbackContext = createContext<FeedbackContextValue | null>(null);

const TOAST_STYLE: Record<ToastTone, { icon: typeof Info; className: string }> = {
  success: { icon: CheckCircle2, className: 'border-success/25 text-success' },
  error: { icon: AlertTriangle, className: 'border-danger/25 text-danger' },
  info: { icon: Info, className: 'border-info/25 text-info' },
};

export function FeedbackProvider({ children }: { children: ReactNode }) {
  const [toasts, setToasts] = useState<ToastItem[]>([]);
  const [dialog, setDialog] = useState<DialogState | null>(null);
  const [inputValue, setInputValue] = useState('');
  const nextId = useRef(1);

  const dismiss = useCallback((id: number) => setToasts(current => current.filter(item => item.id !== id)), []);
  const push = useCallback((tone: ToastTone, message: string) => {
    const id = nextId.current++;
    setToasts(current => [...current.slice(-3), { id, tone, message }]);
    window.setTimeout(() => dismiss(id), tone === 'error' ? 7000 : 4000);
  }, [dismiss]);

  const value = useMemo<FeedbackContextValue>(() => ({
    toast: {
      success: message => push('success', message),
      error: message => push('error', message),
      info: message => push('info', message),
    },
    confirm: options => new Promise<boolean>(resolve => setDialog({ kind: 'confirm', options, resolve })),
    prompt: options => new Promise<string | null>(resolve => {
      setInputValue(options.defaultValue || '');
      setDialog({ kind: 'prompt', options, resolve });
    }),
  }), [push]);

  const close = (result: boolean) => {
    if (!dialog) return;
    if (dialog.kind === 'confirm') dialog.resolve(result);
    else dialog.resolve(result ? inputValue : null);
    setDialog(null);
  };

  const promptOptions = dialog?.kind === 'prompt' ? dialog.options : null;
  const confirmDisabled = Boolean(promptOptions?.required && !inputValue.trim());

  return (
    <FeedbackContext.Provider value={value}>
      {children}
      <div aria-live="polite" className="pointer-events-none fixed inset-x-0 top-0 z-toast flex flex-col items-center gap-2 px-4 pt-[max(12px,env(safe-area-inset-top))]">
        {toasts.map(item => {
          const style = TOAST_STYLE[item.tone];
          const Icon = style.icon;
          return (
            <div key={item.id} role={item.tone === 'error' ? 'alert' : 'status'} className={cn('pointer-events-auto flex w-full max-w-md items-start gap-2.5 rounded-btn border bg-surface px-4 py-3 shadow-lg', style.className)}>
              <Icon size={18} className="mt-0.5 shrink-0" aria-hidden />
              <p className="min-w-0 flex-1 text-sm font-bold text-fg"><Phrase>{item.message}</Phrase></p>
              <button type="button" onClick={() => dismiss(item.id)} aria-label="閉じる" className="-mr-1 shrink-0 rounded p-0.5 text-fg-muted hover:text-fg"><X size={16} aria-hidden /></button>
            </div>
          );
        })}
      </div>
      <Modal
        open={Boolean(dialog)}
        onClose={() => close(false)}
        size="sm"
        title={dialog?.options.title || ''}
        description={dialog?.options.message}
        footer={(
          <>
            <Button variant="secondary" onClick={() => close(false)}>{dialog?.options.cancelLabel || 'キャンセル'}</Button>
            <Button
              variant={dialog?.kind === 'confirm' && dialog.options.tone === 'danger' ? 'danger' : 'primary'}
              disabled={confirmDisabled}
              onClick={() => close(true)}
              data-autofocus={dialog?.kind === 'confirm' ? true : undefined}
            >
              {dialog?.options.confirmLabel || 'OK'}
            </Button>
          </>
        )}
      >
        {promptOptions && (
          <form onSubmit={event => { event.preventDefault(); if (!confirmDisabled) close(true); }} className="flex flex-col gap-1.5">
            <label htmlFor="cb-prompt-input" className="text-sm font-bold text-fg">{promptOptions.label}</label>
            {promptOptions.multiline ? (
              <textarea id="cb-prompt-input" data-autofocus value={inputValue} onChange={event => setInputValue(event.target.value)} placeholder={promptOptions.placeholder} rows={4} className="rounded-input border border-line bg-surface px-3 py-2 text-sm text-fg focus:border-accent focus:outline-none focus:ring-2 focus:ring-accent/30" />
            ) : (
              <input id="cb-prompt-input" data-autofocus type={promptOptions.type || 'text'} value={inputValue} onChange={event => setInputValue(event.target.value)} placeholder={promptOptions.placeholder} className="min-h-11 rounded-input border border-line bg-surface px-3 text-sm text-fg focus:border-accent focus:outline-none focus:ring-2 focus:ring-accent/30" />
            )}
          </form>
        )}
      </Modal>
    </FeedbackContext.Provider>
  );
}

function useFeedback() {
  const context = useContext(FeedbackContext);
  if (!context) throw new Error('FeedbackProvider is missing');
  return context;
}

export const useToast = () => useFeedback().toast;
export const useConfirm = () => useFeedback().confirm;
export const usePrompt = () => useFeedback().prompt;
