'use client';

import { useCallback, useEffect, useState } from 'react';
import { CalendarClock, CheckCircle2, Loader2, TrendingUp } from 'lucide-react';
import EikenCalendar from '@/app/components/eiken/EikenCalendar';
import { useEikenApi } from '@/app/eiken/useEikenApi';

export default function EikenParentPage() {
  const api = useEikenApi();
  const [data, setData] = useState<any>(null);
  const [selectedStudentId, setSelectedStudentId] = useState('');
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState('');

  const load = useCallback(async (studentId?: string) => {
    setLoading(true);
    setError('');
    try {
      const result = await api<any>(`/api/eiken/dashboard${studentId ? `?student_id=${encodeURIComponent(studentId)}` : ''}`);
      setData(result);
      setSelectedStudentId(result.selected_student_id || '');
    } catch (loadError) {
      setError(loadError instanceof Error ? loadError.message : '進捗を取得できませんでした。');
    } finally {
      setLoading(false);
    }
  }, [api]);

  useEffect(() => {
    load();
  }, [load]);

  if (loading) return <main className="flex min-h-[60vh] items-center justify-center"><Loader2 className="animate-spin text-emerald-600" /></main>;

  const dashboard = data?.dashboard;
  const latestQuiz = dashboard?.quiz_results?.[0];
  const importantTasks = (dashboard?.today_tasks || []).filter((task: any) => task.is_required !== false);

  return (
    <main className="mx-auto max-w-5xl px-4 py-8">
      <div className="mb-7 flex flex-col justify-between gap-4 sm:flex-row sm:items-end">
        <div>
          <p className="text-sm font-bold text-emerald-700">保護者ページ</p>
          <h1 className="mt-1 text-2xl font-black">Boosterの取り組み状況</h1>
          <p className="mt-1 text-sm text-slate-500">今週の様子と次の予定を確認できます。</p>
        </div>
        {data?.students?.length > 1 && (
          <label className="text-sm font-bold">
            お子さま
            <select
              value={selectedStudentId}
              onChange={event => load(event.target.value)}
              className="ml-2 rounded-lg border border-slate-300 bg-white px-3 py-2"
            >
              {data.students.map((student: any) => <option key={student.id} value={student.id}>{student.name}</option>)}
            </select>
          </label>
        )}
      </div>

      {error && <div className="rounded-lg border border-red-200 bg-red-50 p-4 text-sm font-bold text-red-700">{error}</div>}
      {!dashboard && !error && <div className="border-y border-slate-200 bg-white py-10 text-center text-sm text-slate-500">英検対策講座の受講情報がありません。</div>}

      {dashboard && (
        <>
          <section className="grid gap-4 sm:grid-cols-3">
            <div className="border-t-4 border-emerald-500 bg-white p-5 shadow-sm">
              <CheckCircle2 className="text-emerald-600" size={22} />
              <p className="mt-3 text-xs font-bold text-slate-500">講座の進捗</p>
              <p className="mt-1 text-3xl font-black">{dashboard.progress_summary?.completion_rate || 0}%</p>
            </div>
            <div className="border-t-4 border-indigo-500 bg-white p-5 shadow-sm">
              <TrendingUp className="text-indigo-600" size={22} />
              <p className="mt-3 text-xs font-bold text-slate-500">完了した学習</p>
              <p className="mt-1 text-3xl font-black">{dashboard.progress_summary?.completed_count || 0}<span className="ml-1 text-sm">件</span></p>
            </div>
            <div className="border-t-4 border-amber-500 bg-white p-5 shadow-sm">
              <p className="text-xs font-bold text-slate-500">最新の確認テスト</p>
              <p className="mt-4 text-3xl font-black">{latestQuiz?.percentage ?? '--'}<span className="ml-1 text-sm">%</span></p>
            </div>
          </section>

          <section className="mt-9">
            <h2 className="font-black">次に取り組む内容</h2>
            <div className="mt-3 divide-y divide-slate-200 border-y border-slate-200 bg-white">
              {importantTasks.map((task: any) => (
                <div key={task.id} className="px-4 py-4">
                  <p className="font-bold">{task.title}</p>
                  <p className="mt-1 text-xs text-slate-500">目安 {task.estimated_minutes || '--'}分</p>
                </div>
              ))}
              {!importantTasks.length && <p className="px-4 py-6 text-center text-sm text-slate-500">現在、優先して取り組む課題はありません。</p>}
            </div>
          </section>

          <section className="mt-9">
            <h2 className="font-black">確認テストの推移</h2>
            <div className="mt-3 overflow-x-auto border-y border-slate-200 bg-white">
              <table className="w-full min-w-[520px] text-left text-sm">
                <thead className="bg-slate-50 text-xs text-slate-500"><tr><th className="px-4 py-3">受験日</th><th className="px-4 py-3">結果</th><th className="px-4 py-3">技能別</th></tr></thead>
                <tbody className="divide-y divide-slate-200">
                  {(dashboard.quiz_results || []).map((result: any) => (
                    <tr key={result.id}>
                      <td className="px-4 py-3">{result.submitted_at ? new Date(result.submitted_at).toLocaleDateString('ja-JP') : '-'}</td>
                      <td className="px-4 py-3 font-black">{result.percentage}%</td>
                      <td className="px-4 py-3 text-xs">{Object.entries(result.skill_scores || {}).map(([skill, score]) => `${skill}: ${score}%`).join(' / ') || '-'}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
              {!dashboard.quiz_results?.length && <p className="py-6 text-center text-sm text-slate-500">確認テストの受験後、結果の推移が表示されます。</p>}
            </div>
          </section>

          <section className="mt-9">
            <div className="mb-3 flex items-center gap-2">
              <CalendarClock className="text-emerald-600" size={20} />
              <h2 className="font-black">次回のLIVE授業</h2>
            </div>
            <div className="divide-y divide-slate-200 border-y border-slate-200 bg-white">
              {(dashboard.upcoming_lessons || []).slice(0, 3).map((lesson: any) => (
                <div key={lesson.id} className="px-4 py-4">
                  <p className="font-bold">{lesson.title}</p>
                  <p className="mt-1 text-sm text-slate-500">
                    {lesson.start_at ? new Intl.DateTimeFormat('ja-JP', { dateStyle: 'medium', timeStyle: 'short' }).format(new Date(lesson.start_at)) : lesson.lesson_date}
                  </p>
                </div>
              ))}
              {!dashboard.upcoming_lessons?.length && <p className="px-4 py-6 text-center text-sm text-slate-500">現在、予定されているLIVE授業はありません。</p>}
            </div>
          </section>

          <div className="mt-9"><EikenCalendar events={dashboard.calendar_events || []} /></div>

          <section className="mt-9">
            <h2 className="font-black">お知らせ</h2>
            <div className="mt-3 divide-y divide-slate-200 border-y border-slate-200 bg-white">
              {(dashboard.announcements || []).map((item: any) => (
                <article key={item.id} className="px-4 py-4">
                  <h3 className="font-bold">{item.title}</h3>
                  <p className="mt-1 whitespace-pre-wrap text-sm leading-6 text-slate-600">{item.body}</p>
                </article>
              ))}
              {!dashboard.announcements?.length && <p className="px-4 py-6 text-center text-sm text-slate-500">新しいお知らせはありません。</p>}
            </div>
          </section>
        </>
      )}
    </main>
  );
}
