'use client';

import { FormEvent, useCallback, useEffect, useMemo, useState } from 'react';
import Link from 'next/link';
import {
  AlertCircle,
  ArrowLeft,
  BookOpenCheck,
  CheckCircle2,
  ClipboardCheck,
  FilePenLine,
  Loader2,
  MessageSquareText,
  Send,
  UserRound,
  Video,
} from 'lucide-react';
import { useEikenApi } from '@/app/eiken/useEikenApi';

type EikenStudentDetailProps = {
  studentId: string;
  courseId?: string;
  backHref: string;
};

const dateTimeLabel = (value: unknown) => {
  if (!value) return '記録なし';
  const date = new Date(String(value));
  return Number.isNaN(date.getTime())
    ? String(value)
    : new Intl.DateTimeFormat('ja-JP', { dateStyle: 'medium', timeStyle: 'short' }).format(date);
};

const taskTypeLabel: Record<string, string> = {
  video: '映像授業',
  textbook: 'テキスト課題',
  live_lesson: 'LIVE授業',
  quiz: '確認テスト',
  ai_writing: 'AI添削',
  reflection: '振り返り',
  announcement: 'お知らせ',
};

const understandingLabel: Record<string, string> = {
  good: '理解できた',
  uncertain: '少し不安',
  difficult: 'よく分からなかった',
};

