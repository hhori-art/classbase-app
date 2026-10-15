'use client';

import { useEffect, useState } from 'react';
import { auth } from '@/lib/firebase';
import { Check, HelpCircle, Loader2, MessageCircle } from 'lucide-react';

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
    if (!confirm('LINE連携を解除しますか？\nLINE通知が届かなくなります。')) return;
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
    <section className={`bg-white ${compact ? 'p-4 rounded-2xl' : 'p-6 rounded-3xl'} shadow-sm border border-gray-100`}>
      <h2 className="text-sm font-extrabold text-gray-500 uppercase tracking-wider mb-2 flex items-center gap-2">
        <MessageCircle size={18} className="text-[#06C755]" /> LINE連携
      </h2>
      <p className="text-xs text-gray-500 mb-4 font-medium leading-relaxed">{description}</p>
      <details className="mb-4 rounded-2xl border border-green-100 bg-green-50/70 px-4 py-3">
        <summary className="flex cursor-pointer list-none items-center gap-2 text-xs font-black text-green-900"><HelpCircle size={15} />連携方法・よくある質問</summary>
        <ol className="mt-2 list-decimal space-y-1 pl-5 text-xs font-bold leading-6 text-green-900">
          <li>「LINEと連携する」を押し、通知を受け取るLINEアカウントでログインします。</li>
          <li>認証画面で許可し、アプリに「連携済み」と表示されたことを確認します。</li>
          <li>通知が届かない場合は、公式アカウントをブロックしていないか、通知設定がONか確認します。</li>
        </ol>
        <p className="mt-2 text-[11px] font-bold leading-5 text-green-800">Q. 別のLINEに変えたい：一度「連携を解除する」を押し、変更先のLINEで連携し直してください。</p>
      </details>
      {message && <p className="mb-3 rounded-xl bg-slate-50 px-3 py-2 text-xs font-bold text-slate-600">{message}</p>}

      {linked ? (
        <div className="bg-[#06C755]/10 border border-[#06C755]/20 p-4 rounded-2xl flex flex-col gap-3">
          <div className="flex items-center gap-2 text-[#06C755] font-bold text-sm">
            <Check size={18} /> 連携済み
          </div>
          <button
            onClick={unlink}
            disabled={loading}
            className="w-full py-2.5 bg-white text-gray-500 text-xs font-bold rounded-xl border border-gray-200 hover:bg-gray-50 transition-colors disabled:opacity-50"
          >
            {loading ? '処理中...' : '連携を解除する'}
          </button>
        </div>
      ) : (
        <button
          onClick={startLink}
          disabled={loading}
          className="w-full bg-[#06C755] hover:bg-[#05b34c] text-white py-3.5 rounded-2xl font-bold text-sm flex items-center justify-center gap-2 transition-all active:scale-95 shadow-md shadow-[#06C755]/20 disabled:opacity-50"
        >
          {loading ? <Loader2 className="animate-spin" size={18} /> : <MessageCircle size={18} fill="currentColor" />}
          LINEと連携する
        </button>
      )}
    </section>
  );
}
