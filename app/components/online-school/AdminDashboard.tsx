'use client';

import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import Link from 'next/link';
import { Activity, BookOpen, CheckCircle2, Clock3, RefreshCw, Search, Users } from 'lucide-react';
import type { LucideIcon } from 'lucide-react';
import { useAuth } from '@/app/context/AuthContext';

type Dashboard = {
  today: string;
  metrics: { participants: number; implementationRate: number; averageAnswers: number; averageAccuracy: number; averageStudySeconds: number; mathUsers: number; japaneseUsers: number };
  sessions: Array<{ id: string; userId: string; studentName: string; subjectId: string; status: string; answeredCount: number; correctCount: number; startedAtMs: number }>;
  students: Array<{ id: string; name: string; grade: string; classroom: string; school: string }>;
  notStarted: Array<{ id: string; name: string; grade: string; classroom: string; school: string }>;
};

export default function AdminDashboard({ basePath = '/master/online-school', compact = false }: { basePath?: string; compact?: boolean }) {
  const { user } = useAuth(); const [data, setData] = useState<Dashboard | null>(null); const [loading, setLoading] = useState(true); const [error, setError] = useState(''); const [query, setQuery] = useState(''); const [classFilter, setClassFilter] = useState('all'); const requestInFlight = useRef(false); const lastLoadedAt = useRef(0);
  const load = useCallback(async () => { if (!user || requestInFlight.current) return; requestInFlight.current = true; setLoading(true); try { const token = await user.getIdToken(); const response = await fetch('/api/online-school/admin?mode=dashboard', { headers: { Authorization: `Bearer ${token}` } }); const value = await response.json(); if (!response.ok) throw new Error(value.error); setData(value); setError(''); lastLoadedAt.current = Date.now(); } catch (err) { setError(err instanceof Error ? err.message : '読み込みに失敗しました。'); } finally { requestInFlight.current = false; setLoading(false); } }, [user]);
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
  return <main className={compact ? 'p-4 sm:p-6' : 'mx-auto max-w-7xl p-4 sm:p-8'}>
    <header className="mb-6 flex flex-wrap items-end justify-between gap-4"><div><p className="text-xs font-black tracking-widest text-indigo-500">ONLINE SCHOOL</p><h1 className="text-2xl font-black text-slate-950 sm:text-3xl">オンライン校 管理</h1><p className="mt-2 text-sm font-bold text-slate-500">表示中は2分ごとに更新します。必要なときは更新ボタンを押してください。</p></div><div className="flex gap-2">{basePath.startsWith('/master') && <Link href={`${basePath}/problems`} className="inline-flex min-h-11 items-center gap-2 rounded-xl border border-slate-200 bg-white px-4 text-sm font-black text-slate-700"><BookOpen size={17}/>問題管理</Link>}<button onClick={() => void load()} className="grid h-11 w-11 place-items-center rounded-xl bg-slate-900 text-white" aria-label="更新"><RefreshCw className={loading ? 'animate-spin' : ''} size={18}/></button></div></header>
    {error && <div className="mb-5 rounded-xl bg-rose-50 p-4 font-bold text-rose-700">{error}</div>}
    <section className="grid gap-3 sm:grid-cols-2 xl:grid-cols-4">{([
      ['今日の参加人数', `${metrics?.participants || 0}人`, Users, 'text-indigo-600 bg-indigo-50'],
      ['今日の学習実施率', `${Math.round((metrics?.implementationRate || 0) * 100)}%`, CheckCircle2, 'text-emerald-600 bg-emerald-50'],
      ['平均回答数 / 正答率', `${(metrics?.averageAnswers || 0).toFixed(1)}問 / ${Math.round((metrics?.averageAccuracy || 0) * 100)}%`, Activity, 'text-violet-600 bg-violet-50'],
      ['平均学習時間', `${Math.floor((metrics?.averageStudySeconds || 0) / 60)}分${Math.round((metrics?.averageStudySeconds || 0) % 60)}秒`, Clock3, 'text-amber-600 bg-amber-50'],
    ] as Array<[string, string, LucideIcon, string]>).map(([label, value, Icon, style]) => <div key={label} className="rounded-2xl border border-slate-100 bg-white p-5 shadow-sm"><div className={`mb-3 grid h-10 w-10 place-items-center rounded-xl ${style}`}><Icon size={20}/></div><p className="text-xs font-bold text-slate-400">{label}</p><p className="mt-1 text-xl font-black text-slate-900">{value}</p></div>)}</section>
    <div className="mt-5 grid gap-5 xl:grid-cols-[1fr_320px]"><section className="rounded-2xl border border-slate-100 bg-white shadow-sm"><div className="flex flex-wrap items-center justify-between gap-3 border-b border-slate-100 p-4"><div><h2 className="font-black text-slate-900">生徒の取り組み状況</h2><p className="text-xs font-bold text-slate-400">数学 {metrics?.mathUsers || 0}人・国語 {metrics?.japaneseUsers || 0}人</p></div><label className="flex items-center gap-2 rounded-xl bg-slate-100 px-3"><Search size={16} className="text-slate-400"/><input value={query} onChange={event => setQuery(event.target.value)} placeholder="氏名・学年・クラス" className="h-10 w-44 bg-transparent text-sm outline-none"/></label></div><div className="max-h-[620px] overflow-auto"><table className="w-full min-w-[650px] text-left text-sm"><thead className="sticky top-0 bg-slate-50 text-xs text-slate-500"><tr><th className="p-3">生徒</th><th className="p-3">所属</th><th className="p-3">状態</th><th className="p-3">科目</th><th className="p-3">回答</th></tr></thead><tbody>{rows.map(row => <tr key={row.id} className="border-t border-slate-100 hover:bg-slate-50"><td className="p-3 font-black text-slate-800">{basePath.startsWith('/master') ? <Link className="text-indigo-700 hover:underline" href={`${basePath}/students/${row.id}`}>{row.name}</Link> : row.name}</td><td className="p-3 text-slate-500">{[row.school, row.grade, row.classroom].filter(Boolean).join(' / ') || '-'}</td><td className="p-3"><span className={`rounded-full px-2.5 py-1 text-xs font-black ${row.session?.status === 'active' ? 'bg-blue-100 text-blue-700' : row.session ? 'bg-emerald-100 text-emerald-700' : 'bg-slate-100 text-slate-500'}`}>{row.session?.status === 'active' ? '学習中' : row.session ? '終了' : '未開始'}</span></td><td className="p-3 font-bold text-slate-600">{row.session?.subjectId === 'math' ? '算数・数学' : row.session?.subjectId === 'japanese' ? '国語' : '-'}</td><td className="p-3 font-bold">{row.session ? `${row.session.answeredCount}問` : '-'}</td></tr>)}</tbody></table></div></section>
      <aside className="space-y-4"><div className="rounded-2xl border border-indigo-100 bg-indigo-50 p-5"><h2 className="font-black text-indigo-950">クラス一覧</h2><select value={classFilter} onChange={event => setClassFilter(event.target.value)} className="mt-3 h-11 w-full rounded-xl border border-indigo-100 bg-white px-3 text-sm font-black"><option value="all">全学年・全クラス（{data?.students.length || 0}人）</option>{classOptions.map(option => <option key={option} value={option}>{option.replace('｜', ' / ')}（{data?.students.filter(student => `${student.grade}｜${student.classroom}` === option).length || 0}人）</option>)}</select></div><div className="rounded-2xl border border-amber-100 bg-amber-50 p-5"><h2 className="font-black text-amber-950">今日まだ学習していない生徒</h2><p className="mt-1 text-xs font-bold text-amber-700">{data?.notStarted.length || 0}人</p><div className="mt-4 max-h-[420px] space-y-2 overflow-auto">{data?.notStarted.filter(student => classFilter === 'all' || `${student.grade}｜${student.classroom}` === classFilter).slice(0, 100).map(student => <div key={student.id} className="rounded-xl bg-white p-3"><p className="font-black text-slate-800">{student.name}</p><p className="text-xs font-bold text-slate-400">{[student.grade, student.classroom].filter(Boolean).join(' / ') || '所属未設定'}</p></div>)}</div></div></aside>
    </div>
  </main>;
}
