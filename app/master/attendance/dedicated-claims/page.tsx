'use client';

import { useCallback, useEffect, useMemo, useState } from 'react';
import Link from 'next/link';
import { ArrowLeft, BookOpen, Check, CheckCircle2, Clock3, Download, Loader2, RefreshCw, Search, Train, X, XCircle } from 'lucide-react';
import { useAuth } from '@/app/context/AuthContext';

type ClaimStatus = 'pending' | 'approved' | 'rejected' | 'not_applied';
type ClaimKind = 'overtime' | 'lesson' | 'transport';
type OvertimeClaim = { id: string; user_name: string; user_id?: string; work_date: string; overtime_minutes: number; prescribed_start: string; prescribed_end: string; reason?: string; details?: string; status: ClaimStatus; review_note?: string; overtime_intervals?: Array<{ kind: string; start: string; end: string; minutes: number }> };
type LessonClaim = { id: string; user_name: string; user_id?: string; lesson_date: string; lesson_minutes: number; school_name?: string; status: ClaimStatus; review_note?: string };
type TransportClaim = { id: string; user_name: string; user_id?: string; expense_date: string; from: string; to: string; amount: number; reason: string; details?: string; status: ClaimStatus; review_note?: string };
type AnyClaim = OvertimeClaim | LessonClaim | TransportClaim;

const todayMonth = () => new Date(Date.now() + 9 * 60 * 60 * 1000).toISOString().slice(0, 7);
const duration = (minutes: number) => `${Math.floor(minutes / 60)}時間${minutes % 60 ? `${minutes % 60}分` : ''}`;
const time = (value: string) => new Date(value).toLocaleTimeString('ja-JP', { hour: '2-digit', minute: '2-digit' });
const statusLabel: Record<ClaimStatus, string> = { pending: '確認待ち', approved: '承認済み', rejected: '差戻し', not_applied: '申請なし' };
const kindLabel: Record<ClaimKind, string> = { overtime: '時間外', lesson: '授業時間', transport: '交通費' };
const tabs = [
  { kind: 'overtime' as const, label: '時間外', Icon: Clock3, active: 'border-indigo-400 bg-indigo-50', icon: 'text-indigo-600' },
  { kind: 'lesson' as const, label: '授業時間', Icon: BookOpen, active: 'border-emerald-400 bg-emerald-50', icon: 'text-emerald-600' },
  { kind: 'transport' as const, label: '交通費', Icon: Train, active: 'border-sky-400 bg-sky-50', icon: 'text-sky-600' },
];
const claimDate = (kind: ClaimKind, item: AnyClaim) => kind === 'overtime' ? (item as OvertimeClaim).work_date : kind === 'lesson' ? (item as LessonClaim).lesson_date : (item as TransportClaim).expense_date;
const csvCell = (value: unknown) => `"${String(value ?? '').replaceAll('"', '""')}"`;

