'use client';

import { useEffect, useMemo, useState } from 'react';
import { BookOpenCheck, CalendarDays, CheckCircle2, Loader2, Plus, Save, Trash2 } from 'lucide-react';
import { auth } from '@/lib/firebase';

const GRADES = ['中1', '中2', '中3'];
const SUBJECTS = ['理科', '社会'];
const COURSES: Record<string, string[]> = {
  理科: ['物理', '化学', '生物', '地学'],
  社会: ['地理', '歴史', '公民'],
};

const emptyItem = (year: number) => ({
  id: '', year, title: '定期テスト対策', grade: '中1', subject: '理科', course_name: '物理',
  units: [] as string[], start_date: '', end_date: '', registration_open_date: '', registration_close_date: '', allowed_student_grades: ['中1'], is_active: true,
});

export default function TestPrepCoursesPage() {
  const [year, setYear] = useState(new Date().getFullYear());
  const [items, setItems] = useState<any[]>([]);
  const [editing, setEditing] = useState<any>(emptyItem(year));
  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);

  const request = async (url: string, init: RequestInit = {}) => {
    const token = await auth.currentUser?.getIdToken();
    const response = await fetch(url, { ...init, headers: { ...(init.body ? { 'Content-Type': 'application/json' } : {}), ...(token ? { Authorization: `Bearer ${token}` } : {}), ...(init.headers || {}) } });
    const data = await response.json().catch(() => ({}));
    if (!response.ok || data.ok === false) throw new Error(data.error || '処理に失敗しました');
    return data;
  };

  const load = async () => {
    setLoading(true);
    try {
      const data = await request(`/api/admin/test-prep-courses?year=${year}`);
      setItems(data.items || []);
    } catch (error: any) {
      alert(error.message || '読み込みに失敗しました');
    } finally {
      setLoading(false);
    }
  };

  useEffect(() => {
    setEditing(emptyItem(year));
    load();
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [year]);

  const sortedItems = useMemo(() => [...items].sort((a, b) => `${a.start_date}_${a.grade}_${a.subject}_${a.course_name}`.localeCompare(`${b.start_date}_${b.grade}_${b.subject}_${b.course_name}`, 'ja')), [items]);

  const save = async () => {
    setSaving(true);
    try {
      const data = await request('/api/admin/test-prep-courses', { method: 'POST', body: JSON.stringify(editing) });
      await load();
      setEditing(emptyItem(year));
      alert(data.item?.id ? '対策講座・単元を保存しました。' : '保存しました。');
    } catch (error: any) {
      alert(error.message || '保存に失敗しました');
    } finally {
      setSaving(false);
    }
  };

  const remove = async (item: any) => {
    if (!confirm(`${item.title} / ${item.grade} ${item.course_name}を非公開にしますか？既存申込の記録は保持されます。`)) return;
    try {
      await request(`/api/admin/test-prep-courses?id=${encodeURIComponent(item.id)}`, { method: 'DELETE' });
      if (editing.id === item.id) setEditing(emptyItem(year));
      await load();
    } catch (error: any) {
      alert(error.message || '削除に失敗しました');
    }
  };

  const toggleAllowedGrade = (grade: string) => setEditing((current: any) => ({
    ...current,
    allowed_student_grades: current.allowed_student_grades.includes(grade)
      ? current.allowed_student_grades.filter((item: string) => item !== grade)
      : [...current.allowed_student_grades, grade],
  }));

  return (
    <div className="min-h-screen bg-slate-50 p-4 sm:p-8">
      <div className="mx-auto max-w-7xl space-y-6">
        <header className="flex flex-col gap-4 rounded-[32px] bg-gradient-to-r from-amber-500 to-orange-500 p-6 text-white shadow-xl shadow-amber-100 md:flex-row md:items-center md:justify-between">
          <div>
            <p className="text-xs font-black uppercase tracking-[0.2em] text-amber-100">Test Preparation</p>
            <h1 className="mt-2 flex items-center gap-3 text-2xl font-black"><BookOpenCheck /> 対策講座・単元設定</h1>
            <p className="mt-2 text-sm font-bold text-amber-50">通常カリキュラムと分けて、対策期間・単元・登録できる学年を設定します。</p>
          </div>
          <label className="rounded-2xl bg-white/15 px-4 py-3 text-xs font-black backdrop-blur-sm">年度 <input type="number" value={year} onChange={event => setYear(Number(event.target.value))} className="ml-2 w-24 rounded-xl bg-white px-3 py-2 text-slate-900 outline-none" /></label>
        </header>

        <div className="grid gap-6 xl:grid-cols-[420px_minmax(0,1fr)]">
          <section className="rounded-[32px] border border-amber-100 bg-white p-6 shadow-sm xl:sticky xl:top-6 xl:self-start">
            <div className="mb-5 flex items-center justify-between"><div><p className="text-xs font-black text-amber-600">{editing.id ? '編集中' : '新規追加'}</p><h2 className="text-lg font-black text-slate-900">対策単元の設定</h2></div>{editing.id && <button onClick={() => setEditing(emptyItem(year))} className="rounded-xl bg-slate-100 px-3 py-2 text-xs font-black text-slate-600"><Plus size={14} className="inline" /> 新規</button>}</div>
            <div className="space-y-4">
              <label className="block text-xs font-black text-slate-600">対策名<input value={editing.title} onChange={event => setEditing({ ...editing, title: event.target.value })} className="mt-2 w-full rounded-2xl border-2 border-slate-100 px-4 py-3 text-sm outline-none focus:border-amber-400" placeholder="9月定期テスト対策" /></label>
              <div className="grid grid-cols-3 gap-2">
                <label className="text-xs font-black text-slate-600">学年<select value={editing.grade} onChange={event => setEditing({ ...editing, grade: event.target.value, allowed_student_grades: [event.target.value] })} className="mt-2 w-full rounded-xl border-2 border-slate-100 px-2 py-3">{GRADES.map(value => <option key={value}>{value}</option>)}</select></label>
                <label className="text-xs font-black text-slate-600">科目<select value={editing.subject} onChange={event => setEditing({ ...editing, subject: event.target.value, course_name: COURSES[event.target.value][0] })} className="mt-2 w-full rounded-xl border-2 border-slate-100 px-2 py-3">{SUBJECTS.map(value => <option key={value}>{value}</option>)}</select></label>
                <label className="text-xs font-black text-slate-600">講座<select value={editing.course_name} onChange={event => setEditing({ ...editing, course_name: event.target.value })} className="mt-2 w-full rounded-xl border-2 border-slate-100 px-2 py-3">{COURSES[editing.subject].map(value => <option key={value}>{value}</option>)}</select></label>
              </div>
              <div className="grid grid-cols-2 gap-3"><label className="text-xs font-black text-slate-600">開始日<input type="date" value={editing.start_date} onChange={event => setEditing({ ...editing, start_date: event.target.value })} className="mt-2 w-full rounded-xl border-2 border-slate-100 px-3 py-3" /></label><label className="text-xs font-black text-slate-600">終了日<input type="date" value={editing.end_date} onChange={event => setEditing({ ...editing, end_date: event.target.value })} className="mt-2 w-full rounded-xl border-2 border-slate-100 px-3 py-3" /></label></div>
              <div className="grid grid-cols-2 gap-3"><label className="text-xs font-black text-slate-600">受付開始日<input type="date" value={editing.registration_open_date || ''} onChange={event => setEditing({ ...editing, registration_open_date: event.target.value })} className="mt-2 w-full rounded-xl border-2 border-slate-100 px-3 py-3" /></label><label className="text-xs font-black text-slate-600">受付締切日<input type="date" value={editing.registration_close_date || ''} onChange={event => setEditing({ ...editing, registration_close_date: event.target.value })} className="mt-2 w-full rounded-xl border-2 border-slate-100 px-3 py-3" /></label></div>
              <p className="rounded-xl bg-amber-50 px-3 py-2 text-[11px] font-bold text-amber-800">受付期間だけ申込できます。締切日の23:59（日本時間）を過ぎると保存できません。</p>
              <label className="block text-xs font-black text-slate-600">対策単元（1行に1単元）<textarea value={editing.units.join('\n')} onChange={event => setEditing({ ...editing, units: event.target.value.split(/\r?\n/).map(value => value.trim()).filter(Boolean) })} className="mt-2 h-32 w-full resize-none rounded-2xl border-2 border-slate-100 p-4 text-sm outline-none focus:border-amber-400" placeholder={'光の性質\n音の性質'} /></label>
              <div><p className="text-xs font-black text-slate-600">登録できる生徒学年</p><div className="mt-2 flex gap-2">{GRADES.map(grade => <label key={grade} className={`flex-1 cursor-pointer rounded-xl border-2 px-3 py-2 text-center text-xs font-black ${editing.allowed_student_grades.includes(grade) ? 'border-amber-400 bg-amber-50 text-amber-700' : 'border-slate-100 text-slate-400'}`}><input type="checkbox" checked={editing.allowed_student_grades.includes(grade)} onChange={() => toggleAllowedGrade(grade)} className="sr-only" />{grade}</label>)}</div></div>
              <label className="flex items-center gap-3 rounded-2xl bg-slate-50 px-4 py-3 text-sm font-black text-slate-700"><input type="checkbox" checked={editing.is_active} onChange={event => setEditing({ ...editing, is_active: event.target.checked })} className="h-5 w-5 accent-amber-600" />生徒の登録候補に出す</label>
              <button type="button" onClick={save} disabled={saving} className="flex w-full items-center justify-center gap-2 rounded-2xl bg-amber-500 py-4 font-black text-white shadow-lg shadow-amber-100 disabled:opacity-50">{saving ? <Loader2 className="animate-spin" /> : <Save />} 保存する</button>
            </div>
          </section>

          <section className="rounded-[32px] border border-slate-100 bg-white p-6 shadow-sm">
            <div className="mb-5 flex items-center justify-between"><div><p className="text-xs font-black text-slate-400">{year}年度</p><h2 className="text-lg font-black text-slate-900">登録済みの対策講座</h2></div><span className="rounded-full bg-amber-50 px-3 py-1 text-xs font-black text-amber-700">{items.length}件</span></div>
            {loading ? <div className="flex h-48 items-center justify-center"><Loader2 className="animate-spin text-amber-500" /></div> : sortedItems.length === 0 ? <div className="rounded-3xl border-2 border-dashed border-slate-200 py-16 text-center text-sm font-black text-slate-400">まだ対策単元がありません。</div> : <div className="space-y-3">{sortedItems.map(item => <article key={item.id} className={`rounded-3xl border p-5 ${item.is_active ? 'border-amber-100 bg-amber-50/40' : 'border-slate-200 bg-slate-50 opacity-70'}`}><div className="flex flex-col gap-4 md:flex-row md:items-start md:justify-between"><button type="button" onClick={() => setEditing({ ...item })} className="flex-1 text-left"><div className="flex flex-wrap items-center gap-2"><span className="rounded-full bg-white px-3 py-1 text-xs font-black text-amber-700 ring-1 ring-amber-100">{item.grade} {item.subject} {item.course_name}</span>{item.is_active ? <span className="flex items-center gap-1 text-xs font-black text-emerald-600"><CheckCircle2 size={14} />公開中</span> : <span className="text-xs font-black text-slate-500">非公開</span>}</div><h3 className="mt-3 text-base font-black text-slate-900">{item.title}</h3><p className="mt-2 flex items-center gap-2 text-xs font-bold text-slate-500"><CalendarDays size={15} />実施 {item.start_date} 〜 {item.end_date} / 受付 {item.registration_open_date} 〜 {item.registration_close_date} / 対象 {item.allowed_student_grades.join('・')}</p><div className="mt-3 flex flex-wrap gap-1.5">{item.units.map((unit: string) => <span key={unit} className="rounded-lg bg-white px-2.5 py-1 text-[11px] font-bold text-slate-600 ring-1 ring-slate-100">{unit}</span>)}</div></button>{item.is_active && <button type="button" onClick={() => remove(item)} className="rounded-xl p-3 text-rose-400 hover:bg-rose-50 hover:text-rose-600" aria-label="非公開にする"><Trash2 size={18} /></button>}</div></article>)}</div>}
          </section>
        </div>
      </div>
    </div>
  );
}
