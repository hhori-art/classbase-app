'use client';

import { useCallback, useEffect, useMemo, useState } from 'react';
import Link from 'next/link';
import { useParams } from 'next/navigation';
import { ArrowLeft, ChevronRight, Clock3, Flame, Loader2, Play, Target, Trophy } from 'lucide-react';
import { useAuth } from '@/app/context/AuthContext';
import { subjectById } from '@/lib/online-school/catalog';

type Progress = { subjectId: string; currentLevel: number; levelXp: number; nextLevelXp: number; totalXp: number; currentStreak: number; accuracy: number; categories: Array<{ categoryId: string; categoryName: string; answeredCount: number; accuracy: number }> };

export default function SubjectTop() {
  const params = useParams<{ subject: string }>();
  const { user } = useAuth(); const subject = subjectById(params.subject); const [progress, setProgress] = useState<Progress | null>(null); const [loading, setLoading] = useState(true);
  const load = useCallback(async () => { if (!user || !subject) return; try { const token = await user.getIdToken(); const response = await fetch('/api/online-school/progress', { headers: { Authorization: `Bearer ${token}` } }); const data = await response.json(); setProgress((data.progresses || []).find((item: Progress) => item.subjectId === subject.id) || null); } finally { setLoading(false); } }, [user, subject]);
  useEffect(() => { void load(); }, [load]);
  const categories = useMemo(() => [...(progress?.categories || [])].filter(item => item.answeredCount >= 2), [progress]);
  const weak = [...categories].sort((a, b) => a.accuracy - b.accuracy).slice(0, 2); const strong = [...categories].sort((a, b) => b.accuracy - a.accuracy).slice(0, 2);
  if (!subject) return <main className="p-10 text-center font-bold">科目が見つかりません。</main>;
  if (loading) return <main className="grid min-h-[70vh] place-items-center"><Loader2 className="animate-spin text-indigo-500" size={34}/></main>;
  const level = progress?.currentLevel || 1; const levelXp = progress?.levelXp || 0; const nextXp = progress?.nextLevelXp || 120; const percent = Math.min(100, Math.round(levelXp / nextXp * 100));
  return <main className="mx-auto min-h-[100dvh] max-w-4xl px-4 py-6 sm:px-7 sm:py-10">
    <header className="mb-7 flex items-center gap-4"><Link href="/student/online-school" className="grid h-12 w-12 place-items-center rounded-2xl bg-white text-slate-600 shadow-sm"><ArrowLeft/></Link><div><p className="text-xs font-black text-indigo-500">{subject.course === 'science' ? '理系コース' : '文系コース'}</p><h1 className="text-2xl font-black text-slate-900">{subject.name}</h1></div></header>
    <section className="rounded-[2rem] bg-white p-6 shadow-sm sm:p-8"><div className="flex flex-wrap items-end justify-between gap-4"><div><p className="text-sm font-bold text-slate-400">現在のLevel</p><p className="text-4xl font-black text-indigo-600">Level {level}</p></div><div className="flex gap-2"><span className="rounded-xl bg-amber-50 px-3 py-2 text-sm font-black text-amber-700"><Trophy className="mr-1 inline" size={16}/>{progress?.totalXp || 0} XP</span><span className="rounded-xl bg-orange-50 px-3 py-2 text-sm font-black text-orange-700"><Flame className="mr-1 inline" size={16}/>{progress?.currentStreak || 0}日</span></div></div><div className="mt-6"><div className="mb-2 flex justify-between text-xs font-bold text-slate-500"><span>次のLevelまで</span><span>{levelXp} / {nextXp} XP</span></div><div className="h-4 overflow-hidden rounded-full bg-slate-100"><div className="h-full rounded-full bg-gradient-to-r from-indigo-500 to-violet-500 transition-all" style={{ width: `${percent}%` }}/></div></div></section>
    <Link href={`/student/online-school/${subject.id}/learn`} className="mt-5 flex min-h-28 items-center justify-between rounded-[2rem] bg-slate-900 p-6 text-white shadow-xl transition active:scale-[.99]"><div className="flex items-center gap-4"><div className="grid h-14 w-14 place-items-center rounded-2xl bg-white/15"><Play fill="currentColor"/></div><div><p className="text-xl font-black">今日の10分学習</p><p className="mt-1 flex items-center gap-1 text-sm text-slate-300"><Clock3 size={15}/>すぐにスタートできます</p></div></div><ChevronRight/></Link>
    <div className="mt-5 grid gap-4 sm:grid-cols-2"><div className="rounded-3xl bg-emerald-50 p-5"><p className="flex items-center gap-2 font-black text-emerald-800"><Trophy size={18}/>得意な分野</p><p className="mt-3 text-sm font-bold text-emerald-700">{strong.length ? strong.map(item => item.categoryName).join('・') : '学習すると見つかります'}</p></div><div className="rounded-3xl bg-amber-50 p-5"><p className="flex items-center gap-2 font-black text-amber-800"><Target size={18}/>伸びそうな分野</p><p className="mt-3 text-sm font-bold text-amber-700">{weak.length ? weak.map(item => item.categoryName).join('・') : '学習すると見つかります'}</p></div></div>
  </main>;
}
