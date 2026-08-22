'use client';

import { useCallback, useEffect, useState } from 'react';
import Link from 'next/link';
import { ArrowLeft, Check, Clipboard, KeyRound, Loader2, RefreshCw, ShieldAlert, X } from 'lucide-react';
import { auth } from '@/lib/firebase';

type RecoveryRequest = {
  id: string;
  request_code: string;
  status: 'pending' | 'resolved' | 'rejected';
  target_user_id?: string | null;
  target_name?: string | null;
  target_login_id?: string | null;
  target_role?: string | null;
  phone_last4_provided?: boolean;
  phone_last4_matched?: boolean;
  created_at?: string | null;
};

const authHeaders = async () => {
  const token = await auth.currentUser?.getIdToken();
  return { authorization: `Bearer ${token || ''}`, 'content-type': 'application/json' };
};

export default function PasswordRecoveryRequestsPage() {
  const [requests, setRequests] = useState<RecoveryRequest[]>([]);
  const [loading, setLoading] = useState(true);
  const [workingId, setWorkingId] = useState('');
  const [issuedLink, setIssuedLink] = useState<{ code: string; url: string } | null>(null);

  const load = useCallback(async () => {
    setLoading(true);
    try {
      const response = await fetch('/api/admin/password-recovery-requests', { headers: await authHeaders() });
      const data = await response.json();
      if (!response.ok) throw new Error(data.error || '取得できませんでした');
      setRequests(Array.isArray(data.requests) ? data.requests : []);
    } catch (error) {
      alert(error instanceof Error ? error.message : '取得できませんでした');
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
      alert(error instanceof Error ? error.message : '更新できませんでした');
    } finally {
      setWorkingId('');
    }
  };

  const issueResetLink = async (item: RecoveryRequest) => {
    if (!item.target_user_id) return;
    if (!confirm(`${item.target_name || item.target_login_id}さんの本人確認は完了していますか？`)) return;
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
      alert(error instanceof Error ? error.message : 'リンクを発行できませんでした');
    } finally {
      setWorkingId('');
    }
  };

  const pending = requests.filter(item => item.status === 'pending');

  return (
    <div className="mx-auto max-w-6xl py-4 sm:py-8">
      <header className="flex flex-wrap items-start justify-between gap-4 border-b border-slate-200 pb-6">
        <div>
          <Link href="/master/accounts" className="mb-3 inline-flex items-center gap-2 text-sm font-black text-slate-500 hover:text-indigo-700">
            <ArrowLeft size={16} /> 全体アカウント管理
          </Link>
          <h1 className="text-2xl font-black text-slate-950">パスワード再設定受付</h1>
          <p className="mt-2 text-sm font-medium text-slate-500">メールを利用できない方の本人確認と再設定リンク発行を行います。</p>
        </div>
        <button onClick={() => void load()} disabled={loading} title="再読み込み" className="flex h-11 w-11 items-center justify-center rounded-lg border border-slate-200 bg-white text-slate-600 hover:bg-slate-50 disabled:opacity-50">
          <RefreshCw size={18} className={loading ? 'animate-spin' : ''} />
        </button>
      </header>

      <div className="mt-5 rounded-lg border border-amber-200 bg-amber-50 p-4 text-sm font-bold leading-6 text-amber-950">
        <ShieldAlert className="mr-2 inline" size={18} />
        登録電話への折り返しなどで本人確認を完了してからリンクを発行してください。受付番号や氏名だけでは発行しないでください。
      </div>

      {issuedLink && (
        <div className="mt-5 rounded-lg border border-emerald-200 bg-emerald-50 p-4">
          <p className="font-black text-emerald-950">{issuedLink.code} の再設定リンクを発行しました（有効期限1時間）</p>
          <div className="mt-3 flex gap-2">
            <input readOnly value={issuedLink.url} className="min-w-0 flex-1 rounded-lg border border-emerald-200 bg-white px-3 py-2 text-sm" />
            <button onClick={() => void navigator.clipboard.writeText(issuedLink.url)} title="リンクをコピー" className="flex h-10 w-10 shrink-0 items-center justify-center rounded-lg bg-emerald-700 text-white"><Clipboard size={17} /></button>
          </div>
        </div>
      )}

      <section className="mt-6 overflow-hidden rounded-lg border border-slate-200 bg-white">
        <div className="border-b border-slate-200 px-5 py-4">
          <h2 className="font-black text-slate-900">未対応 {pending.length}件</h2>
        </div>
        {loading ? (
          <div className="flex min-h-40 items-center justify-center"><Loader2 className="animate-spin text-indigo-600" /></div>
        ) : pending.length === 0 ? (
          <p className="p-8 text-center text-sm font-bold text-slate-400">未対応の受付はありません</p>
        ) : (
          <div className="divide-y divide-slate-100">
            {pending.map(item => (
              <article key={item.id} className="grid gap-4 p-5 lg:grid-cols-[1fr_auto] lg:items-center">
                <div className="min-w-0">
                  <div className="flex flex-wrap items-center gap-2">
                    <span className="font-mono text-sm font-black text-indigo-700">{item.request_code}</span>
                    <span className={`rounded px-2 py-1 text-[11px] font-black ${item.target_user_id ? 'bg-emerald-100 text-emerald-800' : 'bg-rose-100 text-rose-800'}`}>
                      {item.target_user_id ? '登録情報一致' : '登録情報不一致'}
                    </span>
                    {item.phone_last4_provided && (
                      <span className={`rounded px-2 py-1 text-[11px] font-black ${item.phone_last4_matched ? 'bg-blue-100 text-blue-800' : 'bg-amber-100 text-amber-800'}`}>
                        電話下4桁 {item.phone_last4_matched ? '一致' : '不一致'}
                      </span>
                    )}
                  </div>
                  <p className="mt-2 truncate font-black text-slate-900">{item.target_name || '対象アカウントを確認できません'}</p>
                  <p className="mt-1 text-xs font-bold text-slate-500">ID: {item.target_login_id || '-'} / 権限: {item.target_role || '-'} / 受付: {item.created_at ? new Date(item.created_at).toLocaleString('ja-JP') : '-'}</p>
                </div>
                <div className="flex flex-wrap gap-2">
                  <button onClick={() => void issueResetLink(item)} disabled={!item.target_user_id || workingId === item.id} className="inline-flex items-center gap-2 rounded-lg bg-indigo-600 px-4 py-2.5 text-sm font-black text-white disabled:opacity-40">
                    <KeyRound size={16} /> 本人確認後に発行
                  </button>
                  <button onClick={() => void updateStatus(item, 'rejected')} disabled={workingId === item.id} title="対応不要にする" className="flex h-10 w-10 items-center justify-center rounded-lg border border-slate-200 text-slate-500 hover:bg-slate-50 disabled:opacity-40">
                    <X size={17} />
                  </button>
                </div>
              </article>
            ))}
          </div>
        )}
      </section>

      <section className="mt-6 rounded-lg border border-slate-200 bg-white p-5">
        <h2 className="flex items-center gap-2 font-black text-slate-900"><Check size={18} className="text-emerald-600" /> 最近の対応済み</h2>
        <div className="mt-3 space-y-2">
          {requests.filter(item => item.status !== 'pending').slice(0, 20).map(item => (
            <div key={item.id} className="flex flex-wrap justify-between gap-2 border-t border-slate-100 py-3 text-sm">
              <span className="font-mono font-black text-slate-600">{item.request_code}</span>
              <span className="font-bold text-slate-700">{item.target_name || '登録情報不一致'}</span>
              <span className="text-xs font-black text-slate-400">{item.status === 'resolved' ? 'リンク発行済み' : '対応不要'}</span>
            </div>
          ))}
        </div>
      </section>
    </div>
  );
}
