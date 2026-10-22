'use client';

import { useCallback, useEffect, useMemo, useState } from 'react';
import Link from 'next/link';
import { useParams } from 'next/navigation';
import { BookOpen, ChevronRight, Clock3, Flame, Play, Target, Trophy } from 'lucide-react';
import { useAuth } from '@/app/context/AuthContext';
import { subjectById } from '@/lib/online-school/catalog';
import { EmptyState, ErrorState, PageHeader, Spinner } from '@/app/components/ui';

type Progress = { subjectId: string; currentLevel: number; levelXp: number; nextLevelXp: number; totalXp: number; currentStreak: number; accuracy: number; categories: Array<{ categoryId: string; categoryName: string; answeredCount: number; accuracy: number }> };

export default function SubjectTop() {
  const params = useParams<{ subject: string }>();
  const { user } = useAuth(); const subject = subjectById(params.subject); const [progress, setProgress] = useState<Progress | null>(null); const [loading, setLoading] = useState(true); const [loadError, setLoadError] = useState(false);
  const load = useCallback(async () => { if (!user || !subject) return; setLoadError(false); try { const token = await user.getIdToken(); const response = await fetch('/api/online-school/progress', { headers: { Authorization: `Bearer ${token}` } }); const data = await response.json().catch(() => ({})); if (!response.ok || data.ok === false) throw new Error(data.error || 'progress-fetch-failed'); setProgress((data.progresses || []).find((item: Progress) => item.subjectId === subject.id) || null); } catch (error) { console.error(error); setLoadError(true); } finally { setLoading(false); } }, [user, subject]);
  useEffect(() => { void load(); }, [load]);
  const categories = useMemo(() => [...(progress?.categories || [])].filter(item => item.answeredCount >= 2), [progress]);
  const weak = [...categories].sort((a, b) => a.accuracy - b.accuracy).slice(0, 2); const strong = [...categories].sort((a, b) => b.accuracy - a.accuracy).slice(0, 2);
  if (!subject) return <main className="mx-auto max-w-4xl px-4 py-6"><EmptyState title="科目が見つかりません。" action={<Link href="/student/online-school" className="text-sm font-bold text-accent">戻る</Link>} /></main>;
  if (loading) return <main className="grid min-h-[70vh] place-items-center"><Spinner size={34} /></main>;
  if (loadError) return <main className="mx-auto max-w-4xl px-4 py-6"><ErrorState onRetry={() => { setLoading(true); void load(); }} /></main>;
  const level = progress?.currentLevel || 1; const levelXp = progress?.levelXp || 0; const nextXp = progress?.nextLevelXp || 120; const percent = Math.min(100, Math.round(levelXp / nextXp * 100));
  return <main className="mx-auto max-w-4xl space-y-5 px-4 py-6">
    <PageHeader tone="hero" eyebrow={subject.course === 'science' ? '理系コース' : '文系コース'} title={subject.name} icon={BookOpen} backHref="/student/online-school" />
    <section className="cb-card p-card"><div className="flex flex-wrap items-end justify-between gap-4"><div><p className="text-sm font-bold text-fg-muted">現在のLevel</p><p className="text-4xl font-black text-accent">Level {level}</p></div><div className="flex gap-2"><span className="rounded-btn bg-amber-50 px-3 py-2 text-sm font-bold text-amber-700"><Trophy className="mr-1 inline" size={16} aria-hidden />{progress?.totalXp || 0} XP</span><span className="rounded-btn bg-rose-50 px-3 py-2 text-sm font-bold text-rose-700"><Flame className="mr-1 inline" size={16} aria-hidden />{progress?.currentStreak || 0}日</span></div></div><div className="mt-6"><div className="mb-2 flex justify-between text-xs font-bold text-fg-muted"><span>次のLevelまで</span><span>{levelXp} / {nextXp} XP</span></div><div className="h-4 overflow-hidden rounded-full bg-slate-100"><div className="h-full rounded-full bg-accent transition-all" style={{ width: `${percent}%` }}/></div></div></section>
    <Link href={`/student/online-school/${subject.id}/learn`} className="flex min-h-28 items-center justify-between rounded-card bg-accent p-6 text-accent-ink shadow-card transition hover:bg-accent-hover active:scale-[.99]"><div className="flex items-center gap-4"><div className="grid h-14 w-14 place-items-center rounded-btn bg-white/15"><Play fill="currentColor" aria-hidden /></div><div><p className="text-xl font-black">今日の10分学習</p><p className="mt-1 flex items-center gap-1 text-sm text-accent-ink/80"><Clock3 size={15} aria-hidden />すぐにスタートできます</p></div></div><ChevronRight aria-hidden /></Link>
    <div className="grid gap-4 sm:grid-cols-2"><div className="rounded-card bg-emerald-50 p-card"><p className="flex items-center gap-2 font-bold text-emerald-800"><Trophy size={18} aria-hidden />得意な分野</p><p className="mt-3 text-sm font-medium text-emerald-700">{strong.length ? strong.map(item => item.categoryName).join('・') : '学習すると見つかります'}</p></div><div className="rounded-card bg-amber-50 p-card"><p className="flex items-center gap-2 font-bold text-amber-800"><Target size={18} aria-hidden />伸びそうな分野</p><p className="mt-3 text-sm font-medium text-amber-700">{weak.length ? weak.map(item => item.categoryName).join('・') : '学習すると見つかります'}</p></div></div>
  </main>;
}
