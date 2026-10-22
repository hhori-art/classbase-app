'use client';

import { useCallback, useEffect, useState } from 'react';
import { auth } from '@/lib/firebase';
import AdminPageHeader from '@/app/components/master/AdminPageHeader';
import { Button, EmptyState, ErrorState, ListSkeleton, StatusPill, type StatusTone } from '@/app/components/ui';
import { formatDateTime } from '@/lib/format';
import { RefreshCw, Save, ShieldAlert } from 'lucide-react';

const STATUS_LABELS: Record<string, string> = { open: '未対応', in_progress: '対応中', resolved: '対応済み' };
const STATUS_TONES: Record<string, StatusTone> = {
  open: 'danger',
  in_progress: 'warning',
  resolved: 'success',
};
const dateLabel = (value: any) => {
  if (!value) return '-';
  const date = typeof value === 'string' ? new Date(value) : new Date((value._seconds || value.seconds || 0) * 1000);
  return Number.isNaN(date.getTime()) || date.getTime() === 0 ? '-' : formatDateTime(date, { withYear: true });
};

export default function SafetyAlertsPage() {
  const [items, setItems] = useState<any[]>([]), [status, setStatus] = useState('active'), [loading, setLoading] = useState(true);
  const [nextCursor, setNextCursor] = useState<string | null>(null), [loadingMore, setLoadingMore] = useState(false);
  const [memos, setMemos] = useState<Record<string, string>>({}), [savingId, setSavingId] = useState(''), [error, setError] = useState('');
  const token = async () => await auth.currentUser?.getIdToken() || '';

  const fetchPage = useCallback(async (cursor?: string) => {
    const query = new URLSearchParams({ status, ...(cursor ? { cursor } : {}) });
    const response = await fetch(`/api/admin/safety-alerts?${query}`, { headers: { Authorization: `Bearer ${await token()}` }, cache: 'no-store' });
    const data = await response.json().catch(() => ({}));
    if (!response.ok || data.ok === false) throw new Error(data.error || '読み込みに失敗しました');
    return { alerts: (data.alerts || []) as any[], nextCursor: (data.next_cursor || null) as string | null };
  }, [status]);

  const load = useCallback(async () => {
    setLoading(true); setError('');
    try {
      const page = await fetchPage();
      setItems(page.alerts); setNextCursor(page.nextCursor);
      setMemos(Object.fromEntries(page.alerts.map(item => [item.id, item.memo || ''])));
    } catch (e: any) { setError(e.message || '読み込みに失敗しました'); } finally { setLoading(false); }
  }, [fetchPage]);
  useEffect(() => { void load(); }, [load]);

  const loadMore = async () => {
    if (!nextCursor) return;
    setLoadingMore(true);
    try {
      const page = await fetchPage(nextCursor);
      setItems(current => [...current, ...page.alerts.filter(item => !current.some(existing => existing.id === item.id))]);
      setMemos(current => ({ ...Object.fromEntries(page.alerts.map(item => [item.id, item.memo || ''])), ...current }));
      setNextCursor(page.nextCursor);
    } catch (e: any) { setError(e.message || '読み込みに失敗しました'); } finally { setLoadingMore(false); }
  };

  const update = async (item: any, nextStatus: string) => {
    setSavingId(item.id); setError('');
    try {
      const response = await fetch('/api/admin/safety-alerts', {
        method: 'PATCH',
        headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${await token()}` },
        body: JSON.stringify({ id: item.id, status: nextStatus, memo: memos[item.id] ?? item.memo ?? '' }),
      });
      const data = await response.json().catch(() => ({}));
      if (!response.ok || data.ok === false) throw new Error(data.error || '更新に失敗しました');
      setItems(current => current.map(value => value.id === item.id ? { ...value, status: nextStatus, memo: memos[item.id] ?? value.memo } : value));
    } catch (e: any) { setError(e.message || '更新に失敗しました'); } finally { setSavingId(''); }
  };

  return <div className="text-slate-800">
    <AdminPageHeader
      description="生徒とAIチューターの会話で、自傷・虐待・いじめなど心配な内容を検知したものです。保護者にも声かけのお願いが通知されています。対応状況とメモを残してください。"
      actions={<><select aria-label="表示するアラート" value={status} onChange={e => setStatus(e.target.value)} className="min-h-10 rounded-input border border-line bg-white px-3 text-sm font-bold"><option value="active">未対応・対応中</option><option value="open">未対応</option><option value="in_progress">対応中</option><option value="resolved">対応済み</option><option value="all">すべて</option></select><Button variant="secondary" icon={<RefreshCw size={16} aria-hidden />} onClick={() => void load()} loading={loading}>再読み込み</Button></>}
    />
    <div className="space-y-3">
      {error && items.length > 0 && <div role="alert" className="rounded-card border border-rose-200 bg-rose-50 p-4 text-sm font-bold text-rose-700">{error}</div>}
      {loading ? <ListSkeleton rows={4}/> : error && items.length === 0 ? <ErrorState message={error} onRetry={() => void load()}/> : items.length === 0 ? <EmptyState icon={ShieldAlert} title="該当するアラートはありません"/> : items.map(item => {
        const high = item.severity === 'high';
        return <article key={item.id} className={`rounded-card border bg-white p-5 shadow-sm ${high && item.status !== 'resolved' ? 'border-rose-300 ring-2 ring-rose-100' : 'border-slate-100'}`}>
          <div className="mb-2 flex flex-wrap gap-2">
            <StatusPill tone={STATUS_TONES[item.status] || 'neutral'}>{STATUS_LABELS[item.status] || item.status}</StatusPill>
            <StatusPill tone={high ? 'danger' : 'warning'}>{high ? '緊急度：高' : '緊急度：中'}</StatusPill>
            <StatusPill>{item.category_label || item.category}</StatusPill>
            {Number(item.occurrence_count || 1) > 1 && <StatusPill>同じ時間帯に{item.occurrence_count}回</StatusPill>}
          </div>
          <h2 className="font-bold">{item.student_name || '生徒'} <span className="text-xs font-bold text-slate-500">{item.school_name || item.school_id || '校舎未設定'}</span></h2>
          <p className="mt-1 text-xs font-bold text-slate-400">検知 {dateLabel(item.created_at)}{item.last_detected_at ? ` / 最終 ${dateLabel(item.last_detected_at)}` : ''}{item.handled_by_name ? ` / 対応者 ${item.handled_by_name}` : ''}</p>
          <div className="mt-3 rounded-btn bg-slate-50 p-4 text-sm font-medium leading-6 text-slate-700">
            <p className="mb-1 text-xs font-bold text-slate-400">生徒の発言（抜粋）</p>
            <p className="whitespace-pre-wrap">{item.excerpt}</p>
            {item.latest_excerpt && item.latest_excerpt !== item.excerpt && <><p className="mb-1 mt-3 text-xs font-bold text-slate-400">直近の発言（抜粋）</p><p className="whitespace-pre-wrap">{item.latest_excerpt}</p></>}
          </div>
          <label className="mt-3 block text-xs font-bold text-slate-500">対応メモ
            <textarea value={memos[item.id] ?? ''} maxLength={2000} onChange={e => setMemos(current => ({ ...current, [item.id]: e.target.value }))} className="mt-1 min-h-20 w-full rounded-input border border-line bg-white p-3 text-sm" placeholder="保護者への連絡、本人との面談など"/>
          </label>
          <div className="mt-3 flex flex-wrap gap-2">
            {item.status !== 'in_progress' && <Button size="sm" variant="secondary" onClick={() => void update(item, 'in_progress')} disabled={savingId === item.id}>対応中にする</Button>}
            {item.status !== 'resolved' && <Button size="sm" onClick={() => void update(item, 'resolved')} disabled={savingId === item.id}>対応済みにする</Button>}
            {item.status === 'resolved' && <Button size="sm" variant="ghost" onClick={() => void update(item, 'open')} disabled={savingId === item.id}>未対応に戻す</Button>}
            <Button size="sm" variant="secondary" onClick={() => void update(item, item.status)} loading={savingId === item.id} icon={<Save size={14} aria-hidden/>}>メモを保存</Button>
          </div>
        </article>;
      })}
      {nextCursor && !loading && <Button variant="secondary" fullWidth onClick={() => void loadMore()} loading={loadingMore}>さらに読み込む</Button>}
    </div>
  </div>;
}
