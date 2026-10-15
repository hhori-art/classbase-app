'use client';

import { useCallback, useEffect, useState } from 'react';
import Link from 'next/link';
import { ArrowLeft, BookOpen, Calculator, ChevronRight, Flame, Loader2, Sparkles, Trophy } from 'lucide-react';
import { useAuth } from '@/app/context/AuthContext';
import { ONLINE_SCHOOL_SUBJECTS } from '@/lib/online-school/catalog';

type Progress = { subjectId: string; currentLevel: number; levelXp: number; nextLevelXp: number; totalXp: number; currentStreak: number };

export default function OnlineSchoolPage() {
  const { user } = useAuth(); const [progresses, setProgresses] = useState<Progress[]>([]); const [loading, setLoading] = useState(true);
  const load = useCallback(async () => {
    if (!user) return; setLoading(true);
    try { const token = await user.getIdToken(); const response = await fetch('/api/online-school/progress', { headers: { Authorization: `Bearer ${token}` } }); const data = await response.json(); if (!response.ok) throw new Error(data.error); setProgresses(data.progresses || []); }
    finally { setLoading(false); }
  }, [user]);
  useEffect(() => { void load(); }, [load]);
  const totalXp = progresses.reduce((sum, item) => sum + item.totalXp, 0); const streak = Math.max(0, ...progresses.map(item => item.currentStreak));
  return <main className="mx-auto min-h-[100dvh] max-w-5xl px-4 py-6 sm:px-7 sm:py-10">
    <header className="mb-7 flex items-center justify-between">
      <Link href="/student" className="grid h-12 w-12 place-items-center rounded-2xl bg-white text-slate-600 shadow-sm" aria-label="生徒トップへ戻る"><ArrowLeft /></Link>
      <div className="text-center"><p className="text-xs font-black tracking-[.2em] text-indigo-500">ONLINE SCHOOL</p><h1 className="text-2xl font-black text-slate-900">オンライン校</h1></div><div className="w-12" />
    </header>
    <section className="mb-7 overflow-hidden rounded-[2rem] bg-gradient-to-br from-indigo-600 to-violet-700 p-6 text-white shadow-xl sm:p-8">
      <div className="flex flex-col gap-6 sm:flex-row sm:items-center sm:justify-between"><div><div className="mb-2 flex items-center gap-2 text-sm font-black text-indigo-100"><Sparkles size={18}/> 今日の10分学習</div><h2 className="text-2xl font-black sm:text-3xl">今日も一歩、Levelを進めよう。</h2><p className="mt-2 text-sm text-indigo-100">コースを選ぶと、すぐに問題が始められます。</p></div><div className="flex gap-3"><div className="rounded-2xl bg-white/15 px-5 py-3 text-center"><Trophy className="mx-auto mb-1" size={20}/><b>{totalXp}</b><span className="block text-[10px]">TOTAL XP</span></div><div className="rounded-2xl bg-white/15 px-5 py-3 text-center"><Flame className="mx-auto mb-1 text-orange-300" size={20}/><b>{streak}日</b><span className="block text-[10px]">連続学習</span></div></div></div>
    </section>
    {loading ? <div className="grid min-h-56 place-items-center"><Loader2 className="animate-spin text-indigo-500" size={32}/></div> : <div className="grid gap-5 md:grid-cols-2">
      {ONLINE_SCHOOL_SUBJECTS.map(subject => { const progress = progresses.find(item => item.subjectId === subject.id); const Icon = subject.id === 'math' ? Calculator : BookOpen; return <Link key={subject.id} href={`/student/online-school/${subject.id}`} className={`group rounded-[2rem] border bg-white p-6 shadow-sm transition hover:-translate-y-1 hover:shadow-lg ${subject.id === 'math' ? 'border-sky-100' : 'border-rose-100'}`}><div className="flex items-start justify-between"><div className={`grid h-16 w-16 place-items-center rounded-2xl ${subject.id === 'math' ? 'bg-sky-100 text-sky-700' : 'bg-rose-100 text-rose-700'}`}><Icon size={32}/></div><ChevronRight className="text-slate-300 transition group-hover:translate-x-1"/></div><p className="mt-6 text-xs font-black text-slate-400">{subject.course === 'science' ? '理系コース' : '文系コース'}</p><h2 className="mt-1 text-2xl font-black text-slate-900">{subject.name}</h2><p className="mt-2 min-h-10 text-sm leading-6 text-slate-500">{subject.description}</p><div className="mt-5 flex items-end justify-between border-t border-slate-100 pt-4"><div><span className="text-xs font-bold text-slate-400">現在</span><p className="text-xl font-black text-indigo-600">Level {progress?.currentLevel || 1}</p></div><span className="rounded-full bg-slate-900 px-4 py-2 text-sm font-black text-white">はじめる</span></div></Link>; })}
    </div>}
  </main>;
}
