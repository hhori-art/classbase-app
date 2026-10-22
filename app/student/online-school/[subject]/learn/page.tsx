'use client';

import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import Link from 'next/link';
import { useParams } from 'next/navigation';
import { ArrowLeft, CheckCircle2, Clock3, Loader2, Send, Sparkles, Target, Trophy, XCircle } from 'lucide-react';
import { EmptyState, ErrorState, IconButton, buttonClass, useConfirm } from '@/app/components/ui';
import { useAuth } from '@/app/context/AuthContext';
import { subjectById } from '@/lib/online-school/catalog';
import type { PublicProblem } from '@/lib/online-school/types';

type Session = { id: string; subjectId: string; status: string; startedAtMs: number; endsAtMs: number; currentLevel: number; answeredCount: number; correctCount: number; xpEarned: number; currentProblem: PublicProblem | null; result?: { answeredCount: number; correctCount: number; xpEarned: number; durationSeconds: number; endingLevel: number } | null };
type AnswerResult = { isCorrect: boolean; correctAnswer: string; explanation: string; xpEarned: number; leveledUp: boolean; currentLevel: number; levelXp: number; reviewMode: boolean; timeExpired: boolean; nextProblem: PublicProblem | null; answeredCount: number };

const uuid = () => typeof crypto !== 'undefined' && 'randomUUID' in crypto ? crypto.randomUUID() : `${Date.now()}_${Math.random().toString(36).slice(2)}`;
const formatTime = (seconds: number) => `${String(Math.floor(seconds / 60)).padStart(2, '0')}:${String(seconds % 60).padStart(2, '0')}`;

