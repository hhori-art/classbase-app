'use client';

import { useCallback, useEffect, useMemo, useState } from 'react';
import Link from 'next/link';
import {
  ArrowRight,
  BookOpen,
  CalendarClock,
  CheckCircle2,
  Circle,
  Clock3,
  FilePenLine,
  Loader2,
  PlayCircle,
  Sparkles,
  Video,
} from 'lucide-react';
import EikenCalendar from '@/app/components/eiken/EikenCalendar';
import { useEikenApi } from '@/app/eiken/useEikenApi';
import { EIKEN_LEVEL_LABELS, type EikenLevel } from '@/lib/eiken/types';

const taskLabels: Record<string, string> = {
  video: '映像授業',
  textbook: 'テキスト課題',
  live_lesson: 'LIVE授業',
  quiz: '確認テスト',
  ai_writing: 'AI添削',
  reflection: '振り返り',
  announcement: 'お知らせ',
};

const taskIcon = (type: string) => {
  if (type === 'video') return Video;
  if (type === 'quiz') return FilePenLine;
  if (type === 'ai_writing') return Sparkles;
  return BookOpen;
};

export default function EikenStudentPage() {
  const api = useEikenApi();
  const [dashboard, setDashboard] = useState<any>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState('');
  const [joiningId, setJoiningId] = useState('');

  const load = useCallback(async () => {
    setLoading(true);
    setError('');
    try {
      const data = await api<any>('/api/eiken/dashboard');
      setDashboard(data.dashboard);
    } catch (loadError) {
      setError(loadError instanceof Error ? loadError.message : '学習情報を取得できませんでした。');
    } finally {
      setLoading(false);
    }
  }, [api]);

  useEffect(() => {
    load();
  }, [load]);

  const course = dashboard?.courses?.[0];
  const nextTask = dashboard?.next_task;
  const todayTasks = dashboard?.today_tasks || [];
  const growth = dashboard?.growth_summary;
  const overdueTasks = (dashboard?.tasks || []).filter((task: any) =>
    task.progress?.status !== 'completed' &&
    task.due_at &&
    new Date(task.due_at).getTime() < Date.now()
  );
  const latestWriting = dashboard?.writing_submissions?.[0];
  const totalMinutes = useMemo(
    () => todayTasks.reduce((sum: number, task: any) => sum + Number(task.estimated_minutes || 0), 0),
    [todayTasks],
  );

  const joinLesson = async (lessonId: string) => {
    setJoiningId(lessonId);
    try {
      const result = await api<any>(`/api/eiken/lessons/${lessonId}/join`, { method: 'POST', body: '{}' });
      window.location.href = result.join_url;
    } catch (joinError) {
      alert(joinError instanceof Error ? joinError.message : '授業へ参加できませんでした。');
    } finally {
      setJoiningId('');
    }
  };

  if (loading) {
    return <main className="flex min-h-[60vh] items-center justify-center"><Loader2 className="animate-spin text-emerald-600" /></main>;
  }
  if (error) {
    return (
      <main className="mx-auto max-w-4xl px-4 py-12">
        <div className="rounded-lg border border-red-200 bg-red-50 p-5 text-sm font-bold text-red-700">{error}</div>
      </main>
    );
  }

  return (
    <main className="mx-auto max-w-4xl px-4 py-6 sm:py-8">
      <section className="mb-8">
        <p className="text-sm font-bold text-emerald-700">今日のBooster</p>
        <div className="mt-2 flex flex-wrap items-end justify-between gap-3">
          <div>
            <h2 className="text-2xl font-black sm:text-3xl">{course?.name || '英検対策講座 Booster'}</h2>
            <p className="mt-1 text-sm text-slate-500">
              {course?.level ? EIKEN_LEVEL_LABELS[course.level as EikenLevel] || course.level : '受講級を確認中'}
              {' ・ '}
              {new Intl.DateTimeFormat('ja-JP', { dateStyle: 'long' }).format(new Date())}
            </p>
          </div>
          <div className="rounded-lg bg-white px-4 py-3 text-right shadow-sm ring-1 ring-slate-200">
            <p className="text-[11px] font-bold text-slate-500">今日の目安</p>
            <p className="text-lg font-black">{totalMinutes || 0}分</p>
          </div>
        </div>
      </section>

      {(latestWriting?.evaluation_status === 'completed' || latestWriting?.evaluation_status === 'failed' || overdueTasks.length > 0) && (
        <section className="mb-8 space-y-3" aria-label="確認が必要なお知らせ">
          {latestWriting?.evaluation_status === 'completed' && (
            <Link
              href={`/eiken/student/tasks/${latestWriting.task_id}`}
              className="flex items-center justify-between gap-3 border-l-4 border-emerald-500 bg-emerald-50 px-4 py-4 text-sm font-bold text-emerald-900"
            >
              <span>AI添削の結果が届いています。良かった点と次のポイントを確認しましょう。</span>
              <ArrowRight className="shrink-0" size={18} />
            </Link>
          )}
          {latestWriting?.evaluation_status === 'failed' && (
            <Link
              href={`/eiken/student/tasks/${latestWriting.task_id}`}
              className="flex items-center justify-between gap-3 border-l-4 border-amber-500 bg-amber-50 px-4 py-4 text-sm font-bold text-amber-900"
            >
              <span>AI添削を完了できませんでした。答案は残っているため、もう一度提出できます。</span>
              <ArrowRight className="shrink-0" size={18} />
            </Link>
          )}
          {overdueTasks.length > 0 && (
            <div className="border-l-4 border-indigo-500 bg-indigo-50 px-4 py-4 text-sm font-bold text-indigo-900">
              期限を過ぎた学習が{overdueTasks.length}件あります。今日は上に表示された1つから再開しましょう。
            </div>
          )}
        </section>
      )}

      <section id="today" className="mb-10" aria-labelledby="next-task-heading">
        {nextTask ? (
          <div className="border-l-4 border-emerald-600 bg-white px-5 py-6 shadow-sm">
            <div className="flex items-center gap-2 text-sm font-bold text-emerald-700">
              <PlayCircle size={18} />
              次にやること
            </div>
            <h2 id="next-task-heading" className="mt-3 text-xl font-black sm:text-2xl">{nextTask.title}</h2>
            <p className="mt-2 text-sm leading-6 text-slate-600">{nextTask.description || 'この学習から始めましょう。'}</p>
            <div className="mt-3 flex flex-wrap gap-3 text-xs font-bold text-slate-500">
              <span>{taskLabels[nextTask.task_type] || '学習タスク'}</span>
              {nextTask.estimated_minutes ? <span>約{nextTask.estimated_minutes}分</span> : null}
            </div>
            <Link
              href={`/eiken/student/tasks/${nextTask.id}`}
              className="mt-6 inline-flex w-full items-center justify-center gap-2 rounded-lg bg-emerald-600 px-5 py-3.5 font-black text-white hover:bg-emerald-700 sm:w-auto"
            >
              学習を始める
              <ArrowRight size={18} />
            </Link>
          </div>
        ) : (
          <div className="border-l-4 border-emerald-600 bg-white px-5 py-7 text-center shadow-sm">
            <CheckCircle2 className="mx-auto text-emerald-600" size={34} />
            <h2 className="mt-3 text-lg font-black">今日までの学習は完了しています</h2>
            <p className="mt-1 text-sm text-slate-500">ここまでよく進められています。次の公開をお待ちください。</p>
          </div>
        )}

        <div className="mt-5">
          <h3 className="text-sm font-black text-slate-700">今日の流れ</h3>
          <ol className="mt-3 divide-y divide-slate-200 border-y border-slate-200 bg-white">
            {todayTasks.map((task: any, index: number) => {
              const Icon = taskIcon(task.task_type);
              const completed = task.progress?.status === 'completed';
              return (
                <li key={task.id} className="flex items-center gap-3 px-3 py-4">
                  <span className="flex h-7 w-7 shrink-0 items-center justify-center rounded-full bg-slate-100 text-xs font-black">{index + 1}</span>
                  <Icon className="shrink-0 text-emerald-600" size={20} />
                  <div className="min-w-0 flex-1">
                    <p className="truncate text-sm font-bold">{task.title}</p>
                    <p className="mt-0.5 text-xs text-slate-500">{taskLabels[task.task_type]}{task.estimated_minutes ? ` ・ ${task.estimated_minutes}分` : ''}</p>
                  </div>
                  {completed ? <CheckCircle2 className="text-emerald-600" size={20} /> : <Circle className="text-slate-300" size={20} />}
                </li>
              );
            })}
            {!todayTasks.length && <li className="px-4 py-6 text-center text-sm text-slate-500">今日の学習はありません。</li>}
          </ol>
        </div>
      </section>

      <section className="mb-10" aria-labelledby="lesson-heading">
        <div className="mb-3 flex items-center gap-2">
          <CalendarClock className="text-emerald-600" size={20} />
          <h2 id="lesson-heading" className="font-black">次回のLIVE授業</h2>
        </div>
        <div className="divide-y divide-slate-200 border-y border-slate-200 bg-white">
          {(dashboard?.upcoming_lessons || []).slice(0, 3).map((lesson: any) => (
            <div key={lesson.id} className="flex flex-col gap-3 px-4 py-4 sm:flex-row sm:items-center">
              <div className="min-w-0 flex-1">
                <p className="font-bold">{lesson.title}</p>
                <p className="mt-1 text-sm text-slate-500">
                  {lesson.start_at ? new Intl.DateTimeFormat('ja-JP', { dateStyle: 'medium', timeStyle: 'short' }).format(new Date(lesson.start_at)) : lesson.lesson_date}
                </p>
              </div>
              <button
                type="button"
                onClick={() => joinLesson(lesson.id)}
                disabled={joiningId === lesson.id}
                className={`items-center justify-center gap-2 rounded-lg border border-emerald-600 px-4 py-2.5 text-sm font-black text-emerald-700 hover:bg-emerald-50 disabled:opacity-50 ${
                  lesson.can_join ? 'inline-flex' : 'hidden'
                }`}
              >
                {joiningId === lesson.id ? <Loader2 className="animate-spin" size={17} /> : <Video size={17} />}
                参加する
              </button>
              {!lesson.can_join && lesson.join_available_at && (
                <p className="text-xs font-bold text-slate-500 sm:text-right">
                  {new Intl.DateTimeFormat('ja-JP', { dateStyle: 'short', timeStyle: 'short' }).format(new Date(lesson.join_available_at))}
                  から参加できます
                </p>
              )}
            </div>
          ))}
          {!dashboard?.upcoming_lessons?.length && <p className="px-4 py-6 text-center text-sm text-slate-500">予定されているLIVE授業はありません。</p>}
        </div>
      </section>

      <EikenCalendar events={dashboard?.calendar_events || []} />

      <section id="growth" className="mt-10">
        <div>
          <p className="text-sm font-bold text-emerald-700">今回の成長</p>
          <h2 className="mt-1 text-xl font-black">積み重ねを確認しましょう</h2>
        </div>
        <div className="mt-4 grid gap-4 sm:grid-cols-2 lg:grid-cols-4">
        <div className="border-t-4 border-emerald-500 bg-white p-4 shadow-sm">
          <p className="text-xs font-bold text-slate-500">講座の進捗</p>
          <p className="mt-2 text-3xl font-black">{dashboard?.progress_summary?.completion_rate || 0}%</p>
        </div>
        <div className="border-t-4 border-indigo-500 bg-white p-4 shadow-sm">
          <p className="text-xs font-bold text-slate-500">完了した学習</p>
          <p className="mt-2 text-3xl font-black">{dashboard?.progress_summary?.completed_count || 0}<span className="ml-1 text-sm">件</span></p>
        </div>
        <div className="border-t-4 border-amber-500 bg-white p-4 shadow-sm">
          <p className="text-xs font-bold text-slate-500">最新テスト</p>
          <p className="mt-2 text-3xl font-black">{dashboard?.quiz_results?.[0]?.percentage ?? '--'}<span className="ml-1 text-sm">%</span></p>
        </div>
        <div className="border-t-4 border-cyan-500 bg-white p-4 shadow-sm">
          <p className="text-xs font-bold text-slate-500">今週の学習日数</p>
          <p className="mt-2 text-3xl font-black">{growth?.this_week_study_days || 0}<span className="ml-1 text-sm">日</span></p>
          <p className="mt-1 text-xs text-slate-500">累計 {growth?.total_study_days || 0}日</p>
        </div>
        </div>

        <div className="mt-5 border-y border-slate-200 bg-white p-5">
          <p className="font-black text-emerald-700">{growth?.message || '今日の1つから始めましょう。'}</p>
          <p className="mt-2 text-sm leading-6 text-slate-600">{growth?.next_focus}</p>
          <p className="mt-3 text-xs font-bold text-slate-500">
            今週の完了 {growth?.this_week_completed || 0}件
            {' ・ '}
            前週比 {Number(growth?.week_over_week_change || 0) >= 0 ? '+' : ''}{growth?.week_over_week_change || 0}件
          </p>
        </div>

        {growth?.skill_changes?.length > 0 && (
          <div className="mt-5 overflow-x-auto border-y border-slate-200 bg-white">
            <table className="w-full min-w-[480px] text-left text-sm">
              <thead className="bg-slate-50 text-xs text-slate-500"><tr><th className="px-4 py-3">技能</th><th className="px-4 py-3">前回</th><th className="px-4 py-3">今回</th><th className="px-4 py-3">変化</th></tr></thead>
              <tbody className="divide-y divide-slate-200">
                {growth.skill_changes.map((item: any) => (
                  <tr key={item.skill}>
                    <td className="px-4 py-3 font-bold">{item.skill}</td>
                    <td className="px-4 py-3">{item.previous ?? '--'}</td>
                    <td className="px-4 py-3 font-black">{item.current}</td>
                    <td className={`px-4 py-3 font-black ${Number(item.change || 0) > 0 ? 'text-emerald-700' : 'text-slate-500'}`}>
                      {item.change === null ? '--' : `${item.change > 0 ? '+' : ''}${item.change}`}
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
      </section>

      <section id="history" className="mt-10">
        <h2 className="font-black">学習履歴</h2>
        <div className="mt-3 divide-y divide-slate-200 border-y border-slate-200 bg-white">
          {(dashboard?.tasks || []).filter((task: any) => task.progress?.status === 'completed').slice(-6).reverse().map((task: any) => (
            <div key={task.id} className="flex items-center gap-3 px-4 py-3">
              <CheckCircle2 className="text-emerald-600" size={19} />
              <div className="min-w-0 flex-1">
                <p className="truncate text-sm font-bold">{task.title}</p>
                <p className="text-xs text-slate-500">{taskLabels[task.task_type]}</p>
              </div>
            </div>
          ))}
          {!dashboard?.tasks?.some((task: any) => task.progress?.status === 'completed') && (
            <p className="px-4 py-6 text-center text-sm text-slate-500">最初の学習を完了すると、ここに履歴が表示されます。</p>
          )}
        </div>
      </section>

      <section id="news" className="mt-10">
        <h2 className="font-black">お知らせ</h2>
        <div className="mt-3 divide-y divide-slate-200 border-y border-slate-200 bg-white">
          {(dashboard?.announcements || []).map((item: any) => (
            <article key={item.id} className="px-4 py-4">
              <h3 className="text-sm font-bold">{item.title}</h3>
              <p className="mt-1 whitespace-pre-wrap text-sm leading-6 text-slate-600">{item.body}</p>
            </article>
          ))}
          {!dashboard?.announcements?.length && <p className="px-4 py-6 text-center text-sm text-slate-500">新しいお知らせはありません。</p>}
        </div>
      </section>
    </main>
  );
}
