'use client';

import { useEffect, useMemo, useState } from 'react';
import Link from 'next/link';
import { collection, getDocs, orderBy, query, where } from 'firebase/firestore';
import { ArrowLeft, CalendarPlus, Loader2, Pencil, Plus, RefreshCw, Trash2, X } from 'lucide-react';
import { auth, db } from '@/lib/firebase';
import { useAuth } from '@/app/context/AuthContext';

const CATEGORY_OPTIONS = [
  { id: 'general', label: '通常予定' },
  { id: 'closed', label: '休講・休校' },
  { id: 'exam', label: 'テスト・模試' },
  { id: 'event', label: 'イベント' },
  { id: 'deadline', label: '締切' },
];

type MonthlySchedule = {
  id: string;
  title: string;
  target_date: string;
  start_date?: string;
  end_date?: string;
  description?: string;
  category?: string;
  audience?: string;
  school_id?: string | null;
  grades?: string[];
  archived?: boolean;
};

const initialForm = {
  title: '',
  start_date: new Date().toISOString().split('T')[0],
  end_date: new Date().toISOString().split('T')[0],
  description: '',
  category: 'general',
  audience: 'all',
  grades: [] as string[],
  school_id: '',
};

const getScheduleStart = (item: MonthlySchedule) => item.start_date || item.target_date || '';
const getScheduleEnd = (item: MonthlySchedule) => item.end_date || item.target_date || getScheduleStart(item);
const scheduleCoversDate = (item: MonthlySchedule, date: string) => {
  const start = getScheduleStart(item);
  const end = getScheduleEnd(item);
  return start <= date && date <= end;
};

