'use client';

import { useCallback, useEffect, useState } from 'react';
import { Check, Clipboard, KeyRound, RefreshCw, ShieldAlert, X } from 'lucide-react';
import { auth } from '@/lib/firebase';
import AdminPageHeader from '@/app/components/master/AdminPageHeader';
import { Button, EmptyState, ErrorState, IconButton, ListSkeleton, useConfirm, useToast } from '@/app/components/ui';
import { formatDateTime } from '@/lib/format';

type RecoveryRequest = {
  id: string;
  request_code: string;
  status: 'pending' | 'resolved' | 'rejected';
  target_user_id?: string | null;
  target_name?: string | null;
  target_login_id?: string | null;
  target_role?: string | null;
  submitted_login_id?: string | null;
  submitted_name?: string | null;
  phone_last4_provided?: boolean;
  phone_last4_matched?: boolean;
  created_at?: string | null;
};

const ROLE_LABELS: Record<string, string> = { student: '生徒', parent: '保護者', guardian: '保護者', teacher: '講師' };
const roleLabel = (role?: string | null) => (role ? ROLE_LABELS[role] || role : '-');

const authHeaders = async () => {
  const token = await auth.currentUser?.getIdToken();
  return { authorization: `Bearer ${token || ''}`, 'content-type': 'application/json' };
};

