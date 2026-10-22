'use client';

import { useCallback, useEffect, useMemo, useState } from 'react';
import { collection, getDocs, orderBy, query, where } from 'firebase/firestore';
import { CalendarPlus, Pencil, Plus, RefreshCw, Trash2, X } from 'lucide-react';
import { auth, db } from '@/lib/firebase';
import { useAuth } from '@/app/context/AuthContext';
import { hasAdminAppPermission, isConfigurableAdminRole } from '@/lib/admin-app-permissions';
import AdminPageHeader from '@/app/components/master/AdminPageHeader';
import { jstDateKey } from '@/lib/date-key';
import { formatShortDate } from '@/lib/format';
import { Button, ErrorState, Skeleton, useConfirm, useToast } from '@/app/components/ui';

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
  start_date: jstDateKey(),
  end_date: jstDateKey(),
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
  const toast = useToast();
  const confirm = useConfirm();
  const [month, setMonth] = useState(() => jstDateKey().slice(0, 7));
  const [schedules, setSchedules] = useState<MonthlySchedule[]>([]);
  const [loading, setLoading] = useState(true);
  const [loadError, setLoadError] = useState(false);
  const [saving, setSaving] = useState(false);
  const [form, setForm] = useState(initialForm);
  const [editingId, setEditingId] = useState('');
  const [cloningGlobalTitle, setCloningGlobalTitle] = useState('');

  const isMaster = profile?.role === 'master';
  const canManageOwnSchool = Boolean(profile && isConfigurableAdminRole(profile.role) && hasAdminAppPermission(profile.role, profile, 'science_social'));
  const readOnly = !isMaster && !canManageOwnSchool;
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

  const loadSchedules = useCallback(async () => {
    setLoading(true);
    setLoadError(false);
    let failedQueries = 0;
    const onQueryError = (error: unknown) => {
      console.error(error);
      failedQueries += 1;
      return { docs: [] as any[] };
    };
    try {
      const [year, monthNum] = month.split('-').map(Number);
      const start = `${month}-01`;
      const end = `${month}-${String(new Date(year, monthNum, 0).getDate()).padStart(2, '0')}`;
      const rangeSnap = await getDocs(query(
        collection(db, 'monthly_schedules'),
        where('start_date', '<=', end),
        orderBy('start_date', 'asc')
      )).catch(onQueryError);
      const legacySnap = await getDocs(query(
        collection(db, 'monthly_schedules'),
        where('target_date', '>=', start),
        where('target_date', '<=', end),
        orderBy('target_date', 'asc')
      )).catch(onQueryError);
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
      if (failedQueries >= 2) setLoadError(true);
    } catch (e) {
      console.error(e);
      setSchedules([]);
      setLoadError(true);
    } finally {
      setLoading(false);
    }
  }, [isMaster, month, mySchool]);

  useEffect(() => {
    loadSchedules();
  }, [loadSchedules]);

  useEffect(() => {
    if (!profile || isMaster || !mySchool) return;
    setForm(prev => ({ ...prev, school_id: mySchool }));
  }, [profile, isMaster, mySchool]);

  const saveSchedule = async () => {
    if (!form.title.trim()) return toast.error('予定名を入力してください。');
    if (!form.start_date || !form.end_date) return toast.error('開始日と終了日を選択してください。');
    if (form.end_date < form.start_date) return toast.error('終了日は開始日以降の日付を選択してください。');
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
      toast.success(editingId ? '予定を更新しました。' : '予定を登録しました。');
      await loadSchedules();
    } catch (e: any) {
      toast.error(`保存できませんでした。${e.message || e}`);
    } finally {
      setSaving(false);
    }
  };

  const deleteSchedule = async (schedule: MonthlySchedule) => {
    if (!(await confirm({
      title: `「${schedule.title}」を削除しますか？`,
      message: `${formatShortDate(getScheduleStart(schedule))} ～ ${formatShortDate(getScheduleEnd(schedule))}${schedule.school_id ? `／校舎: ${schedule.school_id}` : '／全体予定'}`,
      confirmLabel: '削除する',
      tone: 'danger',
    }))) return;
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
      toast.success(`「${schedule.title}」を削除しました。`);
    } catch (e: any) {
      toast.error(`削除できませんでした。${e.message || e}`);
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
      <AdminPageHeader
        title={readOnly ? '月間予定（閲覧のみ）' : undefined}
        description={<>
          <p>{readOnly ? '自校舎と全体の予定を確認できます。登録・変更はマスター管理者へ依頼してください。' : '登録した予定は生徒・保護者のカレンダーに表示されます。複数日にまたがる予定にも対応しています。'}</p>
          {!isMaster && (
            <div className="mt-3 flex flex-wrap gap-2">
              <div className="inline-flex rounded-full bg-accent-soft px-4 py-2 text-xs font-bold text-accent ring-1 ring-accent/20">
                編集対象校舎: {mySchool || '未設定'}
              </div>
              <div className="inline-flex rounded-full bg-emerald-50 px-4 py-2 text-xs font-bold text-emerald-700 ring-1 ring-emerald-100">
                全体予定も表示中
              </div>
            </div>
          )}
        </>}
        actions={<Button variant="secondary" icon={<RefreshCw size={16} aria-hidden />} onClick={loadSchedules} loading={loading}>再読み込み</Button>}
      />

      <section className={`grid gap-6 ${readOnly ? '' : 'xl:grid-cols-[380px_1fr]'}`}>
        {!readOnly ? <div className="rounded-card border border-line bg-white p-5 shadow-sm">
          <div className="mb-4 flex items-center justify-between gap-3">
            <h2 className="flex items-center gap-2 text-lg font-bold text-slate-900"><CalendarPlus className="text-accent" aria-hidden /> {editingId ? '予定を編集' : '予定を追加'}</h2>
            {editingId && (
              <Button variant="ghost" size="sm" onClick={cancelEdit} icon={<X size={14} aria-hidden />}>
                編集をやめる
              </Button>
            )}
          </div>
          <div className="space-y-4">
            <Field label="予定名" value={form.title} onChange={value => setForm(prev => ({ ...prev, title: value }))} placeholder="例: 休講日 / 模試 / 保護者面談" />
            <label>
              <span className="mb-2 block text-xs font-bold text-slate-500">開始日</span>
              <input type="date" value={form.start_date} onChange={e => setForm(prev => ({ ...prev, start_date: e.target.value, end_date: prev.end_date < e.target.value ? e.target.value : prev.end_date }))} className="w-full rounded-input border border-line bg-slate-50 px-4 py-3 text-sm font-bold outline-none focus:ring-2 focus:ring-accent/20" />
            </label>
            <label>
              <span className="mb-2 block text-xs font-bold text-slate-500">終了日</span>
              <input type="date" value={form.end_date} onChange={e => setForm(prev => ({ ...prev, end_date: e.target.value }))} className="w-full rounded-input border border-line bg-slate-50 px-4 py-3 text-sm font-bold outline-none focus:ring-2 focus:ring-accent/20" />
            </label>
            <label>
              <span className="mb-2 block text-xs font-bold text-slate-500">種別</span>
              <select value={form.category} onChange={e => setForm(prev => ({ ...prev, category: e.target.value }))} className="w-full rounded-input border border-line bg-slate-50 px-4 py-3 text-sm font-bold outline-none focus:ring-2 focus:ring-accent/20">
                {CATEGORY_OPTIONS.map(item => <option key={item.id} value={item.id}>{item.label}</option>)}
              </select>
            </label>
            <label>
              <span className="mb-2 block text-xs font-bold text-slate-500">表示対象</span>
              <select value={form.audience} onChange={e => setForm(prev => ({ ...prev, audience: e.target.value }))} className="w-full rounded-input border border-line bg-slate-50 px-4 py-3 text-sm font-bold outline-none focus:ring-2 focus:ring-accent/20">
                <option value="all">全員</option>
                <option value="student_parent">生徒・保護者</option>
                <option value="parent">保護者のみ</option>
                <option value="student">生徒のみ</option>
              </select>
            </label>
            <div>
              <span className="mb-2 block text-xs font-bold text-slate-500">対象学年</span>
              <div className="grid grid-cols-3 gap-2">
                {['中1', '中2', '中3'].map(grade => (
                  <button key={grade} type="button" aria-pressed={form.grades.includes(grade)} onClick={() => toggleGrade(grade)} className={`min-h-11 rounded-btn border-2 py-2.5 text-sm font-bold ${form.grades.includes(grade) ? 'border-accent/40 bg-accent-soft text-accent' : 'border-slate-100 bg-slate-50 text-slate-500'}`}>
                    {grade}
                  </button>
                ))}
              </div>
              <p className="mt-2 text-xs font-bold text-slate-400">未選択の場合は全学年に表示します。</p>
            </div>
            {isMaster ? (
              <Field label="校舎ID 任意" value={form.school_id} onChange={value => setForm(prev => ({ ...prev, school_id: value }))} placeholder="校舎を限定する場合のみ入力" />
            ) : (
              <label>
                <span className="mb-2 block text-xs font-bold text-slate-500">校舎ID</span>
                <input value={mySchool || '未設定'} readOnly className="w-full rounded-input border border-accent/20 bg-accent-soft px-4 py-3 text-sm font-bold text-accent outline-none" />
                <p className="mt-2 text-xs font-bold text-slate-400">全体予定は表示されます。変更する場合は、この校舎用の予定として保存されます。</p>
              </label>
            )}
            {cloningGlobalTitle && (
              <div className="rounded-btn border border-emerald-100 bg-emerald-50 p-3 text-xs font-bold text-emerald-700">
                「{cloningGlobalTitle}」を元に、{mySchool || 'この校舎'} 用の予定を作成します。全体予定は変更されません。
              </div>
            )}
            <label>
              <span className="mb-2 block text-xs font-bold text-slate-500">詳細</span>
              <textarea value={form.description} onChange={e => setForm(prev => ({ ...prev, description: e.target.value }))} className="min-h-28 w-full resize-none rounded-input border border-line bg-slate-50 px-4 py-3 text-sm font-bold outline-none focus:ring-2 focus:ring-accent/20" placeholder="持ち物・対象・注意事項など" />
            </label>
            <Button size="lg" fullWidth onClick={saveSchedule} loading={saving} icon={editingId || cloningGlobalTitle ? <Pencil size={18} aria-hidden /> : <Plus size={18} aria-hidden />}>
              {editingId ? '更新する' : cloningGlobalTitle ? '校舎用に保存する' : '登録する'}
            </Button>
          </div>
        </div> : null}

        <div className="rounded-card border border-line bg-white p-5 shadow-sm">
          <div className="mb-4 flex flex-col gap-3 sm:flex-row sm:items-center sm:justify-between">
            <h2 className="text-lg font-bold text-slate-900">予定カレンダー</h2>
            <div className="flex flex-col gap-2 sm:items-end">
              <input type="month" aria-label="表示する月" value={month} onChange={e => setMonth(e.target.value)} className="rounded-input border border-slate-200 bg-slate-50 px-4 py-3 text-sm font-bold outline-none focus:ring-2 focus:ring-accent/20" />
              <p className="text-xs font-bold text-slate-400">{readOnly ? '予定名・期間・対象校舎を確認できます。' : '日付をクリックすると開始日・終了日に反映します。'}</p>
            </div>
          </div>
          {loading ? (
            <div role="status" aria-label="読み込み中" className="grid grid-cols-7 gap-1.5">
              {Array.from({ length: 35 }, (_, index) => <Skeleton key={index} className="min-h-24" />)}
            </div>
          ) : loadError ? (
            <ErrorState title="予定を読み込めませんでした" onRetry={loadSchedules} />
          ) : (
            <>
              <div className="mb-2 grid grid-cols-7 text-center text-xs font-bold text-slate-400">
                {['日', '月', '火', '水', '木', '金', '土'].map(day => <div key={day}>{day}</div>)}
              </div>
              <div className="grid grid-cols-7 gap-1.5">
                {days.map(day => day.blank ? <div key={day.key} className="min-h-24 rounded-btn bg-slate-50/50" /> : (
                  <div key={day.key} {...(!readOnly ? { role: 'button', tabIndex: 0, onClick: () => selectCalendarDate(day.date), onKeyDown: (e: React.KeyboardEvent<HTMLDivElement>) => { if (e.key === 'Enter' || e.key === ' ') selectCalendarDate(day.date); } } : {})} className={`min-h-24 rounded-btn border p-2 text-left transition ${!readOnly && scheduleCoversDate({ id: 'draft', title: '', target_date: form.start_date, start_date: form.start_date, end_date: form.end_date }, day.date) ? 'border-accent/30 bg-accent-soft' : 'border-slate-100 bg-slate-50'} ${readOnly ? '' : 'cursor-pointer hover:border-slate-200'}`}>
                    <p className="mb-2 text-sm font-bold text-slate-600">{day.day}</p>
                    <div className="space-y-1">
                      {schedules.filter(item => scheduleCoversDate(item, day.date)).map(item => (
                        <div key={item.id} className="group rounded-btn bg-white p-2 shadow-sm">
                          <div className="flex items-start justify-between gap-1">
                            <p className="line-clamp-2 text-xs font-bold text-slate-700">{item.title}</p>
                            {!readOnly && (isMaster || !item.school_id || item.school_id === mySchool) && (
                              <div className="flex shrink-0 items-center gap-1">
                                <button type="button" onClick={(event) => { event.stopPropagation(); editSchedule(item); }} className="rounded p-0.5 text-slate-400 hover:text-accent" title="編集" aria-label={`「${item.title}」を編集`}><Pencil size={14} aria-hidden /></button>
                                {(isMaster || item.school_id === mySchool) && (
                                  <button type="button" onClick={(event) => { event.stopPropagation(); deleteSchedule(item); }} className="rounded p-0.5 text-slate-400 hover:text-rose-600" title="削除" aria-label={`「${item.title}」を削除`}><Trash2 size={14} aria-hidden /></button>
                                )}
                              </div>
                            )}
                          </div>
                          <p className="mt-1 text-[11px] font-bold text-accent">{CATEGORY_OPTIONS.find(c => c.id === item.category)?.label || item.category}</p>
                          <p className="mt-0.5 text-[11px] font-bold text-slate-400">{formatShortDate(getScheduleStart(item))} - {formatShortDate(getScheduleEnd(item))}</p>
                          <p className="mt-0.5 text-[11px] font-bold text-slate-400">{item.school_id ? `校舎: ${item.school_id}` : '全体予定'}</p>
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
      <span className="mb-2 block text-xs font-bold text-slate-500">{label}</span>
      <input value={value} onChange={e => onChange(e.target.value)} placeholder={placeholder} className="w-full rounded-input border border-line bg-slate-50 px-4 py-3 text-sm font-bold outline-none focus:ring-2 focus:ring-accent/20" />
    </label>
  );
}
