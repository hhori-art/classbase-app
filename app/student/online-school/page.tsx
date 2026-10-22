'use client';

import { useCallback, useEffect, useState } from 'react';
import Link from 'next/link';
import { BookOpen, Calculator, ChevronRight, Flame, GraduationCap, Sparkles, Trophy } from 'lucide-react';
import { useAuth } from '@/app/context/AuthContext';
import { ONLINE_SCHOOL_SUBJECTS } from '@/lib/online-school/catalog';
import { ErrorState, ListSkeleton, PageHeader } from '@/app/components/ui';

type Progress = { subjectId: string; currentLevel: number; levelXp: number; nextLevelXp: number; totalXp: number; currentStreak: number };

export default function OnlineSchoolPage() {
  const { user } = useAuth(); const [progresses, setProgresses] = useState<Progress[]>([]); const [loading, setLoading] = useState(true); const [loadError, setLoadError] = useState(false);
  const load = useCallback(async () => {
    if (!user) return; setLoading(true); setLoadError(false);
    try { const token = await user.getIdToken(); const response = await fetch('/api/online-school/progress', { headers: { Authorization: `Bearer ${token}` } }); const data = await response.json(); if (!response.ok) throw new Error(data.error); setProgresses(data.progresses || []); }
    catch (error) { console.error(error); setLoadError(true); }
    finally { setLoading(false); }
  }, [user]);
  useEffect(() => { void load(); }, [load]);
  const totalXp = progresses.reduce((sum, item) => sum + item.totalXp, 0); const streak = Math.max(0, ...progresses.map(item => item.currentStreak));
  return <main className="mx-auto max-w-5xl space-y-5 px-4 py-6">
    <PageHeader tone="hero" title="オンライン校" description="コースを選ぶと、すぐに問題が始められます。" icon={GraduationCap} backHref="/student" />
    <section className="cb-card p-card">
      <div className="flex flex-col gap-5 sm:flex-row sm:items-center sm:justify-between"><div><div className="mb-2 flex items-center gap-2 text-sm font-bold text-accent"><Sparkles size={18} aria-hidden /> 今日の10分学習</div><h2 className="text-xl font-black text-fg sm:text-2xl">今日も一歩、Levelを進めよう。</h2></div><div className="flex gap-3"><div className="rounded-btn bg-amber-50 px-5 py-3 text-center text-amber-800"><Trophy className="mx-auto mb-1" size={20} aria-hidden /><b className="text-lg font-bold">{totalXp}</b><span className="block text-xs font-bold">合計XP</span></div><div className="rounded-btn bg-rose-50 px-5 py-3 text-center text-rose-800"><Flame className="mx-auto mb-1 text-rose-500" size={20} aria-hidden /><b className="text-lg font-bold">{streak}日</b><span className="block text-xs font-bold">連続学習</span></div></div></div>
    </section>
    {loading ? <ListSkeleton rows={2} /> : loadError ? <ErrorState onRetry={() => void load()} /> : <div className="grid gap-5 md:grid-cols-2">
      {ONLINE_SCHOOL_SUBJECTS.map(subject => { const progress = progresses.find(item => item.subjectId === subject.id); const Icon = subject.id === 'math' ? Calculator : BookOpen; return <Link key={subject.id} href={`/student/online-school/${subject.id}`} className="cb-card group p-card transition hover:-translate-y-1 hover:shadow-lg"><div className="flex items-start justify-between"><div className={`grid h-16 w-16 place-items-center rounded-btn ${subject.id === 'math' ? 'bg-sky-100 text-sky-700' : 'bg-rose-100 text-rose-700'}`}><Icon size={32} aria-hidden /></div><ChevronRight className="text-fg-muted/50 transition group-hover:translate-x-1" aria-hidden /></div><p className="mt-6 text-xs font-bold text-fg-muted">{subject.course === 'science' ? '理系コース' : '文系コース'}</p><h2 className="mt-1 text-2xl font-black text-fg">{subject.name}</h2><p className="mt-2 min-h-10 text-sm leading-6 text-fg-muted">{subject.description}</p><div className="mt-5 flex items-end justify-between border-t border-line pt-4"><div><span className="text-xs font-bold text-fg-muted">現在</span><p className="text-xl font-black text-accent">Level {progress?.currentLevel || 1}</p></div><span className="inline-flex min-h-11 items-center rounded-btn bg-accent px-4 text-sm font-bold text-accent-ink">はじめる</span></div></Link>; })}
    </div>}
  </main>;
}
