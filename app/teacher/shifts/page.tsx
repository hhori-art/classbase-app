'use client';

import { useState, useEffect } from 'react';
import { useAuth } from '@/app/context/AuthContext';
import { db } from '@/lib/firebase';
import { collection, query, where, getDocs, doc, getDoc } from 'firebase/firestore';
import { CalendarPlus, Trash2, Check, ChevronLeft, ChevronRight, X, Clock, User, CheckSquare, MapPin, CalendarClock, GraduationCap, Lock, Megaphone } from 'lucide-react';
import { Button, ButtonLink, Card, EmptyState, ErrorState, IconButton, ListSkeleton, Modal, PageHeader, StatusPill, useConfirm, useToast } from '@/app/components/ui';
import { ATTENDANCE_SCHOOL_OPTION_GROUPS, ATTENDANCE_SCHOOLS, resolveAttendanceSchool } from '@/lib/attendance-schools';
import { formatShortDate, jstDateKey } from '@/lib/format';
import { DEFAULT_WEEKLY_DAY, WEEKDAY_KEYS, type TeacherAvailabilityProfile, type WeekdayKey, type WeeklyAvailabilityDay } from '@/lib/teacher-weekly-availability';
import { userErrorMessage } from '@/lib/user-error';

// ロール定義
const ROLES = [
  { id: 'main', label: '講師 (授業)' },
  { id: 'sub', label: 'サポート (個別)' },
  { id: 'general', label: '全体サポート' },
  { id: 'office', label: '事務作業' }
];

const WEEKDAY_LABELS: Record<WeekdayKey, string> = { sun: '日', mon: '月', tue: '火', wed: '水', thu: '木', fri: '金', sat: '土' };
const createInitialWeekdays = (workplace = DEFAULT_WEEKLY_DAY.workplace) => Object.fromEntries(
  WEEKDAY_KEYS.map(key => [key, { ...DEFAULT_WEEKLY_DAY, workplace, roles: [...DEFAULT_WEEKLY_DAY.roles] }]),
) as Record<WeekdayKey, WeeklyAvailabilityDay>;

const SUBMIT_ERRORS: Record<string, string> = {
  'date-in-past': '過ぎた日付のシフト希望は提出できません。',
  'invalid-time-range': '開始時刻は終了時刻より前にしてください。',
  'workplace-required': '勤務地を選択してください。',
  'roles-required': '希望役割を1つ以上選択してください。',
  'too-many-dates': '一度に提出できるのは62日分までです。',
};
const WEEKLY_ERRORS: Record<string, string> = {
  'invalid-time-range': '開始時刻は終了時刻より前にしてください。',
  'invalid-time': '時刻の形式が正しくありません。',
  'invalid-workplace': '勤務地は一覧から選択してください。',
  'commitment-required': '予定種別と終了時刻を入力してください。',
  'note-too-long': '補足は200文字以内で入力してください。',
};
const DELETE_ERRORS: Record<string, string> = {
  'locked-date': '当日・過去のシフト希望は取り消せません。教室へ連絡してください。',
  'already-assigned': 'この日はすでに授業に配置されています。代行依頼から調整してください。',
};

/** 校舎一覧（lib/attendance-schools）から選ぶ。一覧にない旧データの値も選択肢に残す。 */
function WorkplaceOptions({ current }: { current: string }) {
  return (
    <>
      {!current && <option value="">勤務地を選択</option>}
      {current && !ATTENDANCE_SCHOOLS.includes(current) && <option value={current}>{current}</option>}
      {ATTENDANCE_SCHOOL_OPTION_GROUPS.map(group => (
        <optgroup key={group.label} label={group.label}>
          {group.schools.map(school => <option key={school.code} value={school.name}>{school.name}</option>)}
        </optgroup>
      ))}
    </>
  );
}

