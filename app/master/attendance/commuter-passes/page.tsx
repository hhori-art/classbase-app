'use client';

import { useCallback, useEffect, useMemo, useState } from 'react';
import { CheckCircle, RefreshCw, Search, Train, Trash2, XCircle } from 'lucide-react';
import { Button, EmptyState, ErrorState, ListSkeleton } from '@/app/components/ui';
import AdminPageHeader from '@/app/components/master/AdminPageHeader';
import { useAuth } from '@/app/context/AuthContext';
import { userErrorMessage } from '@/lib/user-error';

type CommuterPass = {
  id: string;
  teacher_id: string;
  teacher_name?: string;
  teacher_school?: string;
  transport_type?: string;
  route_line?: string;
  from?: string;
  to?: string;
  display_route?: string;
  start_date?: string;
  end_date?: string;
  status?: string;
  active: boolean;
  expired: boolean;
  needs_confirmation: boolean;
  source?: string;
  confirmation_action?: string;
};

type Filter = 'all' | 'confirm' | 'active' | 'ended';

const STATE_LABELS = {
  confirm: { label: '期限間近', className: 'bg-amber-100 text-amber-800' },
  active: { label: '有効', className: 'bg-emerald-100 text-emerald-700' },
  ended: { label: '期限切れ・無効', className: 'bg-slate-200 text-slate-600' },
} as const;

const stateOf = (pass: CommuterPass): keyof typeof STATE_LABELS => (
  pass.needs_confirmation ? 'confirm' : pass.active ? 'active' : 'ended'
);

