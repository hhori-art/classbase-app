'use client';

import { FormEvent, useCallback, useEffect, useMemo, useState } from 'react';
import Link from 'next/link';
import {
  AlertCircle,
  BookOpen,
  CalendarDays,
  CheckCircle2,
  ChevronRight,
  ClipboardCheck,
  Languages,
  Megaphone,
  Plus,
  Users,
} from 'lucide-react';
import AdminPageHeader from '@/app/components/master/AdminPageHeader';
import AdminTabs from '@/app/components/master/AdminTabs';
import { SortableHeader, useTableSort } from '@/app/components/master/SortableHeader';
import { Button, EmptyState, ErrorState, ListSkeleton, Skeleton, buttonClass, useToast } from '@/app/components/ui';
import { formatDate, formatDateTime, toDate } from '@/lib/format';
import EikenCalendar from '@/app/components/eiken/EikenCalendar';
import { useEikenApi } from '@/app/eiken/useEikenApi';
import { EIKEN_LEVELS, EIKEN_LEVEL_LABELS, EIKEN_TASK_TYPES, type EikenLevel } from '@/lib/eiken/types';

const fieldClass = 'min-h-10 w-full rounded-input border border-line bg-surface px-3 py-2 text-sm text-fg outline-none focus:border-accent focus:ring-2 focus:ring-accent/20';
const labelClass = 'block text-xs font-bold text-slate-600';
const cardClass = 'rounded-card border border-line bg-surface p-5 shadow-card';
const listClass = 'mt-3 divide-y divide-slate-200 overflow-hidden rounded-card border border-line bg-surface';
const toggleClass = buttonClass('secondary', 'sm', 'shrink-0');
type Tab = 'overview' | 'courses' | 'tasks' | 'assessments' | 'lessons' | 'enrollments';

