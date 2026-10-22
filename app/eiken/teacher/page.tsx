'use client';

import { useCallback, useEffect, useState } from 'react';
import Link from 'next/link';
import { AlertCircle, CalendarClock, ChevronRight, Play, Users } from 'lucide-react';
import { Button, Card, PageHeader, Spinner, useToast, EmptyState, ErrorState } from '@/app/components/ui';
import { formatDate, formatDateTime } from '@/lib/format';
import EikenCalendar from '@/app/components/eiken/EikenCalendar';
import { useEikenApi } from '@/app/eiken/useEikenApi';

export default function EikenTeacherPage() {
  const api = useEikenApi();
  const toast = useToast();
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
      toast.error(startError instanceof Error ? startError.message : 'LIVE授業を開始できませんでした。');
    } finally {
      setStartingId('');
    }
  };

  if (loading) return <main className="flex min-h-[60vh] items-center justify-center"><Spinner size={28} /></main>;

  const retry = () => {
    setError('');
    setLoading(true);
    load();
  };

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
    <main className="mx-auto max-w-6xl space-y-9 px-4 py-8">
      <PageHeader
        tone="plain"
        eyebrow="講師ページ"
        title="担当Booster講座"
        description="授業予定と、フォローが必要な受講生を確認できます。"
      />
      {error && !dashboard ? (
        <ErrorState message={error} onRetry={retry} />
      ) : (
        <>
          {error && <div role="alert" className="rounded-card border border-danger/20 bg-danger-soft p-4 text-sm font-bold text-danger">{error}</div>}

          <section className="grid gap-4 sm:grid-cols-3">
            <Card className="border-t-4 border-t-accent">
              <Users className="text-accent" size={22} aria-hidden />
              <p className="mt-3 text-xs font-bold text-fg-muted">担当受講生</p>
              <p className="mt-1 text-3xl font-black">{dashboard?.metrics?.active_students || 0}<span className="ml-1 text-sm">名</span></p>
            </Card>
            <Card className="border-t-4 border-t-info">
              <CalendarClock className="text-info" size={22} aria-hidden />
              <p className="mt-3 text-xs font-bold text-fg-muted">今後のLIVE授業</p>
              <p className="mt-1 text-3xl font-black">{dashboard?.metrics?.upcoming_lessons || 0}<span className="ml-1 text-sm">件</span></p>
            </Card>
            <Card className="border-t-4 border-t-warning">
              <AlertCircle className="text-warning" size={22} aria-hidden />
              <p className="mt-3 text-xs font-bold text-fg-muted">確認したい受講生</p>
              <p className="mt-1 text-3xl font-black">{dashboard?.metrics?.follow_up_students || 0}<span className="ml-1 text-sm">名</span></p>
            </Card>
          </section>

          <section>
            <h2 className="mb-3 text-base font-bold text-fg">LIVE授業</h2>
            {upcoming.length ? (
              <Card padded={false} className="divide-y divide-line overflow-hidden">
                {upcoming.slice(0, 6).map((lesson: any, index: number) => (
                  <div key={lesson.id} className="flex flex-col gap-3 px-4 py-4 sm:flex-row sm:items-center">
                    <div className="min-w-0 flex-1">
                      <p className="font-bold">{lesson.title}</p>
                      <p className="mt-1 text-sm text-fg-muted">
                        {lesson.start_at ? formatDateTime(lesson.start_at, { withYear: true }) : lesson.lesson_date}
                      </p>
                    </div>
                    <Button
                      variant={index === 0 ? 'primary' : 'secondary'}
                      onClick={() => startLesson(lesson.id)}
                      loading={startingId === lesson.id}
                      icon={<Play size={17} aria-hidden />}
                    >
                      ホスト開始
                    </Button>
                  </div>
                ))}
              </Card>
            ) : (
              <EmptyState icon={CalendarClock} title="予定されているLIVE授業はありません" />
            )}
          </section>

          <div><EikenCalendar events={calendarEvents} /></div>

          <section>
            <h2 className="mb-3 text-base font-bold text-fg">受講生の進捗</h2>
            {(dashboard?.students || []).length ? (
              <Card padded={false} className="overflow-x-auto">
                <table className="w-full min-w-[900px] text-left text-sm">
                  <thead className="bg-canvas text-xs text-fg-muted">
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
                  <tbody className="divide-y divide-line">
                    {(dashboard?.students || []).map((student: any) => (
                      <tr key={`${student.student_id}-${student.course_id}`}>
                        <td className="px-4 py-3 font-bold">{student.name}</td>
                        <td className="px-4 py-3">{student.course_name || dashboard?.courses?.find((course: any) => course.id === student.course_id)?.name || student.course_id}</td>
                        <td className="px-4 py-3 font-bold">{student.weekly_completion_rate}%</td>
                        <td className="px-4 py-3 font-bold">{student.completion_rate}%</td>
                        <td className="px-4 py-3 text-fg-muted">{student.last_learning_at ? formatDate(student.last_learning_at, { withYear: true }) : 'まだありません'}</td>
                        <td className="px-4 py-3 text-amber-700">{student.follow_up_reasons?.join(' / ') || '順調です'}</td>
                        <td className="px-4 py-3 text-right">
                          <Link
                            href={`/eiken/teacher/students/${encodeURIComponent(student.student_id)}?course_id=${encodeURIComponent(student.course_id)}`}
                            className="inline-flex min-h-9 items-center gap-1 rounded-btn px-2 text-xs font-bold text-accent hover:bg-accent-soft"
                          >
                            詳細
                            <ChevronRight size={15} aria-hidden />
                          </Link>
                        </td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </Card>
            ) : (
              <EmptyState icon={Users} title="担当している受講生はまだいません" />
            )}
          </section>
        </>
      )}
    </main>
  );
}
