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
import { formatDate, formatDateTime } from '@/lib/format';
import { EmptyState, ErrorState, ListSkeleton, buttonClass, useToast } from '@/app/components/ui';
import { userErrorMessage } from '@/lib/user-error';

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
  const toast = useToast();

  const load = useCallback(async () => {
    setLoading(true);
    setError('');
    try {
      const data = await api<any>('/api/eiken/dashboard');
      setDashboard(data.dashboard);
    } catch (loadError) {
      setError(userErrorMessage(loadError, '学習情報を取得できませんでした。'));
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
      toast.error(userErrorMessage(joinError, '授業へ参加できませんでした。'));
    } finally {
      setJoiningId('');
    }
  };

  if (loading) {
    return <main className="mx-auto max-w-4xl px-4 py-8"><ListSkeleton rows={4} /></main>;
  }
  if (error) {
    return (
      <main className="mx-auto max-w-4xl px-4 py-12">
        <ErrorState title="学習情報を読み込めませんでした" message={error} onRetry={() => void load()} />
      </main>
    );
  }

  return (
    <main className="mx-auto max-w-4xl px-4 py-6 sm:py-8">
      <section className="mb-8">
        <p className="text-sm font-bold text-accent">今日のBooster</p>
        <div className="mt-2 flex flex-wrap items-end justify-between gap-3">
          <div>
            <h2 className="text-2xl font-black text-fg sm:text-3xl">{course?.name || '英検対策講座 Booster'}</h2>
            <p className="mt-1 text-sm text-fg-muted">
              {course?.level ? EIKEN_LEVEL_LABELS[course.level as EikenLevel] || course.level : '受講級を確認中'}
              {' ・ '}
              {formatDate(new Date(), { withYear: true })}
            </p>
          </div>
          <div className="cb-card px-4 py-3 text-right">
            <p className="text-xs font-bold text-fg-muted">今日の目安</p>
            <p className="text-lg font-bold text-fg">{totalMinutes || 0}分</p>
          </div>
        </div>
      </section>

      {(latestWriting?.evaluation_status === 'completed' || latestWriting?.evaluation_status === 'failed' || overdueTasks.length > 0) && (
        <section className="mb-8 space-y-3" aria-label="確認が必要なお知らせ">
          {latestWriting?.evaluation_status === 'completed' && (
            <Link
              href={`/eiken/student/tasks/${latestWriting.task_id}`}
              className="flex min-h-11 items-center justify-between gap-3 rounded-btn border-l-4 border-success bg-success-soft px-4 py-4 text-sm font-bold text-emerald-900"
            >
              <span>AI添削の結果が届いています。良かった点と次のポイントを確認しましょう。</span>
              <ArrowRight className="shrink-0" size={18} aria-hidden />
            </Link>
          )}
          {latestWriting?.evaluation_status === 'failed' && (
            <Link
              href={`/eiken/student/tasks/${latestWriting.task_id}`}
              className="flex min-h-11 items-center justify-between gap-3 rounded-btn border-l-4 border-warning bg-warning-soft px-4 py-4 text-sm font-bold text-amber-900"
            >
              <span>AI添削を完了できませんでした。答案は残っているため、もう一度提出できます。</span>
              <ArrowRight className="shrink-0" size={18} />
            </Link>
          )}
          {overdueTasks.length > 0 && (
            <div className="rounded-btn border-l-4 border-danger bg-danger-soft px-4 py-4 text-sm font-bold text-rose-900">
              期限を過ぎた学習が{overdueTasks.length}件あります。今日は上に表示された1つから再開しましょう。
            </div>
          )}
        </section>
      )}

      <section id="today" className="mb-10" aria-labelledby="next-task-heading">
        {nextTask ? (
          <div className="rounded-card border-l-4 border-accent bg-surface shadow-card px-5 py-6">
            <div className="flex items-center gap-2 text-sm font-bold text-accent">
              <PlayCircle size={18} aria-hidden />
              次にやること
            </div>
            <h2 id="next-task-heading" className="mt-3 text-xl font-black text-fg sm:text-2xl">{nextTask.title}</h2>
            <p className="mt-2 text-sm leading-6 text-fg-muted">{nextTask.description || 'この学習から始めましょう。'}</p>
            <div className="mt-3 flex flex-wrap gap-3 text-xs font-bold text-fg-muted">
              <span>{taskLabels[nextTask.task_type] || '学習タスク'}</span>
              {nextTask.estimated_minutes ? <span>約{nextTask.estimated_minutes}分</span> : null}
            </div>
            <Link
              href={`/eiken/student/tasks/${nextTask.id}`}
              className={buttonClass('primary', 'lg', 'mt-6 w-full sm:w-auto')}
            >
              学習を始める
              <ArrowRight size={18} aria-hidden />
            </Link>
          </div>
        ) : (
          <div className="rounded-card border-l-4 border-accent bg-surface shadow-card px-5 py-7 text-center">
            <CheckCircle2 className="mx-auto text-success" size={34} aria-hidden />
            <h2 className="mt-3 text-lg font-bold text-fg">今日までの学習は完了しています</h2>
            <p className="mt-1 text-sm text-fg-muted">ここまでよく進められています。次の公開をお待ちください。</p>
          </div>
        )}

        <div className="mt-5">
          <h3 className="text-sm font-bold text-fg">今日の流れ</h3>
          <ol className="cb-card mt-3 divide-y divide-line overflow-hidden">
            {todayTasks.map((task: any, index: number) => {
              const Icon = taskIcon(task.task_type);
              const completed = task.progress?.status === 'completed';
              return (
                <li key={task.id} className="flex items-center gap-3 px-3 py-4">
                  <span className="flex h-7 w-7 shrink-0 items-center justify-center rounded-full bg-slate-100 text-xs font-bold text-fg">{index + 1}</span>
                  <Icon className="shrink-0 text-accent" size={20} aria-hidden />
                  <div className="min-w-0 flex-1">
                    <p className="truncate text-sm font-bold text-fg">{task.title}</p>
                    <p className="mt-0.5 text-xs text-fg-muted">{taskLabels[task.task_type]}{task.estimated_minutes ? ` ・ ${task.estimated_minutes}分` : ''}</p>
                  </div>
                  {completed ? <CheckCircle2 className="text-success" size={20} aria-label="完了" /> : <Circle className="text-slate-300" size={20} aria-label="未完了" />}
                </li>
              );
            })}
            {!todayTasks.length && <li className="px-4 py-6 text-center text-sm text-fg-muted">今日の学習はありません。</li>}
          </ol>
        </div>
      </section>

      <section className="mb-10" aria-labelledby="lesson-heading">
        <div className="mb-3 flex items-center gap-2">
          <CalendarClock className="text-accent" size={20} aria-hidden />
          <h2 id="lesson-heading" className="font-bold text-fg">次回のLIVE授業</h2>
        </div>
        <div className="cb-card divide-y divide-line overflow-hidden">
          {(dashboard?.upcoming_lessons || []).slice(0, 3).map((lesson: any) => (
            <div key={lesson.id} className="flex flex-col gap-3 px-4 py-4 sm:flex-row sm:items-center">
              <div className="min-w-0 flex-1">
                <p className="font-bold text-fg">{lesson.title}</p>
                <p className="mt-1 text-sm text-fg-muted">
                  {lesson.start_at ? formatDateTime(lesson.start_at, { withYear: true }) : lesson.lesson_date}
                </p>
              </div>
              <button
                type="button"
                onClick={() => joinLesson(lesson.id)}
                disabled={joiningId === lesson.id}
                className={`min-h-11 items-center justify-center gap-2 rounded-btn border border-accent px-4 text-sm font-bold text-accent hover:bg-accent-soft disabled:opacity-50 ${
                  lesson.can_join ? 'inline-flex' : 'hidden'
                }`}
              >
                {joiningId === lesson.id ? <Loader2 className="animate-spin" size={17} aria-hidden /> : <Video size={17} aria-hidden />}
                参加する
              </button>
              {!lesson.can_join && lesson.join_available_at && (
                <p className="text-xs font-bold text-fg-muted sm:text-right">
                  {formatDateTime(lesson.join_available_at)}
                  から参加できます
                </p>
              )}
            </div>
          ))}
          {!dashboard?.upcoming_lessons?.length && <EmptyState icon={CalendarClock} title="予定されているLIVE授業はありません。" className="m-3 border-0 py-6" />}
        </div>
      </section>

      <EikenCalendar events={dashboard?.calendar_events || []} />

      <section id="growth" className="mt-10">
        <div>
          <p className="text-sm font-bold text-accent">今回の成長</p>
          <h2 className="mt-1 text-xl font-bold text-fg">積み重ねを確認しましょう</h2>
        </div>
        <div className="mt-4 grid gap-4 sm:grid-cols-2 lg:grid-cols-4">
        <div className="rounded-card border-t-4 border-accent bg-surface shadow-card p-4">
          <p className="text-xs font-bold text-fg-muted">講座の進捗</p>
          <p className="mt-2 text-3xl font-black text-fg">{dashboard?.progress_summary?.completion_rate || 0}%</p>
        </div>
        <div className="rounded-card border-t-4 border-sky-500 bg-surface shadow-card p-4">
          <p className="text-xs font-bold text-fg-muted">完了した学習</p>
          <p className="mt-2 text-3xl font-black text-fg">{dashboard?.progress_summary?.completed_count || 0}<span className="ml-1 text-sm">件</span></p>
        </div>
        <div className="rounded-card border-t-4 border-amber-500 bg-surface shadow-card p-4">
          <p className="text-xs font-bold text-fg-muted">最新テスト</p>
          <p className="mt-2 text-3xl font-black text-fg">{dashboard?.quiz_results?.[0]?.percentage ?? '--'}<span className="ml-1 text-sm">%</span></p>
        </div>
        <div className="rounded-card border-t-4 border-slate-400 bg-surface shadow-card p-4">
          <p className="text-xs font-bold text-fg-muted">今週の学習日数</p>
          <p className="mt-2 text-3xl font-black text-fg">{growth?.this_week_study_days || 0}<span className="ml-1 text-sm">日</span></p>
          <p className="mt-1 text-xs text-fg-muted">累計 {growth?.total_study_days || 0}日</p>
        </div>
        </div>

        <div className="cb-card mt-5 p-card">
          <p className="font-bold text-accent">{growth?.message || '今日の1つから始めましょう。'}</p>
          <p className="mt-2 text-sm leading-6 text-fg-muted">{growth?.next_focus}</p>
          <p className="mt-3 text-xs font-bold text-fg-muted">
            今週の完了 {growth?.this_week_completed || 0}件
            {' ・ '}
            前週比 {Number(growth?.week_over_week_change || 0) >= 0 ? '+' : ''}{growth?.week_over_week_change || 0}件
          </p>
        </div>

        {growth?.skill_changes?.length > 0 && (
          <div className="cb-card mt-5 overflow-x-auto">
            <table className="w-full min-w-[480px] text-left text-sm">
              <thead className="bg-slate-50 text-xs text-fg-muted"><tr><th className="px-4 py-3">技能</th><th className="px-4 py-3">前回</th><th className="px-4 py-3">今回</th><th className="px-4 py-3">変化</th></tr></thead>
              <tbody className="divide-y divide-line">
                {growth.skill_changes.map((item: any) => (
                  <tr key={item.skill}>
                    <td className="px-4 py-3 font-bold">{item.skill}</td>
                    <td className="px-4 py-3">{item.previous ?? '--'}</td>
                    <td className="px-4 py-3 font-bold">{item.current}</td>
                    <td className={`px-4 py-3 font-bold ${Number(item.change || 0) > 0 ? 'text-success' : 'text-fg-muted'}`}>
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
        <h2 className="font-bold text-fg">学習履歴</h2>
        <div className="cb-card mt-3 divide-y divide-line overflow-hidden">
          {(dashboard?.tasks || []).filter((task: any) => task.progress?.status === 'completed').slice(-6).reverse().map((task: any) => (
            <div key={task.id} className="flex items-center gap-3 px-4 py-3">
              <CheckCircle2 className="text-success" size={19} aria-hidden />
              <div className="min-w-0 flex-1">
                <p className="truncate text-sm font-bold text-fg">{task.title}</p>
                <p className="text-xs text-fg-muted">{taskLabels[task.task_type]}</p>
              </div>
            </div>
          ))}
          {!dashboard?.tasks?.some((task: any) => task.progress?.status === 'completed') && (
            <p className="px-4 py-6 text-center text-sm text-fg-muted">最初の学習を完了すると、ここに履歴が表示されます。</p>
          )}
        </div>
      </section>

      <section id="news" className="mt-10">
        <h2 className="font-bold text-fg">お知らせ</h2>
        <div className="cb-card mt-3 divide-y divide-line overflow-hidden">
          {(dashboard?.announcements || []).map((item: any) => (
            <article key={item.id} className="px-4 py-4">
              <h3 className="text-sm font-bold text-fg">{item.title}</h3>
              <p className="mt-1 whitespace-pre-wrap text-sm leading-6 text-fg-muted">{item.body}</p>
            </article>
          ))}
          {!dashboard?.announcements?.length && <p className="px-4 py-6 text-center text-sm text-fg-muted">新しいお知らせはありません。</p>}
        </div>
      </section>
    </main>
  );
}
