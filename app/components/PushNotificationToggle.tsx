'use client';

import { BellRing } from 'lucide-react';
import { Card, SectionTitle, Spinner, useToast } from '@/app/components/ui';
import { useWebPush, type WebPushStatus } from '@/app/hooks/useWebPush';

const HINTS: Partial<Record<WebPushStatus, string>> = {
  'not-configured': '準備中です',
  unsupported: 'この端末・ブラウザでは使えません。',
  'ios-needs-install': 'iPhoneはホーム画面に追加すると使えます',
  denied: '通知がブロックされています。端末またはブラウザの設定で、このサイトの通知を許可してください。',
};

/** 「この端末に通知を送る」の切り替え。生徒・保護者・講師・管理者の設定画面で使う。 */
export default function PushNotificationToggle({ compact = false }: { compact?: boolean }) {
  const toast = useToast();
  const { status, busy, enable, disable } = useWebPush();
  const on = status === 'on';
  const disabled = busy || !(status === 'on' || status === 'off');
  const hint = HINTS[status];

  const toggle = async () => {
    if (on) {
      const result = await disable();
      if (result.ok) toast.success('この端末への通知をオフにしました');
      else toast.error('切り替えられませんでした。もう一度お試しください。');
      return;
    }
    const result = await enable();
    if (result.ok) toast.success('この端末に通知が届くようになりました');
    else if (result.status === 'denied') toast.error('通知が許可されませんでした');
    else if (result.status === 'off') toast.error('登録できませんでした。もう一度お試しください。');
  };

  return (
    <Card className={compact ? 'p-4' : undefined} padded={!compact}>
      <SectionTitle
        icon={BellRing}
        title="この端末への通知"
        description="アプリを開いていない時も、大切な通知をこの端末に表示します。端末ごとに設定してください。"
      />
      <div className="flex min-h-11 items-center justify-between gap-3">
        <span id="push-notification-toggle" className="text-sm font-bold text-fg">
          この端末に通知を送る
          {hint && <span className="block text-xs font-medium text-fg-muted">{hint}</span>}
        </span>
        {status === 'checking' ? (
          <Spinner />
        ) : (
          <button
            type="button"
            role="switch"
            aria-checked={on}
            aria-labelledby="push-notification-toggle"
            aria-busy={busy || undefined}
            disabled={disabled}
            onClick={toggle}
            className="inline-flex h-11 shrink-0 items-center rounded-full px-1 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-accent disabled:cursor-not-allowed disabled:opacity-50"
          >
            <span className={`flex h-6 w-11 items-center rounded-full p-1 transition-colors ${on ? 'bg-accent' : 'bg-slate-200'}`}>
              <span className={`h-4 w-4 rounded-full bg-white shadow-sm transition-transform ${on ? 'translate-x-5' : 'translate-x-0'}`} />
            </span>
          </button>
        )}
      </div>
    </Card>
  );
}
