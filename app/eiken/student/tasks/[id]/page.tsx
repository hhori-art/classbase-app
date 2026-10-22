'use client';

import { useCallback, useEffect, useMemo, useState } from 'react';
import { useParams } from 'next/navigation';
import { BookOpen, CheckCircle2, ExternalLink, Sparkles } from 'lucide-react';
import { useEikenApi } from '@/app/eiken/useEikenApi';
import { Button, ErrorState, ListSkeleton, PageHeader, buttonClass } from '@/app/components/ui';

const youtubeEmbedUrl = (value: string) => {
  try {
    const url = new URL(value);
    if (url.hostname.includes('youtu.be')) return `https://www.youtube-nocookie.com/embed/${url.pathname.slice(1)}`;
    const id = url.searchParams.get('v');
    if (url.hostname.includes('youtube.com') && id) return `https://www.youtube-nocookie.com/embed/${id}`;
  } catch {}
  return '';
};

export default function EikenTaskPage() {
  const params = useParams<{ id: string }>();
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

  if (loading) return <main className="mx-auto max-w-3xl px-4 py-8"><ListSkeleton rows={4} /></main>;

  return (
    <main className="mx-auto max-w-3xl space-y-5 px-4 py-6">
      {!task && (
        <PageHeader tone="hero" title="学習" icon={BookOpen} backHref="/eiken/student" />
      )}

      {!task && error && <ErrorState title="学習内容を読み込めませんでした" message={error} onRetry={() => { setError(''); void load(); }} />}
      {task && error && <div role="alert" className="rounded-btn border border-danger/20 bg-danger-soft p-4 text-sm font-bold text-danger">{error}</div>}

      {task && (
        <>
          <PageHeader
            tone="hero"
            eyebrow={task.task_type === 'ai_writing' ? 'AI添削' : 'Booster 学習タスク'}
            title={task.title}
            description={task.estimated_minutes ? `想定時間 約${task.estimated_minutes}分` : undefined}
            icon={task.task_type === 'ai_writing' ? Sparkles : BookOpen}
            backHref="/eiken/student"
          />
          {task.description && (
            <p className="whitespace-pre-wrap text-sm leading-7 text-fg">{task.description}</p>
          )}

          {task.task_type === 'video' && (
            <section className="space-y-5">
              {embedUrl ? (
                <div className="aspect-video max-w-full overflow-hidden rounded-card bg-black">
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
                  className={buttonClass('primary', 'lg')}
                >
                  動画を開く
                  <ExternalLink size={18} aria-hidden />
                </a>
              ) : (
                <p className="cb-card p-card text-sm text-fg-muted">動画は準備中です。</p>
              )}
              {task.details?.learning_points && (
                <div className="rounded-card border-l-4 border-accent bg-surface shadow-card p-card">
                  <h2 className="font-bold text-fg">この動画で学ぶこと</h2>
                  <p className="mt-2 whitespace-pre-wrap text-sm leading-6 text-fg-muted">{String(task.details.learning_points)}</p>
                </div>
              )}
            </section>
          )}

          {task.task_type === 'textbook' && (
            <section className="space-y-5">
              <div className="cb-card grid gap-4 p-card sm:grid-cols-2">
                <div>
                  <p className="text-xs font-bold text-fg-muted">テキスト</p>
                  <p className="mt-1 font-bold text-fg">{task.details?.textbook_name || '指定教材'}</p>
                </div>
                <div>
                  <p className="text-xs font-bold text-fg-muted">取り組むページ</p>
                  <p className="mt-1 font-bold text-fg">{task.details?.pages || task.details?.page_range || '指定範囲を確認してください'}</p>
                </div>
              </div>
              {task.details?.instructions && (
                <div>
                  <h2 className="font-bold text-fg">取り組み方</h2>
                  <p className="mt-2 whitespace-pre-wrap text-sm leading-7 text-fg-muted">{String(task.details.instructions)}</p>
                </div>
              )}
              <fieldset>
                <legend className="font-bold text-fg">取り組んだあとの理解度</legend>
                <div className="mt-3 grid gap-2 sm:grid-cols-3">
                  {[
                    ['good', '理解できた'],
                    ['uncertain', '少し不安'],
                    ['difficult', 'よく分からなかった'],
                  ].map(([value, label]) => (
                    <label key={value} className={`flex min-h-11 cursor-pointer items-center justify-center rounded-btn border p-3 text-center text-sm font-bold focus-within:ring-2 focus-within:ring-accent ${understanding === value ? 'border-accent bg-accent-soft text-accent' : 'border-line bg-surface text-fg'}`}>
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
                <Button
                  variant="secondary"
                  onClick={() => saveProgress('understanding')}
                  disabled={saving}
                  className="mt-3"
                >
                  理解度を保存
                </Button>
              </fieldset>
            </section>
          )}

          {task.task_type === 'quiz' && quiz && (
            <section className="space-y-7">
              {quiz.questions.map((question: any, index: number) => (
                <fieldset key={question.id} className="border-b border-line pb-6">
                  <legend className="font-bold text-fg">{index + 1}. {question.question}</legend>
                  {question.question_type === 'short_text' ? (
                    <input
                      type="text"
                      value={String(answers[question.id] || '')}
                      onChange={event => setAnswers(current => ({ ...current, [question.id]: event.target.value }))}
                      className="mt-3 min-h-11 w-full rounded-input border border-line bg-surface px-4 py-3 text-fg outline-none focus:border-accent focus:ring-2 focus:ring-accent/30"
                    />
                  ) : (
                    <div className="mt-3 grid gap-2">
                      {question.options.map((option: string) => {
                        const checked = question.question_type === 'multiple_choice'
                          ? Array.isArray(answers[question.id]) && (answers[question.id] as string[]).includes(option)
                          : answers[question.id] === option;
                        return (
                          <label key={option} className={`flex min-h-11 cursor-pointer items-center rounded-btn border px-4 py-3 text-sm font-bold text-fg ${checked ? 'border-accent bg-accent-soft' : 'border-line bg-surface'}`}>
                            <input
                              type={question.question_type === 'multiple_choice' ? 'checkbox' : 'radio'}
                              name={question.id}
                              checked={checked}
                              onChange={() => question.question_type === 'multiple_choice'
                                ? toggleMultipleAnswer(question.id, option)
                                : setAnswers(current => ({ ...current, [question.id]: option }))
                              }
                              className="mr-3 accent-[rgb(var(--cb-accent))]"
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
                <Button size="lg" fullWidth onClick={submitQuiz} loading={saving}>
                  {saving ? '採点しています...' : '確認テストを提出'}
                </Button>
              ) : (
                <div className="rounded-card border-l-4 border-accent bg-surface shadow-card p-card">
                  <p className="text-sm font-bold text-fg-muted">今回の結果</p>
                  <p className="mt-2 text-4xl font-black text-fg">{quizResult.percentage}%</p>
                  <p className="mt-2 text-sm text-fg-muted">{quizResult.score} / {quizResult.max_score}問正解</p>
                </div>
              )}
            </section>
          )}

          {task.task_type === 'ai_writing' && (
            <section className="space-y-5">
              {task.details?.prompt && (
                <div className="rounded-card border-l-4 border-accent bg-surface shadow-card p-card">
                  <h2 className="font-bold text-fg">問題</h2>
                  <p className="mt-2 whitespace-pre-wrap text-sm leading-7 text-fg">{String(task.details.prompt)}</p>
                </div>
              )}
              <div>
                <label htmlFor="writing-answer" className="font-bold text-fg">あなたの答案</label>
                <textarea
                  id="writing-answer"
                  rows={12}
                  value={writingAnswer}
                  onChange={event => setWritingAnswer(event.target.value)}
                  className="mt-2 w-full rounded-input border border-line bg-surface p-4 leading-7 text-fg outline-none focus:border-accent focus:ring-2 focus:ring-accent/30"
                  placeholder="ここに英語で入力してください"
                />
                <p className="mt-1 text-right text-xs text-fg-muted">{writingAnswer.trim().split(/\s+/).filter(Boolean).length}語</p>
              </div>
              {writingStatus === 'failed' && (
                <div role="alert" className="rounded-btn border-l-4 border-warning bg-warning-soft p-4 text-sm font-bold text-amber-800">
                  前回の添削を完了できませんでした。答案を確認して、もう一度提出できます。
                </div>
              )}
              {!writingResult ? (
                <Button size="lg" fullWidth onClick={submitWriting} loading={saving} disabled={writingAnswer.trim().length < 10} icon={<Sparkles size={18} aria-hidden />}>
                  {writingStatus === 'failed' ? 'AI添削を再試行' : 'AI添削へ提出'}
                </Button>
              ) : (
                <div className="cb-card space-y-5 p-card">
                  <div>
                    <p className="text-xs font-bold text-fg-muted">今回の評価（公式採点ではありません）</p>
                    <div className="mt-3 grid grid-cols-2 gap-2 sm:grid-cols-4">
                      {Object.entries(writingResult.scores || {}).map(([key, value]) => (
                        <div key={key} className="rounded-btn bg-slate-50 p-3 text-center">
                          <p className="text-xs font-bold text-fg-muted">{key}</p>
                          <p className="mt-1 text-xl font-black text-fg">{String(value)} / 4</p>
                        </div>
                      ))}
                    </div>
                  </div>
                  <div>
                    <h2 className="font-bold text-success">良かった点</h2>
                    <p className="mt-2 text-sm leading-7 text-fg">{writingResult.strengths?.[0]}</p>
                  </div>
                  <div>
                    <h2 className="font-bold text-amber-700">最優先の改善点</h2>
                    <p className="mt-2 text-sm leading-7 text-fg">{writingResult.priority_improvements?.[0]}</p>
                  </div>
                  <div>
                    <h2 className="font-bold text-fg">次に意識すること</h2>
                    <p className="mt-2 text-sm leading-7 text-fg">{writingResult.next_focus}</p>
                  </div>
                </div>
              )}
            </section>
          )}

          {!['quiz', 'ai_writing'].includes(task.task_type) && (
            <div className="border-t border-line pt-6">
              {progress?.status === 'completed' ? (
                <div className="flex items-center gap-2 font-bold text-success">
                  <CheckCircle2 size={21} aria-hidden />
                  この学習は完了しています
                </div>
              ) : (
                <Button
                  size="lg"
                  fullWidth
                  onClick={() => saveProgress('complete')}
                  loading={saving}
                  icon={<CheckCircle2 size={18} aria-hidden />}
                >
                  完了して次へ進む
                </Button>
              )}
            </div>
          )}
        </>
      )}
    </main>
  );
}
