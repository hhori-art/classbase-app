'use client';

import { useEffect, useMemo, useState } from 'react';
import { CalendarDays, CheckCircle2, Plus, Save, Trash2 } from 'lucide-react';
import { Button, EmptyState, ErrorState, IconButton, ListSkeleton, useConfirm, useToast } from '@/app/components/ui';
import { formatDate } from '@/lib/format';
import { auth } from '@/lib/firebase';
import { jstSchoolYear } from '@/lib/date-key';

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

export default function TestPrepCoursesPanel() {
  // 年度は4月はじまり（日本時間）。1〜3月は前年の年度として扱う。
  const [year, setYear] = useState(() => jstSchoolYear());
  const [items, setItems] = useState<any[]>([]);
  const [editing, setEditingState] = useState<any>(() => emptyItem(jstSchoolYear()));
  // 単元の入力欄は入力中の文字列をそのまま持ち、保存時に1行1単元へ分ける（改行が消えないように）。
  const [unitsText, setUnitsText] = useState('');
  const setEditing = (item: any) => {
    setEditingState(item);
    setUnitsText(Array.isArray(item?.units) ? item.units.join('\n') : '');
  };
  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);
  const [loadError, setLoadError] = useState('');
  const toast = useToast();
  const confirm = useConfirm();

  const request = async (url: string, init: RequestInit = {}) => {
    const token = await auth.currentUser?.getIdToken();
    const response = await fetch(url, { ...init, headers: { ...(init.body ? { 'Content-Type': 'application/json' } : {}), ...(token ? { Authorization: `Bearer ${token}` } : {}), ...(init.headers || {}) } });
    const data = await response.json().catch(() => ({}));
    if (!response.ok || data.ok === false) throw new Error(data.error || '処理に失敗しました');
    return data;
  };

  const load = async () => {
    setLoading(true);
    setLoadError('');
    try {
      const data = await request(`/api/admin/test-prep-courses?year=${year}`);
      setItems(data.items || []);
    } catch (error: any) {
      console.error(error);
      setLoadError(error.message || '読み込みに失敗しました');
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
      const units = Array.from(new Set(unitsText.split(/\r?\n/).map(value => value.trim()).filter(Boolean)));
      const data = await request('/api/admin/test-prep-courses', { method: 'POST', body: JSON.stringify({ ...editing, units }) });
      await load();
      setEditing(emptyItem(year));
      toast.success(data.item?.id ? '対策講座・単元を保存しました。' : '保存しました。');
    } catch (error: any) {
      console.error(error);
      toast.error(error.message || '保存に失敗しました');
    } finally {
      setSaving(false);
    }
  };

  const remove = async (item: any) => {
    if (!(await confirm({
      title: `「${item.title} / ${item.grade} ${item.course_name}」を非公開にしますか？`,
      message: '既存申込の記録は保持されます。',
      confirmLabel: '非公開にする',
      tone: 'danger',
    }))) return;
    try {
      await request(`/api/admin/test-prep-courses?id=${encodeURIComponent(item.id)}`, { method: 'DELETE' });
      if (editing.id === item.id) setEditing(emptyItem(year));
      await load();
    } catch (error: any) {
      console.error(error);
      toast.error(error.message || '非公開にできませんでした');
    }
  };

  const toggleAllowedGrade = (grade: string) => setEditingState((current: any) => ({
    ...current,
    allowed_student_grades: current.allowed_student_grades.includes(grade)
      ? current.allowed_student_grades.filter((item: string) => item !== grade)
      : [...current.allowed_student_grades, grade],
  }));

  const inputClass = 'mt-2 min-h-11 w-full rounded-input border border-line bg-surface px-3 py-2 text-sm font-medium text-fg outline-none focus:border-accent focus:ring-2 focus:ring-accent/20';
  const fieldLabel = 'text-xs font-bold text-slate-600';
  const dateText = (value: string) => (value && formatDate(value)) || value || '—';

  return (
    <div>
      <div className="space-y-6">
        <div className="flex flex-wrap items-center justify-between gap-3 rounded-btn bg-amber-50 px-4 py-3">
          <p className="text-xs font-medium text-amber-900">生徒が受講登録する対策講座（講座・単元・受付期間・対象学年）を設定します。生徒の「テスト期間一覧」には、復習期間に入る講座だけが表示されます。</p>
          <label className="rounded-btn border border-line bg-surface px-4 py-2 text-xs font-bold text-slate-700">年度 <input type="number" value={year} onChange={event => setYear(Number(event.target.value))} className="ml-2 min-h-9 w-24 rounded-input border border-line bg-surface px-3 py-1.5 text-slate-900 outline-none focus:border-accent" /></label>
        </div>

        <div className="grid gap-6 xl:grid-cols-[420px_minmax(0,1fr)]">
          <section className="rounded-card border border-line bg-surface p-6 shadow-card xl:sticky xl:top-6 xl:self-start">
            <div className="mb-5 flex items-center justify-between"><div><p className="text-xs font-bold text-accent">{editing.id ? '編集中' : '新規追加'}</p><h2 className="text-lg font-bold text-slate-900">対策単元の設定</h2></div>{editing.id && <Button variant="secondary" size="sm" onClick={() => setEditing(emptyItem(year))} icon={<Plus size={14} aria-hidden />}>新規</Button>}</div>
            <div className="space-y-4">
              <label className={`block ${fieldLabel}`}>対策名<input value={editing.title} onChange={event => setEditingState({ ...editing, title: event.target.value })} className={inputClass} placeholder="9月定期テスト対策" /></label>
              <div className="grid grid-cols-3 gap-2">
                <label className={fieldLabel}>学年<select value={editing.grade} onChange={event => setEditingState({ ...editing, grade: event.target.value, allowed_student_grades: [event.target.value] })} className={`${inputClass} px-2`}>{GRADES.map(value => <option key={value}>{value}</option>)}</select></label>
                <label className={fieldLabel}>科目<select value={editing.subject} onChange={event => setEditingState({ ...editing, subject: event.target.value, course_name: COURSES[event.target.value][0] })} className={`${inputClass} px-2`}>{SUBJECTS.map(value => <option key={value}>{value}</option>)}</select></label>
                <label className={fieldLabel}>講座<select value={editing.course_name} onChange={event => setEditingState({ ...editing, course_name: event.target.value })} className={`${inputClass} px-2`}>{COURSES[editing.subject].map(value => <option key={value}>{value}</option>)}</select></label>
              </div>
              <div className="grid grid-cols-2 gap-3"><label className={fieldLabel}>開始日<input type="date" value={editing.start_date} onChange={event => setEditingState({ ...editing, start_date: event.target.value })} className={inputClass} /></label><label className={fieldLabel}>終了日<input type="date" value={editing.end_date} onChange={event => setEditingState({ ...editing, end_date: event.target.value })} className={inputClass} /></label></div>
              <div className="grid grid-cols-2 gap-3"><label className={fieldLabel}>受付開始日<input type="date" value={editing.registration_open_date || ''} onChange={event => setEditingState({ ...editing, registration_open_date: event.target.value })} className={inputClass} /></label><label className={fieldLabel}>受付締切日<input type="date" value={editing.registration_close_date || ''} onChange={event => setEditingState({ ...editing, registration_close_date: event.target.value })} className={inputClass} /></label></div>
              <p className="rounded-btn bg-amber-50 px-3 py-2 text-xs font-medium text-amber-800">受付期間だけ申込できます。締切日の23:59（日本時間）を過ぎると保存できません。</p>
              <label className={`block ${fieldLabel}`}>対策単元（1行に1単元）<textarea value={unitsText} onChange={event => setUnitsText(event.target.value)} className={`${inputClass} h-32 resize-none p-3`} placeholder={'光の性質\n音の性質'} /></label>
              <div><p className={fieldLabel}>登録できる生徒学年</p><div className="mt-2 flex gap-2">{GRADES.map(grade => <label key={grade} className={`flex min-h-10 flex-1 cursor-pointer items-center justify-center rounded-btn border-2 px-3 py-2 text-center text-xs font-bold focus-within:ring-2 focus-within:ring-accent ${editing.allowed_student_grades.includes(grade) ? 'border-accent bg-accent-soft text-accent' : 'border-line text-slate-500'}`}><input type="checkbox" checked={editing.allowed_student_grades.includes(grade)} onChange={() => toggleAllowedGrade(grade)} className="sr-only" />{grade}</label>)}</div></div>
              <label className="flex items-center gap-3 rounded-btn bg-slate-50 px-4 py-3 text-sm font-bold text-slate-700"><input type="checkbox" checked={editing.is_active} onChange={event => setEditingState({ ...editing, is_active: event.target.checked })} className="h-5 w-5 accent-indigo-600" />生徒の登録候補に出す</label>
              <Button fullWidth size="lg" onClick={save} loading={saving} icon={<Save size={18} aria-hidden />}>保存する</Button>
            </div>
          </section>

          <section className="rounded-card border border-line bg-surface p-6 shadow-card">
            <div className="mb-5 flex items-center justify-between"><div><p className="text-xs font-bold text-slate-400">{year}年度</p><h2 className="text-lg font-bold text-slate-900">登録済みの対策講座</h2></div><span className="rounded-full bg-accent-soft px-3 py-1 text-xs font-bold text-accent">{items.length}件</span></div>
            {loading ? <ListSkeleton rows={3} /> : loadError ? <ErrorState message={loadError} onRetry={() => void load()} /> : sortedItems.length === 0 ? <EmptyState icon={CalendarDays} title="まだ対策単元がありません" description="左のフォームから講座と単元を保存すると、ここに表示されます。" /> : <div className="space-y-3">{sortedItems.map(item => <article key={item.id} className={`rounded-card border p-5 ${item.is_active ? 'border-line bg-surface' : 'border-slate-200 bg-slate-50 opacity-70'}`}><div className="flex flex-col gap-4 md:flex-row md:items-start md:justify-between"><button type="button" onClick={() => setEditing({ ...item })} className="flex-1 rounded-btn text-left focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-accent"><div className="flex flex-wrap items-center gap-2"><span className="rounded-full bg-accent-soft px-3 py-1 text-xs font-bold text-accent">{item.grade} {item.subject} {item.course_name}</span>{item.is_active ? <span className="flex items-center gap-1 text-xs font-bold text-emerald-600"><CheckCircle2 size={14} aria-hidden />公開中</span> : <span className="text-xs font-bold text-slate-500">非公開</span>}</div><h3 className="mt-3 text-base font-bold text-slate-900">{item.title}</h3><p className="mt-2 flex items-center gap-2 text-xs font-medium text-slate-500"><CalendarDays size={15} aria-hidden />実施 {dateText(item.start_date)} 〜 {dateText(item.end_date)} / 受付 {dateText(item.registration_open_date)} 〜 {dateText(item.registration_close_date)} / 対象 {item.allowed_student_grades.join('・')}</p><div className="mt-3 flex flex-wrap gap-1.5">{item.units.map((unit: string) => <span key={unit} className="rounded-btn bg-slate-50 px-2.5 py-1 text-xs font-medium text-slate-600 ring-1 ring-slate-100">{unit}</span>)}</div></button>{item.is_active && <IconButton label={`「${item.title} / ${item.grade} ${item.course_name}」を非公開にする`} onClick={() => remove(item)} className="text-rose-400 hover:bg-rose-50 hover:text-rose-600"><Trash2 size={18} aria-hidden /></IconButton>}</div></article>)}</div>}
          </section>
        </div>
      </div>
    </div>
  );
}
