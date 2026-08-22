'use client';

import { useCallback, useEffect, useMemo, useState } from 'react';
import Link from 'next/link';
import { ArrowLeft, CheckCircle2, ExternalLink, Loader2, Sparkles } from 'lucide-react';
import { useEikenApi } from '@/app/eiken/useEikenApi';

const youtubeEmbedUrl = (value: string) => {
  try {
    const url = new URL(value);
    if (url.hostname.includes('youtu.be')) return `https://www.youtube-nocookie.com/embed/${url.pathname.slice(1)}`;
    const id = url.searchParams.get('v');
    if (url.hostname.includes('youtube.com') && id) return `https://www.youtube-nocookie.com/embed/${id}`;
  } catch {}
  return '';
};

export default function EikenTaskPage({ params }: { params: { id: string } }) {
  const api = useEikenApi();
  const [task, setTask] = useState<any>(null);
  const [progress, setProgress] = useState<any>(null);
  const [quiz, setQuiz] = useState<any>(null);
  const [answers, setAnswers] = useState<Record<string, string | string[]>>({});
  const [quizResult, setQuizResult] = useState<any>(null);
  const [writingAnswer, setWritingAnswer] = useState('');
  const [writingResult, setWritingResult] = useState<any>(null);
  const [writingStatus, setWritingStatus] = useState('');
  const [understanding, setUnderstanding] = useState('good');
  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState('');

  const load = useCallback(async () => {
    setLoading(true);
    try {
      const data = await api<any>(`/api/eiken/tasks/${params.id}`);
      setTask(data.task);
      setProgress(data.progress);
      setUnderstanding(data.progress?.understanding || 'good');
      if (data.writing_submission) {
        setWritingAnswer(data.writing_submission.original_answer || '');
        setWritingStatus(data.writing_submission.evaluation_status || '');
        if (data.writing_submission.evaluation_status === 'completed') {
          setWritingResult(data.writing_submission);
        }
      }
      if (data.latest_quiz_result) {
        setQuizResult(data.latest_quiz_result);
      }
      if (data.task.task_type === 'quiz' && data.task.details?.quiz_id) {
        const quizData = await api<any>(`/api/eiken/quizzes/${data.task.details.quiz_id}`);
        setQuiz(quizData);
      }
    } catch (loadError) {
      setError(loadError instanceof Error ? loadError.message : '学習内容を取得できませんでした。');
    } finally {
      setLoading(false);
    }
  }, [api, params.id]);

  useEffect(() => {
    load();
  }, [load]);

  useEffect(() => {
    if (!task || progress?.status) return;
    api(`/api/eiken/tasks/${params.id}/progress`, {
      method: 'POST',
      body: JSON.stringify({ action: 'start' }),
    }).catch(() => undefined);
  }, [api, params.id, progress?.status, task]);

  const videoUrl = String(task?.details?.video_url || '');
  const embedUrl = useMemo(() => youtubeEmbedUrl(videoUrl), [videoUrl]);

  const saveProgress = async (action: 'complete' | 'understanding') => {
    setSaving(true);
    setError('');
    setWritingStatus('processing');
    try {
      await api(`/api/eiken/tasks/${params.id}/progress`, {
        method: 'POST',
        body: JSON.stringify({ action, ...(action === 'understanding' ? { understanding } : {}) }),
      });
      setProgress((current: any) => ({
        ...current,
        ...(action === 'complete' ? { status: 'completed' } : { understanding }),
      }));
    } catch (saveError) {
      setError(saveError instanceof Error ? saveError.message : '保存できませんでした。');
    } finally {
      setSaving(false);
    }
  };

  const toggleMultipleAnswer = (questionId: string, option: string) => {
    setAnswers(current => {
      const selected = Array.isArray(current[questionId]) ? current[questionId] as string[] : [];
      return {
        ...current,
        [questionId]: selected.includes(option)
          ? selected.filter(value => value !== option)
          : [...selected, option],
      };
    });
  };

  const submitQuiz = async () => {
    setSaving(true);
    setError('');
    try {
      const result = await api<any>(`/api/eiken/quizzes/${quiz.quiz.id}/submit`, {
        method: 'POST',
        body: JSON.stringify({ answers }),
      });
      setQuizResult(result);
      if (result.ok) await saveProgress('complete');
    } catch (submitError) {
      setError(submitError instanceof Error ? submitError.message : '確認テストを提出できませんでした。');
      setSaving(false);
    }
  };

  const submitWriting = async () => {
    setSaving(true);
    setError('');
    try {
      const result = await api<any>(`/api/eiken/writing/${params.id}/submit`, {
        method: 'POST',
        body: JSON.stringify({ answer: writingAnswer }),
      });
      setWritingResult(result.evaluation);
      setWritingStatus('completed');
      await saveProgress('complete');
    } catch (submitError) {
      setWritingStatus('failed');
      setError(submitError instanceof Error ? submitError.message : 'AI添削へ提出できませんでした。');
      setSaving(false);
    }
  };

  if (loading) return <main className="flex min-h-[60vh] items-center justify-center"><Loader2 className="animate-spin text-emerald-600" /></main>;

  return (
    <main className="mx-auto max-w-3xl px-4 py-6 sm:py-10">
      <Link href="/eiken/student" className="inline-flex items-center gap-2 text-sm font-bold text-slate-600 hover:text-emerald-700">
        <ArrowLeft size={17} />
        今日の学習へ戻る
      </Link>

      {error && <div className="mt-5 rounded-lg border border-red-200 bg-red-50 p-4 text-sm font-bold text-red-700">{error}</div>}

      {task && (
        <>
          <header className="mt-6 border-b border-slate-200 pb-5">
            <p className="text-xs font-black text-emerald-700">{task.task_type === 'ai_writing' ? 'AI添削' : 'Booster 学習タスク'}</p>
            <h1 className="mt-2 text-2xl font-black sm:text-3xl">{task.title}</h1>
            <p className="mt-3 whitespace-pre-wrap text-sm leading-7 text-slate-600">{task.description}</p>
            {task.estimated_minutes ? <p className="mt-3 text-xs font-bold text-slate-500">想定時間 約{task.estimated_minutes}分</p> : null}
          </header>

          {task.task_type === 'video' && (
            <section className="py-6">
              {embedUrl ? (
                <div className="aspect-video overflow-hidden bg-black">
                  <iframe
                    src={embedUrl}
                    title={task.title}
                    className="h-full w-full"
                    allow="accelerometer; autoplay; clipboard-write; encrypted-media; gyroscope; picture-in-picture"
                    allowFullScreen
                  />
                </div>
              ) : videoUrl ? (
                <a
                  href={videoUrl}
                  target="_blank"
                  rel="noreferrer"
                  className="inline-flex items-center gap-2 rounded-lg bg-slate-900 px-5 py-3 font-bold text-white"
                >
                  動画を開く
                  <ExternalLink size={18} />
                </a>
              ) : (
                <p className="border-y border-slate-200 py-6 text-sm text-slate-500">動画は準備中です。</p>
              )}
              {task.details?.learning_points && (
                <div className="mt-6 border-l-4 border-emerald-500 bg-white p-4">
                  <h2 className="font-black">この動画で学ぶこと</h2>
                  <p className="mt-2 whitespace-pre-wrap text-sm leading-6 text-slate-600">{String(task.details.learning_points)}</p>
                </div>
              )}
            </section>
          )}

          {task.task_type === 'textbook' && (
            <section className="space-y-5 py-6">
              <div className="grid gap-4 border-y border-slate-200 bg-white py-5 sm:grid-cols-2">
                <div>
                  <p className="text-xs font-bold text-slate-500">テキスト</p>
                  <p className="mt-1 font-black">{task.details?.textbook_name || '指定教材'}</p>
                </div>
                <div>
                  <p className="text-xs font-bold text-slate-500">取り組むページ</p>
                  <p className="mt-1 font-black">{task.details?.pages || task.details?.page_range || '指定範囲を確認してください'}</p>
                </div>
              </div>
              {task.details?.instructions && (
                <div>
                  <h2 className="font-black">取り組み方</h2>
                  <p className="mt-2 whitespace-pre-wrap text-sm leading-7 text-slate-600">{String(task.details.instructions)}</p>
                </div>
              )}
              <fieldset>
                <legend className="font-black">取り組んだあとの理解度</legend>
                <div className="mt-3 grid gap-2 sm:grid-cols-3">
                  {[
                    ['good', '理解できた'],
                    ['uncertain', '少し不安'],
                    ['difficult', 'よく分からなかった'],
                  ].map(([value, label]) => (
                    <label key={value} className={`cursor-pointer border p-3 text-center text-sm font-bold ${understanding === value ? 'border-emerald-600 bg-emerald-50 text-emerald-800' : 'border-slate-200 bg-white'}`}>
                      <input
                        type="radio"
                        name="understanding"
                        value={value}
                        checked={understanding === value}
                        onChange={() => setUnderstanding(value)}
                        className="sr-only"
                      />
                      {label}
                    </label>
                  ))}
                </div>
                <button
                  type="button"
                  onClick={() => saveProgress('understanding')}
                  disabled={saving}
                  className="mt-3 text-sm font-bold text-emerald-700 underline"
                >
                  理解度を保存
                </button>
              </fieldset>
            </section>
          )}

          {task.task_type === 'quiz' && quiz && (
            <section className="space-y-7 py-6">
              {quiz.questions.map((question: any, index: number) => (
                <fieldset key={question.id} className="border-b border-slate-200 pb-6">
                  <legend className="font-black">{index + 1}. {question.question}</legend>
                  {question.question_type === 'short_text' ? (
                    <input
                      type="text"
                      value={String(answers[question.id] || '')}
                      onChange={event => setAnswers(current => ({ ...current, [question.id]: event.target.value }))}
                      className="mt-3 w-full rounded-lg border border-slate-300 bg-white px-4 py-3 outline-none focus:border-emerald-600"
                    />
                  ) : (
                    <div className="mt-3 grid gap-2">
                      {question.options.map((option: string) => {
                        const checked = question.question_type === 'multiple_choice'
                          ? Array.isArray(answers[question.id]) && (answers[question.id] as string[]).includes(option)
                          : answers[question.id] === option;
                        return (
                          <label key={option} className={`cursor-pointer rounded-lg border px-4 py-3 text-sm font-bold ${checked ? 'border-emerald-600 bg-emerald-50' : 'border-slate-200 bg-white'}`}>
                            <input
                              type={question.question_type === 'multiple_choice' ? 'checkbox' : 'radio'}
                              name={question.id}
                              checked={checked}
                              onChange={() => question.question_type === 'multiple_choice'
                                ? toggleMultipleAnswer(question.id, option)
                                : setAnswers(current => ({ ...current, [question.id]: option }))
                              }
                              className="mr-3"
                            />
                            {option}
                          </label>
                        );
                      })}
                    </div>
                  )}
                </fieldset>
              ))}
              {!quizResult ? (
                <button type="button" onClick={submitQuiz} disabled={saving} className="w-full rounded-lg bg-emerald-600 px-5 py-3.5 font-black text-white disabled:opacity-50">
                  {saving ? '採点しています...' : '確認テストを提出'}
                </button>
              ) : (
                <div className="border-l-4 border-emerald-600 bg-white p-5">
                  <p className="text-sm font-bold text-slate-500">今回の結果</p>
                  <p className="mt-2 text-4xl font-black">{quizResult.percentage}%</p>
                  <p className="mt-2 text-sm text-slate-600">{quizResult.score} / {quizResult.max_score}問正解</p>
                </div>
              )}
            </section>
          )}

          {task.task_type === 'ai_writing' && (
            <section className="space-y-5 py-6">
              {task.details?.prompt && (
                <div className="border-l-4 border-emerald-500 bg-white p-4">
                  <h2 className="font-black">問題</h2>
                  <p className="mt-2 whitespace-pre-wrap text-sm leading-7 text-slate-700">{String(task.details.prompt)}</p>
                </div>
              )}
              <div>
                <label htmlFor="writing-answer" className="font-black">あなたの答案</label>
                <textarea
                  id="writing-answer"
                  rows={12}
                  value={writingAnswer}
                  onChange={event => setWritingAnswer(event.target.value)}
                  className="mt-2 w-full rounded-lg border border-slate-300 bg-white p-4 leading-7 outline-none focus:border-emerald-600"
                  placeholder="ここに英語で入力してください"
                />
                <p className="mt-1 text-right text-xs text-slate-500">{writingAnswer.trim().split(/\s+/).filter(Boolean).length} words</p>
              </div>
              {writingStatus === 'failed' && (
                <div className="border-l-4 border-amber-500 bg-amber-50 p-4 text-sm font-bold text-amber-800">
                  前回の添削を完了できませんでした。答案を確認して、もう一度提出できます。
                </div>
              )}
              {!writingResult ? (
                <button type="button" onClick={submitWriting} disabled={saving || writingAnswer.trim().length < 10} className="inline-flex w-full items-center justify-center gap-2 rounded-lg bg-emerald-600 px-5 py-3.5 font-black text-white disabled:opacity-50">
                  {saving ? <Loader2 className="animate-spin" size={18} /> : <Sparkles size={18} />}
                  {writingStatus === 'failed' ? 'AI添削を再試行' : 'AI添削へ提出'}
                </button>
              ) : (
                <div className="space-y-5 border-y border-slate-200 bg-white py-5">
                  <div>
                    <p className="text-xs font-bold text-slate-500">今回の評価（公式採点ではありません）</p>
                    <div className="mt-3 grid grid-cols-2 gap-2 sm:grid-cols-4">
                      {Object.entries(writingResult.scores || {}).map(([key, value]) => (
                        <div key={key} className="bg-slate-50 p-3 text-center">
                          <p className="text-xs font-bold text-slate-500">{key}</p>
                          <p className="mt-1 text-xl font-black">{String(value)} / 4</p>
                        </div>
                      ))}
                    </div>
                  </div>
                  <div>
                    <h2 className="font-black text-emerald-700">良かった点</h2>
                    <p className="mt-2 text-sm leading-7">{writingResult.strengths?.[0]}</p>
                  </div>
                  <div>
                    <h2 className="font-black text-amber-700">最優先の改善点</h2>
                    <p className="mt-2 text-sm leading-7">{writingResult.priority_improvements?.[0]}</p>
                  </div>
                  <div>
                    <h2 className="font-black">次に意識すること</h2>
                    <p className="mt-2 text-sm leading-7">{writingResult.next_focus}</p>
                  </div>
                </div>
              )}
            </section>
          )}

          {!['quiz', 'ai_writing'].includes(task.task_type) && (
            <div className="border-t border-slate-200 py-6">
              {progress?.status === 'completed' ? (
                <div className="flex items-center gap-2 font-bold text-emerald-700">
                  <CheckCircle2 size={21} />
                  この学習は完了しています
                </div>
              ) : (
                <button
                  type="button"
                  onClick={() => saveProgress('complete')}
                  disabled={saving}
                  className="inline-flex w-full items-center justify-center gap-2 rounded-lg bg-emerald-600 px-5 py-3.5 font-black text-white disabled:opacity-50"
                >
                  {saving ? <Loader2 className="animate-spin" size={18} /> : <CheckCircle2 size={18} />}
                  完了して次へ進む
                </button>
              )}
            </div>
          )}
        </>
      )}
    </main>
  );
}
