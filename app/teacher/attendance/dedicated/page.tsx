'use client';

import { FormEvent, useCallback, useEffect, useMemo, useState } from 'react';
import { BookOpen, CheckCircle2, Loader2, Play, RefreshCw, Send, Square, TimerReset, Train } from 'lucide-react';
import { useAuth } from '@/app/context/AuthContext';

type Interval = { kind: 'before' | 'after' | 'day_off'; start: string; end: string; minutes: number };
type Claim = { id: string; decision: 'apply' | 'decline'; status: string; reason?: string; details?: string; review_note?: string };
type WorkRecord = {
  id: string; date: string; start_time: string; end_time?: string | null;
  overtime_intervals: Interval[]; overtime_minutes: number; overtime_claim?: Claim | null;
};
type LessonClaim = { id: string; lesson_date: string; school_name?: string; start_time?: string; end_time?: string; lesson_minutes: number; course_name?: string; details?: string; status: string; review_note?: string };
type TransportClaim = { id: string; expense_date: string; from: string; to: string; amount: number; reason: string; details?: string; status: string; review_note?: string };
type Schedule = { start_time: string; end_time: string; break_minutes: number; work_days: number[] };

const jstToday = () => new Date(Date.now() + 9 * 60 * 60 * 1000).toISOString().slice(0, 10);
const duration = (minutes: number) => `${Math.floor(minutes / 60)}時間${minutes % 60 ? `${minutes % 60}分` : ''}`;
const time = (value: string) => new Date(value).toLocaleTimeString('ja-JP', { hour: '2-digit', minute: '2-digit' });
const statusLabel = (status: string) => ({ pending: '確認待ち', approved: '承認', rejected: '差戻し', not_applied: '申請しない' }[status] || status);
const statusClass = (status: string) => status === 'approved' ? 'bg-emerald-100 text-emerald-700' : status === 'rejected' ? 'bg-rose-100 text-rose-700' : status === 'not_applied' ? 'bg-slate-100 text-slate-600' : 'bg-amber-100 text-amber-700';
const intervalKindLabel = (kind: Interval['kind']) => kind === 'before' ? '始業前' : kind === 'after' ? '終業後' : '規定休日';