export default function MasterMonthlySchedulesPage() {
  const { profile } = useAuth();
  const [month, setMonth] = useState(() => new Date().toISOString().slice(0, 7));
  const [schedules, setSchedules] = useState<MonthlySchedule[]>([]);
  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);
  const [form, setForm] = useState(initialForm);
  const [editingId, setEditingId] = useState('');
  const [cloningGlobalTitle, setCloningGlobalTitle] = useState('');

  const isMaster = profile?.role === 'master';
  const mySchool = useMemo(() => {
    const ids = Array.isArray(profile?.school_ids) ? profile.school_ids : [];
    return ids[0] || profile?.school_id || profile?.school || '';
  }, [profile]);

  const days = useMemo(() => {
    const [year, monthNum] = month.split('-').map(Number);
    const first = new Date(year, monthNum - 1, 1);
    const last = new Date(year, monthNum, 0);
    return Array.from({ length: first.getDay() }, (_, i) => ({ blank: true, key: `blank-${i}` } as any))
      .concat(Array.from({ length: last.getDate() }, (_, index) => {
        const day = index + 1;
        const date = `${month}-${String(day).padStart(2, '0')}`;
        return { date, day, key: date };
      }));
  }, [month]);

  const loadSchedules = async () => {
    setLoading(true);
    try {
      const [year, monthNum] = month.split('-').map(Number);
      const start = `${month}-01`;
      const end = `${month}-${String(new Date(year, monthNum, 0).getDate()).padStart(2, '0')}`;
      const rangeSnap = await getDocs(query(
        collection(db, 'monthly_schedules'),
        where('start_date', '<=', end),
        orderBy('start_date', 'asc')
      )).catch(() => ({ docs: [] as any[] }));
      const legacySnap = await getDocs(query(
        collection(db, 'monthly_schedules'),
        where('target_date', '>=', start),
        where('target_date', '<=', end),
        orderBy('target_date', 'asc')
      )).catch(() => ({ docs: [] as any[] }));
      const merged = new Map<string, MonthlySchedule>();
      [...rangeSnap.docs, ...legacySnap.docs].forEach((doc: any) => {
        const item = { id: doc.id, ...doc.data() } as MonthlySchedule;
        if (!isMaster) {
          const scheduleSchool = item.school_id || '';
          if (scheduleSchool && scheduleSchool !== mySchool) return;
        }
        if (!item.archived && getScheduleStart(item) <= end && getScheduleEnd(item) >= start) merged.set(item.id, item);
      });
      setSchedules(Array.from(merged.values()).sort((a, b) => getScheduleStart(a).localeCompare(getScheduleStart(b))));
    } catch (e) {
      console.error(e);
      setSchedules([]);
    } finally {
      setLoading(false);
    }
  };

  useEffect(() => {
    loadSchedules();
  }, [month, isMaster, mySchool]);

  useEffect(() => {
    if (!profile || isMaster || !mySchool) return;
    setForm(prev => ({ ...prev, school_id: mySchool }));
  }, [profile, isMaster, mySchool]);

  const saveSchedule = async () => {
    if (!form.title.trim()) return alert('予定名を入力してください');
    if (!form.start_date || !form.end_date) return alert('開始日と終了日を選択してください');
    if (form.end_date < form.start_date) return alert('終了日は開始日以降の日付を選択してください');
    setSaving(true);
    try {
      const token = await auth.currentUser?.getIdToken();
      const res = await fetch('/api/monthly-schedules', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${token}` },
        body: JSON.stringify({ action: editingId ? 'update' : 'create', schedule_id: editingId, ...form }),
      });
      const data = await res.json().catch(() => ({}));
      if (!res.ok || data.ok === false) throw new Error(data.error || 'failed');
      setForm(prev => ({ ...initialForm, start_date: prev.start_date, end_date: prev.end_date, school_id: isMaster ? prev.school_id : mySchool }));
      setEditingId('');
      setCloningGlobalTitle('');
      await loadSchedules();
    } catch (e: any) {
      alert(`保存に失敗しました: ${e.message || e}`);
    } finally {
      setSaving(false);
    }
  };

  const deleteSchedule = async (schedule: MonthlySchedule) => {
    if (!confirm(`「${schedule.title}」を削除しますか？`)) return;
    try {
      const token = await auth.currentUser?.getIdToken();
      const res = await fetch('/api/monthly-schedules', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${token}` },
        body: JSON.stringify({ action: 'delete', schedule_id: schedule.id }),
      });
      const data = await res.json().catch(() => ({}));
      if (!res.ok || data.ok === false) throw new Error(data.error || 'failed');
      setSchedules(prev => prev.filter(item => item.id !== schedule.id));
    } catch (e: any) {
      alert(`削除に失敗しました: ${e.message || e}`);
    }
  };

  const editSchedule = (schedule: MonthlySchedule) => {
    const isGlobalSchedule = !schedule.school_id;
    setEditingId(isGlobalSchedule && !isMaster ? '' : schedule.id);
    setCloningGlobalTitle(isGlobalSchedule && !isMaster ? schedule.title || '全体予定' : '');
    setForm({
      title: schedule.title || '',
      start_date: getScheduleStart(schedule),
      end_date: getScheduleEnd(schedule),
      description: schedule.description || '',
      category: schedule.category || 'general',
      audience: schedule.audience || 'all',
      grades: Array.isArray(schedule.grades) ? schedule.grades : [],
      school_id: isMaster ? schedule.school_id || '' : mySchool,
    });
  };

  const cancelEdit = () => {
    setEditingId('');
    setCloningGlobalTitle('');
    setForm(prev => ({ ...initialForm, start_date: prev.start_date, end_date: prev.end_date, school_id: isMaster ? prev.school_id : mySchool }));
  };

  const toggleGrade = (grade: string) => {
    setForm(prev => ({
      ...prev,
      grades: prev.grades.includes(grade) ? prev.grades.filter(item => item !== grade) : [...prev.grades, grade],
    }));
  };

  const selectCalendarDate = (date: string) => {
    setForm(prev => {
      if (!prev.start_date || (prev.start_date && prev.end_date && prev.start_date !== prev.end_date)) {
        return { ...prev, start_date: date, end_date: date };
      }
      if (date < prev.start_date) return { ...prev, start_date: date, end_date: prev.start_date };
      return { ...prev, end_date: date };
    });
  };

  return (
    <div className="space-y-6">
      <section className="rounded-[28px] bg-slate-950 p-6 text-white shadow-xl">
        <div className="flex flex-col gap-4 lg:flex-row lg:items-center lg:justify-between">
          <div className="flex items-center gap-4">
            <Link href="/master" className="rounded-full bg-white/10 p-3 hover:bg-white/20">
              <ArrowLeft size={20} />
            </Link>
            <div>
              <p className="text-xs font-black uppercase tracking-[0.25em] text-indigo-300">Monthly Schedule</p>
              <h1 className="text-2xl font-black">月間予定管理</h1>
              <p className="mt-1 text-sm font-bold text-slate-300">登録した予定は生徒・保護者のカレンダーに表示されます。複数日にまたがる予定にも対応しています。</p>
              {!isMaster && (
                <div className="mt-3 flex flex-wrap gap-2">
                  <div className="inline-flex rounded-2xl bg-white/10 px-4 py-2 text-xs font-black text-indigo-100 ring-1 ring-white/10">
                    編集対象校舎: {mySchool || '未設定'}
                  </div>
                  <div className="inline-flex rounded-2xl bg-white/10 px-4 py-2 text-xs font-black text-emerald-100 ring-1 ring-white/10">
                    全体予定も表示中
                  </div>
                </div>
              )}
            </div>
          </div>
          <button onClick={loadSchedules} className="flex w-fit items-center gap-2 rounded-2xl bg-white px-4 py-3 text-sm font-black text-slate-950 hover:bg-indigo-50">
            <RefreshCw size={18} /> 更新
          </button>
        </div>
      </section>

      <section className="grid gap-6 xl:grid-cols-[380px_1fr]">
        <div className="rounded-[28px] bg-white p-5 shadow-sm">
          <div className="mb-4 flex items-center justify-between gap-3">
            <h2 className="flex items-center gap-2 text-lg font-black text-slate-900"><CalendarPlus className="text-indigo-500" /> {editingId ? '予定を編集' : '予定を追加'}</h2>
            {editingId && (
              <button onClick={cancelEdit} className="flex items-center gap-1 rounded-xl bg-slate-100 px-3 py-2 text-xs font-black text-slate-500 hover:bg-slate-200">
                <X size={14} /> 解除
              </button>
            )}
          </div>
          <div className="space-y-4">
            <Field label="予定名" value={form.title} onChange={value => setForm(prev => ({ ...prev, title: value }))} placeholder="例: 休講日 / 模試 / 保護者面談" />
            <label>
              <span className="mb-2 block text-xs font-black text-slate-500">開始日</span>
              <input type="date" value={form.start_date} onChange={e => setForm(prev => ({ ...prev, start_date: e.target.value, end_date: prev.end_date < e.target.value ? e.target.value : prev.end_date }))} className="w-full rounded-2xl border border-slate-200 bg-slate-50 px-4 py-3 text-sm font-bold outline-none focus:ring-2 focus:ring-indigo-100" />
            </label>
            <label>
              <span className="mb-2 block text-xs font-black text-slate-500">終了日</span>
              <input type="date" value={form.end_date} onChange={e => setForm(prev => ({ ...prev, end_date: e.target.value }))} className="w-full rounded-2xl border border-slate-200 bg-slate-50 px-4 py-3 text-sm font-bold outline-none focus:ring-2 focus:ring-indigo-100" />
            </label>
            <label>
              <span className="mb-2 block text-xs font-black text-slate-500">種別</span>
              <select value={form.category} onChange={e => setForm(prev => ({ ...prev, category: e.target.value }))} className="w-full rounded-2xl border border-slate-200 bg-slate-50 px-4 py-3 text-sm font-bold outline-none focus:ring-2 focus:ring-indigo-100">
                {CATEGORY_OPTIONS.map(item => <option key={item.id} value={item.id}>{item.label}</option>)}
              </select>
            </label>
            <label>
              <span className="mb-2 block text-xs font-black text-slate-500">表示対象</span>
              <select value={form.audience} onChange={e => setForm(prev => ({ ...prev, audience: e.target.value }))} className="w-full rounded-2xl border border-slate-200 bg-slate-50 px-4 py-3 text-sm font-bold outline-none focus:ring-2 focus:ring-indigo-100">
                <option value="all">全員</option>
                <option value="student_parent">生徒・保護者</option>
                <option value="parent">保護者のみ</option>
                <option value="student">生徒のみ</option>
              </select>
            </label>
            <div>
              <span className="mb-2 block text-xs font-black text-slate-500">対象学年</span>
              <div className="grid grid-cols-3 gap-2">
                {['中1', '中2', '中3'].map(grade => (
                  <button key={grade} type="button" onClick={() => toggleGrade(grade)} className={`rounded-2xl border-2 py-3 text-sm font-black ${form.grades.includes(grade) ? 'border-indigo-300 bg-indigo-50 text-indigo-600' : 'border-slate-100 bg-slate-50 text-slate-400'}`}>
                    {grade}
                  </button>
                ))}
              </div>
              <p className="mt-2 text-[11px] font-bold text-slate-400">未選択の場合は全学年に表示します。</p>
            </div>
            {isMaster ? (
              <Field label="校舎ID 任意" value={form.school_id} onChange={value => setForm(prev => ({ ...prev, school_id: value }))} placeholder="校舎を限定する場合のみ入力" />
            ) : (
              <label>
                <span className="mb-2 block text-xs font-black text-slate-500">校舎ID</span>
                <input value={mySchool || '未設定'} readOnly className="w-full rounded-2xl border border-indigo-100 bg-indigo-50 px-4 py-3 text-sm font-black text-indigo-700 outline-none" />
                <p className="mt-2 text-[11px] font-bold text-slate-400">全体予定は表示されます。変更する場合は、この校舎用の予定として保存されます。</p>
              </label>
            )}
            {cloningGlobalTitle && (
              <div className="rounded-2xl border border-emerald-100 bg-emerald-50 p-3 text-xs font-bold text-emerald-700">
                「{cloningGlobalTitle}」を元に、{mySchool || 'この校舎'} 用の予定を作成します。全体予定は変更されません。
              </div>
            )}
            <label>
              <span className="mb-2 block text-xs font-black text-slate-500">詳細</span>
              <textarea value={form.description} onChange={e => setForm(prev => ({ ...prev, description: e.target.value }))} className="min-h-28 w-full resize-none rounded-2xl border border-slate-200 bg-slate-50 px-4 py-3 text-sm font-bold outline-none focus:ring-2 focus:ring-indigo-100" placeholder="持ち物・対象・注意事項など" />
            </label>
            <button onClick={saveSchedule} disabled={saving} className="flex w-full items-center justify-center gap-2 rounded-2xl bg-slate-900 py-4 text-sm font-black text-white hover:bg-slate-800 disabled:opacity-60">
              {saving ? <Loader2 className="animate-spin" size={18} /> : editingId || cloningGlobalTitle ? <Pencil size={18} /> : <Plus size={18} />} {editingId ? '更新する' : cloningGlobalTitle ? '校舎用に保存する' : '登録する'}
            </button>
          </div>
        </div>

        <div className="rounded-[28px] bg-white p-5 shadow-sm">
          <div className="mb-4 flex flex-col gap-3 sm:flex-row sm:items-center sm:justify-between">
            <h2 className="text-lg font-black text-slate-900">予定カレンダー</h2>
            <div className="flex flex-col gap-2 sm:items-end">
              <input type="month" value={month} onChange={e => setMonth(e.target.value)} className="rounded-2xl border border-slate-200 bg-slate-50 px-4 py-3 text-sm font-black outline-none focus:ring-2 focus:ring-indigo-100" />
              <p className="text-[11px] font-bold text-slate-400">日付をクリックすると開始日・終了日に反映します。</p>
            </div>
          </div>
          {loading ? (
            <div className="flex justify-center py-20"><Loader2 className="animate-spin text-indigo-500" /></div>
          ) : (
            <>
              <div className="mb-2 grid grid-cols-7 text-center text-xs font-black text-slate-400">
                {['日', '月', '火', '水', '木', '金', '土'].map(day => <div key={day}>{day}</div>)}
              </div>
              <div className="grid grid-cols-7 gap-1.5">
                {days.map(day => day.blank ? <div key={day.key} className="min-h-24 rounded-2xl bg-slate-50/50" /> : (
                  <div key={day.key} role="button" tabIndex={0} onClick={() => selectCalendarDate(day.date)} onKeyDown={e => { if (e.key === 'Enter' || e.key === ' ') selectCalendarDate(day.date); }} className={`min-h-24 cursor-pointer rounded-2xl border p-2 text-left transition ${scheduleCoversDate({ id: 'draft', title: '', target_date: form.start_date, start_date: form.start_date, end_date: form.end_date }, day.date) ? 'border-indigo-200 bg-indigo-50' : 'border-slate-100 bg-slate-50 hover:border-slate-200'}`}>
                    <p className="mb-2 text-sm font-black text-slate-600">{day.day}</p>
                    <div className="space-y-1">
                      {schedules.filter(item => scheduleCoversDate(item, day.date)).map(item => (
                        <div key={item.id} className="group rounded-xl bg-white p-2 shadow-sm">
                          <div className="flex items-start justify-between gap-1">
                            <p className="line-clamp-2 text-[10px] font-black text-slate-700">{item.title}</p>
                            {(isMaster || !item.school_id || item.school_id === mySchool) && (
                              <div className="flex shrink-0 items-center gap-1">
                                <button onClick={(event) => { event.stopPropagation(); editSchedule(item); }} className="text-slate-300 hover:text-indigo-500" title="編集"><Pencil size={12} /></button>
                                {(isMaster || item.school_id === mySchool) && (
                                  <button onClick={(event) => { event.stopPropagation(); deleteSchedule(item); }} className="text-slate-300 hover:text-rose-500" title="削除"><Trash2 size={12} /></button>
                                )}
                              </div>
                            )}
                          </div>
                          <p className="mt-1 text-[9px] font-bold text-indigo-500">{CATEGORY_OPTIONS.find(c => c.id === item.category)?.label || item.category}</p>
                          <p className="mt-0.5 text-[9px] font-bold text-slate-400">{getScheduleStart(item)} - {getScheduleEnd(item)}</p>
                          <p className="mt-0.5 text-[9px] font-bold text-slate-400">{item.school_id ? `校舎: ${item.school_id}` : '全体予定'}</p>
                        </div>
                      ))}
                    </div>
                  </div>
                ))}
              </div>
            </>
          )}
        </div>
      </section>
    </div>
  );
}

function Field({ label, value, onChange, placeholder }: { label: string; value: string; onChange: (value: string) => void; placeholder?: string }) {
  return (
    <label>
      <span className="mb-2 block text-xs font-black text-slate-500">{label}</span>
      <input value={value} onChange={e => onChange(e.target.value)} placeholder={placeholder} className="w-full rounded-2xl border border-slate-200 bg-slate-50 px-4 py-3 text-sm font-bold outline-none focus:ring-2 focus:ring-indigo-100" />
    </label>
  );
}
