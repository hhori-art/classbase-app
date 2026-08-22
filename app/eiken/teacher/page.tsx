'use client';

import { useCallback, useEffect, useState } from 'react';
import Link from 'next/link';
import { AlertCircle, CalendarClock, ChevronRight, Loader2, Play, Users } from 'lucide-react';
import EikenCalendar from '@/app/components/eiken/EikenCalendar';
import { useEikenApi } from '@/app/eiken/useEikenApi';

export default function EikenTeacherPage() {
  const api = useEikenApi();
  const [dashboard, setDashboard] = useState<any>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState('');
  const [startingId, setStartingId] = useState('');

  const load = useCallback(async () => {
    try {
      const data = await api<any>('/api/eiken/dashboard');
      setDashboard(data.dashboard);
    } catch (loadError) {
      setError(loadError instanceof Error ? loadError.message : '担当講座を取得できませんでした。');
    } finally {
      setLoading(false);
    }
  }, [api]);

  useEffect(() => {
    load();
  }, [load]);

  const startLesson = async (lessonId: string) => {
    setStartingId(lessonId);
    try {
      const result = await api<any>(`/api/eiken/lessons/${lessonId}/host`, { method: 'POST', body: '{}' });
      window.location.href = result.start_url;
    } catch (startError) {
      alert(startError instanceof Error ? startError.message : 'LIVE授業を開始できませんでした。');
    } finally {
      setStartingId('');
    }
  };

  if (loading) return <main className="flex min-h-[60vh] items-center justify-center"><Loader2 className="animate-spin text-emerald-600" /></main>;

  const calendarEvents = (dashboard?.lessons || []).map((lesson: any) => ({
    id: lesson.id,
    type: 'live_lesson',
    title: lesson.title || 'Booster LIVE授業',
    start_at: lesson.start_at || lesson.lesson_date,
    end_at: lesson.end_at || null,
  }));
  const now = Date.now();
  const upcoming = (dashboard?.lessons || [])
    .filter((lesson: any) => lesson.status !== 'cancelled' && (!lesson.end_at || new Date(lesson.end_at).getTime() >= now))
    .sort((a: any, b: any) => String(a.start_at || '').localeCompare(String(b.start_at || '')));

  return (
    <main className="mx-auto max-w-6xl px-4 py-8">
      <div>
        <p className="text-sm font-bold text-emerald-700">講師ページ</p>
        <h1 className="mt-1 text-2xl font-black">担当Booster講座</h1>
        <p className="mt-1 text-sm text-slate-500">授業予定と、フォローが必要な受講生を確認できます。</p>
      </div>
      {error && <div className="mt-5 rounded-lg border border-red-200 bg-red-50 p-4 text-sm font-bold text-red-700">{error}</div>}

      <section className="mt-7 grid gap-4 sm:grid-cols-3">
        <div className="border-t-4 border-emerald-500 bg-white p-5 shadow-sm">
          <Users className="text-emerald-600" size={22} />
          <p className="mt-3 text-xs font-bold text-slate-500">担当受講生</p>
          <p className="mt-1 text-3xl font-black">{dashboard?.metrics?.active_students || 0}<span className="ml-1 text-sm">名</span></p>
        </div>
        <div className="border-t-4 border-indigo-500 bg-white p-5 shadow-sm">
          <CalendarClock className="text-indigo-600" size={22} />
          <p className="mt-3 text-xs font-bold text-slate-500">今後のLIVE授業</p>
          <p className="mt-1 text-3xl font-black">{dashboard?.metrics?.upcoming_lessons || 0}<span className="ml-1 text-sm">件</span></p>
        </div>
        <div className="border-t-4 border-amber-500 bg-white p-5 shadow-sm">
          <AlertCircle className="text-amber-600" size={22} />
          <p className="mt-3 text-xs font-bold text-slate-500">確認したい受講生</p>
          <p className="mt-1 text-3xl font-black">{dashboard?.metrics?.follow_up_students || 0}<span className="ml-1 text-sm">名</span></p>
        </div>
      </section>

      <section className="mt-9">
        <h2 className="font-black">LIVE授業</h2>
        <div className="mt-3 divide-y divide-slate-200 border-y border-slate-200 bg-white">
          {upcoming.slice(0, 6).map((lesson: any) => (
            <div key={lesson.id} className="flex flex-col gap-3 px-4 py-4 sm:flex-row sm:items-center">
              <div className="min-w-0 flex-1">
                <p className="font-bold">{lesson.title}</p>
                <p className="mt-1 text-sm text-slate-500">
                  {lesson.start_at ? new Intl.DateTimeFormat('ja-JP', { dateStyle: 'medium', timeStyle: 'short' }).format(new Date(lesson.start_at)) : lesson.lesson_date}
                </p>
              </div>
              <button
                type="button"
                onClick={() => startLesson(lesson.id)}
                disabled={startingId === lesson.id}
                className="inline-flex items-center justify-center gap-2 rounded-lg bg-emerald-600 px-4 py-2.5 text-sm font-black text-white disabled:opacity-50"
              >
                {startingId === lesson.id ? <Loader2 className="animate-spin" size={17} /> : <Play size={17} />}
                ホスト開始
              </button>
            </div>
          ))}
          {!upcoming.length && <p className="px-4 py-6 text-center text-sm text-slate-500">予定されているLIVE授業はありません。</p>}
        </div>
      </section>

      <div className="mt-9"><EikenCalendar events={calendarEvents} /></div>

      <section className="mt-9">
        <h2 className="font-black">受講生の進捗</h2>
        <div className="mt-3 overflow-x-auto border-y border-slate-200 bg-white">
          <table className="w-full min-w-[900px] text-left text-sm">
            <thead className="bg-slate-50 text-xs text-slate-500">
              <tr>
                <th className="px-4 py-3">氏名</th>
                <th className="px-4 py-3">講座</th>
                <th className="px-4 py-3">今週</th>
                <th className="px-4 py-3">完了率</th>
                <th className="px-4 py-3">最終学習</th>
                <th className="px-4 py-3">確認ポイント</th>
                <th className="px-4 py-3"><span className="sr-only">詳細</span></th>
              </tr>
            </thead>
            <tbody className="divide-y divide-slate-200">
              {(dashboard?.students || []).map((student: any) => (
                <tr key={`${student.student_id}-${student.course_id}`}>
                  <td className="px-4 py-3 font-bold">{student.name}</td>
                  <td className="px-4 py-3">{student.course_name || dashboard?.courses?.find((course: any) => course.id === student.course_id)?.name || student.course_id}</td>
                  <td className="px-4 py-3 font-bold">{student.weekly_completion_rate}%</td>
                  <td className="px-4 py-3 font-bold">{student.completion_rate}%</td>
                  <td className="px-4 py-3 text-slate-500">{student.last_learning_at ? new Date(student.last_learning_at).toLocaleDateString('ja-JP') : 'まだありません'}</td>
                  <td className="px-4 py-3 text-amber-700">{student.follow_up_reasons?.join(' / ') || '順調です'}</td>
                  <td className="px-4 py-3 text-right">
                    <Link
                      href={`/eiken/teacher/students/${encodeURIComponent(student.student_id)}?course_id=${encodeURIComponent(student.course_id)}`}
                      className="inline-flex items-center gap-1 text-xs font-black text-emerald-700 hover:underline"
                    >
                      詳細
                      <ChevronRight size={15} />
                    </Link>
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      </section>
    </main>
  );
}