export default function PasswordRecoveryRequestsPage() {
  const toast = useToast();
  const confirm = useConfirm();
  const [requests, setRequests] = useState<RecoveryRequest[]>([]);
  const [loading, setLoading] = useState(true);
  const [loadError, setLoadError] = useState('');
  const [workingId, setWorkingId] = useState('');
  const [issuedLink, setIssuedLink] = useState<{ code: string; url: string } | null>(null);

  const load = useCallback(async () => {
    setLoading(true);
    setLoadError('');
    try {
      const response = await fetch('/api/admin/password-recovery-requests', { headers: await authHeaders() });
      const data = await response.json();
      if (!response.ok) throw new Error(data.error || '取得できませんでした');
      setRequests(Array.isArray(data.requests) ? data.requests : []);
    } catch (error) {
      console.error('Password recovery requests fetch failed:', error);
      setLoadError(error instanceof Error ? error.message : '取得できませんでした');
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => { void load(); }, [load]);

  const updateStatus = async (item: RecoveryRequest, status: 'resolved' | 'rejected') => {
    setWorkingId(item.id);
    try {
      const response = await fetch('/api/admin/password-recovery-requests', {
        method: 'PATCH',
        headers: await authHeaders(),
        body: JSON.stringify({ request_id: item.id, status }),
      });
      const data = await response.json();
      if (!response.ok) throw new Error(data.error || '更新できませんでした');
      setRequests(current => current.map(request => request.id === item.id ? { ...request, status } : request));
    } catch (error) {
      toast.error(error instanceof Error ? error.message : '更新できませんでした');
    } finally {
      setWorkingId('');
    }
  };

  const issueResetLink = async (item: RecoveryRequest) => {
    if (!item.target_user_id) return;
    if (!(await confirm({
      title: `「${item.target_name || item.target_login_id}」の再設定リンクを発行しますか？`,
      message: '登録電話への折り返しなどで本人確認が完了している場合だけ発行してください。',
      confirmLabel: '本人確認済み・発行する',
      tone: 'danger',
    }))) return;
    setWorkingId(item.id);
    try {
      const response = await fetch('/api/auth/password-reset', {
        method: 'POST',
        headers: await authHeaders(),
        body: JSON.stringify({ user_id: item.target_user_id }),
      });
      const data = await response.json();
      if (!response.ok || !data.token) throw new Error(data.error || 'リンクを発行できませんでした');
      const url = `${window.location.origin}/password-reset/confirm?token=${encodeURIComponent(data.token)}`;
      setIssuedLink({ code: item.request_code, url });
      await updateStatus(item, 'resolved');
    } catch (error) {
      toast.error(error instanceof Error ? error.message : 'リンクを発行できませんでした');
    } finally {
      setWorkingId('');
    }
  };

  const pending = requests.filter(item => item.status === 'pending');

  return (
    <div>
      <AdminPageHeader
        description="メールを利用できない方の本人確認と再設定リンク発行を行います。"
        actions={<Button variant="secondary" icon={<RefreshCw size={16} aria-hidden />} onClick={() => void load()} loading={loading}>再読み込み</Button>}
      />

      <div className="mt-5 rounded-card border border-amber-200 bg-amber-50 p-4 text-sm font-bold leading-6 text-amber-950">
        <ShieldAlert className="mr-2 inline" size={18} aria-hidden />
        登録電話への折り返しなどで本人確認を完了してからリンクを発行してください。受付番号や氏名だけでは発行しないでください。
      </div>

      {issuedLink && (
        <div className="mt-5 rounded-card border border-emerald-200 bg-emerald-50 p-4">
          <p className="font-bold text-emerald-950">{issuedLink.code} の再設定リンクを発行しました（有効期限1時間）</p>
          <div className="mt-3 flex gap-2">
            <input readOnly aria-label="再設定リンク" value={issuedLink.url} className="min-h-11 min-w-0 flex-1 rounded-input border border-line bg-white px-3 text-sm" />
            <Button variant="secondary" className="shrink-0" icon={<Clipboard size={16} aria-hidden />} onClick={() => navigator.clipboard.writeText(issuedLink.url).then(() => toast.success('リンクをコピーしました'), () => toast.error('コピーできませんでした。リンクを選択してコピーしてください。'))}>コピー</Button>
          </div>
        </div>
      )}

      <section className="mt-6 overflow-hidden rounded-card border border-line bg-white shadow-sm">
        <div className="border-b border-line px-5 py-4">
          <h2 className="font-bold text-slate-900">未対応 {pending.length}件</h2>
        </div>
        {loading ? (
          <div className="p-5"><ListSkeleton rows={3} /></div>
        ) : loadError ? (
          <ErrorState className="m-5" message={loadError} onRetry={() => void load()} />
        ) : pending.length === 0 ? (
          <EmptyState className="m-5" title="未対応の依頼はありません" description="ログイン画面から依頼が届くと、ここに表示されます。" />
        ) : (
          <div className="divide-y divide-slate-100">
            {pending.map(item => (
              <article key={item.id} className="grid gap-4 p-5 lg:grid-cols-[1fr_auto] lg:items-center">
                <div className="min-w-0">
                  <div className="flex flex-wrap items-center gap-2">
                    <span className="font-mono text-sm font-bold text-accent">{item.request_code}</span>
                    <span className={`rounded-full px-2 py-1 text-xs font-bold ${item.target_user_id ? 'bg-emerald-100 text-emerald-800' : 'bg-rose-100 text-rose-800'}`}>
                      {item.target_user_id ? '登録情報一致' : '登録と一致しませんでした'}
                    </span>
                    {item.phone_last4_provided && (
                      <span className={`rounded-full px-2 py-1 text-xs font-bold ${item.phone_last4_matched ? 'bg-sky-100 text-sky-800' : 'bg-amber-100 text-amber-800'}`}>
                        電話下4桁 {item.phone_last4_matched ? '一致' : '不一致'}
                      </span>
                    )}
                  </div>
                  <p className="mt-2 truncate font-bold text-slate-900">
                    {item.target_user_id ? item.target_name || '（氏名未登録）' : '対象アカウントを確認できません'}
                  </p>
                  {item.target_user_id && (
                    <p className="mt-1 text-xs font-bold text-slate-500">ID: {item.target_login_id || '-'} / 種別: {roleLabel(item.target_role)}</p>
                  )}
                  <p className="mt-1 break-all text-xs font-bold text-slate-500">
                    入力内容：ログインID「{item.submitted_login_id || '記録なし'}」・氏名「{item.submitted_name || '記録なし'}」
                  </p>
                  {!item.target_user_id && (
                    <p className="mt-1 text-xs font-bold text-rose-700">ID・氏名の入力違いの可能性があります。入力内容から本人を探し、登録電話などで連絡してください。</p>
                  )}
                  <p className="mt-1 text-xs font-bold text-slate-500">受付: {item.created_at ? (formatDateTime(item.created_at, { withYear: true }) || '-') : '-'}</p>
                </div>
                <div className="flex flex-wrap gap-2">
                  <Button onClick={() => void issueResetLink(item)} disabled={!item.target_user_id || workingId === item.id} icon={<KeyRound size={16} aria-hidden />}>
                    本人確認後に発行
                  </Button>
                  <IconButton label="対応不要にする" variant="secondary" onClick={() => void updateStatus(item, 'rejected')} disabled={workingId === item.id}>
                    <X size={18} aria-hidden />
                  </IconButton>
                </div>
              </article>
            ))}
          </div>
        )}
      </section>

      <section className="mt-6 rounded-card border border-line bg-white p-5 shadow-sm">
        <h2 className="flex items-center gap-2 font-bold text-slate-900"><Check size={18} className="text-emerald-600" aria-hidden /> 最近の対応済み</h2>
        <div className="mt-3 space-y-2">
          {requests.filter(item => item.status !== 'pending').slice(0, 20).map(item => (
            <div key={item.id} className="flex flex-wrap justify-between gap-2 border-t border-slate-100 py-3 text-sm">
              <span className="font-mono font-bold text-slate-600">{item.request_code}</span>
              <span className="font-bold text-slate-700">{item.target_name || `登録と一致しませんでした（${item.submitted_name || '氏名なし'}）`}</span>
              <span className="text-xs font-bold text-slate-400">{item.status === 'resolved' ? 'リンク発行済み' : '対応不要'}</span>
            </div>
          ))}
        </div>
      </section>
    </div>
  );
}