export default function DedicatedClaimsPage() {
  const { user } = useAuth();
  const [month, setMonth] = useState(todayMonth());
  const [tab, setTab] = useState<ClaimKind>('overtime');
  const [statusFilter, setStatusFilter] = useState<'pending' | 'all'>('pending');
  const [search, setSearch] = useState('');
  const [overtime, setOvertime] = useState<OvertimeClaim[]>([]);
  const [lessons, setLessons] = useState<LessonClaim[]>([]);
  const [transport, setTransport] = useState<TransportClaim[]>([]);
  const [selected, setSelected] = useState<Set<string>>(new Set());
  const [rejectingId, setRejectingId] = useState('');
  const [rejectReason, setRejectReason] = useState('');
  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState('');
  const [message, setMessage] = useState('');

  const load = useCallback(async () => {
    if (!user) return;
    setLoading(true); setError('');
    try {
      const token = await user.getIdToken();
      const response = await fetch(`/api/admin/dedicated-claims?month=${month}`, { cache: 'no-store', headers: { Authorization: `Bearer ${token}` } });
      const body = await response.json().catch(() => ({}));
      if (!response.ok || body.ok === false) throw new Error(body.error || '申請を取得できませんでした。');
      setOvertime(Array.isArray(body.overtime) ? body.overtime : []);
      setLessons(Array.isArray(body.lessons) ? body.lessons : []);
      setTransport(Array.isArray(body.transport) ? body.transport : []);
    } catch (loadError) { setError(loadError instanceof Error ? loadError.message : '申請を取得できませんでした。'); }
    finally { setLoading(false); }
  }, [month, user]);
  useEffect(() => { load(); }, [load]);
  useEffect(() => { setSelected(new Set()); setRejectingId(''); setRejectReason(''); }, [tab, statusFilter, month]);

  const lists: Record<ClaimKind, AnyClaim[]> = useMemo(() => ({ overtime, lesson: lessons, transport }), [lessons, overtime, transport]);
  const pendingCounts = useMemo(() => ({
    overtime: overtime.filter(item => item.status === 'pending').length,
    lesson: lessons.filter(item => item.status === 'pending').length,
    transport: transport.filter(item => item.status === 'pending').length,
  }), [lessons, overtime, transport]);
  const totalPending = pendingCounts.overtime + pendingCounts.lesson + pendingCounts.transport;
  const approvedOvertime = overtime.filter(item => item.status === 'approved').reduce((sum, item) => sum + Number(item.overtime_minutes || 0), 0);
  const approvedLessons = lessons.filter(item => item.status === 'approved').reduce((sum, item) => sum + Number(item.lesson_minutes || 0), 0);
  const approvedTransport = transport.filter(item => item.status === 'approved').reduce((sum, item) => sum + Number(item.amount || 0), 0);
  const currentItems = useMemo(() => {
    const keyword = search.trim().toLowerCase();
    return lists[tab]
      .filter(item => statusFilter === 'all' || item.status === 'pending')
      .filter(item => !keyword || JSON.stringify(item).toLowerCase().includes(keyword))
      .sort((a, b) => (a.status === 'pending' ? -1 : 0) - (b.status === 'pending' ? -1 : 0) || claimDate(tab, b).localeCompare(claimDate(tab, a)));
  }, [lists, search, statusFilter, tab]);
  const visiblePendingIds = currentItems.filter(item => item.status === 'pending').map(item => item.id);
  const allVisibleSelected = visiblePendingIds.length > 0 && visiblePendingIds.every(id => selected.has(id));

  const review = async (items: Array<{ kind: ClaimKind; id: string }>, status: 'approved' | 'rejected', reviewNote = '') => {
    if (!user || saving || !items.length) return;
    if (status === 'rejected' && !reviewNote.trim()) return setError('差戻し理由を入力してください。');
    setSaving(true); setError(''); setMessage('');
    try {
      const token = await user.getIdToken();
      let updated = 0;
      for (let offset = 0; offset < items.length; offset += 150) {
        const response = await fetch('/api/admin/dedicated-claims', { method: 'POST', headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${token}` }, body: JSON.stringify({ items: items.slice(offset, offset + 150), status, review_note: reviewNote }) });
        const body = await response.json().catch(() => ({}));
        if (!response.ok || body.ok === false) throw new Error(body.error || '確認結果を保存できませんでした。');
        updated += Number(body.updated || 0);
      }
      setMessage(`${updated || items.length}件を${status === 'approved' ? '承認' : '差し戻し'}ました。本人にも通知されます。`);
      setSelected(new Set()); setRejectingId(''); setRejectReason('');
      await load();
    } catch (reviewError) { setError(reviewError instanceof Error ? reviewError.message : '確認結果を保存できませんでした。'); }
    finally { setSaving(false); }
  };

  const toggleAll = () => setSelected(current => {
    const next = new Set(current);
    if (allVisibleSelected) visiblePendingIds.forEach(id => next.delete(id)); else visiblePendingIds.forEach(id => next.add(id));
    return next;
  });
  const toggleOne = (id: string) => setSelected(current => { const next = new Set(current); next.has(id) ? next.delete(id) : next.add(id); return next; });

  const exportCsv = () => {
    const rows = [
      ['種別', '氏名', '日付', '分数・金額', '校舎・経路', '状態', '理由・詳細'],
      ...currentItems.map(item => tab === 'overtime'
        ? [kindLabel[tab], item.user_name, claimDate(tab, item), (item as OvertimeClaim).overtime_minutes, '', statusLabel[item.status], `${(item as OvertimeClaim).reason || ''} ${(item as OvertimeClaim).details || ''}`]
        : tab === 'lesson'
          ? [kindLabel[tab], item.user_name, claimDate(tab, item), (item as LessonClaim).lesson_minutes, (item as LessonClaim).school_name || '', statusLabel[item.status], '']
          : [kindLabel[tab], item.user_name, claimDate(tab, item), (item as TransportClaim).amount, `${(item as TransportClaim).from}〜${(item as TransportClaim).to}`, statusLabel[item.status], `${(item as TransportClaim).reason || ''} ${(item as TransportClaim).details || ''}`]),
    ];
    const blob = new Blob([`\uFEFF${rows.map(row => row.map(csvCell).join(',')).join('\r\n')}`], { type: 'text/csv;charset=utf-8' });
    const url = URL.createObjectURL(blob); const anchor = document.createElement('a'); anchor.href = url; anchor.download = `専任_${kindLabel[tab]}_${month}.csv`; anchor.click(); URL.revokeObjectURL(url);
  };

  return <main className="min-h-screen bg-slate-50 p-4 text-slate-900 sm:p-6"><div className="mx-auto max-w-6xl space-y-5">
    <header className="flex flex-wrap items-center justify-between gap-4"><div className="flex items-center gap-3"><Link href="/master/attendance" className="grid h-11 w-11 place-items-center rounded-full border border-slate-200 bg-white"><ArrowLeft size={18} /></Link><div><h1 className="text-2xl font-black">専任申請</h1><p className="text-sm font-bold text-slate-500">確認待ちを上から順に処理します。</p></div></div><div className="flex gap-2"><input aria-label="対象月" type="month" value={month} onChange={event => setMonth(event.target.value)} className="rounded-xl border border-slate-200 bg-white px-3 py-2 font-black" /><button aria-label="再読み込み" onClick={load} className="grid h-10 w-10 place-items-center rounded-xl bg-slate-900 text-white"><RefreshCw size={17} className={loading ? 'animate-spin' : ''} /></button></div></header>
    {error && <div className="flex items-center justify-between rounded-xl border border-rose-200 bg-rose-50 p-4 text-sm font-bold text-rose-700"><span>{error}</span><button onClick={() => setError('')}><X size={17} /></button></div>}
    {message && <div className="rounded-xl border border-emerald-200 bg-emerald-50 p-4 text-sm font-bold text-emerald-700">{message}</div>}

    <section className="grid grid-cols-2 gap-3 lg:grid-cols-4"><Summary label="確認待ち" value={`${totalPending}件`} tone="amber" /><Summary label="承認済み時間外" value={duration(approvedOvertime)} tone="indigo" /><Summary label="承認済み授業" value={duration(approvedLessons)} tone="emerald" /><Summary label="承認済み交通費" value={`${approvedTransport.toLocaleString()}円`} tone="sky" /></section>

    <section className="grid gap-2 sm:grid-cols-3">{tabs.map(({ kind, label, Icon, active, icon }) => <button key={kind} onClick={() => setTab(kind)} className={`flex items-center justify-between rounded-2xl border p-4 text-left ${tab === kind ? active : 'border-slate-200 bg-white'}`}><span className="flex items-center gap-3"><Icon className={icon} /><span className="font-black">{label}</span></span><span className={`rounded-full px-2.5 py-1 text-xs font-black ${pendingCounts[kind] ? 'bg-amber-100 text-amber-800' : 'bg-slate-100 text-slate-500'}`}>{pendingCounts[kind]}件待ち</span></button>)}</section>

    <section className="rounded-2xl border border-slate-200 bg-white p-3 shadow-sm"><div className="flex flex-wrap items-center gap-2"><div className="flex rounded-xl bg-slate-100 p-1"><button onClick={() => setStatusFilter('pending')} className={`rounded-lg px-4 py-2 text-xs font-black ${statusFilter === 'pending' ? 'bg-white text-slate-900 shadow-sm' : 'text-slate-500'}`}>確認待ち</button><button onClick={() => setStatusFilter('all')} className={`rounded-lg px-4 py-2 text-xs font-black ${statusFilter === 'all' ? 'bg-white text-slate-900 shadow-sm' : 'text-slate-500'}`}>すべて</button></div><div className="relative min-w-52 flex-1"><Search className="absolute left-3 top-2.5 text-slate-400" size={17} /><input value={search} onChange={event => setSearch(event.target.value)} placeholder="氏名・校舎・理由で検索" className="w-full rounded-xl border border-slate-200 py-2 pl-9 pr-3 text-sm font-bold outline-none" /></div><button onClick={exportCsv} disabled={!currentItems.length} className="inline-flex items-center gap-2 rounded-xl border border-slate-200 px-4 py-2 text-xs font-black text-slate-600 disabled:opacity-30"><Download size={16} />CSV</button></div></section>

    {selected.size > 0 && <section className="sticky top-3 z-20 flex flex-wrap items-center justify-between gap-3 rounded-2xl bg-slate-950 px-5 py-4 text-white shadow-xl"><p className="font-black">{selected.size}件を選択中</p><div className="flex gap-2"><button onClick={() => setSelected(new Set())} className="rounded-xl border border-white/20 px-4 py-2 text-xs font-black">解除</button><button disabled={saving} onClick={() => review(Array.from(selected).map(id => ({ kind: tab, id })), 'approved')} className="inline-flex items-center gap-2 rounded-xl bg-emerald-500 px-5 py-2 text-xs font-black disabled:opacity-50"><Check size={16} />一括承認</button></div></section>}

    <section className="overflow-hidden rounded-2xl border border-slate-200 bg-white shadow-sm"><div className="flex items-center justify-between border-b border-slate-100 px-4 py-3"><label className="flex cursor-pointer items-center gap-2 text-xs font-black text-slate-500"><input type="checkbox" checked={allVisibleSelected} disabled={!visiblePendingIds.length} onChange={toggleAll} className="h-4 w-4 accent-indigo-600" />表示中の待機申請を全選択</label><span className="text-xs font-black text-slate-400">{currentItems.length}件</span></div>
      {loading ? <div className="flex justify-center p-14"><Loader2 className="animate-spin text-indigo-500" /></div> : currentItems.length === 0 ? <div className="p-14 text-center"><CheckCircle2 className="mx-auto text-emerald-400" size={34} /><p className="mt-3 font-black text-slate-600">{statusFilter === 'pending' ? '確認待ちはありません' : '該当する申請はありません'}</p></div> : <div className="divide-y divide-slate-100">{currentItems.map(item => <ClaimRow key={item.id} kind={tab} item={item} selected={selected.has(item.id)} saving={saving} rejecting={rejectingId === item.id} rejectReason={rejectReason} onToggle={() => toggleOne(item.id)} onApprove={() => review([{ kind: tab, id: item.id }], 'approved')} onStartReject={() => { setRejectingId(item.id); setRejectReason(''); }} onCancelReject={() => { setRejectingId(''); setRejectReason(''); }} onRejectReason={setRejectReason} onReject={() => review([{ kind: tab, id: item.id }], 'rejected', rejectReason)} />)}</div>}
    </section>
  </div></main>;
}

function Summary({ label, value, tone }: { label: string; value: string; tone: 'amber' | 'indigo' | 'emerald' | 'sky' }) {
  const styles = { amber: 'bg-amber-50 text-amber-900', indigo: 'bg-indigo-50 text-indigo-900', emerald: 'bg-emerald-50 text-emerald-900', sky: 'bg-sky-50 text-sky-900' };
  return <div className={`rounded-2xl p-4 ${styles[tone]}`}><p className="text-[11px] font-black opacity-70">{label}</p><p className="mt-2 text-xl font-black sm:text-2xl">{value}</p></div>;
}

function ClaimRow({ kind, item, selected, saving, rejecting, rejectReason, onToggle, onApprove, onStartReject, onCancelReject, onRejectReason, onReject }: { kind: ClaimKind; item: AnyClaim; selected: boolean; saving: boolean; rejecting: boolean; rejectReason: string; onToggle: () => void; onApprove: () => void; onStartReject: () => void; onCancelReject: () => void; onRejectReason: (value: string) => void; onReject: () => void }) {
  const pending = item.status === 'pending';
  const statusStyle = item.status === 'approved' ? 'bg-emerald-100 text-emerald-700' : item.status === 'rejected' ? 'bg-rose-100 text-rose-700' : 'bg-amber-100 text-amber-800';
  const detail = kind === 'overtime' ? item as OvertimeClaim : kind === 'lesson' ? item as LessonClaim : item as TransportClaim;
  return <article className={`p-4 sm:p-5 ${selected ? 'bg-indigo-50/50' : ''}`}><div className="flex items-start gap-3">{pending ? <input aria-label={`${item.user_name}の申請を選択`} type="checkbox" checked={selected} onChange={onToggle} className="mt-1.5 h-5 w-5 shrink-0 accent-indigo-600" /> : <span className="mt-1.5 grid h-5 w-5 shrink-0 place-items-center rounded-full bg-slate-100"><Check size={12} /></span>}<div className="min-w-0 flex-1"><div className="flex flex-wrap items-center justify-between gap-2"><div><p className="text-base font-black text-slate-900">{item.user_name}</p><p className="text-xs font-bold text-slate-400">{claimDate(kind, item)}</p></div><span className={`rounded-full px-3 py-1 text-[11px] font-black ${statusStyle}`}>{statusLabel[item.status]}</span></div>
    {kind === 'overtime' && <div className="mt-3"><p className="text-lg font-black text-indigo-700">{duration((detail as OvertimeClaim).overtime_minutes)}</p><p className="text-xs font-bold text-slate-500">{((detail as OvertimeClaim).overtime_intervals || []).map(interval => `${interval.kind === 'before' ? '始業前' : interval.kind === 'after' ? '終業後' : '規定休日'} ${time(interval.start)}〜${time(interval.end)}`).join(' / ')}</p><p className="mt-2 rounded-lg bg-slate-50 p-2 text-sm font-bold text-slate-600">{(detail as OvertimeClaim).reason || '理由未入力'}{(detail as OvertimeClaim).details ? ` / ${(detail as OvertimeClaim).details}` : ''}</p></div>}
    {kind === 'lesson' && <div className="mt-3 flex flex-wrap items-center gap-3"><span className="text-lg font-black text-emerald-700">{duration((detail as LessonClaim).lesson_minutes)}</span><span className="rounded-lg bg-slate-100 px-3 py-1 text-xs font-black text-slate-600">{(detail as LessonClaim).school_name || '校舎未設定'}</span></div>}
    {kind === 'transport' && <div className="mt-3"><p className="text-lg font-black text-sky-700">{Number((detail as TransportClaim).amount || 0).toLocaleString()}円</p><p className="text-sm font-black text-slate-700">{(detail as TransportClaim).from}〜{(detail as TransportClaim).to}</p><p className="mt-1 text-xs font-bold text-slate-500">{(detail as TransportClaim).reason}{(detail as TransportClaim).details ? ` / ${(detail as TransportClaim).details}` : ''}</p></div>}
    {item.review_note && !pending && <p className="mt-2 text-xs font-bold text-slate-500">確認メモ: {item.review_note}</p>}
    {pending && !rejecting && <div className="mt-4 flex gap-2"><button disabled={saving} onClick={onApprove} className="inline-flex min-h-10 flex-1 items-center justify-center gap-1 rounded-xl bg-emerald-600 px-4 text-sm font-black text-white disabled:opacity-50"><CheckCircle2 size={16} />承認</button><button disabled={saving} onClick={onStartReject} className="inline-flex min-h-10 items-center justify-center gap-1 rounded-xl border border-rose-200 px-4 text-sm font-black text-rose-600 disabled:opacity-50"><XCircle size={16} />差戻し</button></div>}
    {pending && rejecting && <div className="mt-4 rounded-xl bg-rose-50 p-3"><label className="text-xs font-black text-rose-700">差戻し理由<textarea autoFocus value={rejectReason} onChange={event => onRejectReason(event.target.value)} className="mt-1 min-h-20 w-full rounded-lg border border-rose-200 bg-white p-3 text-sm font-bold text-slate-700 outline-none" /></label><div className="mt-2 flex gap-2"><button onClick={onCancelReject} className="flex-1 rounded-lg border border-slate-200 bg-white py-2 text-xs font-black">戻る</button><button disabled={saving || !rejectReason.trim()} onClick={onReject} className="flex-1 rounded-lg bg-rose-600 py-2 text-xs font-black text-white disabled:opacity-40">理由を送って差戻し</button></div></div>}
  </div></div></article>;
}