export default function EikenAdminPage() {
  const api = useEikenApi();
  const [data, setData] = useState<any>(null);
  const [tab, setTab] = useState<Tab>('overview');
  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState('');
  const toast = useToast();

  const load = useCallback(async () => {
    setLoading(true);
    setError('');
    try {
      setData(await api('/api/eiken/admin/catalog'));
    } catch (loadError) {
      console.error(loadError);
      setError(loadError instanceof Error ? loadError.message : '英検管理情報を取得できませんでした。');
    } finally {
      setLoading(false);
    }
  }, [api]);

  useEffect(() => {
    load();
  }, [load]);

  const createResource = async (resource: string, resourceData: Record<string, unknown>, form?: HTMLFormElement) => {
    setSaving(true);
    try {
      await api('/api/eiken/admin/catalog', {
        method: 'POST',
        body: JSON.stringify({ resource, data: resourceData }),
      });
      toast.success('保存しました。');
      form?.reset();
      await load();
    } catch (saveError) {
      console.error(saveError);
      toast.error(saveError instanceof Error ? saveError.message : '保存できませんでした。');
    } finally {
      setSaving(false);
    }
  };

  const updateResource = async (
    resource: string,
    id: string,
    resourceData: Record<string, unknown>,
    successMessage: string,
  ) => {
    setSaving(true);
    try {
      await api('/api/eiken/admin/catalog', {
        method: 'PATCH',
        body: JSON.stringify({ resource, id, data: resourceData }),
      });
      toast.success(successMessage);
      await load();
    } catch (saveError) {
      console.error(saveError);
      toast.error(saveError instanceof Error ? saveError.message : '更新できませんでした。');
    } finally {
      setSaving(false);
    }
  };

  const dashboard = data?.dashboard;
  const courses = dashboard?.courses || [];
  const units = dashboard?.units || [];
  const students = (data?.users || []).filter((user: any) => user.role === 'student');
  const teachers = (data?.users || []).filter((user: any) => user.role === 'teacher');
  const enrollments = data?.enrollments || [];
  const teacherAssignments = data?.teacher_assignments || [];
  const quizzes = data?.quizzes || [];
  const announcements = data?.announcements || [];
  const viewer = data?.viewer || {};
  const viewerSchoolIds = Array.isArray(viewer.school_ids)
    ? viewer.school_ids.filter(Boolean)
    : [];
  const calendarEvents = useMemo(() =>
    (dashboard?.lessons || []).map((lesson: any) => ({
      id: lesson.id,
      type: 'live_lesson',
      title: lesson.title || 'Booster LIVE授業',
      start_at: lesson.start_at || lesson.lesson_date,
      end_at: lesson.end_at || null,
    })), [dashboard?.lessons]
  );
  // 受講生一覧：既定は確認ポイントのある受講生を先に。見出しを押すと読み込み済みの行を並べ替える。
  const eikenStudents = useMemo(() => [...(dashboard?.students || [])].sort((a: any, b: any) => Number(Boolean(b.follow_up_reasons?.length)) - Number(Boolean(a.follow_up_reasons?.length))), [dashboard?.students]);
  const { sorted: sortedEikenStudents, headerProps: eikenSortProps } = useTableSort(eikenStudents, {
    name: (student: any) => student.name,
    school: (student: any) => student.school,
    course: (student: any) => `${student.course_name || ''} ${student.level || ''}`.trim(),
    weekly: (student: any) => Number(student.weekly_completion_rate),
    overall: (student: any) => Number(student.completion_rate),
    lastLearning: (student: any) => student.last_learning_at ? toDate(student.last_learning_at) : null,
    nextLesson: (student: any) => student.next_lesson_at ? toDate(student.next_lesson_at) : null,
    quiz: (student: any) => student.latest_quiz_percentage ?? null,
    followUp: (student: any) => student.follow_up_reasons?.length || 0,
  });

  const header = <AdminPageHeader description="講座、学習の順番、LIVE授業、受講生を一か所で管理します。" />;

  if (loading && !data) return (
    <div>
      {header}
      <Skeleton className="mb-6 h-12 w-full" />
      <ListSkeleton rows={5} />
    </div>
  );

  if (!data && error) return (
    <div>
      {header}
      <ErrorState message={error} onRetry={() => void load()} />
    </div>
  );

  const tabs: { id: Tab; label: string }[] = [
    { id: 'overview', label: '概要' },
    { id: 'courses', label: '講座' },
    { id: 'tasks', label: '学習タスク' },
    { id: 'assessments', label: 'テスト・連絡' },
    { id: 'lessons', label: 'LIVE授業' },
    { id: 'enrollments', label: '受講・担当' },
  ];

  return (
    <div>
      {header}

      <AdminTabs tabs={tabs} value={tab} onChange={setTab} urlParam="tab" ariaLabel="Booster 管理" className="mb-6" />

      {error && <ErrorState className="mb-5" message={error} onRetry={() => void load()} />}

      {tab === 'overview' && (
        <div className="space-y-8">
          <section className="grid gap-4 sm:grid-cols-2 xl:grid-cols-4">
            {[
              ['有効受講生', dashboard?.metrics?.active_students || 0, Users, 'text-accent'],
              ['今週の学習実施率', `${dashboard?.metrics?.weekly_learning_rate || 0}%`, BookOpen, 'text-accent'],
              ['今週のタスク完了率', `${dashboard?.metrics?.weekly_task_completion_rate || 0}%`, CheckCircle2, 'text-accent'],
              ['LIVE授業出席率', dashboard?.metrics?.live_attendance_rate === null ? '--' : `${dashboard?.metrics?.live_attendance_rate || 0}%`, CalendarDays, 'text-accent'],
              ['確認テスト受験率', dashboard?.metrics?.quiz_participation_rate === null ? '--' : `${dashboard?.metrics?.quiz_participation_rate || 0}%`, ClipboardCheck, 'text-accent'],
              ['AI添削提出率', dashboard?.metrics?.writing_submission_rate === null ? '--' : `${dashboard?.metrics?.writing_submission_rate || 0}%`, Languages, 'text-accent'],
              ['要フォロー', dashboard?.metrics?.follow_up_students || 0, AlertCircle, 'text-amber-600'],
            ].map(([label, value, Icon, iconColor]) => (
              <div key={String(label)} className={cardClass}>
                <Icon className={String(iconColor)} size={21} aria-hidden />
                <p className="mt-3 text-xs font-bold text-slate-500">{String(label)}</p>
                <p className="mt-1 text-3xl font-black">{String(value)}</p>
              </div>
            ))}
          </section>
          <EikenCalendar events={calendarEvents} />
          <section>
            <h2 className="font-bold">受講生一覧</h2>
            <p className="mt-1 text-sm text-slate-500">確認ポイントのある受講生を先に表示しています。</p>
            <div className="mt-3 overflow-x-auto rounded-card border border-line bg-surface">
              <table className="w-full min-w-[1180px] text-left text-sm">
                <thead className="bg-slate-50 text-xs text-slate-500">
                  <tr><SortableHeader {...eikenSortProps('name')} className="px-4 py-1">氏名</SortableHeader><SortableHeader {...eikenSortProps('school')} className="px-4 py-1">校舎</SortableHeader><SortableHeader {...eikenSortProps('course')} className="px-4 py-1">講座・級</SortableHeader><SortableHeader {...eikenSortProps('weekly')} className="px-4 py-1">今週</SortableHeader><SortableHeader {...eikenSortProps('overall')} className="px-4 py-1">全体</SortableHeader><SortableHeader {...eikenSortProps('lastLearning')} className="px-4 py-1">最終学習</SortableHeader><SortableHeader {...eikenSortProps('nextLesson')} className="px-4 py-1">次回授業</SortableHeader><SortableHeader {...eikenSortProps('quiz')} className="px-4 py-1">最新テスト</SortableHeader><SortableHeader {...eikenSortProps('followUp')} className="px-4 py-1">確認理由</SortableHeader><th className="px-4 py-3"><span className="sr-only">詳細</span></th></tr>
                </thead>
                <tbody className="divide-y divide-slate-200">
                  {sortedEikenStudents.map((student: any) => (
                    <tr key={`${student.student_id}-${student.course_id}`}>
                      <td className="px-4 py-3 font-bold">{student.name}</td>
                      <td className="px-4 py-3">{student.school || '-'}</td>
                      <td className="px-4 py-3"><p className="font-bold">{student.course_name}</p><p className="text-xs text-slate-500">{student.level || '-'}</p></td>
                      <td className="px-4 py-3 font-bold">{student.weekly_completion_rate}%</td>
                      <td className="px-4 py-3 font-bold">{student.completion_rate}%</td>
                      <td className="px-4 py-3 text-xs text-slate-500">{(student.last_learning_at && formatDate(student.last_learning_at)) || '-'}</td>
                      <td className="px-4 py-3 text-xs text-slate-500">{(student.next_lesson_at && formatDateTime(student.next_lesson_at)) || '-'}</td>
                      <td className="px-4 py-3 font-bold">{student.latest_quiz_percentage ?? '--'}{student.latest_quiz_percentage !== null ? '%' : ''}</td>
                      <td className="max-w-xs px-4 py-3 text-amber-700">{student.follow_up_reasons.join(' / ') || '順調です'}</td>
                      <td className="px-4 py-3 text-right">
                        <Link
                          href={`/master/eiken/students/${encodeURIComponent(student.student_id)}?course_id=${encodeURIComponent(student.course_id)}`}
                          aria-label={`${student.name} さんの詳細`}
                          className="inline-flex min-h-9 items-center gap-1 text-xs font-bold text-accent hover:underline"
                        >
                          詳細
                          <ChevronRight size={15} aria-hidden />
                        </Link>
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
              {!dashboard?.students?.length && <EmptyState className="m-4" icon={Users} title="受講登録された生徒はいません" description="「受講・担当」タブから生徒を受講登録できます。" />}
            </div>
          </section>
        </div>
      )}

      {tab === 'courses' && (
        <div className="space-y-8">
        <div className="grid gap-6 xl:grid-cols-[minmax(0,1fr)_360px]">
          <section>
            <h2 className="font-bold">登録済み講座</h2>
            <div className={listClass}>
              {courses.map((course: any) => (
                <div key={course.id} className="flex flex-col gap-3 px-4 py-4 sm:flex-row sm:items-center">
                  <BookOpen className="shrink-0 text-accent" size={20} aria-hidden />
                  <div className="min-w-0 flex-1">
                    <p className="font-bold">{course.name}</p>
                    <p className="mt-1 text-xs text-slate-500">{EIKEN_LEVEL_LABELS[course.level as EikenLevel] || course.level} ・ {course.academic_year}年度 ・ {course.status}</p>
                  </div>
                  <button
                    type="button"
                    disabled={saving}
                    onClick={() => updateResource('course', course.id, { status: course.status === 'active' ? 'archived' : 'active' }, course.status === 'active' ? '講座を停止しました。' : '講座を公開しました。')}
                    className={toggleClass}
                  >
                    {course.status === 'active' ? '停止する' : '公開する'}
                  </button>
                </div>
              ))}
              {!courses.length && <EmptyState className="m-4" title="講座を登録してください" />}
            </div>
          </section>
          <form
            className={`space-y-4 ${cardClass}`}
            onSubmit={(event: FormEvent<HTMLFormElement>) => {
              event.preventDefault();
              const form = event.currentTarget;
              const values = new FormData(form);
              createResource('course', {
                name: values.get('name'),
                level: values.get('level'),
                academic_year: values.get('academic_year'),
                school_id: values.get('school_id') || 'all',
                status: values.get('status'),
                description: values.get('description'),
              }, form);
            }}
          >
            <h2 className="font-bold">講座を追加</h2>
            <label className={labelClass}>講座名<input name="name" required className={`${fieldClass} mt-1`} /></label>
            <label className={labelClass}>級<select name="level" className={`${fieldClass} mt-1`}>{EIKEN_LEVELS.map(level => <option key={level} value={level}>{EIKEN_LEVEL_LABELS[level]}</option>)}</select></label>
            <label className={labelClass}>年度<input name="academic_year" type="number" defaultValue={new Date().getFullYear()} className={`${fieldClass} mt-1`} /></label>
            <label className={labelClass}>
              対象校舎
              {viewer.role === 'master' ? (
                <input name="school_id" defaultValue="all" className={`${fieldClass} mt-1`} />
              ) : (
                <select name="school_id" required className={`${fieldClass} mt-1`}>
                  <option value="">選択</option>
                  {viewerSchoolIds.map((schoolId: string) => (
                    <option key={schoolId} value={schoolId}>{schoolId}</option>
                  ))}
                </select>
              )}
            </label>
            <label className={labelClass}>公開状態<select name="status" className={`${fieldClass} mt-1`}><option value="draft">下書き</option><option value="active">公開</option></select></label>
            <label className={labelClass}>説明<textarea name="description" rows={3} className={`${fieldClass} mt-1`} /></label>
            <Button type="submit" fullWidth disabled={saving} icon={<Plus size={18} aria-hidden />}>追加</Button>
          </form>
        </div>
        <div className="grid gap-6 xl:grid-cols-[minmax(0,1fr)_360px]">
          <section>
            <h2 className="font-bold">フェーズ・Week・ユニット</h2>
            <div className={listClass}>
              {[...units].sort((a: any, b: any) => Number(a.sequence) - Number(b.sequence)).map((unit: any) => (
                <div key={unit.id} className="grid gap-2 px-4 py-4 sm:grid-cols-[100px_150px_minmax(0,1fr)]">
                  <p className="text-xs font-bold text-accent">Week {unit.week_no}</p>
                  <p className="text-xs font-bold text-slate-500">{unit.phase}</p>
                  <div>
                    <p className="font-bold">{unit.title}</p>
                    <p className="mt-1 text-xs text-slate-500">{courses.find((course: any) => course.id === unit.course_id)?.name || unit.course_id}</p>
                  </div>
                </div>
              ))}
              {!units.length && <EmptyState className="m-4" title="最初のユニットを登録してください" />}
            </div>
          </section>
          <form
            className={`space-y-4 ${cardClass}`}
            onSubmit={(event: FormEvent<HTMLFormElement>) => {
              event.preventDefault();
              const form = event.currentTarget;
              const values = new FormData(form);
              createResource('unit', {
                course_id: values.get('course_id'),
                title: values.get('title'),
                phase: values.get('phase'),
                week_no: values.get('week_no'),
                sequence: values.get('sequence'),
                status: values.get('status'),
                description: values.get('description'),
              }, form);
            }}
          >
            <h2 className="font-bold">ユニットを追加</h2>
            <label className={labelClass}>講座<select name="course_id" required className={`${fieldClass} mt-1`}><option value="">選択</option>{courses.map((course: any) => <option key={course.id} value={course.id}>{course.name}</option>)}</select></label>
            <label className={labelClass}>フェーズ<input name="phase" required placeholder="例: フェーズ1 基礎構築" className={`${fieldClass} mt-1`} /></label>
            <div className="grid grid-cols-2 gap-3">
              <label className={labelClass}>Week<input name="week_no" type="number" min="1" defaultValue="1" className={`${fieldClass} mt-1`} /></label>
              <label className={labelClass}>表示順<input name="sequence" type="number" min="0" defaultValue="1" className={`${fieldClass} mt-1`} /></label>
            </div>
            <label className={labelClass}>ユニット名<input name="title" required className={`${fieldClass} mt-1`} /></label>
            <label className={labelClass}>説明<textarea name="description" rows={3} className={`${fieldClass} mt-1`} /></label>
            <label className={labelClass}>状態<select name="status" className={`${fieldClass} mt-1`}><option value="draft">下書き</option><option value="published">公開</option></select></label>
            <Button type="submit" fullWidth disabled={saving} icon={<Plus size={18} aria-hidden />}>追加</Button>
          </form>
        </div>
        </div>
      )}

      {tab === 'tasks' && (
        <div className="grid gap-6 xl:grid-cols-[minmax(0,1fr)_400px]">
          <section>
            <h2 className="font-bold">学習の順番</h2>
            <div className={listClass}>
              {(dashboard?.tasks || []).sort((a: any, b: any) => Number(a.sequence) - Number(b.sequence)).map((task: any) => (
                <div key={task.id} className="flex items-center gap-3 px-4 py-4">
                  <span className="flex h-8 w-8 shrink-0 items-center justify-center rounded-full bg-slate-100 text-xs font-bold">{task.sequence}</span>
                  <div className="min-w-0 flex-1">
                    <p className="font-bold">{task.title}</p>
                    <p className="mt-1 text-xs text-slate-500">{task.task_type} ・ {task.estimated_minutes || 0}分 ・ {task.status}</p>
                  </div>
                  <button
                    type="button"
                    disabled={saving}
                    onClick={() => updateResource('task', task.id, { status: task.status === 'published' ? 'archived' : 'published' }, task.status === 'published' ? 'タスクを停止しました。' : 'タスクを公開しました。')}
                    className={toggleClass}
                  >
                    {task.status === 'published' ? '停止' : '公開'}
                  </button>
                </div>
              ))}
            </div>
          </section>
          <form
            className={`space-y-4 ${cardClass}`}
            onSubmit={(event: FormEvent<HTMLFormElement>) => {
              event.preventDefault();
              const form = event.currentTarget;
              const values = new FormData(form);
              const taskType = String(values.get('task_type') || '');
              createResource('task', {
                course_id: values.get('course_id'),
                unit_id: values.get('unit_id') || '',
                title: values.get('title'),
                description: values.get('description'),
                task_type: taskType,
                sequence: values.get('sequence'),
                estimated_minutes: values.get('estimated_minutes'),
                is_required: true,
                priority: values.get('priority'),
                status: values.get('status'),
                details: {
                  video_url: values.get('video_url') || '',
                  textbook_name: values.get('textbook_name') || '',
                  pages: values.get('pages') || '',
                  instructions: values.get('instructions') || '',
                  assignment_type: values.get('assignment_type') || 'opinion',
                  prompt: values.get('prompt') || '',
                  quiz_id: values.get('quiz_id') || '',
                },
              }, form);
            }}
          >
            <h2 className="font-bold">学習タスクを追加</h2>
            <label className={labelClass}>講座<select name="course_id" required className={`${fieldClass} mt-1`}><option value="">選択</option>{courses.map((course: any) => <option key={course.id} value={course.id}>{course.name}</option>)}</select></label>
            <label className={labelClass}>ユニット<select name="unit_id" className={`${fieldClass} mt-1`}><option value="">未設定</option>{units.map((unit: any) => <option key={unit.id} value={unit.id}>Week {unit.week_no} ・ {unit.title}</option>)}</select></label>
            <label className={labelClass}>種類<select name="task_type" className={`${fieldClass} mt-1`}>{EIKEN_TASK_TYPES.map(type => <option key={type} value={type}>{type}</option>)}</select></label>
            <label className={labelClass}>タイトル<input name="title" required className={`${fieldClass} mt-1`} /></label>
            <div className="grid grid-cols-2 gap-3">
              <label className={labelClass}>順番<input name="sequence" type="number" defaultValue="1" className={`${fieldClass} mt-1`} /></label>
              <label className={labelClass}>目安分<input name="estimated_minutes" type="number" defaultValue="15" className={`${fieldClass} mt-1`} /></label>
            </div>
            <label className={labelClass}>優先度<select name="priority" className={`${fieldClass} mt-1`}><option value="required">必須</option><option value="recommended">推奨</option><option value="optional">任意</option></select></label>
            <label className={labelClass}>説明<textarea name="description" rows={3} className={`${fieldClass} mt-1`} /></label>
            <details className="border-y border-slate-200 py-3">
              <summary className="cursor-pointer text-sm font-bold">種類別の詳細</summary>
              <div className="mt-3 space-y-3">
                <label className={labelClass}>動画URL<input name="video_url" className={`${fieldClass} mt-1`} /></label>
                <label className={labelClass}>テキスト名<input name="textbook_name" className={`${fieldClass} mt-1`} /></label>
                <label className={labelClass}>ページ<input name="pages" className={`${fieldClass} mt-1`} /></label>
                <label className={labelClass}>取り組み方<textarea name="instructions" rows={2} className={`${fieldClass} mt-1`} /></label>
                <label className={labelClass}>AI課題種別<select name="assignment_type" className={`${fieldClass} mt-1`}><option value="opinion">意見論述</option><option value="summary">要約</option></select></label>
                <label className={labelClass}>問題文<textarea name="prompt" rows={3} className={`${fieldClass} mt-1`} /></label>
                <label className={labelClass}>確認テスト
                  <select name="quiz_id" className={`${fieldClass} mt-1`}>
                    <option value="">使用しない</option>
                    {quizzes.map((quiz: any) => <option key={quiz.id} value={quiz.id}>{quiz.title}</option>)}
                  </select>
                </label>
              </div>
            </details>
            <label className={labelClass}>状態<select name="status" className={`${fieldClass} mt-1`}><option value="draft">下書き</option><option value="published">公開</option></select></label>
            <Button type="submit" fullWidth disabled={saving} icon={<Plus size={18} aria-hidden />}>追加</Button>
          </form>
        </div>
      )}

      {tab === 'assessments' && (
        <div className="space-y-8">
          <section>
            <div className="flex items-center gap-2">
              <ClipboardCheck className="text-accent" size={20} aria-hidden />
              <h2 className="font-bold">確認テスト</h2>
            </div>
            <div className="mt-3 grid gap-6 xl:grid-cols-[minmax(0,1fr)_400px]">
              <div className="divide-y divide-slate-200 overflow-hidden rounded-card border border-line bg-surface">
                {quizzes.map((quiz: any) => (
                  <div key={quiz.id} className="flex items-center gap-3 px-4 py-4">
                    <div className="min-w-0 flex-1">
                      <p className="font-bold">{quiz.title}</p>
                      <p className="mt-1 text-xs text-slate-500">最大{quiz.max_attempts}回 ・ {quiz.status}</p>
                    </div>
                    <button
                      type="button"
                      disabled={saving}
                      onClick={() => updateResource('quiz', quiz.id, { status: quiz.status === 'published' ? 'archived' : 'published' }, quiz.status === 'published' ? '確認テストを停止しました。' : '確認テストを公開しました。')}
                      className={toggleClass}
                    >
                      {quiz.status === 'published' ? '停止' : '公開'}
                    </button>
                  </div>
                ))}
                {!quizzes.length && <EmptyState className="m-4" title="確認テストはまだありません" />}
              </div>
              <form
                className={`space-y-4 ${cardClass}`}
                onSubmit={(event: FormEvent<HTMLFormElement>) => {
                  event.preventDefault();
                  const form = event.currentTarget;
                  const values = new FormData(form);
                  createResource('quiz', {
                    course_id: values.get('course_id'),
                    title: values.get('title'),
                    quiz_type: values.get('quiz_type'),
                    max_attempts: values.get('max_attempts'),
                    status: values.get('status'),
                  }, form);
                }}
              >
                <h3 className="font-bold">確認テストを追加</h3>
                <label className={labelClass}>講座<select name="course_id" required className={`${fieldClass} mt-1`}><option value="">選択</option>{courses.map((course: any) => <option key={course.id} value={course.id}>{course.name}</option>)}</select></label>
                <label className={labelClass}>タイトル<input name="title" required className={`${fieldClass} mt-1`} /></label>
                <div className="grid grid-cols-2 gap-3">
                  <label className={labelClass}>種別<select name="quiz_type" className={`${fieldClass} mt-1`}><option value="periodic">確認</option><option value="diagnostic">診断</option><option value="completion">修了</option></select></label>
                  <label className={labelClass}>受験上限<input name="max_attempts" type="number" min="1" defaultValue="1" className={`${fieldClass} mt-1`} /></label>
                </div>
                <label className={labelClass}>状態<select name="status" className={`${fieldClass} mt-1`}><option value="draft">下書き</option><option value="published">公開</option></select></label>
                <Button type="submit" fullWidth disabled={saving} icon={<Plus size={18} aria-hidden />}>追加</Button>
              </form>
            </div>
          </section>

          <section className="grid gap-6 lg:grid-cols-2">
            <form
              className={`space-y-4 ${cardClass}`}
              onSubmit={(event: FormEvent<HTMLFormElement>) => {
                event.preventDefault();
                const form = event.currentTarget;
                const values = new FormData(form);
                const questionType = String(values.get('question_type'));
                const answers = String(values.get('correct_answer') || '').split(/\r?\n/).map(value => value.trim()).filter(Boolean);
                createResource('question', {
                  quiz_id: values.get('quiz_id'),
                  question: values.get('question'),
                  question_type: questionType,
                  options: String(values.get('options') || '').split(/\r?\n/).map(value => value.trim()).filter(Boolean),
                  correct_answer: questionType === 'multiple_choice' ? answers : (answers[0] || ''),
                  explanation: values.get('explanation'),
                  skill_tag: values.get('skill_tag') || 'general',
                  sequence: values.get('sequence'),
                }, form);
              }}
            >
              <h3 className="font-bold">設問を追加</h3>
              <label className={labelClass}>確認テスト<select name="quiz_id" required className={`${fieldClass} mt-1`}><option value="">選択</option>{quizzes.map((quiz: any) => <option key={quiz.id} value={quiz.id}>{quiz.title}</option>)}</select></label>
              <label className={labelClass}>問題文<textarea name="question" rows={3} required className={`${fieldClass} mt-1`} /></label>
              <label className={labelClass}>回答形式<select name="question_type" className={`${fieldClass} mt-1`}><option value="single_choice">一つ選択</option><option value="multiple_choice">複数選択</option><option value="short_text">短文入力</option></select></label>
              <label className={labelClass}>選択肢（1行に1つ）<textarea name="options" rows={4} className={`${fieldClass} mt-1`} /></label>
              <label className={labelClass}>正解（複数正解は1行に1つ）<textarea name="correct_answer" rows={2} required className={`${fieldClass} mt-1`} /></label>
              <div className="grid grid-cols-2 gap-3">
                <label className={labelClass}>技能タグ<input name="skill_tag" defaultValue="general" className={`${fieldClass} mt-1`} /></label>
                <label className={labelClass}>順番<input name="sequence" type="number" min="0" defaultValue="1" className={`${fieldClass} mt-1`} /></label>
              </div>
              <label className={labelClass}>解説<textarea name="explanation" rows={2} className={`${fieldClass} mt-1`} /></label>
              <Button type="submit" fullWidth disabled={saving || !quizzes.length} icon={<Plus size={18} aria-hidden />}>追加</Button>
            </form>

            <div>
              <div className="flex items-center gap-2">
                <Megaphone className="text-accent" size={20} aria-hidden />
                <h3 className="font-bold">お知らせ</h3>
              </div>
              <div className={listClass}>
                {announcements.map((announcement: any) => (
                  <div key={announcement.id} className="flex items-start gap-3 px-4 py-4">
                    <div className="min-w-0 flex-1">
                      <p className="font-bold">{announcement.title}</p>
                      <p className="mt-1 line-clamp-2 text-sm text-slate-600">{announcement.body}</p>
                    </div>
                    <button
                      type="button"
                      disabled={saving}
                      onClick={() => updateResource('announcement', announcement.id, { status: announcement.status === 'published' ? 'archived' : 'published' }, announcement.status === 'published' ? 'お知らせを停止しました。' : 'お知らせを公開しました。')}
                      className={toggleClass}
                    >
                      {announcement.status === 'published' ? '停止' : '公開'}
                    </button>
                  </div>
                ))}
              </div>
              <form
                className={`mt-5 space-y-4 ${cardClass}`}
                onSubmit={(event: FormEvent<HTMLFormElement>) => {
                  event.preventDefault();
                  const form = event.currentTarget;
                  const values = new FormData(form);
                  createResource('announcement', {
                    course_id: values.get('course_id'),
                    title: values.get('title'),
                    body: values.get('body'),
                    status: values.get('status'),
                  }, form);
                }}
              >
                <h3 className="font-bold">お知らせを追加</h3>
                <label className={labelClass}>講座<select name="course_id" required className={`${fieldClass} mt-1`}><option value="">選択</option>{courses.map((course: any) => <option key={course.id} value={course.id}>{course.name}</option>)}</select></label>
                <label className={labelClass}>タイトル<input name="title" required className={`${fieldClass} mt-1`} /></label>
                <label className={labelClass}>本文<textarea name="body" rows={4} required className={`${fieldClass} mt-1`} /></label>
                <label className={labelClass}>状態<select name="status" className={`${fieldClass} mt-1`}><option value="draft">下書き</option><option value="published">公開</option></select></label>
                <Button type="submit" fullWidth disabled={saving} icon={<Plus size={18} aria-hidden />}>追加</Button>
              </form>
            </div>
          </section>
        </div>
      )}

      {tab === 'lessons' && (
        <div className="grid gap-6 xl:grid-cols-[minmax(0,1fr)_400px]">
          <div><EikenCalendar events={calendarEvents} /></div>
          <form
            className={`space-y-4 ${cardClass}`}
            onSubmit={(event: FormEvent<HTMLFormElement>) => {
              event.preventDefault();
              const form = event.currentTarget;
              const values = new FormData(form);
              createResource('lesson', {
                course_id: values.get('course_id'),
                title: values.get('title'),
                school_id: values.get('school_id') || 'all',
                start_at: new Date(String(values.get('start_at'))).toISOString(),
                end_at: new Date(String(values.get('end_at'))).toISOString(),
                teacher_ids: values.get('teacher_id') ? [values.get('teacher_id')] : [],
                meeting_id: values.get('meeting_id'),
                join_open_before_minutes: 15,
                join_close_after_minutes: 30,
                status: values.get('status'),
              }, form);
            }}
          >
            <h2 className="font-bold">LIVE授業を追加</h2>
            <label className={labelClass}>講座<select name="course_id" required className={`${fieldClass} mt-1`}><option value="">選択</option>{courses.map((course: any) => <option key={course.id} value={course.id}>{course.name}</option>)}</select></label>
            <label className={labelClass}>授業名<input name="title" required className={`${fieldClass} mt-1`} /></label>
            <label className={labelClass}>開始<input name="start_at" type="datetime-local" required className={`${fieldClass} mt-1`} /></label>
            <label className={labelClass}>終了<input name="end_at" type="datetime-local" required className={`${fieldClass} mt-1`} /></label>
            <label className={labelClass}>担当講師<select name="teacher_id" className={`${fieldClass} mt-1`}><option value="">未設定</option>{teachers.map((teacher: any) => <option key={teacher.id} value={teacher.id}>{teacher.name}</option>)}</select></label>
            <label className={labelClass}>Zoom Meeting ID<input name="meeting_id" className={`${fieldClass} mt-1`} /></label>
            <label className={labelClass}>状態<select name="status" className={`${fieldClass} mt-1`}><option value="draft">下書き</option><option value="scheduled">公開予定</option></select></label>
            <Button type="submit" fullWidth disabled={saving} icon={<Plus size={18} aria-hidden />}>追加</Button>
          </form>
        </div>
      )}

      {tab === 'enrollments' && (
        <div className="space-y-8">
        <div className="grid gap-6 lg:grid-cols-2">
          <form
            className={`space-y-4 ${cardClass}`}
            onSubmit={(event: FormEvent<HTMLFormElement>) => {
              event.preventDefault();
              const form = event.currentTarget;
              const values = new FormData(form);
              createResource('enrollment', {
                user_id: values.get('student_id'),
                course_id: values.get('course_id'),
                school_id: values.get('school_id') || '',
                status: 'active',
              }, form);
            }}
          >
            <h2 className="font-bold">生徒を受講登録</h2>
            <label className={labelClass}>生徒<select name="student_id" required className={`${fieldClass} mt-1`}><option value="">選択</option>{students.map((student: any) => <option key={student.id} value={student.id}>{student.name} {student.school ? `(${student.school})` : ''}</option>)}</select></label>
            <label className={labelClass}>講座<select name="course_id" required className={`${fieldClass} mt-1`}><option value="">選択</option>{courses.map((course: any) => <option key={course.id} value={course.id}>{course.name}</option>)}</select></label>
            <label className={labelClass}>校舎<input name="school_id" className={`${fieldClass} mt-1`} /></label>
            <Button type="submit" fullWidth disabled={saving} icon={<Plus size={18} aria-hidden />}>受講登録</Button>
          </form>
          <form
            className={`space-y-4 ${cardClass}`}
            onSubmit={(event: FormEvent<HTMLFormElement>) => {
              event.preventDefault();
              const form = event.currentTarget;
              const values = new FormData(form);
              createResource('teacher_assignment', {
                teacher_id: values.get('teacher_id'),
                course_id: values.get('course_id'),
                school_id: values.get('school_id') || 'all',
                status: 'active',
              }, form);
            }}
          >
            <h2 className="font-bold">講師を担当登録</h2>
            <label className={labelClass}>講師<select name="teacher_id" required className={`${fieldClass} mt-1`}><option value="">選択</option>{teachers.map((teacher: any) => <option key={teacher.id} value={teacher.id}>{teacher.name}</option>)}</select></label>
            <label className={labelClass}>講座<select name="course_id" required className={`${fieldClass} mt-1`}><option value="">選択</option>{courses.map((course: any) => <option key={course.id} value={course.id}>{course.name}</option>)}</select></label>
            <label className={labelClass}>校舎<input name="school_id" defaultValue="all" className={`${fieldClass} mt-1`} /></label>
            <Button type="submit" fullWidth disabled={saving} icon={<Plus size={18} aria-hidden />}>担当登録</Button>
          </form>
        </div>
        <div className="grid gap-8 xl:grid-cols-2">
          <section>
            <h2 className="font-bold">受講状況</h2>
            <div className={listClass}>
              {enrollments.map((enrollment: any) => {
                const student = students.find((item: any) => item.id === enrollment.user_id);
                const course = courses.find((item: any) => item.id === enrollment.course_id);
                const active = enrollment.status === 'active';
                return (
                  <div key={enrollment.id} className="flex flex-col gap-3 px-4 py-4 sm:flex-row sm:items-center">
                    <div className="min-w-0 flex-1">
                      <p className="font-bold">{student?.name || enrollment.user_id}</p>
                      <p className="mt-1 text-xs text-slate-500">
                        {course?.name || enrollment.course_id} ・ {active ? '受講中' : '停止中'}
                      </p>
                    </div>
                    <button
                      type="button"
                      disabled={saving}
                      onClick={() => updateResource(
                        'enrollment',
                        enrollment.id,
                        { status: active ? 'cancelled' : 'active' },
                        active ? '受講を停止しました。' : '受講を再開しました。',
                      )}
                      className={toggleClass}
                    >
                      {active ? '受講を停止' : '受講を再開'}
                    </button>
                  </div>
                );
              })}
              {!enrollments.length && <EmptyState className="m-4" title="受講登録はありません" />}
            </div>
          </section>

          <section>
            <h2 className="font-bold">講師の担当状況</h2>
            <div className={listClass}>
              {teacherAssignments.map((assignment: any) => {
                const teacher = teachers.find((item: any) => item.id === assignment.teacher_id);
                const course = courses.find((item: any) => item.id === assignment.course_id);
                const active = assignment.status === 'active';
                return (
                  <div key={assignment.id} className="flex flex-col gap-3 px-4 py-4 sm:flex-row sm:items-center">
                    <div className="min-w-0 flex-1">
                      <p className="font-bold">{teacher?.name || assignment.teacher_id}</p>
                      <p className="mt-1 text-xs text-slate-500">
                        {course?.name || assignment.course_id} ・ {active ? '担当中' : '停止中'}
                      </p>
                    </div>
                    <button
                      type="button"
                      disabled={saving}
                      onClick={() => updateResource(
                        'teacher_assignment',
                        assignment.id,
                        { status: active ? 'inactive' : 'active' },
                        active ? '担当を停止しました。' : '担当を再開しました。',
                      )}
                      className={toggleClass}
                    >
                      {active ? '担当を停止' : '担当を再開'}
                    </button>
                  </div>
                );
              })}
              {!teacherAssignments.length && <EmptyState className="m-4" title="担当登録はありません" />}
            </div>
          </section>
        </div>
        </div>
      )}
    </div>
  );
}