export default function DedicatedAttendancePage() {
  const { user, profile } = useAuth();
  const [month, setMonth] = useState(jstToday().slice(0, 7));
  const [records, setRecords] = useState<WorkRecord[]>([]);
  const [lessons, setLessons] = useState<LessonClaim[]>([]);
  const [transport, setTransport] = useState<TransportClaim[]>([]);
  const [schedule, setSchedule] = useState<Schedule>({ start_time: '09:00', end_time: '18:00', break_minutes: 60, work_days: [1, 2, 3, 4, 5] });
  const [loading, setLoading] = useState(true);
  const [working, setWorking] = useState(false);
  const [error, setError] = useState('');
  const [message, setMessage] = useState('');
  const [claimTarget, setClaimTarget] = useState<WorkRecord | null>(null);
  const [claimForm, setClaimForm] = useState({ decision: 'apply', reason: '', details: '' });
  const [lessonForm, setLessonForm] = useState({ lesson_date: jstToday(), school_name: '', lesson_minutes: '' });
  const [transportForm, setTransportForm] = useState({ expense_date: jstToday(), from: '', to: '', amount: '', reason: '', details: '' });

  const load = useCallback(async () => {
    if (!user) return;
    setLoading(true); setError('');
    try {
      const token = await user.getIdToken();
      const response = await fetch(`/api/dedicated-attendance?month=${month}`, { cache: 'no-store', headers: { Authorization: `Bearer ${token}` } });
      const body = await response.json().catch(() => ({}));
      if (!response.ok || body.ok === false) throw new Error(body.error || '専任勤怠を取得できませんでした。');
      setRecords(Array.isArray(body.records) ? body.records : []);
      setLessons(Array.isArray(body.lessons) ? body.lessons : []);
      setTransport(Array.isArray(body.transport) ? body.transport : []);
      if (body.schedule) setSchedule(body.schedule);
    } catch (loadError) {
      setError(loadError instanceof Error ? loadError.message : '専任勤怠を取得できませんでした。');
    } finally { setLoading(false); }
  }, [month, user]);

  useEffect(() => { load(); }, [load]);
  useEffect(() => {
    const defaultSchool = String(profile?.school_name || profile?.school || profile?.school_id || profile?.classroom || '');
    if (defaultSchool) setLessonForm(current => current.school_name ? current : { ...current, school_name: defaultSchool });
  }, [profile]);
  const activeRecord = records.find(record => !record.end_time);
  const todayRecord = records.find(record => record.date === jstToday());
  const pendingCount = useMemo(() => records.filter(record => record.overtime_minutes > 0 && !record.overtime_claim).length, [records]);
  const overtimeTotal = useMemo(() => records.filter(record => record.overtime_claim?.decision === 'apply').reduce((sum, record) => sum + record.overtime_minutes, 0), [records]);
  const lessonTotal = useMemo(() => lessons.reduce((sum, lesson) => sum + Number(lesson.lesson_minutes || 0), 0), [lessons]);

  const clock = async (action: 'clock_in' | 'clock_out') => {
    if (!user || working) return;
    setWorking(true); setError(''); setMessage('');
    try {
      const token = await user.getIdToken();
      const response = await fetch('/api/teacher/attendance-clock', {
        method: 'POST', headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${token}` },
        body: JSON.stringify({ action, work_record_id: activeRecord?.id, attendance_kind: 'normal' }),
      });
      const body = await response.json().catch(() => ({}));
      if (!response.ok || body.ok === false) throw new Error(body.error || '打刻できませんでした。');
      setMessage(action === 'clock_in' ? '出勤を打刻しました。' : '退勤を打刻しました。時間外候補を確認してください。');
      await load();
    } catch (clockError) { setError(clockError instanceof Error ? clockError.message : '打刻できませんでした。'); }
    finally { setWorking(false); }
  };

  const submitOvertime = async (event: FormEvent) => {
    event.preventDefault();
    if (!user || !claimTarget || working) return;
    setWorking(true); setError(''); setMessage('');
    try {
      const token = await user.getIdToken();
      const response = await fetch('/api/dedicated-attendance', { method: 'POST', headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${token}` }, body: JSON.stringify({ action: 'overtime_decision', work_record_id: claimTarget.id, ...claimForm }) });
      const body = await response.json().catch(() => ({}));
      if (!response.ok || body.ok === false) throw new Error(body.error || '時間外の登録に失敗しました。');
      setClaimTarget(null); setMessage(claimForm.decision === 'apply' ? '時間外を申請しました。' : '「時間外を申請しない」として登録しました。');
      await load();
    } catch (submitError) { setError(submitError instanceof Error ? submitError.message : '時間外の登録に失敗しました。'); }
    finally { setWorking(false); }
  };

  const submitLesson = async (event: FormEvent) => {
    event.preventDefault();
    if (!user || working) return;
    setWorking(true); setError(''); setMessage('');
    try {
      const token = await user.getIdToken();
      const response = await fetch('/api/dedicated-attendance', { method: 'POST', headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${token}` }, body: JSON.stringify({ action: 'lesson_apply', ...lessonForm }) });
      const body = await response.json().catch(() => ({}));
      if (!response.ok || body.ok === false) throw new Error(body.error || '授業時間を申請できませんでした。');
      setMessage(`授業時間を${duration(Number(body.lesson_minutes || 0))}で申請しました。`);
      setMonth(lessonForm.lesson_date.slice(0, 7));
      setLessonForm(current => ({ ...current, lesson_minutes: '' }));
      await load();
    } catch (submitError) { setError(submitError instanceof Error ? submitError.message : '授業時間を申請できませんでした。'); }
    finally { setWorking(false); }
  };

  const submitTransport = async (event: FormEvent) => {
    event.preventDefault();
    if (!user || working) return;
    setWorking(true); setError(''); setMessage('');
    try {
      const token = await user.getIdToken();
      const response = await fetch('/api/dedicated-attendance', { method: 'POST', headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${token}` }, body: JSON.stringify({ action: 'transport_apply', ...transportForm }) });
      const body = await response.json().catch(() => ({}));
      if (!response.ok || body.ok === false) throw new Error(body.error || '交通費を申請できませんでした。');
      setMessage(`交通費 ${Number(body.amount || 0).toLocaleString()}円を申請しました。`);
      setMonth(transportForm.expense_date.slice(0, 7));
      setTransportForm(current => ({ ...current, from: '', to: '', amount: '', reason: '', details: '' }));
      await load();
    } catch (submitError) { setError(submitError instanceof Error ? submitError.message : '交通費を申請できませんでした。'); }
    finally { setWorking(false); }
  };

  const inputClass = 'mt-1 w-full rounded-xl border border-slate-200 bg-white px-3 py-2.5 text-sm font-bold outline-none focus:border-indigo-400';
  return (
    <main className="min-h-screen bg-slate-50 px-4 py-6 text-slate-900 sm:px-6">
      <div className="mx-auto max-w-5xl space-y-5">
        <header className="flex flex-wrap items-start justify-between gap-4"><div><p className="text-xs font-black tracking-widest text-indigo-500">DEDICATED EMPLOYEE</p><h1 className="text-2xl font-black">専任勤怠</h1><p className="mt-1 text-sm font-bold text-slate-500">{profile?.name || profile?.teacher_name || '専任'} / 規定 {schedule.start_time}〜{schedule.end_time}（休憩{schedule.break_minutes}分）</p></div><div className="flex items-center gap-2"><input type="month" value={month} onChange={event => setMonth(event.target.value)} className="rounded-xl border border-slate-200 bg-white px-3 py-2 text-sm font-black" /><button onClick={load} className="grid h-10 w-10 place-items-center rounded-xl bg-slate-900 text-white"><RefreshCw size={17} className={loading ? 'animate-spin' : ''} /></button></div></header>
        {error && <div className="rounded-xl border border-rose-200 bg-rose-50 p-4 text-sm font-bold text-rose-700">{error}</div>}
        {message && <div className="rounded-xl border border-emerald-200 bg-emerald-50 p-4 text-sm font-bold text-emerald-700">{message}</div>}

        <section className="rounded-3xl bg-slate-950 p-5 text-white shadow-xl"><div className="flex flex-col gap-5 sm:flex-row sm:items-center sm:justify-between"><div><p className="text-xs font-black text-slate-400">本日の勤務</p><p className="mt-2 text-xl font-black">{activeRecord ? `${time(activeRecord.start_time)} 出勤中` : todayRecord?.end_time ? `${time(todayRecord.start_time)}〜${time(todayRecord.end_time)} 退勤済み` : '未打刻'}</p></div>{activeRecord ? <button disabled={working} onClick={() => clock('clock_out')} className="inline-flex min-h-14 items-center justify-center gap-2 rounded-2xl bg-rose-500 px-8 font-black disabled:opacity-50"><Square size={20} />退勤打刻</button> : <button disabled={working || Boolean(todayRecord)} onClick={() => clock('clock_in')} className="inline-flex min-h-14 items-center justify-center gap-2 rounded-2xl bg-indigo-500 px-8 font-black disabled:opacity-40"><Play size={20} />出勤打刻</button>}</div></section>

        <section className="grid gap-3 sm:grid-cols-3"><div className="rounded-2xl bg-amber-50 p-4"><p className="text-xs font-black text-amber-700">未判断の時間外</p><p className="mt-2 text-2xl font-black text-amber-900">{pendingCount}件</p></div><div className="rounded-2xl bg-indigo-50 p-4"><p className="text-xs font-black text-indigo-600">時間外申請計</p><p className="mt-2 text-2xl font-black text-indigo-900">{duration(overtimeTotal)}</p></div><div className="rounded-2xl bg-emerald-50 p-4"><p className="text-xs font-black text-emerald-600">授業申請計</p><p className="mt-2 text-2xl font-black text-emerald-900">{duration(lessonTotal)}</p></div></section>

        <section className="rounded-2xl border border-slate-200 bg-white p-5 shadow-sm"><div className="mb-4 flex items-center gap-2"><TimerReset className="text-indigo-600" /><div><h2 className="font-black">時間外候補の確認</h2><p className="text-xs font-bold text-slate-400">打刻から規定時間外を自動抽出しています。</p></div></div><div className="space-y-3">{records.filter(record => record.end_time && record.overtime_minutes > 0).map(record => { const canEdit = !record.overtime_claim || ['rejected', 'not_applied'].includes(record.overtime_claim.status); return <article key={record.id} className="rounded-xl border border-slate-200 p-4"><div className="flex flex-wrap items-center justify-between gap-3"><div><p className="font-black">{record.date} <span className="ml-2 text-indigo-700">{duration(record.overtime_minutes)}</span></p><p className="mt-1 text-xs font-bold text-slate-500">{record.overtime_intervals.map(interval => `${intervalKindLabel(interval.kind)} ${time(interval.start)}〜${time(interval.end)}`).join(' / ')}</p></div><div className="flex items-center gap-2">{record.overtime_claim && <span className={`rounded-full px-3 py-1 text-xs font-black ${statusClass(record.overtime_claim.status)}`}>{statusLabel(record.overtime_claim.status)}</span>}{canEdit && <button onClick={() => { setClaimTarget(record); setClaimForm({ decision: record.overtime_claim?.decision || 'apply', reason: record.overtime_claim?.reason || '', details: record.overtime_claim?.details || '' }); }} className="rounded-xl bg-indigo-600 px-4 py-2 text-xs font-black text-white">{record.overtime_claim ? '再登録' : '申請するか選ぶ'}</button>}</div></div>{record.overtime_claim?.reason && <p className="mt-2 text-xs font-bold text-slate-500">理由: {record.overtime_claim.reason}</p>}</article>; })}{!loading && !records.some(record => record.end_time && record.overtime_minutes > 0) && <p className="py-8 text-center text-sm font-bold text-slate-400">この月の時間外候補はありません。</p>}</div></section>

        <section className="grid items-start gap-5 lg:grid-cols-[360px_1fr]">
          <form onSubmit={submitLesson} className="rounded-2xl border border-emerald-200 bg-white p-5 shadow-sm">
            <div className="flex items-center gap-2"><BookOpen className="text-emerald-600" /><div><h2 className="font-black">授業時間を申請</h2><p className="text-xs font-bold text-slate-400">日付と合計分数だけで完了します。</p></div></div>
            <label className="mt-5 block text-xs font-black text-slate-600">授業日<input required type="date" value={lessonForm.lesson_date} onChange={event => setLessonForm({ ...lessonForm, lesson_date: event.target.value })} className={inputClass} /></label>
            <label className="mt-4 block text-xs font-black text-slate-600">授業をした校舎<input required value={lessonForm.school_name} onChange={event => setLessonForm({ ...lessonForm, school_name: event.target.value })} className={inputClass} placeholder="所属校舎" /></label>
            <label className="mt-4 block text-xs font-black text-slate-600">授業分数<input required type="number" min="1" max="720" inputMode="numeric" value={lessonForm.lesson_minutes} onChange={event => setLessonForm({ ...lessonForm, lesson_minutes: event.target.value })} className={`${inputClass} text-2xl`} placeholder="60" /></label>
            <div className="mt-3 grid grid-cols-4 gap-2">{[30, 45, 60, 90].map(minutes => <button key={minutes} type="button" onClick={() => setLessonForm({ ...lessonForm, lesson_minutes: String(minutes) })} className={`rounded-xl border py-2 text-sm font-black ${lessonForm.lesson_minutes === String(minutes) ? 'border-emerald-500 bg-emerald-50 text-emerald-700' : 'border-slate-200 text-slate-500'}`}>{minutes}分</button>)}</div>
            <button disabled={working} className="mt-5 inline-flex min-h-12 w-full items-center justify-center gap-2 rounded-xl bg-emerald-600 font-black text-white disabled:opacity-50"><Send size={17} />この内容で申請</button>
          </form>
          <div className="overflow-hidden rounded-2xl border border-slate-200 bg-white shadow-sm"><div className="border-b border-slate-100 p-4"><h2 className="font-black">授業申請履歴</h2></div><div className="divide-y divide-slate-100">{lessons.map(lesson => <article key={lesson.id} className="p-4"><div className="flex items-center justify-between gap-3"><div><p className="font-black">{lesson.lesson_date} <span className="ml-2 text-xs text-slate-400">{lesson.school_name || '校舎未設定'}</span></p><p className="mt-1 text-sm font-black text-emerald-700">{duration(lesson.lesson_minutes)}</p></div><span className={`rounded-full px-3 py-1 text-xs font-black ${statusClass(lesson.status)}`}>{statusLabel(lesson.status)}</span></div></article>)}{!loading && lessons.length === 0 && <p className="p-8 text-center text-sm font-bold text-slate-400">授業申請はありません。</p>}</div></div>
        </section>

        <section className="grid items-start gap-5 lg:grid-cols-[360px_1fr]"><form onSubmit={submitTransport} className="space-y-3 rounded-2xl border border-sky-200 bg-white p-5 shadow-sm"><div className="flex items-center gap-2"><Train className="text-sky-600" /><div><h2 className="font-black">移動交通費を申請</h2><p className="text-xs font-bold text-slate-400">業務での移動理由と経路を登録します。</p></div></div><label className="block text-xs font-black text-slate-600">移動日<input required type="date" value={transportForm.expense_date} onChange={event => setTransportForm({ ...transportForm, expense_date: event.target.value })} className={inputClass} /></label><div className="grid grid-cols-2 gap-2"><label className="text-xs font-black text-slate-600">出発<input required value={transportForm.from} onChange={event => setTransportForm({ ...transportForm, from: event.target.value })} className={inputClass} /></label><label className="text-xs font-black text-slate-600">到着<input required value={transportForm.to} onChange={event => setTransportForm({ ...transportForm, to: event.target.value })} className={inputClass} /></label></div><label className="block text-xs font-black text-slate-600">金額（円）<input required type="number" min="1" value={transportForm.amount} onChange={event => setTransportForm({ ...transportForm, amount: event.target.value })} className={inputClass} /></label><label className="block text-xs font-black text-slate-600">移動理由<input required value={transportForm.reason} onChange={event => setTransportForm({ ...transportForm, reason: event.target.value })} className={inputClass} placeholder="例：他校舎での会議" /></label><label className="block text-xs font-black text-slate-600">詳細・備考<textarea value={transportForm.details} onChange={event => setTransportForm({ ...transportForm, details: event.target.value })} className={`${inputClass} min-h-20`} /></label><button disabled={working} className="inline-flex min-h-12 w-full items-center justify-center gap-2 rounded-xl bg-sky-600 font-black text-white disabled:opacity-50"><Send size={17} />交通費を申請</button></form><div className="overflow-hidden rounded-2xl border border-slate-200 bg-white shadow-sm"><div className="border-b border-slate-100 p-4"><h2 className="font-black">交通費申請履歴</h2></div><div className="divide-y divide-slate-100">{transport.map(item => <article key={item.id} className="p-4"><div className="flex items-center justify-between gap-3"><div><p className="font-black">{item.expense_date} / {item.from}〜{item.to}</p><p className="mt-1 text-xs font-bold text-slate-500">{item.amount.toLocaleString()}円 / {item.reason}</p></div><span className={`rounded-full px-3 py-1 text-xs font-black ${statusClass(item.status)}`}>{statusLabel(item.status)}</span></div></article>)}{!loading && transport.length === 0 && <p className="p-8 text-center text-sm font-bold text-slate-400">交通費申請はありません。</p>}</div></div></section>
      </div>

      {claimTarget && <div className="fixed inset-0 z-[1000] grid place-items-center bg-slate-950/50 p-4"><form onSubmit={submitOvertime} className="w-full max-w-lg rounded-3xl bg-white p-6 shadow-2xl"><h2 className="text-xl font-black">時間外の判断</h2><p className="mt-1 text-sm font-bold text-slate-500">{claimTarget.date} / 自動抽出 {duration(claimTarget.overtime_minutes)}</p><div className="mt-5 grid grid-cols-2 gap-3"><label className={`cursor-pointer rounded-xl border p-4 text-center text-sm font-black ${claimForm.decision === 'apply' ? 'border-indigo-500 bg-indigo-50 text-indigo-700' : 'border-slate-200'}`}><input type="radio" className="sr-only" checked={claimForm.decision === 'apply'} onChange={() => setClaimForm({ ...claimForm, decision: 'apply' })} />時間外として申請</label><label className={`cursor-pointer rounded-xl border p-4 text-center text-sm font-black ${claimForm.decision === 'decline' ? 'border-slate-500 bg-slate-100' : 'border-slate-200'}`}><input type="radio" className="sr-only" checked={claimForm.decision === 'decline'} onChange={() => setClaimForm({ ...claimForm, decision: 'decline' })} />申請しない</label></div>{claimForm.decision === 'apply' && <label className="mt-4 block text-xs font-black text-slate-600">時間外の理由 *<input required value={claimForm.reason} onChange={event => setClaimForm({ ...claimForm, reason: event.target.value })} className={inputClass} placeholder="例：会議・保護者対応" /></label>}<label className="mt-4 block text-xs font-black text-slate-600">作業の詳細<textarea value={claimForm.details} onChange={event => setClaimForm({ ...claimForm, details: event.target.value })} className={`${inputClass} min-h-24`} placeholder="行った業務を入力" /></label><div className="mt-5 grid grid-cols-2 gap-3"><button type="button" onClick={() => setClaimTarget(null)} className="rounded-xl border border-slate-200 py-3 font-black">キャンセル</button><button disabled={working} className="inline-flex items-center justify-center gap-2 rounded-xl bg-indigo-600 py-3 font-black text-white disabled:opacity-50">{working ? <Loader2 size={17} className="animate-spin" /> : <CheckCircle2 size={17} />}登録</button></div></form></div>}
    </main>
  );
}
