'use client';

import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import Link from 'next/link';
import { Activity, BookOpen, CheckCircle2, Clock3, RefreshCw, Search, Users } from 'lucide-react';
import type { LucideIcon } from 'lucide-react';
import { useAuth } from '@/app/context/AuthContext';
import AdminPageHeader from '@/app/components/master/AdminPageHeader';
import { Button, ButtonLink, EmptyState, ErrorState, ListSkeleton, Skeleton } from '@/app/components/ui';
import { userErrorMessage } from '@/lib/user-error';

type Dashboard = {
  today: string;
  metrics: { participants: number; implementationRate: number; averageAnswers: number; averageAccuracy: number; averageStudySeconds: number; mathUsers: number; japaneseUsers: number };
  sessions: Array<{ id: string; userId: string; studentName: string; subjectId: string; status: string; answeredCount: number; correctCount: number; startedAtMs: number }>;
  students: Array<{ id: string; name: string; grade: string; classroom: string; school: string }>;
  notStarted: Array<{ id: string; name: string; grade: string; classroom: string; school: string }>;
};

export default function AdminDashboard({ basePath = '/master/online-school', compact = false }: { basePath?: string; compact?: boolean }) {
  const { user } = useAuth(); const [data, setData] = useState<Dashboard | null>(null); const [loading, setLoading] = useState(true); const [error, setError] = useState(''); const [query, setQuery] = useState(''); const [classFilter, setClassFilter] = useState('all'); const requestInFlight = useRef(false); const lastLoadedAt = useRef(0);
  const load = useCallback(async () => { if (!user || requestInFlight.current) return; requestInFlight.current = true; setLoading(true); try { const token = await user.getIdToken(); const response = await fetch('/api/online-school/admin?mode=dashboard', { headers: { Authorization: `Bearer ${token}` } }); const value = await response.json(); if (!response.ok) throw new Error(value.error); setData(value); setError(''); lastLoadedAt.current = Date.now(); } catch (err) { console.error(err); setError(userErrorMessage(err, '読み込みに失敗しました。')); } finally { requestInFlight.current = false; setLoading(false); } }, [user]);
  useEffect(() => {
    void load();
    const refreshIfVisible = () => {
      if (document.visibilityState === 'visible' && Date.now() - lastLoadedAt.current >= 120_000) void load();
    };
    const id = window.setInterval(refreshIfVisible, 120_000);
    document.addEventListener('visibilitychange', refreshIfVisible);
    return () => { window.clearInterval(id); document.removeEventListener('visibilitychange', refreshIfVisible); };
  }, [load]);
  const classOptions = useMemo(() => Array.from(new Set((data?.students || []).map(student => `${student.grade}｜${student.classroom}`).filter(value => value !== '｜'))).sort(), [data]);
  const rows = useMemo(() => { if (!data) return []; const latest = new Map([...data.sessions].sort((a, b) => b.startedAtMs - a.startedAtMs).map(item => [item.userId, item])); return data.students.filter(student => `${student.name}${student.grade}${student.classroom}${student.school}`.toLowerCase().includes(query.toLowerCase())).filter(student => classFilter === 'all' || `${student.grade}｜${student.classroom}` === classFilter).map(student => ({ ...student, session: latest.get(student.id) })); }, [classFilter, data, query]);
  const metrics = data?.metrics;
  const actions = <>{basePath.startsWith('/master') && <ButtonLink variant="secondary" href={`${basePath}/problems`} icon={<BookOpen size={17} aria-hidden />}>問題管理</ButtonLink>}<Button variant="secondary" onClick={() => void load()} loading={loading} icon={<RefreshCw size={16} aria-hidden />}>再読み込み</Button></>;
  const Wrapper = compact ? 'main' : 'div';
  const description = '表示中は2分ごとに更新します。必要なときは「再読み込み」を押してください。';
  const filteredNotStarted = data?.notStarted.filter(student => classFilter === 'all' || `${student.grade}｜${student.classroom}` === classFilter) || [];
  return <Wrapper className={compact ? 'p-4 sm:p-6' : undefined}>
    {compact
      ? <header className="mb-6 flex flex-wrap items-end justify-between gap-4"><div><p className="text-xs font-bold text-accent">オンライン校</p><h1 className="text-2xl font-black text-slate-950 sm:text-3xl">オンライン校 管理</h1><p className="mt-2 text-sm font-medium text-slate-500">{description}</p></div><div className="flex flex-wrap gap-2">{actions}</div></header>
      : <AdminPageHeader description={description} actions={actions} />}
    {error && (data
      ? <ErrorState className="mb-5" message={error} onRetry={() => void load()} />
      : <ErrorState message={error} onRetry={() => void load()} />)}
    {!data && loading && <div className="space-y-5"><div className="grid gap-3 sm:grid-cols-2 xl:grid-cols-4">{[0, 1, 2, 3].map(index => <Skeleton key={index} className="h-32 rounded-card" />)}</div><ListSkeleton rows={6} /></div>}
    {data && <>
    <section className="grid gap-3 sm:grid-cols-2 xl:grid-cols-4">{([
      ['今日の参加人数', `${metrics?.participants || 0}人`, Users, 'text-accent bg-accent-soft'],
      ['今日の学習実施率', `${Math.round((metrics?.implementationRate || 0) * 100)}%`, CheckCircle2, 'text-emerald-600 bg-emerald-50'],
      ['平均回答数 / 正答率', `${(metrics?.averageAnswers || 0).toFixed(1)}問 / ${Math.round((metrics?.averageAccuracy || 0) * 100)}%`, Activity, 'text-accent bg-accent-soft'],
      ['平均学習時間', `${Math.floor((metrics?.averageStudySeconds || 0) / 60)}分${Math.round((metrics?.averageStudySeconds || 0) % 60)}秒`, Clock3, 'text-amber-600 bg-amber-50'],
    ] as Array<[string, string, LucideIcon, string]>).map(([label, value, Icon, style]) => <div key={label} className="rounded-card border border-line bg-surface p-5 shadow-card"><div className={`mb-3 grid h-10 w-10 place-items-center rounded-btn ${style}`}><Icon size={20} aria-hidden /></div><p className="text-xs font-bold text-slate-500">{label}</p><p className="mt-1 text-xl font-black text-slate-900">{value}</p></div>)}</section>
    <div className="mt-5 grid gap-5 xl:grid-cols-[1fr_320px]"><section className="rounded-card border border-line bg-surface shadow-card"><div className="flex flex-wrap items-center justify-between gap-3 border-b border-line p-4"><div><h2 className="font-bold text-slate-900">生徒の取り組み状況</h2><p className="text-xs font-medium text-slate-500">数学 {metrics?.mathUsers || 0}人・国語 {metrics?.japaneseUsers || 0}人</p></div><label className="flex items-center gap-2 rounded-input border border-line bg-surface px-3 focus-within:border-accent"><Search size={16} className="text-slate-400" aria-hidden /><input value={query} onChange={event => setQuery(event.target.value)} aria-label="生徒を検索" placeholder="氏名・学年・クラス" className="h-10 w-44 bg-transparent text-sm outline-none"/></label></div>{rows.length ? <div className="max-h-[620px] overflow-auto"><table className="w-full min-w-[650px] text-left text-sm"><thead className="sticky top-0 bg-slate-50 text-xs text-slate-500"><tr><th className="p-3">生徒</th><th className="p-3">所属</th><th className="p-3">状態</th><th className="p-3">科目</th><th className="p-3">回答</th></tr></thead><tbody>{rows.map(row => <tr key={row.id} className="border-t border-slate-100 hover:bg-slate-50"><td className="p-3 font-bold text-slate-800">{basePath.startsWith('/master') ? <Link className="text-accent hover:underline" href={`${basePath}/students/${row.id}`}>{row.name}</Link> : row.name}</td><td className="p-3 text-slate-500">{[row.school, row.grade, row.classroom].filter(Boolean).join(' / ') || '-'}</td><td className="p-3"><span className={`rounded-full px-2.5 py-1 text-xs font-bold ${row.session?.status === 'active' ? 'bg-sky-100 text-sky-700' : row.session ? 'bg-emerald-100 text-emerald-700' : 'bg-slate-100 text-slate-500'}`}>{row.session?.status === 'active' ? '学習中' : row.session ? '終了' : '未開始'}</span></td><td className="p-3 font-bold text-slate-600">{row.session?.subjectId === 'math' ? '算数・数学' : row.session?.subjectId === 'japanese' ? '国語' : '-'}</td><td className="p-3 font-bold">{row.session ? `${row.session.answeredCount}問` : '-'}</td></tr>)}</tbody></table></div> : <EmptyState className="m-4" icon={Users} title={data.students.length ? '条件に合う生徒がいません' : '生徒がいません'} description={data.students.length ? '検索やクラスの条件を変えてみてください。' : undefined} />}</section>
      <aside className="space-y-4"><div className="rounded-card border border-line bg-surface p-5 shadow-card"><h2 className="font-bold text-slate-900">クラス一覧</h2><select value={classFilter} onChange={event => setClassFilter(event.target.value)} aria-label="クラスで絞り込み" className="mt-3 h-11 w-full rounded-input border border-line bg-surface px-3 text-sm font-bold"><option value="all">全学年・全クラス（{data.students.length || 0}人）</option>{classOptions.map(option => <option key={option} value={option}>{option.replace('｜', ' / ')}（{data.students.filter(student => `${student.grade}｜${student.classroom}` === option).length || 0}人）</option>)}</select></div><div className="rounded-card border border-amber-100 bg-amber-50 p-5"><h2 className="font-bold text-amber-950">今日まだ学習していない生徒</h2><p className="mt-1 text-xs font-bold text-amber-700">{data.notStarted.length || 0}人</p><div className="mt-4 max-h-[420px] space-y-2 overflow-auto">{filteredNotStarted.slice(0, 100).map(student => <div key={student.id} className="rounded-btn bg-surface p-3"><p className="font-bold text-slate-800">{student.name}</p><p className="text-xs font-medium text-slate-500">{[student.grade, student.classroom].filter(Boolean).join(' / ') || '所属未設定'}</p></div>)}{!filteredNotStarted.length && data.students.length > 0 && <p className="text-sm font-medium text-amber-800">全員が学習を始めています。</p>}</div></div></aside>
    </div>
    </>}
  </Wrapper>;
}
