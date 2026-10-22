'use client';

import { useEffect, useState } from 'react';
import { auth } from '@/lib/firebase';
import { Check, HelpCircle, Loader2, MessageCircle } from 'lucide-react';
import { Button, useConfirm } from '@/app/components/ui';

type Props = {
  role: 'teacher' | 'student' | 'parent' | 'admin' | 'master';
  lineUserId?: string | null;
  description: string;
  compact?: boolean;
};

export default function LineLinkPanel({ role, lineUserId, description, compact = false }: Props) {
  const [linked, setLinked] = useState(!!lineUserId);
  const [loading, setLoading] = useState(false);
  const [message, setMessage] = useState('');
  const confirm = useConfirm();

  useEffect(() => {
    setLinked(!!lineUserId);
  }, [lineUserId]);

  useEffect(() => {
    const params = new URLSearchParams(window.location.search);
    const linkedParam = params.get('line_linked');
    const error = params.get('error');
    if (linkedParam) {
      setLinked(true);
      setMessage('LINE連携が完了しました。');
      window.history.replaceState(null, '', window.location.pathname);
    } else if (error) {
      const errorMessages: Record<string, string> = {
        line_auth_failed: 'LINE側で連携が完了しませんでした。キャンセルしていないか確認し、もう一度お試しください。',
        line_env_missing: 'LINE連携の設定が不足しています。管理者へご連絡ください。',
        token_failed: 'LINE認証の有効期限が切れたか、認証設定が一致していません。最初からやり直してください。',
        profile_failed: 'LINEプロフィールを取得できませんでした。LINEへのログイン状態を確認してください。',
        line_integration_unavailable: 'このアカウントでは現在LINE連携を利用できません。',
        line_link_failed: '連携の有効期限が切れたか、別の連携操作が開始されました。設定画面からもう一度お試しください。',
      };
      setMessage(errorMessages[error] || 'LINE連携に失敗しました。時間をおいて再度お試しください。解決しない場合はサポートセンターへご連絡ください。');
      window.history.replaceState(null, '', window.location.pathname);
    }
  }, []);

  const startLink = async () => {
    const currentUser = auth.currentUser;
    if (!currentUser) return setMessage('ログイン情報を確認できませんでした。');
    setLoading(true);
    try {
      const token = await currentUser.getIdToken();
      const redirect = encodeURIComponent(window.location.href.split('?')[0]);
      const res = await fetch(`/api/line/auth?mode=json&role=${role}&redirect=${redirect}`, {
        headers: { Authorization: `Bearer ${token}` },
      });
      const data = await res.json();
      if (!res.ok || !data.url) throw new Error(data.error || 'failed');
      window.location.href = data.url;
    } catch (error) {
      setMessage(error instanceof Error && error.message === 'line-integration-unavailable'
        ? 'この環境ではLINE外部連携を停止しています。LINE側の画面は今回の診断対象外です。'
        : 'LINE連携画面への移動に失敗しました。');
      setLoading(false);
    }
  };

  const unlink = async () => {
    const ok = await confirm({
      title: 'LINE連携を解除しますか？',
      message: 'LINE通知が届かなくなります。',
      tone: 'danger',
      confirmLabel: '連携を解除する',
    });
    if (!ok) return;
    setLoading(true);
    try {
      const token = await auth.currentUser?.getIdToken();
      const res = await fetch('/api/line/link', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${token}` },
        body: JSON.stringify({ action: 'unlink' }),
      });
      if (!res.ok) throw new Error('failed');
      setLinked(false);
      setMessage('LINE連携を解除しました。');
    } catch {
      setMessage('LINE連携の解除に失敗しました。');
    } finally {
      setLoading(false);
    }
  };

  return (
    <section className={`cb-card ${compact ? 'p-4' : 'p-card'}`}>
      <h2 className="mb-2 flex items-center gap-2 text-base font-bold text-fg">
        <MessageCircle size={18} className="text-[#06C755]" aria-hidden /> LINE連携
      </h2>
      <p className="mb-4 text-sm font-medium leading-relaxed text-fg-muted">{description}</p>
      <details className="mb-4 rounded-card border border-emerald-100 bg-emerald-50/70 px-4 py-3">
        <summary className="flex min-h-9 cursor-pointer list-none items-center gap-2 text-xs font-bold text-emerald-900"><HelpCircle size={15} aria-hidden />連携方法・よくある質問</summary>
        <ol className="mt-2 list-decimal space-y-1 pl-5 text-xs font-bold leading-6 text-emerald-900">
          <li>「LINEと連携する」を押し、通知を受け取るLINEアカウントでログインします。</li>
          <li>認証画面で許可し、アプリに「連携済み」と表示されたことを確認します。</li>
          <li>通知が届かない場合は、公式アカウントをブロックしていないか、通知設定がONか確認します。</li>
        </ol>
        <p className="mt-2 text-xs font-bold leading-5 text-emerald-800">Q. 別のLINEに変えたい：一度「連携を解除する」を押し、変更先のLINEで連携し直してください。</p>
      </details>
      {message && <p role="status" className="mb-3 rounded-input bg-canvas px-3 py-2 text-sm font-bold text-fg-muted">{message}</p>}

      {linked ? (
        <div className="flex flex-col gap-3 rounded-card border border-[#06C755]/20 bg-[#06C755]/10 p-4">
          <div className="flex items-center gap-2 text-sm font-bold text-emerald-700">
            <Check size={18} aria-hidden /> 連携済み
          </div>
          <Button variant="secondary" fullWidth onClick={unlink} loading={loading}>
            {loading ? '処理中...' : '連携を解除する'}
          </Button>
        </div>
      ) : (
        <button
          type="button"
          onClick={startLink}
          disabled={loading}
          aria-busy={loading || undefined}
          className="flex min-h-12 w-full items-center justify-center gap-2 rounded-btn bg-[#06C755] py-3 text-sm font-bold text-white shadow-sm transition-colors hover:bg-[#05b34c] focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-accent disabled:opacity-50"
        >
          {loading ? <Loader2 className="motion-safe:animate-spin" size={18} aria-hidden /> : <MessageCircle size={18} fill="currentColor" aria-hidden />}
          LINEと連携する
        </button>
      )}
    </section>
  );
}