export default function EikenStudentDetail({
  studentId,
  courseId,
  backHref,
}: EikenStudentDetailProps) {
  const api = useEikenApi();
  const [detail, setDetail] = useState<any>(null);
  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState('');
  const [message, setMessage] = useState('');

  const load = useCallback(async () => {
    setLoading(true);
    setError('');
    try {
      const query = courseId ? `?course_id=${encodeURIComponent(courseId)}` : '';
      const data = await api<any>(`/api/eiken/students/${encodeURIComponent(studentId)}${query}`);
      setDetail(data.detail);
    } catch (loadError) {
      setError(loadError instanceof Error ? loadError.message : '受講生情報を取得できませんでした。');
    } finally {
      setLoading(false);
    }
  }, [api, courseId, studentId]);

  useEffect(() => {
    load();
  }, [load]);

  const taskGroups = useMemo(() => {
    const tasks = detail?.tasks || [];
    return {
      video: tasks.filter((task: any) => task.task_type === 'video'),
      textbook: tasks.filter((task: any) => task.task_type === 'textbook'),
      other: tasks.filter((task: any) => !['video', 'textbook'].includes(task.task_type)),
    };
  }, [detail?.tasks]);

  const saveFollowUp = async (event: FormEvent<HTMLFormElement>) => {
    event.preventDefault();
    const form = event.currentTarget;
    const values = new FormData(form);
    setSaving(true);
    setError('');
    setMessage('');
    try {
      await api(`/api/eiken/students/${encodeURIComponent(studentId)}/follow-ups`, {
        method: 'POST',
        body: JSON.stringify({
          course_id: detail.course.id,
          note: values.get('note'),
          status: values.get('status'),
        }),
      });
      form.reset();
      setMessage('フォロー記録を保存しました。');
      await load();
    } catch (saveError) {
      setError(saveError instanceof Error ? saveError.message : 'フォロー記録を保存できませんでした。');
    } finally {
      setSaving(false);
    }
  };

  if (loading) {
    return <div className="flex min-h-[60vh] items-center justify-center"><Loader2 className="animate-spin text-emerald-600" /></div>;
  }

  if (!detail) {
    return (
      <div className="mx-auto max-w-5xl px-4 py-10">
        <Link href={backHref} className="inline-flex items-center gap-2 text-sm font-bold text-slate-600"><ArrowLeft size={17} />一覧へ戻る</Link>
        <div className="mt-6 border border-red-200 bg-red-50 p-5 text-sm font-bold text-red-700">{error || '受講生情報がありません。'}</div>
      </div>
    );
  }

  const renderTaskRows = (tasks: any[]) => (
    <div className="divide-y divide-slate-200">
      {tasks.map(task => (
        <div key={task.id} className="grid gap-2 px-4 py-3 sm:grid-cols-[minmax(0,1fr)_130px_150px] sm:items-center">
          <div>
            <p className="font-bold">{task.title}</p>
            <p className="mt-1 text-xs text-slate-500">{taskTypeLabel[task.task_type] || task.task_type}</p>
          </div>
          <span className={`w-fit rounded-full px-2.5 py-1 text-xs font-black ${
            task.progress?.status === 'completed'
              ? 'bg-emerald-100 text-emerald-700'
              : task.progress?.status === 'in_progress'
                ? 'bg-indigo-100 text-indigo-700'
                : 'bg-slate-100 text-slate-500'
          }`}>
            {task.progress?.status === 'completed' ? '完了' : task.progress?.status === 'in_progress' ? '取組中' : '未着手'}
          </span>
          <p className={`text-xs font-bold ${task.progress?.understanding === 'difficult' ? 'text-amber-700' : 'text-slate-500'}`}>
            {understandingLabel[task.progress?.understanding] || '-'}
          </p>
        </div>
      ))}
      {!tasks.length && <p className="px-4 py-6 text-center text-sm text-slate-500">該当するタスクはありません。</p>}
    </div>
  );

  return (
    <div className="mx-auto max-w-6xl px-4 py-8">
      <Link href={backHref} className="inline-flex items-center gap-2 text-sm font-bold text-slate-600 hover:text-emerald-700">
        <ArrowLeft size={17} />
        受講生一覧へ戻る
      </Link>

      <header className="mt-5 border-b border-slate-200 pb-6">
        <div className="flex items-start gap-3">
          <div className="flex h-12 w-12 shrink-0 items-center justify-center rounded-lg bg-emerald-600 text-white"><UserRound size={24} /></div>
          <div>
            <p className="text-xs font-black text-emerald-700">Booster受講生</p>
            <h1 className="text-2xl font-black">{detail.student.name}</h1>
            <p className="mt-1 text-sm text-slate-500">{detail.student.grade || '学年未登録'} ・ {detail.student.school || '校舎未登録'} ・ {detail.course.name}</p>
          </div>
        </div>
      </header>

      {message && <div className="mt-5 border border-emerald-200 bg-emerald-50 p-4 text-sm font-bold text-emerald-800">{message}</div>}
      {error && <div className="mt-5 border border-red-200 bg-red-50 p-4 text-sm font-bold text-red-700">{error}</div>}

      <section className="mt-6 grid gap-4 sm:grid-cols-2 xl:grid-cols-4">
        <div className="border-t-4 border-emerald-500 bg-white p-5 shadow-sm">
          <CheckCircle2 className="text-emerald-600" size={21} />
          <p className="mt-3 text-xs font-bold text-slate-500">必須タスク進捗</p>
          <p className="mt-1 text-3xl font-black">{detail.summary.completion_rate}%</p>
          <p className="mt-1 text-xs text-slate-500">{detail.summary.required_completed} / {detail.summary.required_total}件</p>
        </div>
        <div className="border-t-4 border-indigo-500 bg-white p-5 shadow-sm">
          <ClipboardCheck className="text-indigo-600" size={21} />
          <p className="mt-3 text-xs font-bold text-slate-500">最新テスト</p>
          <p className="mt-1 text-3xl font-black">{detail.summary.latest_quiz_percentage ?? '--'}<span className="text-sm">%</span></p>
        </div>
        <div className="border-t-4 border-cyan-500 bg-white p-5 shadow-sm">
          <FilePenLine className="text-cyan-600" size={21} />
          <p className="mt-3 text-xs font-bold text-slate-500">AI添削完了</p>
          <p className="mt-1 text-3xl font-black">{detail.summary.writing_completed}<span className="text-sm">件</span></p>
        </div>
        <div className="border-t-4 border-slate-500 bg-white p-5 shadow-sm">
          <BookOpenCheck className="text-slate-600" size={21} />
          <p className="mt-3 text-xs font-bold text-slate-500">最終学習</p>
          <p className="mt-2 text-sm font-black">{dateTimeLabel(detail.summary.last_learning_at)}</p>
        </div>
      </section>

      <section className="mt-8 border-l-4 border-amber-500 bg-amber-50 p-5">
        <div className="flex items-center gap-2 text-amber-800"><AlertCircle size={20} /><h2 className="font-black">確認ポイント</h2></div>
        <div className="mt-3 flex flex-wrap gap-2">
          {(detail.summary.follow_up_reasons || []).map((reason: string) => <span key={reason} className="rounded-full bg-white px-3 py-1.5 text-xs font-bold text-amber-800">{reason}</span>)}
          {!detail.summary.follow_up_reasons?.length && <span className="text-sm font-bold text-emerald-700">現在は順調です。</span>}
        </div>
      </section>

      <div className="mt-9 grid gap-8 xl:grid-cols-[minmax(0,1.5fr)_minmax(320px,0.7fr)]">
        <div className="space-y-8">
          <section className="border-y border-slate-200 bg-white">
            <div className="flex items-center gap-2 border-b border-slate-200 px-4 py-3"><Video className="text-emerald-600" size={19} /><h2 className="font-black">映像授業</h2></div>
            {renderTaskRows(taskGroups.video)}
          </section>
          <section className="border-y border-slate-200 bg-white">
            <div className="flex items-center gap-2 border-b border-slate-200 px-4 py-3"><BookOpenCheck className="text-emerald-600" size={19} /><h2 className="font-black">テキスト課題</h2></div>
            {renderTaskRows(taskGroups.textbook)}
          </section>
          <section className="border-y border-slate-200 bg-white">
            <div className="flex items-center gap-2 border-b border-slate-200 px-4 py-3"><ClipboardCheck className="text-emerald-600" size={19} /><h2 className="font-black">その他の学習</h2></div>
            {renderTaskRows(taskGroups.other)}
          </section>

          <section>
            <h2 className="font-black">確認テスト履歴・技能別スコア</h2>
            <div className="mt-3 overflow-x-auto border-y border-slate-200 bg-white">
              <table className="w-full min-w-[620px] text-left text-sm">
                <thead className="bg-slate-50 text-xs text-slate-500"><tr><th className="px-4 py-3">受験日</th><th className="px-4 py-3">結果</th><th className="px-4 py-3">技能別</th></tr></thead>
                <tbody className="divide-y divide-slate-200">
                  {(detail.quiz_results || []).map((result: any) => (
                    <tr key={result.id}>
                      <td className="px-4 py-3">{dateTimeLabel(result.submitted_at)}</td>
                      <td className="px-4 py-3 font-black">{result.percentage}%</td>
                      <td className="px-4 py-3 text-xs">{Object.entries(result.skill_scores || {}).map(([skill, score]) => `${skill}: ${score}%`).join(' / ') || '-'}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
              {!detail.quiz_results?.length && <p className="py-6 text-center text-sm text-slate-500">確認テストの受験履歴はありません。</p>}
            </div>
          </section>

          <section>
            <h2 className="font-black">AI添削履歴</h2>
            <div className="mt-3 divide-y divide-slate-200 border-y border-slate-200 bg-white">
              {(detail.writing_submissions || []).map((submission: any) => (
                <div key={submission.id} className="px-4 py-4">
                  <div className="flex flex-wrap items-center justify-between gap-2">
                    <p className="font-bold">{submission.assignment_type === 'summary' ? '要約課題' : '意見論述'}</p>
                    <span className={`rounded-full px-2.5 py-1 text-xs font-black ${submission.evaluation_status === 'completed' ? 'bg-emerald-100 text-emerald-700' : submission.evaluation_status === 'failed' ? 'bg-red-100 text-red-700' : 'bg-slate-100 text-slate-600'}`}>{submission.evaluation_status}</span>
                  </div>
                  <p className="mt-1 text-xs text-slate-500">{dateTimeLabel(submission.submitted_at)}</p>
                  {submission.scores && <p className="mt-2 text-sm">{Object.entries(submission.scores).map(([key, score]) => `${key}: ${score}/4`).join(' / ')}</p>}
                  {submission.error_message && <p className="mt-2 text-xs font-bold text-red-700">{submission.error_message}</p>}
                </div>
              ))}
              {!detail.writing_submissions?.length && <p className="px-4 py-6 text-center text-sm text-slate-500">AI添削の提出履歴はありません。</p>}
            </div>
          </section>
        </div>

        <aside className="space-y-7">
          <section className="bg-white p-5 shadow-sm">
            <div className="flex items-center gap-2"><MessageSquareText className="text-emerald-600" size={20} /><h2 className="font-black">フォローを記録</h2></div>
            <form onSubmit={saveFollowUp} className="mt-4 space-y-3">
              <label className="block text-xs font-black text-slate-600">対応状況
                <select name="status" className="mt-1 w-full rounded-lg border border-slate-300 bg-white px-3 py-2.5 text-sm">
                  <option value="noted">確認メモ</option>
                  <option value="contacted">本人・保護者へ連絡済み</option>
                  <option value="resolved">対応完了</option>
                </select>
              </label>
              <label className="block text-xs font-black text-slate-600">内容
                <textarea name="note" rows={5} required className="mt-1 w-full rounded-lg border border-slate-300 p-3 text-sm outline-none focus:border-emerald-600" />
              </label>
              <button disabled={saving} className="inline-flex w-full items-center justify-center gap-2 rounded-lg bg-emerald-600 px-4 py-3 text-sm font-black text-white disabled:opacity-50">
                {saving ? <Loader2 className="animate-spin" size={17} /> : <Send size={17} />}
                記録する
              </button>
            </form>
          </section>

          <section>
            <h2 className="font-black">フォロー履歴</h2>
            <div className="mt-3 divide-y divide-slate-200 border-y border-slate-200 bg-white">
              {(detail.follow_up_records || []).map((record: any) => (
                <div key={record.id} className="px-4 py-4">
                  <div className="flex items-center justify-between gap-2">
                    <span className="text-xs font-black text-emerald-700">{record.status}</span>
                    <span className="text-xs text-slate-400">{dateTimeLabel(record.created_at)}</span>
                  </div>
                  <p className="mt-2 whitespace-pre-wrap text-sm leading-6">{record.note}</p>
                </div>
              ))}
              {!detail.follow_up_records?.length && <p className="px-4 py-6 text-center text-sm text-slate-500">フォロー記録はまだありません。</p>}
            </div>
          </section>

          <section>
            <h2 className="font-black">LIVE授業出席</h2>
            <div className="mt-3 divide-y divide-slate-200 border-y border-slate-200 bg-white">
              {(detail.attendance || []).map((item: any) => (
                <div key={item.id} className="flex items-center justify-between gap-3 px-4 py-3 text-sm">
                  <span>{dateTimeLabel(item.lesson_date || item.joined_at || item.created_at)}</span>
                  <span className="font-black">{item.status || (item.attended ? '出席' : '欠席')}</span>
                </div>
              ))}
              {!detail.attendance?.length && <p className="px-4 py-6 text-center text-sm text-slate-500">出席記録はありません。</p>}
            </div>
          </section>
        </aside>
      </div>
    </div>
  );
}
