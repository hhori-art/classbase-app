'use client';

import Link from 'next/link';
import { useCallback, useEffect, useMemo, useState } from 'react';
import { Area, AreaChart, Bar, BarChart, CartesianGrid, Legend, ResponsiveContainer, Tooltip, XAxis, YAxis } from 'recharts';
import { Activity, AlertTriangle, ArrowLeft, BookCheck, CalendarDays, Download, Mail, PlayCircle, RefreshCw, UserMinus, Users } from 'lucide-react';
import { useAuth } from '@/app/context/AuthContext';

type Period = 'week' | 'month';
const pct = (value: number | null | undefined) => value == null ? '—' : `${value}%`;
const csvCell = (value: unknown) => {
  const text = String(value ?? '');
  const safe = /^[=+\-@]/.test(text) ? `'${text}` : text;
  return `"${safe.replace(/"/g, '""')}"`;
};

export default function StatisticsPage() {
  const { user, profile, loading: authLoading } = useAuth();
  const [period, setPeriod] = useState<Period>('month');
  const [anchor, setAnchor] = useState(new Date().toLocaleDateString('sv-SE', { timeZone: 'Asia/Tokyo' }));
  const [school, setSchool] = useState('');
  const [grade, setGrade] = useState('');
  const [data, setData] = useState<any>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState('');
  const [email, setEmail] = useState('');
  const [sending, setSending] = useState(false);

  const load = useCallback(async () => {
    if (!user || profile?.role !== 'master') return;
    setLoading(true); setError('');
    try {
      const token = await user.getIdToken();
      const params = new URLSearchParams({ period, anchor });
      if (school) params.set('school', school);
      if (grade) params.set('grade', grade);
      const response = await fetch(`/api/admin/course-analytics?${params}`, { headers: { Authorization: `Bearer ${token}` }, cache: 'no-store' });
      const body = await response.json().catch(() => ({}));
      if (!response.ok) throw new Error(body.error || '分析データを取得できませんでした。');
      setData(body);
    } catch (cause) { setError(cause instanceof Error ? cause.message : '分析データを取得できませんでした。'); }
    finally { setLoading(false); }
  }, [anchor, grade, period, profile?.role, school, user]);

  useEffect(() => { void load(); }, [load]);

  const exportReport = () => {
    if (!data) return;
    const summary = [['期間', data.range.label], ['対象生徒数', data.summary.students], ['受講人数', data.summary.enrolled_students], ['出席率', pct(data.summary.attendance_rate)], ['宿題提出率', pct(data.summary.homework_rate)], ['開始率', pct(data.summary.start_rate)], ['解除率', pct(data.summary.withdrawal_rate)]];
    const courseRows = data.courses.map((course: any) => ['講座', course.name, course.enrolled, course.attended_students, pct(course.start_rate), course.schools.join(' / '), course.grades.join(' / ')]);
    const exceptionRows = data.exceptions.map((item: any) => ['要確認', item.name, item.school, item.grade, item.attended ? '出席あり' : '期間内出席なし', `${item.homework_submitted}/${item.homework_total}`, pct(item.homework_rate)]);
    const rows = [['種別', '名称/期間', '値1', '値2', '率', '校舎', '学年'], ...summary.map(row => ['概要', ...row]), ...courseRows, ...exceptionRows];
    const blob = new Blob(['\uFEFF' + rows.map((row: unknown[]) => row.map(csvCell).join(',')).join('\r\n')], { type: 'text/csv;charset=utf-8' });
    const link = document.createElement('a'); link.href = URL.createObjectURL(blob); link.download = `course_report_${data.range.start}_${data.range.end}.csv`; link.click(); URL.revokeObjectURL(link.href);
  };

  const sendReport = async () => {
    if (!user || !email) return alert('送信先メールアドレスを入力してください。');
    setSending(true);
    try {
      const token = await user.getIdToken();
      const response = await fetch('/api/admin/course-analytics', { method: 'POST', headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${token}` }, body: JSON.stringify({ email, period, anchor, school, grade }) });
      const body = await response.json().catch(() => ({}));
      if (!response.ok) throw new Error(body.error || 'メールを送信できませんでした。');
      alert('レポート作成完了メールを送信しました。');
    } catch (cause) { alert(cause instanceof Error ? cause.message : 'メールを送信できませんでした。'); }
    finally { setSending(false); }
  };

  const kpis = useMemo(() => data ? [
    { label: '受講人数', value: `${data.summary.enrolled_students}人`, note: `対象生徒 ${data.summary.students}人`, icon: <Users />, tone: 'bg-indigo-50 text-indigo-700' },
    { label: '出席率', value: pct(data.summary.attendance_rate), note: `${data.summary.attendance_numerator}/${data.summary.attendance_denominator}人`, icon: <CalendarDays />, tone: 'bg-emerald-50 text-emerald-700' },
    { label: '宿題提出率', value: pct(data.summary.homework_rate), note: `${data.summary.homework_numerator}/${data.summary.homework_denominator}件`, icon: <BookCheck />, tone: 'bg-sky-50 text-sky-700' },
    { label: '講座開始率', value: pct(data.summary.start_rate), note: `${data.summary.started_students}人が受講開始`, icon: <PlayCircle />, tone: 'bg-violet-50 text-violet-700' },
    { label: '解除率', value: pct(data.summary.withdrawal_rate), note: `${data.summary.withdrawals}/${data.summary.registration_records}件`, icon: <UserMinus />, tone: 'bg-rose-50 text-rose-700' },
    { label: '要確認', value: `${data.exceptions.length}人`, note: '未出席・宿題未提出', icon: <AlertTriangle />, tone: 'bg-amber-50 text-amber-800' },
  ] : [], [data]);

  if (authLoading || !profile) return <main className="grid min-h-screen place-items-center"><RefreshCw className="animate-spin text-indigo-600" /></main>;
  if (profile.role !== 'master') return <main className="grid min-h-screen place-items-center p-6 font-black">マスター管理者専用です。</main>;

  return <main className="min-h-screen bg-slate-50 px-3 py-5 text-slate-900 sm:px-6"><div className="mx-auto max-w-[1500px] space-y-5">
    <header className="rounded-[28px] border border-slate-200 bg-white p-5 shadow-sm sm:p-7">
      <div className="flex flex-col gap-5 xl:flex-row xl:items-center xl:justify-between"><div className="flex items-center gap-3"><Link href="/master" aria-label="戻る" className="grid h-11 w-11 place-items-center rounded-2xl bg-slate-100"><ArrowLeft size={19} /></Link><div><h1 className="flex items-center gap-2 text-2xl font-black"><Activity className="text-indigo-600" />講座運用分析</h1><p className="mt-1 text-xs font-bold text-slate-500">出席・宿題・受講開始・解除・受講人数を一つの母数で確認</p></div></div><div className="flex flex-wrap gap-2"><button onClick={exportReport} disabled={!data} className="inline-flex min-h-11 items-center gap-2 rounded-xl bg-emerald-600 px-4 text-xs font-black text-white disabled:opacity-40"><Download size={16} />CSVレポート</button><button onClick={() => window.print()} disabled={!data} className="inline-flex min-h-11 items-center gap-2 rounded-xl bg-slate-900 px-4 text-xs font-black text-white disabled:opacity-40"><Download size={16} />印刷・PDF</button></div></div>
      <div className="mt-6 grid gap-3 md:grid-cols-2 xl:grid-cols-5"><label className="grid gap-1 text-xs font-black text-slate-600"><span>集計単位</span><select value={period} onChange={event => setPeriod(event.target.value as Period)} className="min-h-11 rounded-xl border border-slate-200 px-3"><option value="week">週次</option><option value="month">月次</option></select></label><label className="grid gap-1 text-xs font-black text-slate-600"><span>基準日</span><input type="date" value={anchor} onChange={event => setAnchor(event.target.value)} className="min-h-11 rounded-xl border border-slate-200 px-3" /></label><label className="grid gap-1 text-xs font-black text-slate-600"><span>校舎</span><select value={school} onChange={event => setSchool(event.target.value)} className="min-h-11 rounded-xl border border-slate-200 px-3"><option value="">全校舎</option>{(data?.options.schools || []).map((value: string) => <option key={value}>{value}</option>)}</select></label><label className="grid gap-1 text-xs font-black text-slate-600"><span>学年</span><select value={grade} onChange={event => setGrade(event.target.value)} className="min-h-11 rounded-xl border border-slate-200 px-3"><option value="">全学年</option>{(data?.options.grades || []).map((value: string) => <option key={value}>{value}</option>)}</select></label><button onClick={() => void load()} disabled={loading} className="mt-auto inline-flex min-h-11 items-center justify-center gap-2 rounded-xl bg-indigo-600 px-4 text-xs font-black text-white disabled:opacity-50"><RefreshCw size={15} className={loading ? 'animate-spin' : ''} />再集計</button></div>
    </header>
    {error && <div className="rounded-2xl border border-rose-200 bg-rose-50 p-4 text-sm font-bold text-rose-800">{error}</div>}
    {loading && !data ? <div className="grid min-h-80 place-items-center rounded-3xl bg-white"><RefreshCw className="animate-spin text-indigo-600" /></div> : data && <>
      <section aria-label="主要指標" className="grid gap-3 sm:grid-cols-2 xl:grid-cols-6">{kpis.map(item => <article key={item.label} className="rounded-3xl border border-slate-200 bg-white p-4 shadow-sm"><div className={`grid h-10 w-10 place-items-center rounded-xl ${item.tone}`}>{item.icon}</div><p className="mt-3 text-xs font-black text-slate-500">{item.label}</p><p className="mt-1 text-2xl font-black">{item.value}</p><p className="mt-1 text-[11px] font-bold text-slate-400">{item.note}</p></article>)}</section>
      <section className="grid gap-5 xl:grid-cols-2"><article className="rounded-3xl border border-slate-200 bg-white p-5 shadow-sm"><h2 className="font-black">日別の受講状況</h2><p className="mt-1 text-xs font-bold text-slate-500">ユニーク出席者数と宿題提出件数</p><div className="mt-4 h-72"><ResponsiveContainer width="100%" height="100%"><AreaChart data={data.trend}><CartesianGrid strokeDasharray="3 3" vertical={false} /><XAxis dataKey="date" tickFormatter={value => String(value).slice(5)} fontSize={11} /><YAxis allowDecimals={false} fontSize={11} /><Tooltip /><Legend /><Area name="出席者" dataKey="attended_students" stroke="#059669" fill="#a7f3d0" /><Area name="宿題提出" dataKey="homework_submissions" stroke="#0284c7" fill="#bae6fd" /></AreaChart></ResponsiveContainer></div></article><article className="rounded-3xl border border-slate-200 bg-white p-5 shadow-sm"><h2 className="font-black">講座別の受講人数</h2><p className="mt-1 text-xs font-bold text-slate-500">現在の登録人数が多い講座順</p><div className="mt-4 h-72"><ResponsiveContainer width="100%" height="100%"><BarChart data={data.courses.slice(0, 10)} layout="vertical" margin={{ left: 20 }}><CartesianGrid strokeDasharray="3 3" horizontal={false} /><XAxis type="number" allowDecimals={false} /><YAxis type="category" dataKey="name" width={120} tick={{ fontSize: 10 }} /><Tooltip /><Bar name="受講人数" dataKey="enrolled" fill="#6366f1" radius={[0, 6, 6, 0]} /></BarChart></ResponsiveContainer></div></article></section>
      <section className="rounded-3xl border border-slate-200 bg-white p-5 shadow-sm"><div className="flex flex-wrap items-end justify-between gap-2"><div><h2 className="font-black">講座別の運用状況</h2><p className="mt-1 text-xs font-bold text-slate-500">人数・期間内の開始状況・対象校舎を比較</p></div><span className="rounded-full bg-indigo-50 px-3 py-1 text-xs font-black text-indigo-700">{data.summary.course_count}講座</span></div><div className="mt-4 overflow-x-auto"><table className="w-full min-w-[760px] text-left text-sm"><thead><tr className="border-b text-xs text-slate-500"><th className="p-3">講座</th><th className="p-3">受講人数</th><th className="p-3">開始人数</th><th className="p-3">開始率</th><th className="p-3">校舎</th><th className="p-3">学年</th></tr></thead><tbody>{data.courses.map((course: any) => <tr key={course.name} className="border-b border-slate-100"><td className="p-3 font-black">{course.name}</td><td className="p-3 font-bold">{course.enrolled}人</td><td className="p-3 font-bold">{course.attended_students}人</td><td className="p-3 font-black text-indigo-700">{pct(course.start_rate)}</td><td className="p-3 text-xs font-bold text-slate-500">{course.schools.join(' / ') || '—'}</td><td className="p-3 text-xs font-bold text-slate-500">{course.grades.join(' / ') || '—'}</td></tr>)}</tbody></table>{data.courses.length === 0 && <p className="py-10 text-center text-sm font-bold text-slate-400">該当する受講登録はありません。</p>}</div></section>
      <section className="grid gap-5 xl:grid-cols-[1.5fr_1fr]"><article className="rounded-3xl border border-amber-200 bg-white p-5 shadow-sm"><h2 className="flex items-center gap-2 font-black"><AlertTriangle className="text-amber-500" />運用上の要確認</h2><p className="mt-1 text-xs font-bold text-slate-500">受講登録済みで期間内出席がない生徒、または宿題未提出がある生徒</p><div className="mt-4 max-h-[430px] overflow-auto"><table className="w-full min-w-[620px] text-left text-sm"><thead className="sticky top-0 bg-white"><tr className="border-b text-xs text-slate-500"><th className="p-3">生徒</th><th className="p-3">校舎・学年</th><th className="p-3">出席</th><th className="p-3">宿題</th></tr></thead><tbody>{data.exceptions.map((item: any) => <tr key={item.id} className="border-b border-slate-100"><td className="p-3 font-black">{item.name}</td><td className="p-3 text-xs font-bold text-slate-500">{item.school}・{item.grade}</td><td className={`p-3 font-black ${item.attended ? 'text-emerald-700' : 'text-rose-700'}`}>{item.attended ? '出席あり' : '期間内なし'}</td><td className="p-3 font-bold">{item.homework_submitted}/{item.homework_total}（{pct(item.homework_rate)}）</td></tr>)}</tbody></table>{data.exceptions.length === 0 && <p className="py-10 text-center text-sm font-bold text-emerald-700">要確認の生徒はいません。</p>}</div></article><div className="space-y-5"><article className="rounded-3xl border border-slate-200 bg-white p-5 shadow-sm"><h2 className="flex items-center gap-2 font-black"><Mail className="text-indigo-600" />レポート完成通知</h2><p className="mt-2 text-xs font-bold leading-5 text-slate-500">現在の週次／月次レポート概要をメール送信します。</p><input type="email" value={email} onChange={event => setEmail(event.target.value)} placeholder="送信先メールアドレス" className="mt-4 min-h-11 w-full rounded-xl border border-slate-200 px-3 text-sm" /><button onClick={() => void sendReport()} disabled={sending || !email} className="mt-3 inline-flex min-h-11 w-full items-center justify-center gap-2 rounded-xl bg-indigo-600 text-xs font-black text-white disabled:opacity-40"><Mail size={15} />{sending ? '送信中…' : 'レポートをメール送信'}</button></article><article className="rounded-3xl border border-slate-200 bg-white p-5 shadow-sm"><h2 className="font-black">指標の定義</h2><dl className="mt-3 space-y-3 text-xs"><div><dt className="font-black">出席率</dt><dd className="mt-1 font-bold text-slate-500">{data.definitions.attendance_rate}</dd></div><div><dt className="font-black">宿題提出率</dt><dd className="mt-1 font-bold text-slate-500">{data.definitions.homework_rate}</dd></div><div><dt className="font-black">開始率</dt><dd className="mt-1 font-bold text-slate-500">{data.definitions.start_rate}</dd></div><div><dt className="font-black">解除率</dt><dd className="mt-1 font-bold text-slate-500">{data.definitions.withdrawal_rate}</dd></div></dl></article></div></section>
    </>}
  </div></main>;
}
