'use client';

import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import Link from 'next/link';
import { useParams } from 'next/navigation';
import { ArrowLeft, CheckCircle2, Clock3, Loader2, Send, Sparkles, Target, Trophy, XCircle } from 'lucide-react';
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
  if (!subject) return <main className="p-10 text-center font-bold">科目が見つかりません。</main>;
  if (loading) return <main className="grid min-h-[100dvh] place-items-center bg-slate-950 text-white"><div className="text-center"><Loader2 className="mx-auto mb-4 animate-spin" size={42}/><p className="font-black">問題を準備しています</p></div></main>;
  if (!session) return <main className="grid min-h-[70vh] place-items-center p-6 text-center"><div><p className="font-bold text-rose-600">{error || 'セッションを開始できませんでした。'}</p><Link href={`/student/online-school/${subject.id}`} className="mt-5 inline-block rounded-xl bg-slate-900 px-5 py-3 font-bold text-white">戻る</Link></div></main>;

  if (session.status === 'completed' || session.result) {
    const result = session.result || { answeredCount: session.answeredCount, correctCount: session.correctCount, xpEarned: session.xpEarned, durationSeconds: 0, endingLevel: session.currentLevel };
    const accuracy = result.answeredCount ? Math.round(result.correctCount / result.answeredCount * 100) : 0;
    return <main className="mx-auto min-h-[100dvh] max-w-3xl px-4 py-8 sm:py-14"><section className="overflow-hidden rounded-[2.5rem] bg-white text-center shadow-xl"><div className="bg-gradient-to-br from-indigo-600 to-violet-700 px-6 py-10 text-white"><Sparkles className="mx-auto mb-3 text-yellow-300" size={38}/><h1 className="text-3xl font-black">今日もおつかれさま！</h1><p className="mt-2 text-indigo-100">10分の積み重ねが、次のLevelにつながります。</p></div><div className="p-6 sm:p-9"><div className="grid grid-cols-2 gap-3 sm:grid-cols-4">{[['回答数', `${result.answeredCount}問`], ['正解数', `${result.correctCount}問`], ['正答率', `${accuracy}%`], ['獲得XP', `+${result.xpEarned}`]].map(([label, value]) => <div key={label} className="rounded-2xl bg-slate-50 p-4"><p className="text-xs font-bold text-slate-400">{label}</p><p className="mt-1 text-2xl font-black text-slate-900">{value}</p></div>)}</div><div className="mt-5 rounded-2xl bg-indigo-50 p-5"><Trophy className="mx-auto text-indigo-600"/><p className="mt-1 text-sm font-bold text-indigo-500">現在</p><p className="text-3xl font-black text-indigo-700">Level {result.endingLevel}</p></div><div className="mt-5 grid gap-3 text-left sm:grid-cols-2"><div className="rounded-2xl bg-emerald-50 p-4"><p className="font-black text-emerald-800">今日よくできた分野</p><p className="mt-1 text-sm font-bold text-emerald-700">{analysis[0]?.name || '次回の学習で見つかります'}</p></div><div className="rounded-2xl bg-amber-50 p-4"><p className="font-black text-amber-800">もう少しで伸びる分野</p><p className="mt-1 text-sm font-bold text-amber-700">{analysis.at(-1)?.name || '次回の学習で見つかります'}</p></div></div><Link href={`/student/online-school/${subject.id}`} className="mt-7 inline-flex min-h-12 w-full items-center justify-center rounded-2xl bg-slate-900 px-6 font-black text-white">科目トップへ戻る</Link></div></section></main>;
  }

  const problem = session.currentProblem;
  return <main className="min-h-[100dvh] bg-slate-100 px-3 py-3 sm:px-6 sm:py-6"><div className="mx-auto max-w-5xl"><header className="mb-4 flex items-center justify-between rounded-2xl bg-white px-4 py-3 shadow-sm"><Link href={`/student/online-school/${subject.id}`} className="grid h-10 w-10 place-items-center rounded-xl bg-slate-100 text-slate-600"><ArrowLeft size={20}/></Link><div className="text-center"><p className="text-[10px] font-black text-slate-400">{subject.name}</p><p className="font-black text-indigo-600">Level {session.currentLevel}</p></div><div className={`flex min-w-28 items-center justify-center gap-2 rounded-xl px-3 py-2 font-mono text-lg font-black ${remaining <= 60 ? 'bg-rose-100 text-rose-700' : 'bg-slate-900 text-white'}`}><Clock3 size={18}/>{formatTime(remaining)}</div></header>
    {remaining <= 0 && <div className="mb-4 rounded-2xl bg-amber-100 p-3 text-center text-sm font-black text-amber-900">時間になりました。この問題を解いたら今日の学習は終了です。</div>}
    {error && <div className="mb-4 rounded-2xl bg-rose-100 p-3 text-center text-sm font-bold text-rose-700">{error}</div>}
    <section className="rounded-[2rem] bg-white p-5 shadow-sm sm:p-9"><div className="mb-6 flex items-center justify-between"><span className="rounded-full bg-indigo-50 px-3 py-1 text-xs font-black text-indigo-600">{problem?.categoryName}</span><span className="text-sm font-bold text-slate-400">{session.answeredCount + 1}問目</span></div>
      {problem?.passage && <div className="mb-6 rounded-2xl border border-slate-200 bg-slate-50 p-5 text-lg font-medium leading-9 text-slate-700">{problem.passage}</div>}
      <h1 className="min-h-20 text-center text-2xl font-black leading-relaxed text-slate-900 sm:text-3xl">{problem?.prompt}</h1>
      {!feedback && problem && <div className="mx-auto mt-8 max-w-2xl">{problem.problemType === 'multiple_choice' ? <div className="grid gap-3 sm:grid-cols-2">{problem.choices?.map(choice => <button key={choice} onClick={() => setAnswer(choice)} className={`min-h-16 rounded-2xl border-2 px-4 text-lg font-black transition active:scale-[.99] ${answer === choice ? 'border-indigo-500 bg-indigo-50 text-indigo-700' : 'border-slate-200 bg-white text-slate-700 hover:border-indigo-200'}`}>{choice}</button>)}</div> : <input autoFocus inputMode={problem.problemType === 'number_input' ? 'decimal' : 'text'} value={answer} onChange={event => setAnswer(event.target.value)} onKeyDown={event => { if (event.key === 'Enter') void submit(); }} placeholder="答えを入力" className="h-20 w-full rounded-2xl border-2 border-slate-200 bg-slate-50 px-5 text-center text-3xl font-black outline-none focus:border-indigo-500"/>}<button onClick={() => void submit()} disabled={!answer.trim() || sending} className="mt-5 flex min-h-16 w-full items-center justify-center gap-2 rounded-2xl bg-indigo-600 text-lg font-black text-white shadow-lg disabled:bg-slate-300">{sending ? <Loader2 className="animate-spin"/> : <Send size={21}/>}答え合わせ</button></div>}
      {feedback && <div className={`mx-auto mt-8 max-w-2xl rounded-3xl border-2 p-5 ${feedback.isCorrect ? 'border-emerald-200 bg-emerald-50' : 'border-amber-200 bg-amber-50'}`}><div className="flex items-center gap-3">{feedback.isCorrect ? <CheckCircle2 className="text-emerald-600" size={34}/> : <XCircle className="text-amber-600" size={34}/>}<div><p className={`text-2xl font-black ${feedback.isCorrect ? 'text-emerald-800' : 'text-amber-900'}`}>{feedback.isCorrect ? '正解！' : 'おしい！'}</p>{feedback.xpEarned > 0 && <p className="text-sm font-black text-indigo-600">+{feedback.xpEarned} XP</p>}</div></div>{!feedback.isCorrect && <p className="mt-4 rounded-xl bg-white/80 p-3 font-bold text-slate-800">正解：{feedback.correctAnswer}</p>}<div className="mt-4"><p className="mb-1 flex items-center gap-1 text-xs font-black text-slate-500"><Target size={14}/>ここを確認しよう</p><p className="leading-7 text-slate-700">{feedback.explanation}</p></div>{feedback.leveledUp && <p className="mt-4 rounded-xl bg-violet-600 p-3 text-center font-black text-white">Level {feedback.currentLevel} にアップ！</p>}<button onClick={() => void next()} disabled={sending} className="mt-5 min-h-14 w-full rounded-2xl bg-slate-900 px-5 font-black text-white">{feedback.timeExpired || remaining <= 0 ? '今日の結果を見る' : '解説を確認して次へ'}</button></div>}
    </section></div></main>;
}