export default function TeacherShiftSubmissionPage() {
  const { user, profile } = useAuth();
  const homeSchool = resolveAttendanceSchool(profile?.school_id || profile?.school_code || profile?.school_name || profile?.school);
  const toast = useToast();
  const confirm = useConfirm();
  
  // 提出済みデータ
  const [submittedShifts, setSubmittedShifts] = useState<any[]>([]);
  
  // フォーム状態
  const [form, setForm] = useState<{ 
    dates: string[], 
    timeType: 'preset' | 'custom', 
    timePreset: string, 
    timeCustomStart: string,
    timeCustomEnd: string,
    workplace: string,
    roles: string[] // 複数選択に変更
  }>({ 
    dates: [], 
    timeType: 'preset',
    timePreset: '19:00 - 22:00',
    timeCustomStart: '18:00',
    timeCustomEnd: '21:00',
    workplace: '',
    roles: ['main'] // デフォルトでメイン講師を選択
  });
  
  const [loading, setLoading] = useState(false);
  const [dataLoading, setDataLoading] = useState(true);
  const [currentMonth, setCurrentMonth] = useState(new Date());
  const [weeklyModalOpen, setWeeklyModalOpen] = useState(false);
  const [weeklySaving, setWeeklySaving] = useState(false);
  const [weeklyProfile, setWeeklyProfile] = useState<Record<WeekdayKey, WeeklyAvailabilityDay>>(createInitialWeekdays);
  const [loadError, setLoadError] = useState(false);
  const [deletingId, setDeletingId] = useState<string | null>(null);
  // 授業に配置済みの日付（取り消し不可）と、その日の講師配置ID
  const [assignedShiftByDate, setAssignedShiftByDate] = useState<Map<string, string>>(new Map());

  useEffect(() => {
    if (!homeSchool) return;
    setForm(prev => (prev.workplace ? prev : { ...prev, workplace: homeSchool }));
  }, [homeSchool]);

  const authHeaders = async () => ({
    'Content-Type': 'application/json',
    Authorization: `Bearer ${await user!.getIdToken()}`,
  });

  // シフト取得処理
  const fetchMyShifts = async () => {
    if (!user) return;
    setLoadError(false);
    try {
      const today = jstDateKey();
      const q = query(
        collection(db, 'teacher_availability'),
        where('teacher_id', '==', user.uid),
        where('available_date', '>=', today)
      );
      const legacyQ = query(
        collection(db, 'teacher_availability'),
        where('user_id', '==', user.uid),
        where('available_date', '>=', today)
      );
      
      const [snapshot, legacySnapshot, profileSnapshot, ownShifts] = await Promise.all([
        getDocs(q),
        getDocs(legacyQ),
        getDoc(doc(db, 'teacher_availability_profiles', user.uid)),
        authHeaders()
          .then(headers => fetch('/api/teacher/substitutions', { headers }))
          .then(async res => (res.ok ? (await res.json()).shifts as { id: string; target_date: string }[] : []))
          .catch(() => [] as { id: string; target_date: string }[]),
      ]);
      const assigned = new Map<string, string>();
      ownShifts.forEach(shift => { if (!assigned.has(shift.target_date)) assigned.set(shift.target_date, shift.id); });
      setAssignedShiftByDate(assigned);
      const byId = new Map<string, any>();
      snapshot.docs.forEach(doc => byId.set(doc.id, { id: doc.id, ...doc.data() }));
      legacySnapshot.docs.forEach(doc => byId.set(doc.id, { id: doc.id, ...doc.data() }));
      const data = Array.from(byId.values());
      data.sort((a: any, b: any) => a.available_date.localeCompare(b.available_date));
      setSubmittedShifts(data);
      if (profileSnapshot.exists()) {
        const profile = profileSnapshot.data() as TeacherAvailabilityProfile;
        const next = createInitialWeekdays(homeSchool || DEFAULT_WEEKLY_DAY.workplace);
        WEEKDAY_KEYS.forEach(key => {
          if (profile.weekdays?.[key]) next[key] = { ...next[key], ...profile.weekdays[key] };
        });
        setWeeklyProfile(next);
      } else {
        if (homeSchool) setWeeklyProfile(createInitialWeekdays(homeSchool));
        setWeeklyModalOpen(true);
      }
    } catch (e) {
      console.error('Fetch error:', e);
      setLoadError(true);
    } finally {
      setDataLoading(false);
    }
  };

  useEffect(() => { 
    if(user) fetchMyShifts(); 
  }, [user]);

  const toggleDate = (dateStr: string) => {
    setForm(prev => {
      if (prev.dates.includes(dateStr)) {
        return { ...prev, dates: prev.dates.filter(d => d !== dateStr) };
      } else {
        return { ...prev, dates: [...prev.dates, dateStr].sort() };
      }
    });
  };

  // 役割トグル
  const toggleRole = (roleId: string) => {
    setForm(prev => {
      if (prev.roles.includes(roleId)) {
        // 最低1つは選択必須にするなら length check
        return { ...prev, roles: prev.roles.filter(r => r !== roleId) };
      } else {
        return { ...prev, roles: [...prev.roles, roleId] };
      }
    });
  };

  // 一括提出処理
  const handleSubmit = async () => {
    if (form.dates.length === 0) return toast.error('日付を1つ以上選択してください');
    if (form.roles.length === 0) return toast.error('希望役割を1つ以上選択してください');
    const workplace = form.workplace;
    if (!workplace) return toast.error('勤務地を選択してください');
    const today = jstDateKey();
    if (form.dates.some(date => date < today)) return toast.error('過ぎた日付のシフト希望は提出できません');
    
    // 時間文字列の生成
    let finalTime = form.timePreset;
    if (form.timeType === 'custom') {
      if (!form.timeCustomStart || !form.timeCustomEnd) return toast.error('開始・終了時間を入力してください');
      if (form.timeCustomStart >= form.timeCustomEnd) return toast.error('開始時刻は終了時刻より前にしてください');
      finalTime = `${form.timeCustomStart} - ${form.timeCustomEnd}`;
    }

    // 役割ラベルの生成
    const roleLabels = form.roles.map(r => ROLES.find(item => item.id === r)?.label).filter(Boolean).join(' / ');
    const note = `希望: ${roleLabels}`;

    const ok = await confirm({
      title: `${form.dates.length}件のシフトを一括提出しますか？`,
      message: <span className="whitespace-pre-line">{`勤務地: ${workplace}\n時間: ${finalTime}\n役割: ${roleLabels}`}</span>,
      confirmLabel: '一括提出する',
    });
    if (!ok) return;
    
    if (!user) return;
    setLoading(true);

    try {
      // 過去日の拒否・重複除外・講師名の設定はサーバー側で行う。
      const res = await fetch('/api/teacher/shifts', {
        method: 'POST',
        headers: await authHeaders(),
        body: JSON.stringify({ dates: form.dates, time_range: finalTime, workplace, roles: form.roles }),
      });
      const data = await res.json().catch(() => ({}));
      if (!res.ok || data.ok === false) {
        toast.error(SUBMIT_ERRORS[data.error] || `提出できませんでした。${data.error || ''}`);
        return;
      }
      await fetchMyShifts();
      setForm(prev => ({ ...prev, dates: [] }));
      toast.success(data.skipped?.length ? `提出しました（提出済みの${data.skipped.length}日は除きました）` : '提出しました');

    } catch (error: any) {
      toast.error('エラーが発生しました: ' + error.message);
    } finally {
      setLoading(false);
    }
  };

  const handleDelete = async (id: string) => {
    const ok = await confirm({ title: 'このシフト希望を取り消しますか？', tone: 'danger', confirmLabel: '取り消す' });
    if (!ok) return;
    if (!user) return;
    setDeletingId(id);
    try {
      const res = await fetch(`/api/teacher/shifts?id=${encodeURIComponent(id)}`, { method: 'DELETE', headers: await authHeaders() });
      const data = await res.json().catch(() => ({}));
      if (!res.ok || data.ok === false) {
        toast.error(DELETE_ERRORS[data.error] || `取り消せませんでした。${data.error || ''}`);
        return;
      }
      setSubmittedShifts(prev => prev.filter(item => item.id !== id));
      toast.success('シフト希望を取り消しました');
    } catch (e: any) {
      toast.error('削除エラー: ' + e.message);
    } finally {
      setDeletingId(null);
    }
  };

  const updateWeeklyDay = (key: WeekdayKey, patch: Partial<WeeklyAvailabilityDay>) => {
    setWeeklyProfile(previous => ({
      ...previous,
      [key]: { ...previous[key], ...patch },
    }));
  };

  const saveWeeklyProfile = async () => {
    if (!user) return;
    const missingCommitment = WEEKDAY_KEYS.find(key => {
      const day = weeklyProfile[key];
      return day.status !== 'available' && (!day.commitment_type || !day.commitment_end_time);
    });
    if (missingCommitment) {
      toast.error(`${WEEKDAY_LABELS[missingCommitment]}曜日の予定種別と終了時刻を入力してください。`);
      return;
    }
    setWeeklySaving(true);
    try {
      // 校舎・時刻の検査と講師名の設定はサーバー側で行い、本人の設定にだけ保存する。
      const res = await fetch('/api/teacher/availability-profile', {
        method: 'PUT',
        headers: await authHeaders(),
        body: JSON.stringify({ weekdays: weeklyProfile }),
      });
      const data = await res.json().catch(() => ({}));
      if (!res.ok || data.ok === false) {
        const dayLabel = data.weekday && data.weekday in WEEKDAY_LABELS ? `${WEEKDAY_LABELS[data.weekday as WeekdayKey]}曜日: ` : '';
        toast.error(`${dayLabel}${WEEKLY_ERRORS[data.error] || `保存できませんでした。${data.error || ''}`}`);
        return;
      }
      setWeeklyModalOpen(false);
      toast.success('基本勤務可能日を保存しました。');
    } catch (error: any) {
      toast.error(`保存できませんでした: ${userErrorMessage(error, '')}`);
    } finally {
      setWeeklySaving(false);
    }
  };

  // カレンダーロジック
  const getDaysInMonth = (year: number, month: number) => new Date(year, month + 1, 0).getDate();
  const getFirstDayOfMonth = (year: number, month: number) => new Date(year, month, 1).getDay();

  const year = currentMonth.getFullYear();
  const month = currentMonth.getMonth();
  const daysInMonth = getDaysInMonth(year, month);
  const firstDay = getFirstDayOfMonth(year, month);
  
  const days = [];
  for (let i = 0; i < firstDay; i++) days.push(null);
  for (let i = 1; i <= daysInMonth; i++) days.push(i);

  const prevMonth = () => setCurrentMonth(new Date(year, month - 1, 1));
  const nextMonth = () => setCurrentMonth(new Date(year, month + 1, 1));
  
  const getShiftOnDate = (d: number) => {
    const dateStr = `${year}-${String(month + 1).padStart(2, '0')}-${String(d).padStart(2, '0')}`;
    return submittedShifts.find(item => item.available_date === dateStr);
  };

  if (dataLoading) {
    return (
      <div className="mx-auto max-w-5xl px-4 py-5 sm:px-6">
        <ListSkeleton rows={4} />
      </div>
    );
  }

  const todayKey = jstDateKey();
  const inputClass = 'w-full rounded-input border border-line bg-surface p-3 text-sm font-bold text-slate-700 outline-none focus:ring-2 focus:ring-accent';

  return (
    <div className="px-4 py-5 pb-32 sm:px-6">
      <div className="mx-auto max-w-5xl">

        {/* ヘッダー */}
        <PageHeader
          tone="plain"
          title="シフト希望提出"
          icon={CalendarPlus}
          backHref="/teacher/work"
          className="mb-6"
          actions={(
            <Button variant="secondary" icon={<CalendarClock size={17} />} onClick={() => setWeeklyModalOpen(true)}>
              基本勤務可能日を設定
            </Button>
          )}
        />

        {loadError && (
          <ErrorState className="mb-6" onRetry={() => void fetchMyShifts()} />
        )}

        <div className="grid gap-8 md:grid-cols-2">

          {/* 左カラム: カレンダー */}
          <Card>
            <div className="mb-6 flex items-center justify-between">
              <IconButton label="前の月" onClick={prevMonth}><ChevronLeft /></IconButton>
              <h2 className="text-xl font-bold text-fg">{year}年 {month + 1}月</h2>
              <IconButton label="次の月" onClick={nextMonth}><ChevronRight /></IconButton>
            </div>

            <div className="mb-2 grid grid-cols-7 gap-2 text-center">
              {['日','月','火','水','木','金','土'].map((d, i) => (
                <div key={d} className={`text-xs font-bold ${i===0 ? 'text-rose-400' : i===6 ? 'text-sky-500' : 'text-slate-400'}`}>{d}</div>
              ))}
            </div>

            <div className="grid grid-cols-7 gap-2">
              {days.map((d, i) => {
                if (!d) return <div key={i} className="aspect-square"></div>;

                const dateStr = `${year}-${String(month + 1).padStart(2, '0')}-${String(d).padStart(2, '0')}`;
                const isSelected = form.dates.includes(dateStr);
                const existingShift = getShiftOnDate(d as number);
                const isToday = todayKey === dateStr;
                const isPast = dateStr < todayKey;

                return (
                  <button
                    key={i}
                    type="button"
                    onClick={() => toggleDate(dateStr)}
                    disabled={!!existingShift || isPast}
                    aria-pressed={isSelected}
                    className={`
                      relative flex aspect-square flex-col items-center justify-center rounded-btn text-sm font-bold motion-safe:transition-all motion-safe:duration-200
                      ${isPast ? 'cursor-not-allowed bg-slate-50 opacity-30' : ''}
                      ${isSelected ? 'z-10 bg-accent text-accent-ink shadow-lg motion-safe:scale-105' : 'bg-slate-50 text-slate-700 hover:bg-surface hover:shadow-md motion-safe:hover:scale-105'}
                      ${existingShift ? 'cursor-default border-2 border-info/20 bg-info-soft text-info opacity-80 hover:scale-100 hover:shadow-none' : ''}
                      ${isToday && !isSelected && !existingShift ? 'ring-2 ring-accent ring-offset-2' : ''}
                    `}
                  >
                    <span>{d}</span>
                    {existingShift && <span className="text-xs font-normal">済</span>}
                    {isSelected && <Check size={14} className="absolute right-1 top-1" aria-hidden />}
                  </button>
                );
              })}
            </div>
            <p className="mt-6 rounded-input bg-slate-50 py-2 text-center text-xs text-fg-muted">
              日付をタップして選択 → 右側で設定して「一括提出」
            </p>
          </Card>

          {/* 右カラム: フォーム & リスト */}
          <div className="space-y-6">

            {/* 一括登録フォーム */}
            <Card className="relative overflow-hidden border-t-4 border-t-accent">
              <h2 className="mb-4 flex items-center gap-2 font-bold text-fg">
                <Check className="rounded-full bg-accent-soft p-1 text-accent" size={20} aria-hidden /> 一括登録設定
              </h2>

              <div className="space-y-6">

                {/* 選択中の日付 */}
                <div>
                  <div className="mb-2 flex items-end justify-between">
                    <label className="text-xs font-bold text-fg-muted">
                      選択中の日付 <span className="text-accent">({form.dates.length}日)</span>
                    </label>
                    {form.dates.length > 0 && (
                      <Button variant="ghost" size="sm" onClick={() => setForm({...form, dates: []})} className="text-danger">全解除</Button>
                    )}
                  </div>

                  <div className="custom-scrollbar flex max-h-[100px] min-h-[60px] flex-wrap content-start gap-2 overflow-y-auto rounded-input border border-line bg-slate-50 p-3">
                    {form.dates.length > 0 ? (
                      form.dates.map(date => (
                        <span key={date} className="flex items-center gap-1 rounded-input border border-line bg-surface py-1 pl-2 pr-1 text-xs font-bold text-slate-700 shadow-sm">
                          {Number(date.slice(8, 10))}日
                          <button type="button" onClick={() => toggleDate(date)} aria-label={`${formatShortDate(date)}の選択を外す`} className="inline-flex h-7 w-7 items-center justify-center rounded-input text-slate-400 hover:text-danger"><X size={12} aria-hidden /></button>
                        </span>
                      ))
                    ) : <span className="w-full py-2 text-center text-xs text-fg-muted">左のカレンダーから選択</span>}
                  </div>
                </div>

                {/* 勤務地 */}
                <div>
                  <label className="mb-2 flex items-center gap-1 text-xs font-bold text-fg-muted"><MapPin size={12} aria-hidden /> 勤務地</label>
                  <select
                    className={inputClass}
                    value={form.workplace}
                    onChange={e => setForm({...form, workplace: e.target.value})}
                  >
                    <WorkplaceOptions current={form.workplace} />
                  </select>
                </div>

                {/* 時間設定 (タブ切り替え) */}
                <div>
                  <label className="mb-2 flex items-center gap-1 text-xs font-bold text-fg-muted"><Clock size={12} aria-hidden /> 時間帯</label>
                  <div className="mb-3 flex rounded-btn bg-slate-100 p-1">
                    <button
                      type="button"
                      onClick={() => setForm({...form, timeType: 'preset'})}
                      aria-pressed={form.timeType === 'preset'}
                      className={`min-h-9 flex-1 rounded-input py-1.5 text-xs font-bold motion-safe:transition-all ${form.timeType === 'preset' ? 'bg-surface text-accent shadow' : 'text-fg-muted hover:bg-slate-200'}`}
                    >
                      選択
                    </button>
                    <button
                      type="button"
                      onClick={() => setForm({...form, timeType: 'custom'})}
                      aria-pressed={form.timeType === 'custom'}
                      className={`min-h-9 flex-1 rounded-input py-1.5 text-xs font-bold motion-safe:transition-all ${form.timeType === 'custom' ? 'bg-surface text-accent shadow' : 'text-fg-muted hover:bg-slate-200'}`}
                    >
                      自由入力
                    </button>
                  </div>

                  {form.timeType === 'preset' ? (
                    <select
                      className={inputClass}
                      value={form.timePreset}
                      onChange={e => setForm({...form, timePreset: e.target.value})}
                    >
                      <option>19:00 - 22:00</option>
                      <option>19:00 - 20:30</option>
                      <option>20:30 - 22:00</option>
                      <option>18:00 - 22:00</option>
                    </select>
                  ) : (
                    <div className="flex items-center gap-2">
                      <input
                        type="time"
                        aria-label="開始時刻"
                        className={`${inputClass} flex-1 text-center`}
                        value={form.timeCustomStart}
                        onChange={e => setForm({...form, timeCustomStart: e.target.value})}
                      />
                      <span className="font-bold text-slate-400">~</span>
                      <input
                        type="time"
                        aria-label="終了時刻"
                        className={`${inputClass} flex-1 text-center`}
                        value={form.timeCustomEnd}
                        onChange={e => setForm({...form, timeCustomEnd: e.target.value})}
                      />
                    </div>
                  )}
                </div>

                {/* 役割 (複数選択) */}
                <div>
                  <label className="mb-2 flex items-center gap-1 text-xs font-bold text-fg-muted"><User size={12} aria-hidden /> 希望役割 (複数選択可)</label>
                  <div className="grid grid-cols-2 gap-2">
                    {ROLES.map(role => {
                      const isChecked = form.roles.includes(role.id);
                      return (
                        <button
                          key={role.id}
                          type="button"
                          onClick={() => toggleRole(role.id)}
                          aria-pressed={isChecked}
                          className={`
                            flex min-h-11 items-center gap-2 rounded-input border px-3 py-2.5 text-left text-xs font-bold motion-safe:transition-all
                            ${isChecked
                              ? 'border-accent bg-accent-soft text-accent shadow-sm'
                              : 'border-line bg-surface text-slate-600 hover:bg-slate-50'}
                          `}
                        >
                          <div className={`flex h-4 w-4 items-center justify-center rounded border ${isChecked ? 'border-accent bg-accent text-accent-ink' : 'border-slate-300 bg-surface'}`}>
                            {isChecked && <Check size={10} strokeWidth={4} aria-hidden />}
                          </div>
                          {role.label}
                        </button>
                      );
                    })}
                  </div>
                </div>

                <Button
                  size="lg"
                  fullWidth
                  onClick={handleSubmit}
                  loading={loading}
                  disabled={form.dates.length === 0 || form.roles.length === 0}
                  icon={<CalendarPlus size={18} />}
                >
                  一括提出する
                </Button>
              </div>
            </Card>

            {/* 提出済みリスト */}
            <Card>
               <h3 className="mb-3 flex items-center gap-2 text-sm font-bold text-slate-600">
                 <CheckSquare size={16} aria-hidden /> 提出済みのシフト
               </h3>
               <p className="mb-3 text-xs text-fg-muted">当日・過去の分と、授業に配置済みの日は取り消せません。配置済みの日に出られなくなったときは「代行を依頼する」から依頼してください。</p>
               <div className="custom-scrollbar max-h-80 space-y-2 overflow-y-auto pr-1">
                 {submittedShifts.map(item => {
                   const assignedShiftId = assignedShiftByDate.get(item.available_date);
                   const locked = String(item.available_date) <= todayKey || Boolean(assignedShiftId);
                   return (
                   <div key={item.id} className="group flex items-center justify-between rounded-input border border-transparent bg-slate-50 p-3 text-sm motion-safe:transition-colors hover:border-info/30">
                      <div className="flex items-center gap-3">
                        <div className="flex h-10 w-10 shrink-0 flex-col items-center justify-center rounded-input border border-line bg-surface shadow-sm">
                           <span className="text-xs leading-none text-slate-400">{Number(String(item.available_date).slice(5, 7))}/</span>
                           <span className="text-sm font-bold leading-none text-fg">{Number(String(item.available_date).slice(8, 10))}</span>
                        </div>
                        <div className="min-w-0">
                           <div className="flex items-center gap-1 text-xs font-bold text-fg">
                             <Clock size={10} className="text-slate-400" aria-hidden /> {item.time_range}
                           </div>
                           <div className="mt-0.5 flex items-center gap-1 text-xs text-fg-muted">
                             <MapPin size={10} className="text-slate-400" aria-hidden /> {item.workplace || item.location || '勤務地未設定'}
                           </div>
                           <div className="mt-0.5 truncate text-xs text-fg-muted">{item.note}</div>
                        </div>
                      </div>
                      {assignedShiftId ? (
                        <div className="flex shrink-0 flex-col items-end gap-1">
                          <StatusPill tone="success">配置済み</StatusPill>
                          <ButtonLink
                            href={`/teacher/substitutions?shift=${encodeURIComponent(assignedShiftId)}`}
                            variant="ghost"
                            size="sm"
                            icon={<Megaphone size={14} />}
                          >
                            代行を依頼する
                          </ButtonLink>
                        </div>
                      ) : locked ? (
                        <StatusPill tone="neutral" icon={<Lock size={12} aria-hidden />}>変更不可</StatusPill>
                      ) : (
                        <IconButton
                          label={`${formatShortDate(item.available_date)}のシフト希望を取り消す`}
                          onClick={() => void handleDelete(item.id)}
                          disabled={deletingId === item.id}
                          className="text-slate-400 hover:bg-danger-soft hover:text-danger"
                        >
                          <Trash2 size={16} />
                        </IconButton>
                      )}
                   </div>
                   );
                 })}
                 {submittedShifts.length === 0 && !loadError && (
                   <EmptyState title="まだシフト希望がありません" />
                 )}
               </div>
            </Card>
          </div>

        </div>
      </div>

      <Modal
        open={weeklyModalOpen}
        onClose={() => setWeeklyModalOpen(false)}
        title="基本勤務可能日・時間"
        description="通常の一週間を登録してください。日付ごとの提出がある場合は、そちらが優先されます。"
        size="lg"
        footer={(
          <>
            <Button variant="ghost" onClick={() => setWeeklyModalOpen(false)}>キャンセル</Button>
            <Button onClick={saveWeeklyProfile} loading={weeklySaving} icon={<Check size={17} />}>保存する</Button>
          </>
        )}
      >
        <div className="space-y-3">
          {WEEKDAY_KEYS.map(key => {
            const day = weeklyProfile[key];
            const needsCommitment = day.status !== 'available';
            return (
              <div key={key} className="rounded-input border border-line p-3 shadow-sm">
                <div className="grid gap-3 sm:grid-cols-[40px_minmax(0,240px)] sm:items-center">
                  <div className={`flex h-10 w-10 items-center justify-center rounded-full text-sm font-bold ${key === 'sun' ? 'bg-rose-50 text-rose-600' : key === 'sat' ? 'bg-sky-50 text-sky-600' : 'bg-slate-100 text-slate-700'}`}>
                    {WEEKDAY_LABELS[key]}
                  </div>
                  <select
                    value={day.status}
                    onChange={event => updateWeeklyDay(key, { status: event.target.value as WeeklyAvailabilityDay['status'] })}
                    className="min-h-10 rounded-input border border-slate-300 bg-surface px-3 py-2 text-sm font-bold text-slate-700"
                    aria-label={`${WEEKDAY_LABELS[key]}曜日の勤務可否`}
                  >
                    <option value="available">勤務可能</option>
                    <option value="after_commitment">予定終了後なら可能</option>
                    <option value="unavailable">勤務不可</option>
                  </select>

                  {!needsCommitment ? (
                    <div className="grid gap-2 sm:col-span-2 sm:grid-cols-[1fr_auto_1fr_1.2fr] sm:items-center">
                      <input type="time" value={day.start_time} onChange={event => updateWeeklyDay(key, { start_time: event.target.value })} className="min-h-10 rounded-input border border-slate-300 px-3 py-2 text-sm" aria-label={`${WEEKDAY_LABELS[key]}曜日の勤務開始時刻`} />
                      <span className="text-center text-slate-400">〜</span>
                      <input type="time" value={day.end_time} onChange={event => updateWeeklyDay(key, { end_time: event.target.value })} className="min-h-10 rounded-input border border-slate-300 px-3 py-2 text-sm" aria-label={`${WEEKDAY_LABELS[key]}曜日の勤務終了時刻`} />
                      <select value={day.workplace} onChange={event => updateWeeklyDay(key, { workplace: event.target.value })} className="min-h-10 rounded-input border border-slate-300 bg-surface px-3 py-2 text-sm" aria-label={`${WEEKDAY_LABELS[key]}曜日の勤務地`}>
                        <WorkplaceOptions current={day.workplace} />
                      </select>
                    </div>
                  ) : (
                    <div className="grid gap-2 sm:col-span-2 sm:grid-cols-[1fr_1fr_1.5fr]">
                      <label className="relative">
                        <GraduationCap className="pointer-events-none absolute left-3 top-2.5 text-slate-400" size={16} aria-hidden />
                        <select value={day.commitment_type} onChange={event => updateWeeklyDay(key, { commitment_type: event.target.value as WeeklyAvailabilityDay['commitment_type'] })} className="min-h-10 w-full rounded-input border border-slate-300 bg-surface py-2 pl-9 pr-3 text-sm" aria-label={`${WEEKDAY_LABELS[key]}曜日の予定`}>
                          <option value="">予定を選択</option>
                          <option value="university">大学</option>
                          <option value="club">サークル</option>
                          <option value="other">その他</option>
                        </select>
                      </label>
                      <label className="flex items-center gap-2 rounded-input border border-slate-300 px-3">
                        <Clock size={15} className="text-slate-400" aria-hidden />
                        <input type="time" value={day.commitment_end_time} onChange={event => updateWeeklyDay(key, { commitment_end_time: event.target.value })} className="min-h-10 min-w-0 flex-1 py-2 text-sm outline-none" aria-label={`${WEEKDAY_LABELS[key]}曜日の予定終了時刻`} />
                        <span className="whitespace-nowrap text-xs text-fg-muted">まで</span>
                      </label>
                      <input value={day.note} onChange={event => updateWeeklyDay(key, { note: event.target.value })} placeholder="補足（移動時間など・任意）" className="min-h-10 rounded-input border border-slate-300 px-3 py-2 text-sm" aria-label={`${WEEKDAY_LABELS[key]}曜日の補足`} />
                    </div>
                  )}
                </div>
              </div>
            );
          })}
        </div>
      </Modal>
    </div>
  );
}