export default function LearnPage() {
  const params = useParams<{ subject: string }>();
  const { user } = useAuth(); const subject = subjectById(params.subject);
  const [session, setSession] = useState<Session | null>(null); const [answer, setAnswer] = useState('');
  const [feedback, setFeedback] = useState<AnswerResult | null>(null); const [loading, setLoading] = useState(true); const [sending, setSending] = useState(false);
  const [error, setError] = useState(''); const [remaining, setRemaining] = useState(600); const [localCategories, setLocalCategories] = useState<Record<string, { name: string; answered: number; correct: number }>>({});
  const answerIdRef = useRef(uuid());
  const confirm = useConfirm();
  const authorizedFetch = useCallback(async (url: string, init: RequestInit = {}) => {
    if (!user) throw new Error('ログイン情報を確認できません。'); const token = await user.getIdToken();
    const response = await fetch(url, { ...init, headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${token}`, ...(init.headers || {}) } });
    const data = await response.json().catch(() => ({})); if (!response.ok) throw new Error(data.error || '通信に失敗しました。'); return data;
  }, [user]);
  useEffect(() => { if (!subject || !user) return; let cancelled = false; void authorizedFetch('/api/online-school/session', { method: 'POST', body: JSON.stringify({ subjectId: subject.id }) }).then(data => { if (!cancelled) setSession(data.session); }).catch(err => setError(err.message)).finally(() => setLoading(false)); return () => { cancelled = true; }; }, [authorizedFetch, subject, user]);
  useEffect(() => { if (!session || session.status !== 'active') return; const tick = () => setRemaining(Math.max(0, Math.ceil((session.endsAtMs - Date.now()) / 1000))); tick(); const id = window.setInterval(tick, 1000); return () => clearInterval(id); }, [session?.id, session?.endsAtMs, session?.status]);

  const finish = useCallback(async () => {
    if (!session) return; setSending(true); setError('');
    try { const data = await authorizedFetch('/api/online-school/session', { method: 'PATCH', body: JSON.stringify({ sessionId: session.id }) }); setSession(data.session); setFeedback(null); }
    catch (err) { setError(err instanceof Error ? err.message : '終了処理に失敗しました。'); } finally { setSending(false); }
  }, [authorizedFetch, session]);

  // 途中で戻るときは確認してから、時間切れと同じ終了処理（PATCH）を呼んで結果画面を出す。
  const quit = async () => {
    if (sending) return;
    const ok = await confirm({
      title: '学習を終了しますか？',
      message: 'ここまでに答えた問題とXPは記録されます。今日の10分学習はここで終わりになります。',
      confirmLabel: '終了する',
      cancelLabel: '続ける',
    });
    if (ok) await finish();
  };

  const submit = async () => {
    if (!session?.currentProblem || !answer.trim() || sending || feedback) return; setSending(true); setError('');
    try {
      const problem = session.currentProblem;
      const data = await authorizedFetch('/api/online-school/answer', { method: 'POST', body: JSON.stringify({ sessionId: session.id, problemInstanceId: problem.problemInstanceId, answerId: answerIdRef.current, answer }) });
      const result = data.result as AnswerResult; setFeedback(result);
      setSession(current => current ? { ...current, answeredCount: result.answeredCount, correctCount: current.correctCount + (result.isCorrect ? 1 : 0), xpEarned: current.xpEarned + result.xpEarned, currentLevel: result.currentLevel } : current);
      setLocalCategories(current => { const old = current[problem.categoryId] || { name: problem.categoryName, answered: 0, correct: 0 }; return { ...current, [problem.categoryId]: { ...old, answered: old.answered + 1, correct: old.correct + (result.isCorrect ? 1 : 0) } }; });
    } catch (err) { setError(err instanceof Error ? err.message : '回答を送信できませんでした。'); } finally { setSending(false); }
  };
  const next = async () => {
    if (!feedback || !session) return;
    if (feedback.timeExpired || remaining <= 0 || !feedback.nextProblem) { await finish(); return; }
    setSession({ ...session, currentProblem: feedback.nextProblem, currentLevel: feedback.currentLevel }); setFeedback(null); setAnswer(''); answerIdRef.current = uuid();
  };

  const analysis = useMemo(() => Object.values(localCategories).sort((a, b) => (b.correct / b.answered) - (a.correct / a.answered)), [localCategories]);
  if (!subject) return <main className="mx-auto max-w-3xl px-4 py-6"><EmptyState title="科目が見つかりません。" action={<Link href="/student/online-school" className="text-sm font-bold text-accent">戻る</Link>} /></main>;
  if (loading) return <main className="grid min-h-[70dvh] place-items-center text-fg"><div role="status" className="text-center"><Loader2 className="mx-auto mb-4 animate-spin text-accent" size={42} aria-hidden /><p className="font-bold">問題を準備しています</p></div></main>;
  if (!session) return <main className="mx-auto max-w-3xl space-y-4 px-4 py-6"><ErrorState title="学習を始められませんでした" message={error || 'セッションを開始できませんでした。'} /><div className="text-center"><Link href={`/student/online-school/${subject.id}`} className={buttonClass('secondary')}>戻る</Link></div></main>;

  if (session.status === 'completed' || session.result) {
    const result = session.result || { answeredCount: session.answeredCount, correctCount: session.correctCount, xpEarned: session.xpEarned, durationSeconds: 0, endingLevel: session.currentLevel };
    const accuracy = result.answeredCount ? Math.round(result.correctCount / result.answeredCount * 100) : 0;
    return <main className="mx-auto max-w-3xl px-4 py-6"><section className="cb-card overflow-hidden text-center"><div className="bg-accent px-6 py-10 text-accent-ink"><Sparkles className="mx-auto mb-3 text-amber-300" size={38} aria-hidden /><h1 className="text-3xl font-black">今日もおつかれさま！</h1><p className="mt-2 text-accent-ink/80">10分の積み重ねが、次のLevelにつながります。</p></div><div className="p-6 sm:p-9"><div className="grid grid-cols-2 gap-3 sm:grid-cols-4">{[['回答数', `${result.answeredCount}問`], ['正解数', `${result.correctCount}問`], ['正答率', `${accuracy}%`], ['獲得XP', `+${result.xpEarned}`]].map(([label, value]) => <div key={label} className="rounded-btn bg-slate-50 p-4"><p className="text-xs font-bold text-fg-muted">{label}</p><p className="mt-1 text-2xl font-black text-fg">{value}</p></div>)}</div><div className="mt-5 rounded-btn bg-accent-soft p-5"><Trophy className="mx-auto text-accent" aria-hidden /><p className="mt-1 text-sm font-bold text-accent">現在</p><p className="text-3xl font-black text-accent">Level {result.endingLevel}</p></div><div className="mt-5 grid gap-3 text-left sm:grid-cols-2"><div className="rounded-btn bg-emerald-50 p-4"><p className="font-bold text-emerald-800">今日よくできた分野</p><p className="mt-1 text-sm font-medium text-emerald-700">{analysis[0]?.name || '次回の学習で見つかります'}</p></div><div className="rounded-btn bg-amber-50 p-4"><p className="font-bold text-amber-800">もう少しで伸びる分野</p><p className="mt-1 text-sm font-medium text-amber-700">{analysis.at(-1)?.name || '次回の学習で見つかります'}</p></div></div><Link href={`/student/online-school/${subject.id}`} className={buttonClass('primary', 'lg', 'mt-7 w-full')}>戻る</Link></div></section></main>;
  }

  const problem = session.currentProblem;
  return <main className="px-3 py-3 sm:px-6 sm:py-6"><div className="mx-auto max-w-5xl"><header className="cb-card mb-4 flex items-center justify-between px-4 py-3"><IconButton label="学習を終了する" variant="secondary" onClick={() => void quit()} disabled={sending}><ArrowLeft size={20} aria-hidden /></IconButton><div className="text-center"><p className="text-xs font-bold text-fg-muted">{subject.name}</p><p className="font-bold text-accent">Level {session.currentLevel}</p></div><div className={`flex min-w-28 items-center justify-center gap-2 rounded-btn px-3 py-2 font-mono text-lg font-black ${remaining <= 60 ? 'bg-danger-soft text-danger' : 'bg-slate-900 text-white'}`}><Clock3 size={18} aria-hidden />{formatTime(remaining)}</div></header>
    {remaining <= 0 && <div className="mb-4 rounded-btn bg-warning-soft p-3 text-center text-sm font-bold text-amber-900">時間になりました。この問題を解いたら今日の学習は終了です。</div>}
    {error && <div role="alert" className="mb-4 rounded-btn bg-danger-soft p-3 text-center text-sm font-bold text-danger">{error}</div>}
    <section className="cb-card p-5 sm:p-9"><div className="mb-6 flex items-center justify-between"><span className="rounded-full bg-accent-soft px-3 py-1 text-xs font-bold text-accent">{problem?.categoryName}</span><span className="text-sm font-bold text-fg-muted">{session.answeredCount + 1}問目</span></div>
      {problem?.passage && <div className="mb-6 rounded-btn border border-line bg-slate-50 p-5 text-lg font-medium leading-9 text-fg">{problem.passage}</div>}
      <h1 className="min-h-20 text-center text-2xl font-black leading-relaxed text-fg sm:text-3xl">{problem?.prompt}</h1>
      {!feedback && problem && <div className="mx-auto mt-8 max-w-2xl">{problem.problemType === 'multiple_choice' ? <div className="grid gap-3 sm:grid-cols-2">{problem.choices?.map(choice => <button key={choice} onClick={() => setAnswer(choice)} className={`min-h-16 rounded-btn border-2 px-4 text-lg font-bold transition active:scale-[.99] ${answer === choice ? 'border-accent bg-accent-soft text-accent' : 'border-line bg-surface text-fg hover:border-accent/30'}`}>{choice}</button>)}</div> : <input autoFocus inputMode={problem.problemType === 'number_input' ? 'decimal' : 'text'} value={answer} onChange={event => setAnswer(event.target.value)} onKeyDown={event => { if (event.key === 'Enter') void submit(); }} placeholder="答えを入力" className="h-20 w-full rounded-input border-2 border-line bg-slate-50 px-5 text-center text-3xl font-black text-fg outline-none focus:border-accent focus:ring-2 focus:ring-accent/30"/>}<button onClick={() => void submit()} disabled={!answer.trim() || sending} className="mt-5 flex min-h-16 w-full items-center justify-center gap-2 rounded-btn bg-accent text-lg font-bold text-accent-ink shadow-card hover:bg-accent-hover disabled:bg-slate-300 disabled:text-white">{sending ? <Loader2 className="animate-spin" aria-hidden /> : <Send size={21} aria-hidden />}答え合わせ</button></div>}
      {feedback && <div className={`mx-auto mt-8 max-w-2xl rounded-card border-2 p-5 ${feedback.isCorrect ? 'border-emerald-200 bg-emerald-50' : 'border-amber-200 bg-amber-50'}`}><div className="flex items-center gap-3">{feedback.isCorrect ? <CheckCircle2 className="text-emerald-600" size={34}/> : <XCircle className="text-amber-600" size={34}/>}<div><p className={`text-2xl font-black ${feedback.isCorrect ? 'text-emerald-800' : 'text-amber-900'}`}>{feedback.isCorrect ? '正解！' : 'おしい！'}</p>{feedback.xpEarned > 0 && <p className="text-sm font-bold text-accent">+{feedback.xpEarned} XP</p>}</div></div>{!feedback.isCorrect && <p className="mt-4 rounded-btn bg-white/80 p-3 font-bold text-fg">正解：{feedback.correctAnswer}</p>}<div className="mt-4"><p className="mb-1 flex items-center gap-1 text-xs font-bold text-fg-muted"><Target size={14} aria-hidden />ここを確認しよう</p><p className="leading-7 text-fg">{feedback.explanation}</p></div>{feedback.leveledUp && <p className="mt-4 rounded-btn bg-accent p-3 text-center font-bold text-accent-ink">Level {feedback.currentLevel} にアップ！</p>}<button onClick={() => void next()} disabled={sending} className="mt-5 min-h-14 w-full rounded-btn bg-slate-900 px-5 font-bold text-white disabled:opacity-50">{feedback.timeExpired || remaining <= 0 ? '今日の結果を見る' : '解説を確認して次へ'}</button></div>}
    </section></div></main>;
}