/** 講師が登録した通勤定期を、勤怠管理者が確認・更新・削除する。交通費の定期控除はここにある有効な定期で行われる。 */
export default function CommuterPassesAdminPage() {
  const { user } = useAuth();
  const [passes, setPasses] = useState<CommuterPass[]>([]);
  const [loading, setLoading] = useState(true);
  const [busy, setBusy] = useState('');
  const [message, setMessage] = useState('');
  const [filter, setFilter] = useState<Filter>('all');
  const [search, setSearch] = useState('');
  const [renewDates, setRenewDates] = useState<Record<string, string>>({});
  const [confirmDelete, setConfirmDelete] = useState('');
  const [loadError, setLoadError] = useState('');

  const call = useCallback(async (path: string, init: RequestInit = {}) => {
    if (!user) throw new Error('ログイン情報を確認できません。');
    const token = await user.getIdToken();
    const response = await fetch(path, { ...init, headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${token}`, ...(init.headers || {}) } });
    const data = await response.json().catch(() => ({}));
    if (!response.ok || data.ok === false) throw new Error(data.message || data.error || '処理に失敗しました。');
    return data;
  }, [user]);

  const load = useCallback(async () => {
    setLoading(true);
    setLoadError('');
    try {
      const data = await call('/api/teacher/commuter-passes?scope=managed');
      setPasses(Array.isArray(data.passes) ? data.passes : []);
    } catch (error) {
      console.error(error);
      setLoadError(userErrorMessage(error, '定期を読み込めませんでした。'));
    } finally {
      setLoading(false);
    }
  }, [call]);

  useEffect(() => { void load(); }, [load]);

  const counts = useMemo(() => ({
    all: passes.length,
    confirm: passes.filter(pass => stateOf(pass) === 'confirm').length,
    active: passes.filter(pass => stateOf(pass) === 'active').length,
    ended: passes.filter(pass => stateOf(pass) === 'ended').length,
  }), [passes]);

  const visible = useMemo(() => {
    const text = search.trim().toLowerCase();
    return passes
      .filter(pass => filter === 'all' || stateOf(pass) === filter)
      .filter(pass => !text || [pass.teacher_name, pass.from, pass.to, pass.route_line, pass.display_route, pass.transport_type]
        .filter(Boolean).join(' ').toLowerCase().includes(text));
  }, [passes, filter, search]);

  const update = async (pass: CommuterPass, action: 'renewed' | 'inactive') => {
    const endDate = renewDates[pass.id] || '';
    if (action === 'renewed' && !endDate) {
      setMessage('更新後の有効期限を入力してください。');
      return;
    }
    setBusy(pass.id);
    setMessage('');
    try {
      await call('/api/teacher/commuter-passes', { method: 'PATCH', body: JSON.stringify({ id: pass.id, action, ...(action === 'renewed' ? { end_date: endDate } : {}) }) });
      setMessage(action === 'renewed' ? `${pass.teacher_name || '講師'}の定期を ${endDate} まで有効にしました。` : `${pass.teacher_name || '講師'}の定期を無効にしました。`);
      await load();
    } catch (error) {
      setMessage(userErrorMessage(error, '更新できませんでした。'));
    } finally {
      setBusy('');
    }
  };

  const remove = async (pass: CommuterPass) => {
    setBusy(pass.id);
    setMessage('');
    try {
      await call(`/api/teacher/commuter-passes?id=${encodeURIComponent(pass.id)}`, { method: 'DELETE' });
      setConfirmDelete('');
      setMessage(`${pass.teacher_name || '講師'}の定期（${pass.from} - ${pass.to}）を削除しました。`);
      await load();
    } catch (error) {
      setMessage(userErrorMessage(error, '削除できませんでした。'));
    } finally {
      setBusy('');
    }
  };

  return (
    <div className="font-sans">
      <AdminPageHeader
        description="講師が登録した定期の区間と有効期限を確認できます。期限の更新・無効化・削除ができ、交通費の定期控除は有効な定期で行われます。"
        backHref="/master/attendance"
        actions={
          <Button variant="secondary" icon={<RefreshCw size={16} aria-hidden />} onClick={() => void load()} loading={loading}>
            再読み込み
          </Button>
        }
      />

      <div className="mb-4 grid grid-cols-2 gap-2 sm:grid-cols-4">
        {([['all', 'すべて'], ['confirm', '期限間近（14日以内）'], ['active', '有効'], ['ended', '期限切れ・無効']] as const).map(([key, label]) => (
          <button key={key} onClick={() => setFilter(key)} aria-pressed={filter === key} className={`rounded-card border p-3 text-left transition ${filter === key ? 'border-accent bg-accent text-accent-ink' : 'border-slate-200 bg-white text-slate-700 hover:border-slate-300'}`}>
            <p className="text-xs font-bold opacity-80">{label}</p>
            <p className="mt-1 text-2xl font-black">{counts[key]}<span className="ml-1 text-xs">件</span></p>
          </button>
        ))}
      </div>

      <div className="mb-4 flex items-center gap-2 rounded-card border border-slate-200 bg-white px-3">
        <Search size={16} className="text-slate-400" />
        <input value={search} onChange={event => setSearch(event.target.value)} placeholder="講師名・駅名・路線で検索" className="h-11 flex-1 bg-transparent text-sm font-bold outline-none" />
      </div>

      {message && <p role="status" className="mb-4 rounded-card bg-accent-soft px-4 py-3 text-sm font-bold text-accent">{message}</p>}

      {loading ? (
        <ListSkeleton rows={3} />
      ) : loadError ? (
        <ErrorState title="定期を読み込めませんでした" message={loadError} onRetry={() => void load()} />
      ) : visible.length === 0 ? (
        <EmptyState icon={Train} title="該当する定期はありません" description={passes.length ? '絞り込みや検索の条件を変えてお試しください。' : undefined} />
      ) : (
        <div className="space-y-2">
          {visible.map(pass => {
            const state = STATE_LABELS[stateOf(pass)];
            return (
              <div key={pass.id} className="rounded-card border border-slate-200 bg-white p-4 shadow-sm">
                <div className="flex flex-wrap items-start justify-between gap-3">
                  <div className="min-w-0">
                    <p className="flex flex-wrap items-center gap-2 text-sm font-bold text-slate-900">
                      {pass.teacher_name || '講師名未設定'}
                      <span className={`rounded-full px-2.5 py-0.5 text-xs font-bold ${state.className}`}>{state.label}</span>
                      {pass.teacher_school && <span className="text-xs font-bold text-slate-400">校舎 {pass.teacher_school}</span>}
                    </p>
                    <p className="mt-1 text-sm font-bold text-slate-700">
                      {pass.transport_type || '交通機関'}{pass.route_line ? `（${pass.route_line}）` : ''} ・ {pass.from} → {pass.to}
                    </p>
                    <p className="mt-0.5 text-xs font-bold text-slate-500">
                      有効期間 {pass.start_date || '開始日不明'} 〜 {pass.end_date || '期限未設定'}{pass.source ? ` ・ ${pass.source}` : ''}
                      {pass.confirmation_action === 'not_purchased' ? ' ・ 講師が「更新しない」と回答' : ''}
                    </p>
                  </div>
                  <div className="flex flex-wrap items-center gap-2">
                    <input type="date" value={renewDates[pass.id] || ''} onChange={event => setRenewDates(current => ({ ...current, [pass.id]: event.target.value }))}
                      className="h-9 rounded-input border border-line px-2 text-xs font-bold" aria-label="更新後の有効期限" />
                    <Button size="sm" onClick={() => void update(pass, 'renewed')} disabled={busy === pass.id} icon={<CheckCircle size={14} aria-hidden />}>
                      期限を更新
                    </Button>
                    {pass.active && (
                      <Button size="sm" variant="secondary" onClick={() => void update(pass, 'inactive')} disabled={busy === pass.id} icon={<XCircle size={14} aria-hidden />}>
                        無効にする
                      </Button>
                    )}
                    {confirmDelete === pass.id ? (
                      <span className="flex items-center gap-1">
                        <Button size="sm" variant="danger" onClick={() => void remove(pass)} loading={busy === pass.id} icon={<Trash2 size={14} aria-hidden />}>
                          削除する
                        </Button>
                        <Button size="sm" variant="ghost" onClick={() => setConfirmDelete('')}>やめる</Button>
                      </span>
                    ) : (
                      <Button size="sm" variant="secondary" onClick={() => setConfirmDelete(pass.id)} className="text-danger" icon={<Trash2 size={14} aria-hidden />}>
                        削除
                      </Button>
                    )}
                  </div>
                </div>
              </div>
            );
          })}
        </div>
      )}
    </div>
  );
}
