'use client';

import { FormEvent, useCallback, useEffect, useMemo, useState } from 'react';
import Link from 'next/link';
import { ArrowLeft, Building2, CalendarDays, Clock3, Loader2, Plus, RefreshCw, Trash2, UserRound } from 'lucide-react';
import { useAuth } from '@/app/context/AuthContext';

type Employee = { id: string; name: string; person_code: string; school_code: string; school_name: string };
type Lesson = {
  id: string;
  school_code?: string;
  school_name: string;
  lesson_date: string;
  employee_id?: string;
  person_code?: string;
  employee_name: string;
  start_time: string;
  end_time: string;
  lesson_minutes: number;
  course_name?: string;
  role?: 'main' | 'sub' | 'other';
  note?: string;
  source_type?: string;
};

const today = () => new Date(Date.now() + 9 * 60 * 60 * 1000).toISOString().slice(0, 10);
const emptyForm = () => ({
  employee_id: '', person_code: '', employee_name: '', school_code: '', school_name: '',
  lesson_date: today(), start_time: '', end_time: '', course_name: '', role: 'main', note: '',
});
const durationLabel = (minutes: number) => `${Math.floor(minutes / 60)}時間${minutes % 60 ? `${minutes % 60}分` : ''}`;

export default function EmployeeLessonEntryPage() {
  const { user } = useAuth();
  const [month, setMonth] = useState(today().slice(0, 7));
  const [lessons, setLessons] = useState<Lesson[]>([]);
  const [employees, setEmployees] = useState<Employee[]>([]);
  const [form, setForm] = useState(emptyForm);
  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState('');
  const [message, setMessage] = useState('');

  const load = useCallback(async () => {
    if (!user) return;
    setLoading(true);
    setError('');
    try {
      const token = await user.getIdToken();
      const response = await fetch(`/api/employee-lessons?month=${month}`, { cache: 'no-store', headers: { Authorization: `Bearer ${token}` } });
      const body = await response.json().catch(() => ({}));
      if (!response.ok || body.ok === false) throw new Error(body.error || '授業実績を取得できませんでした。');
      setLessons(Array.isArray(body.lessons) ? body.lessons : []);
      setEmployees(Array.isArray(body.employees) ? body.employees : []);
    } catch (loadError) {
      setError(loadError instanceof Error ? loadError.message : '授業実績を取得できませんでした。');
    } finally {
      setLoading(false);
    }
  }, [month, user]);

  useEffect(() => { load(); }, [load]);

  const selectEmployee = (id: string) => {
    const employee = employees.find(item => item.id === id);
    if (!employee) {
      setForm(current => ({ ...current, employee_id: '', person_code: '', employee_name: '' }));
      return;
    }
    setForm(current => ({
      ...current,
      employee_id: employee.id,
      person_code: employee.person_code,
      employee_name: employee.name,
      school_code: employee.school_code || current.school_code,
      school_name: employee.school_name || current.school_name,
    }));
  };

  const save = async (event: FormEvent) => {
    event.preventDefault();
    if (!user || saving) return;
    setSaving(true);
    setError('');
    setMessage('');
    try {
      const token = await user.getIdToken();
      const response = await fetch('/api/employee-lessons', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${token}` },
        body: JSON.stringify({ action: 'create', ...form }),
      });
      const body = await response.json().catch(() => ({}));
      if (!response.ok || body.ok === false) throw new Error(body.error || '登録できませんでした。');
      setMessage(`授業実績を${durationLabel(Number(body.lesson_minutes || 0))}で登録しました。`);
      setMonth(form.lesson_date.slice(0, 7));
      setForm(current => ({ ...emptyForm(), employee_id: current.employee_id, person_code: current.person_code, employee_name: current.employee_name, school_code: current.school_code, school_name: current.school_name, lesson_date: current.lesson_date }));
      await load();
    } catch (saveError) {
      setError(saveError instanceof Error ? saveError.message : '登録できませんでした。');
    } finally {
      setSaving(false);
    }
  };

  const remove = async (lesson: Lesson) => {
    if (!user || !confirm(`${lesson.lesson_date} ${lesson.employee_name}の授業実績を削除しますか？`)) return;
    setError('');
    try {
      const token = await user.getIdToken();
      const response = await fetch('/api/employee-lessons', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${token}` },
        body: JSON.stringify({ action: 'delete', id: lesson.id }),
      });
      const body = await response.json().catch(() => ({}));
      if (!response.ok || body.ok === false) throw new Error(body.error || '削除できませんでした。');
      await load();
    } catch (removeError) {
      setError(removeError instanceof Error ? removeError.message : '削除できませんでした。');
    }
  };

  const totals = useMemo(() => {
    const people = new Set(lessons.map(item => item.employee_id || item.person_code || item.employee_name)).size;
    return { count: lessons.length, people, minutes: lessons.reduce((sum, item) => sum + Number(item.lesson_minutes || 0), 0) };
  }, [lessons]);

  const inputClass = 'mt-1.5 min-h-11 w-full rounded-xl border border-slate-200 bg-white px-3 py-2 text-sm font-bold text-slate-800 outline-none focus:border-indigo-500 focus:ring-2 focus:ring-indigo-100';
  const labelClass = 'text-xs font-black text-slate-600';

  return (
    <main className="min-h-screen bg-slate-50 px-4 py-6 text-slate-900 sm:px-6">
      <div className="mx-auto max-w-7xl">
        <header className="mb-6 flex flex-wrap items-center justify-between gap-4">
          <div className="flex items-center gap-3">
            <Link href="/master/attendance" className="grid h-11 w-11 shrink-0 place-items-center rounded-full border border-slate-200 bg-white text-slate-500 shadow-sm"><ArrowLeft size={19} /></Link>
            <div><h1 className="text-2xl font-black">専任・授業実績入力</h1><p className="mt-1 text-sm font-bold text-slate-500">校舎ごとの授業を簡単に登録し、専任別の授業分数を自動集計します。</p></div>
          </div>
          <div className="flex items-center gap-2"><input type="month" value={month} onChange={event => setMonth(event.target.value)} className="rounded-xl border border-slate-200 bg-white px-4 py-2 text-sm font-black" /><button onClick={load} disabled={loading} className="grid h-10 w-10 place-items-center rounded-xl bg-slate-900 text-white disabled:opacity-40"><RefreshCw size={17} className={loading ? 'animate-spin' : ''} /></button></div>
        </header>

        {error && <div className="mb-4 whitespace-pre-wrap rounded-xl border border-rose-200 bg-rose-50 p-4 text-sm font-bold text-rose-700">{error}</div>}
        {message && <div className="mb-4 rounded-xl border border-emerald-200 bg-emerald-50 p-4 text-sm font-bold text-emerald-700">{message}</div>}

        <section className="mb-6 grid gap-3 sm:grid-cols-3">
          <div className="rounded-2xl border border-slate-200 bg-white p-4 shadow-sm"><p className="text-xs font-black text-slate-400">登録授業</p><p className="mt-2 text-2xl font-black">{totals.count}件</p></div>
          <div className="rounded-2xl border border-indigo-100 bg-indigo-50 p-4 shadow-sm"><p className="text-xs font-black text-indigo-500">対象専任</p><p className="mt-2 text-2xl font-black text-indigo-800">{totals.people}名</p></div>
          <div className="rounded-2xl border border-emerald-100 bg-emerald-50 p-4 shadow-sm"><p className="text-xs font-black text-emerald-600">授業時間計</p><p className="mt-2 text-2xl font-black text-emerald-800">{durationLabel(totals.minutes)}</p></div>
        </section>

        <div className="grid items-start gap-6 xl:grid-cols-[430px_1fr]">
          <form onSubmit={save} className="rounded-2xl border border-indigo-200 bg-white p-5 shadow-sm xl:sticky xl:top-4">
            <div className="mb-5 flex items-center gap-3"><span className="grid h-10 w-10 place-items-center rounded-xl bg-indigo-600 text-white"><Plus size={20} /></span><div><h2 className="font-black">授業を登録</h2><p className="text-xs font-bold text-slate-400">上から順番に入力してください。</p></div></div>
            <div className="space-y-4">
              <label className={labelClass}><span className="flex items-center gap-1"><UserRound size={14} /> 専任</span>
                <select value={form.employee_id} onChange={event => selectEmployee(event.target.value)} className={inputClass}>
                  <option value="">職員名・コードを直接入力</option>
                  {employees.map(employee => <option key={employee.id} value={employee.id}>{employee.person_code ? `${employee.person_code} / ` : ''}{employee.name}</option>)}
                </select>
              </label>
              {!form.employee_id && <div className="grid gap-3 sm:grid-cols-2"><label className={labelClass}>職員コード<input value={form.person_code} onChange={event => setForm({ ...form, person_code: event.target.value })} className={inputClass} placeholder="例：10001" /></label><label className={labelClass}>職員名 <span className="text-rose-500">*</span><input required value={form.employee_name} onChange={event => setForm({ ...form, employee_name: event.target.value })} className={inputClass} placeholder="例：山田 太郎" /></label></div>}
              <div className="grid gap-3 sm:grid-cols-2"><label className={labelClass}>校舎コード<input value={form.school_code} onChange={event => setForm({ ...form, school_code: event.target.value })} className={inputClass} placeholder="任意" /></label><label className={labelClass}><span className="flex items-center gap-1"><Building2 size={14} /> 校舎名 *</span><input required value={form.school_name} onChange={event => setForm({ ...form, school_name: event.target.value })} className={inputClass} placeholder="例：元町校" /></label></div>
              <label className={labelClass}><span className="flex items-center gap-1"><CalendarDays size={14} /> 授業日 *</span><input required type="date" value={form.lesson_date} onChange={event => setForm({ ...form, lesson_date: event.target.value })} className={inputClass} /></label>
              <div className="grid grid-cols-2 gap-3"><label className={labelClass}>授業開始 *<input required type="time" value={form.start_time} onChange={event => setForm({ ...form, start_time: event.target.value })} className={inputClass} /></label><label className={labelClass}>授業終了 *<input required type="time" value={form.end_time} onChange={event => setForm({ ...form, end_time: event.target.value })} className={inputClass} /></label></div>
              <label className={labelClass}>講座・クラス名<input value={form.course_name} onChange={event => setForm({ ...form, course_name: event.target.value })} className={inputClass} placeholder="例：中3英語 Aクラス" /></label>
              <label className={labelClass}>担当区分<select value={form.role} onChange={event => setForm({ ...form, role: event.target.value })} className={inputClass}><option value="main">主担当</option><option value="sub">補助</option><option value="other">その他</option></select></label>
              <label className={labelClass}>備考<textarea value={form.note} onChange={event => setForm({ ...form, note: event.target.value })} className={`${inputClass} min-h-20 resize-y`} placeholder="必要な場合のみ入力" /></label>
              <button disabled={saving} className="flex min-h-12 w-full items-center justify-center gap-2 rounded-xl bg-indigo-600 px-4 text-sm font-black text-white shadow-sm hover:bg-indigo-700 disabled:opacity-50">{saving ? <Loader2 size={18} className="animate-spin" /> : <Plus size={18} />} 授業実績を登録</button>
            </div>
          </form>

          <section className="overflow-hidden rounded-2xl border border-slate-200 bg-white shadow-sm">
            <div className="border-b border-slate-100 p-5"><h2 className="font-black">{month}の登録内容</h2><p className="mt-1 text-xs font-bold text-slate-400">登録後すぐに専任別の授業分数へ反映されます。</p></div>
            <div className="divide-y divide-slate-100">
              {lessons.map(lesson => <article key={lesson.id} className="flex flex-col gap-3 p-4 sm:flex-row sm:items-center sm:justify-between">
                <div className="min-w-0"><div className="flex flex-wrap items-center gap-2"><span className="rounded-lg bg-indigo-50 px-2 py-1 text-[10px] font-black text-indigo-700">{lesson.school_name}</span><p className="font-black">{lesson.employee_name}</p>{lesson.person_code && <span className="font-mono text-[10px] text-slate-400">{lesson.person_code}</span>}</div><p className="mt-2 flex flex-wrap items-center gap-x-3 gap-y-1 text-sm font-bold text-slate-600"><span>{lesson.lesson_date}</span><span className="inline-flex items-center gap-1 font-mono"><Clock3 size={14} />{lesson.start_time && lesson.end_time ? `${lesson.start_time}〜${lesson.end_time}` : '日別合計'}</span><span className="font-black text-emerald-700">{durationLabel(lesson.lesson_minutes)}</span></p><p className="mt-1 text-xs font-bold text-slate-400">{lesson.source_type === 'dedicated_self_report' ? '本人申請（承認済み）' : `${lesson.course_name || '講座名なし'} / ${lesson.role === 'sub' ? '補助' : lesson.role === 'other' ? 'その他' : '主担当'}`}{lesson.note ? ` / ${lesson.note}` : ''}</p></div>
                <button type="button" onClick={() => remove(lesson)} className="inline-flex min-h-10 shrink-0 items-center justify-center gap-1 rounded-xl border border-rose-200 px-3 text-xs font-black text-rose-600 hover:bg-rose-50"><Trash2 size={15} /> 削除</button>
              </article>)}
              {!loading && lessons.length === 0 && <div className="p-12 text-center"><CalendarDays className="mx-auto text-slate-300" size={34} /><p className="mt-3 text-sm font-black text-slate-400">この月の授業実績は未登録です。</p></div>}
              {loading && <div className="flex items-center justify-center gap-2 p-12 text-sm font-black text-slate-400"><Loader2 size={18} className="animate-spin" /> 読み込み中</div>}
            </div>
          </section>
        </div>
      </div>
    </main>
  );
}
