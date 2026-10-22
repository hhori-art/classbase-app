'use client';

import { FormEvent, useCallback, useEffect, useMemo, useState } from 'react';
import { BookOpen, CalendarDays, CheckCircle2, ClipboardCheck, History, Play, RefreshCw, Send, Square, TimerReset, Train } from 'lucide-react';
import { useAuth } from '@/app/context/AuthContext';
import { SHIFT_CATEGORY_LABELS, type AttendanceShiftPlan } from '@/lib/attendance-shift-plan';
import { jstDateKey } from '@/lib/date-key';
import { formatDate, formatTime } from '@/lib/format';
import { hasScienceSocialProgram } from '@/lib/teacher-programs';
import { Button, ButtonLink, Card, EmptyState, ErrorState, IconButton, ListSkeleton, Modal, PageHeader, SectionTitle, StatusPill, useToast } from '@/app/components/ui';
import { resolveAttendanceSchoolCode } from '@/lib/attendance-schools';
import {
  CorrectionRequestList,
  MissingClockModal,
  TimeCorrectionModal,
  correctionFormForRecord,
  correctionRequestsNeedingAttention,
  missingClockFormForDate,
  useCorrectionRequests,
  type CorrectionForm,
  type CorrectionRequest,
  type CorrectionTargetRecord,
  type MissingClockForm,
} from '../correction-requests';

type Interval = { kind: 'before' | 'after' | 'day_off'; start: string; end: string; minutes: number };
type Claim = { id: string; decision: 'apply' | 'decline'; status: string; reason?: string; details?: string; review_note?: string };
type WorkRecord = {
  id: string; date: string; start_time: string; end_time?: string | null; status?: string;
  overtime_intervals: Interval[]; overtime_minutes: number; overtime_claim?: Claim | null;
};
type LessonClaim = { id: string; lesson_date: string; school_name?: string; start_time?: string; end_time?: string; lesson_minutes: number; course_name?: string; details?: string; status: string; review_note?: string };
type TransportClaim = { id: string; expense_date: string; from: string; to: string; amount: number; reason: string; details?: string; status: string; review_note?: string };
type Schedule = { start_time: string; end_time: string; break_minutes: number; work_days: number[] };

const jstToday = () => jstDateKey();
type CurrentRecord = { id: string; date: string; start_time: string; end_time?: string | null };
const CLOCK_ERROR_MESSAGES: Record<string, string> = {
  'clocking is closed after 23:00': '23時以降は打刻できません。打刻を忘れた場合は管理者へ修正を依頼してください。',
  'active work record already exists': '本日はすでに出勤中の勤務記録があります。1日に同じ講師が複数の打刻を作ることはできません。',
  'work record already completed today': '本日はすでに勤務記録が完了しています。1日に同じ講師が複数の打刻を作ることはできません。',
  'work_record_id is required': '出勤中の勤務記録が見つかりません。画面を再読み込みしてください。',
  'work record not found': '出勤中の勤務記録が見つかりません。画面を再読み込みしてください。',
  'work record already clocked out': 'この勤務記録はすでに退勤済みです。画面を再読み込みしてください。',
  'approved work records cannot be changed': '承認済みの勤務記録は変更できません。',
  'work record belongs to another date': '前日以前の勤務記録は退勤打刻できません。管理者へ修正を依頼してください。',
  forbidden: 'この操作を行う権限がありません。',
  'invalid action': '不正な操作です。画面を再読み込みしてください。',
};
const toJapaneseClockError = (message: unknown, fallback: string) => {
  const text = String(message || '');
  return CLOCK_ERROR_MESSAGES[text] || text || fallback;
};
const duration = (minutes: number) => `${Math.floor(minutes / 60)}時間${minutes % 60 ? `${minutes % 60}分` : ''}`;
const time = (value: string) => formatTime(value) || '--:--';
const dayText = (dateKey: string) => formatDate(dateKey) || dateKey;
const statusLabel = (status: string) => ({ pending: '確認待ち', approved: '承認', rejected: '差戻し', not_applied: '申請しない' }[status] || status);
const statusClass = (status: string) => status === 'approved' ? 'bg-success-soft text-success' : status === 'rejected' ? 'bg-danger-soft text-danger' : status === 'not_applied' ? 'bg-slate-100 text-slate-600' : 'bg-warning-soft text-warning';
const intervalKindLabel = (kind: Interval['kind']) => kind === 'before' ? '始業前' : kind === 'after' ? '終業後' : '規定休日';

export default function DedicatedAttendancePage() {
  const { user, profile } = useAuth();
  const toast = useToast();
  const canApproveAttendance = profile?.attendance_school_manager === true;
  const [month, setMonth] = useState(jstToday().slice(0, 7));
  const [records, setRecords] = useState<WorkRecord[]>([]);
  // 本日の打刻状態は表示月と独立して保持する
  const [activeRecord, setActiveRecord] = useState<CurrentRecord | null>(null);
  const [todayRecord, setTodayRecord] = useState<CurrentRecord | null>(null);
  const [lessons, setLessons] = useState<LessonClaim[]>([]);
  const [transport, setTransport] = useState<TransportClaim[]>([]);
  const [todayShiftPlans, setTodayShiftPlans] = useState<AttendanceShiftPlan[]>([]);
  const [schedule, setSchedule] = useState<Schedule>({ start_time: '09:00', end_time: '18:00', break_minutes: 60, work_days: [1, 2, 3, 4, 5] });
  const [loading, setLoading] = useState(true);
  const [working, setWorking] = useState(false);
  const [error, setError] = useState('');
  const [claimTarget, setClaimTarget] = useState<WorkRecord | null>(null);
  const [claimForm, setClaimForm] = useState({ decision: 'apply', reason: '', details: '' });
  const [lessonForm, setLessonForm] = useState({ lesson_date: jstToday(), school_name: '', lesson_minutes: '' });
  const [transportForm, setTransportForm] = useState({ expense_date: jstToday(), from: '', to: '', amount: '', reason: '', details: '' });
  // 打刻修正依頼・打刻忘れ申請（準専任と同じ /api/attendance-corrections を使う）
  const [correctionTarget, setCorrectionTarget] = useState<CorrectionTargetRecord | null>(null);
  const [correctionInitialForm, setCorrectionInitialForm] = useState<CorrectionForm>({ requested_start_time: '', requested_end_time: '', reason: '' });
  const [missingOpen, setMissingOpen] = useState(false);
  const [missingInitialForm, setMissingInitialForm] = useState<MissingClockForm>(() => missingClockFormForDate(jstToday(), ''));
  const corrections = useCorrectionRequests(user, month);
  const correctionAttention = useMemo(() => correctionRequestsNeedingAttention(corrections.requests), [corrections.requests]);
  const profileSchoolId = resolveAttendanceSchoolCode(profile?.school_id || profile?.school_code || profile?.school_name || profile?.school || profile?.classroom || '');

  const load = useCallback(async () => {
    if (!user) return;
    setLoading(true); setError('');
    try {
      const token = await user.getIdToken();
      const today = jstToday();
      const [response, shiftResponse] = await Promise.all([
        fetch(`/api/dedicated-attendance?month=${month}`, { cache: 'no-store', headers: { Authorization: `Bearer ${token}` } }),
        fetch(`/api/attendance-shifts?start=${today}&end=${today}&scope=mine`, { cache: 'no-store', headers: { Authorization: `Bearer ${token}` } }),
      ]);
      const body = await response.json().catch(() => ({}));
      if (!response.ok || body.ok === false) throw new Error(body.error || '専任勤怠を取得できませんでした。');
      const shiftBody = await shiftResponse.json().catch(() => ({}));
      setRecords(Array.isArray(body.records) ? body.records : []);
      setActiveRecord(body.active_record || null);
      setTodayRecord(body.today_record || null);
      setLessons(Array.isArray(body.lessons) ? body.lessons : []);
      setTransport(Array.isArray(body.transport) ? body.transport : []);
      setTodayShiftPlans(shiftResponse.ok && shiftBody.ok
        ? (shiftBody.shifts || []).filter((item: AttendanceShiftPlan) => item.reflect_to_attendance !== false)
        : []);
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
  const pendingCount = useMemo(() => records.filter(record => record.overtime_minutes > 0 && !record.overtime_claim).length, [records]);
  const overtimeTotal = useMemo(() => records.filter(record => record.overtime_claim?.decision === 'apply').reduce((sum, record) => sum + record.overtime_minutes, 0), [records]);
  const lessonTotal = useMemo(() => lessons.reduce((sum, lesson) => sum + Number(lesson.lesson_minutes || 0), 0), [lessons]);

  const openCorrection = (record: CorrectionTargetRecord, request?: CorrectionRequest | null) => {
    setCorrectionTarget(record);
    setCorrectionInitialForm(correctionFormForRecord(record, request));
  };
  const openMissing = (targetDate = jstToday(), request?: CorrectionRequest | null) => {
    setMissingInitialForm(missingClockFormForDate(targetDate, profileSchoolId, request));
    setMissingOpen(true);
  };
  const reopenRequest = (request: CorrectionRequest) => {
    const record = request.work_record_id ? records.find(item => item.id === request.work_record_id) : null;
    if (record) return openCorrection(record, request);
    const targetDate = String(request.target_date || '').slice(0, 10);
    if (!targetDate) return toast.error('申請日を確認できません。新規の打刻忘れ申請から入力してください。');
    openMissing(targetDate, request);
  };
  const afterCorrectionSubmitted = async () => {
    setCorrectionTarget(null);
    setMissingOpen(false);
    await corrections.reload();
  };

  const clock = async (action: 'clock_in' | 'clock_out') => {
    if (!user || working) return;
    setWorking(true);
    try {
      const token = await user.getIdToken();
      const response = await fetch('/api/teacher/attendance-clock', {
        method: 'POST', headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${token}` },
        body: JSON.stringify({ action, work_record_id: activeRecord?.id, attendance_kind: 'normal' }),
      });
      const body = await response.json().catch(() => ({}));
      if (!response.ok || body.ok === false) throw new Error(toJapaneseClockError(body.error, '打刻できませんでした。'));
      toast.success(action === 'clock_in' ? '出勤を打刻しました。' : '退勤を打刻しました。時間外候補を確認してください。');
      await load();
    } catch (clockError) { toast.error(clockError instanceof Error ? clockError.message : '打刻できませんでした。'); }
    finally { setWorking(false); }
  };

  const submitOvertime = async (event: FormEvent) => {
    event.preventDefault();
    if (!user || !claimTarget || working) return;
    setWorking(true);
    try {
      const token = await user.getIdToken();
      const response = await fetch('/api/dedicated-attendance', { method: 'POST', headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${token}` }, body: JSON.stringify({ action: 'overtime_decision', work_record_id: claimTarget.id, ...claimForm }) });
      const body = await response.json().catch(() => ({}));
      if (!response.ok || body.ok === false) throw new Error(body.error || '時間外の登録に失敗しました。');
      setClaimTarget(null); toast.success(claimForm.decision === 'apply' ? '時間外を申請しました。' : '「時間外を申請しない」として登録しました。');
      await load();
    } catch (submitError) { toast.error(submitError instanceof Error ? submitError.message : '時間外の登録に失敗しました。'); }
    finally { setWorking(false); }
  };

  const submitLesson = async (event: FormEvent) => {
    event.preventDefault();
    if (!user || working) return;
    setWorking(true);
    try {
      const token = await user.getIdToken();
      const response = await fetch('/api/dedicated-attendance', { method: 'POST', headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${token}` }, body: JSON.stringify({ action: 'lesson_apply', ...lessonForm }) });
      const body = await response.json().catch(() => ({}));
      if (!response.ok || body.ok === false) throw new Error(body.error || '授業時間を申請できませんでした。');
      toast.success(`授業時間を${duration(Number(body.lesson_minutes || 0))}で申請しました。`);
      setMonth(lessonForm.lesson_date.slice(0, 7));
      setLessonForm(current => ({ ...current, lesson_minutes: '' }));
      await load();
    } catch (submitError) { toast.error(submitError instanceof Error ? submitError.message : '授業時間を申請できませんでした。'); }
    finally { setWorking(false); }
  };

  const submitTransport = async (event: FormEvent) => {
    event.preventDefault();
    if (!user || working) return;
    setWorking(true);
    try {
      const token = await user.getIdToken();
      const response = await fetch('/api/dedicated-attendance', { method: 'POST', headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${token}` }, body: JSON.stringify({ action: 'transport_apply', ...transportForm }) });
      const body = await response.json().catch(() => ({}));
      if (!response.ok || body.ok === false) throw new Error(body.error || '交通費を申請できませんでした。');
      toast.success(`交通費 ${Number(body.amount || 0).toLocaleString()}円を申請しました。`);
      setMonth(transportForm.expense_date.slice(0, 7));
      setTransportForm(current => ({ ...current, from: '', to: '', amount: '', reason: '', details: '' }));
      await load();
    } catch (submitError) { toast.error(submitError instanceof Error ? submitError.message : '交通費を申請できませんでした。'); }
    finally { setWorking(false); }
  };

  const inputClass = 'mt-1 min-h-11 w-full rounded-input border border-line bg-surface px-3 py-2.5 text-sm font-medium text-fg outline-none focus:border-accent focus:ring-2 focus:ring-accent/30';
  const labelClass = 'block text-xs font-bold text-fg-muted';
  const overtimeRecords = records.filter(record => record.end_time && record.overtime_minutes > 0);
  const initialLoading = loading && records.length === 0 && !error;
  return (
    <main className="px-4 py-5 text-fg sm:px-6">
      <div className="mx-auto max-w-5xl space-y-5">
        <PageHeader
          tone="plain"
          title="専任勤怠"
          eyebrow="専任"
          backHref={hasScienceSocialProgram(profile) ? '/teacher/work' : undefined}
          description={`${profile?.name || profile?.teacher_name || '専任'} / 規定 ${schedule.start_time}〜${schedule.end_time}（休憩${schedule.break_minutes}分）`}
          actions={<>
            {canApproveAttendance && <ButtonLink href="/teacher/attendance-approvals" variant="secondary" icon={<ClipboardCheck size={17} aria-hidden />}>自校舎の勤怠承認</ButtonLink>}
            <input type="month" aria-label="表示する月" value={month} onChange={event => setMonth(event.target.value)} className="min-h-11 rounded-input border border-line bg-surface px-3 text-sm font-bold text-fg outline-none focus:border-accent focus:ring-2 focus:ring-accent/30" />
            <IconButton label="再読み込み" variant="secondary" onClick={load}><RefreshCw size={17} className={loading ? 'motion-safe:animate-spin' : ''} aria-hidden /></IconButton>
          </>}
        />
        {error && <ErrorState title="専任勤怠を読み込めませんでした" message={error} onRetry={load} />}

        {todayShiftPlans.length > 0 && <Card className="border-indigo-100 bg-indigo-50"><SectionTitle icon={CalendarDays} title="今日の勤務予定" description="承認者が登録したシフトです。" trailing={<span className="rounded-full bg-surface px-3 py-1 text-xs font-bold text-indigo-700 ring-1 ring-indigo-200">{todayShiftPlans.length}件</span>} className="mb-0" /><div className="mt-3 grid gap-2 sm:grid-cols-2">{todayShiftPlans.map(plan => <article key={plan.id} className="rounded-input bg-surface p-3 shadow-sm ring-1 ring-indigo-100"><div className="flex items-center gap-2"><span className="font-mono text-sm font-bold">{plan.start}–{plan.end}</span><span className="rounded-full bg-indigo-100 px-2 py-0.5 text-xs font-bold text-indigo-700">{SHIFT_CATEGORY_LABELS[plan.category]}</span></div><p className="mt-1 truncate text-xs font-medium text-fg-muted">{[plan.title, plan.subject, plan.room].filter(Boolean).join(' ／ ') || '勤務予定'}</p></article>)}</div></Card>}

        <section className="rounded-hero bg-slate-900 p-5 text-white shadow-card"><div className="flex flex-col gap-5 sm:flex-row sm:items-center sm:justify-between"><div><p className="text-xs font-bold text-slate-300">本日の勤務</p><p className="mt-2 text-xl font-black">{activeRecord ? `${time(activeRecord.start_time)} 出勤中` : todayRecord?.end_time ? `${time(todayRecord.start_time)}〜${time(todayRecord.end_time)} 退勤済み` : '未打刻'}</p>{(activeRecord || todayRecord) && <button type="button" onClick={() => openCorrection((activeRecord || todayRecord) as CurrentRecord)} className="mt-2 inline-flex min-h-11 items-center gap-1.5 rounded-btn px-1 text-sm font-bold text-amber-300 underline-offset-4 hover:underline focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-white"><Send size={15} aria-hidden /> 打刻時刻の修正を依頼する</button>}</div>{activeRecord ? <Button variant="danger" size="lg" loading={working} onClick={() => clock('clock_out')} icon={<Square size={20} aria-hidden />} className="min-h-14 px-8">退勤打刻</Button> : <Button size="lg" loading={working} disabled={Boolean(todayRecord)} onClick={() => clock('clock_in')} icon={<Play size={20} aria-hidden />} className="min-h-14 px-8">出勤打刻</Button>}</div></section>

        <section className="grid gap-3 sm:grid-cols-3"><div className="rounded-card bg-warning-soft p-4"><p className="text-xs font-bold text-amber-700">未判断の時間外</p><p className="mt-2 text-2xl font-black text-amber-900">{pendingCount}件</p></div><div className="rounded-card bg-indigo-50 p-4"><p className="text-xs font-bold text-indigo-600">時間外申請計</p><p className="mt-2 text-2xl font-black text-indigo-900">{duration(overtimeTotal)}</p></div><div className="rounded-card bg-success-soft p-4"><p className="text-xs font-bold text-emerald-700">授業申請計</p><p className="mt-2 text-2xl font-black text-emerald-900">{duration(lessonTotal)}</p></div></section>

        <Card>
          <SectionTitle
            icon={History}
            title="打刻の修正・打刻忘れ"
            description="打刻の押し間違いや押し忘れを管理者へ申請します。承認されるまで勤務記録は変わりません。"
            trailing={<div className="flex flex-wrap justify-end gap-1">
              {correctionAttention.some(item => item.status === 'rejected') && <StatusPill tone="danger">却下 {correctionAttention.filter(item => item.status === 'rejected').length}件</StatusPill>}
              {correctionAttention.some(item => item.status === 'pending') && <StatusPill tone="warning">承認待ち {correctionAttention.filter(item => item.status === 'pending').length}件</StatusPill>}
            </div>}
          />
          <Button variant="secondary" fullWidth onClick={() => openMissing()} icon={<Send size={16} aria-hidden />} className="min-h-12 border-amber-200 bg-warning-soft text-amber-700 hover:bg-amber-100">
            打刻を忘れた日の申請をする
          </Button>
          <div className="mt-4">
            <h3 className="mb-2 text-sm font-bold text-fg">この月の打刻</h3>
            {initialLoading ? <ListSkeleton rows={2} /> : records.length === 0 ? (
              !error && <EmptyState icon={History} title="この月の打刻はありません" description="打刻を忘れた日は上のボタンから申請できます。" />
            ) : (
              <ul className="divide-y divide-line rounded-input border border-line">
                {records.map(record => (
                  <li key={record.id} className="flex flex-wrap items-center justify-between gap-2 px-3 py-2">
                    <span className="text-sm font-bold text-fg">{dayText(record.date)} <span className="ml-2 font-mono text-xs text-fg-muted">{time(record.start_time)}〜{record.end_time ? time(record.end_time) : '勤務中'}</span></span>
                    <Button size="sm" variant="secondary" onClick={() => openCorrection(record)} icon={<Send size={14} aria-hidden />} className="text-amber-700">修正を依頼</Button>
                  </li>
                ))}
              </ul>
            )}
          </div>
          <div className="mt-5">
            <h3 className="mb-2 text-sm font-bold text-fg">送信した申請</h3>
            <CorrectionRequestList
              requests={corrections.requests}
              loading={corrections.loading}
              error={corrections.error}
              onRetry={corrections.reload}
              onReopen={reopenRequest}
              emptyTitle="この月の申請はありません"
            />
          </div>
        </Card>

        <Card><SectionTitle icon={TimerReset} title="時間外候補の確認" description="打刻から規定時間外を自動抽出しています。" /><div className="space-y-3">{initialLoading ? <ListSkeleton rows={2} /> : overtimeRecords.map(record => { const canEdit = !record.overtime_claim || ['rejected', 'not_applied'].includes(record.overtime_claim.status); return <article key={record.id} className="rounded-input border border-line p-4"><div className="flex flex-wrap items-center justify-between gap-3"><div><p className="font-bold">{dayText(record.date)} <span className="ml-2 text-accent">{duration(record.overtime_minutes)}</span></p><p className="mt-1 text-xs font-medium text-fg-muted">{record.overtime_intervals.map(interval => `${intervalKindLabel(interval.kind)} ${time(interval.start)}〜${time(interval.end)}`).join(' / ')}</p></div><div className="flex items-center gap-2">{record.overtime_claim && <span className={`rounded-full px-3 py-1 text-xs font-bold ${statusClass(record.overtime_claim.status)}`}>{statusLabel(record.overtime_claim.status)}</span>}{canEdit && <Button size="sm" variant="secondary" onClick={() => { setClaimTarget(record); setClaimForm({ decision: record.overtime_claim?.decision || 'apply', reason: record.overtime_claim?.reason || '', details: record.overtime_claim?.details || '' }); }}>{record.overtime_claim ? '再登録' : '申請するか選ぶ'}</Button>}</div></div>{record.overtime_claim?.reason && <p className="mt-2 text-xs font-medium text-fg-muted">理由: {record.overtime_claim.reason}</p>}</article>; })}{!loading && !error && overtimeRecords.length === 0 && <EmptyState icon={TimerReset} title="この月の時間外候補はありません" />}</div></Card>

        <section className="grid items-start gap-5 lg:grid-cols-[360px_1fr]">
          <form onSubmit={submitLesson} className="cb-card p-card">
            <SectionTitle icon={BookOpen} title="授業時間を申請" description="日付と合計分数だけで完了します。" />
            <label className={labelClass}>授業日<input required type="date" value={lessonForm.lesson_date} onChange={event => setLessonForm({ ...lessonForm, lesson_date: event.target.value })} className={inputClass} /></label>
            <label className={`mt-4 ${labelClass}`}>授業をした校舎<input required value={lessonForm.school_name} onChange={event => setLessonForm({ ...lessonForm, school_name: event.target.value })} className={inputClass} placeholder="所属校舎" /></label>
            <label className={`mt-4 ${labelClass}`}>授業分数<input required type="number" min="1" max="720" inputMode="numeric" value={lessonForm.lesson_minutes} onChange={event => setLessonForm({ ...lessonForm, lesson_minutes: event.target.value })} className={`${inputClass} text-2xl`} placeholder="60" /></label>
            <div className="mt-3 grid grid-cols-4 gap-2">{[30, 45, 60, 90].map(minutes => <button key={minutes} type="button" aria-pressed={lessonForm.lesson_minutes === String(minutes)} onClick={() => setLessonForm({ ...lessonForm, lesson_minutes: String(minutes) })} className={`min-h-11 rounded-btn border text-sm font-bold ${lessonForm.lesson_minutes === String(minutes) ? 'border-accent bg-accent-soft text-accent' : 'border-line text-fg-muted hover:bg-canvas'}`}>{minutes}分</button>)}</div>
            <Button type="submit" variant="secondary" loading={working} fullWidth icon={<Send size={17} aria-hidden />} className="mt-5 min-h-12">この内容で申請</Button>
          </form>
          <Card padded={false} className="overflow-hidden"><div className="border-b border-line p-4"><h2 className="text-base font-bold text-fg">授業申請履歴</h2></div><div className="divide-y divide-line">{initialLoading ? <div className="p-4"><ListSkeleton rows={2} /></div> : lessons.map(lesson => <article key={lesson.id} className="p-4"><div className="flex items-center justify-between gap-3"><div><p className="font-bold">{dayText(lesson.lesson_date)} <span className="ml-2 text-xs text-fg-muted">{lesson.school_name || '校舎未設定'}</span></p><p className="mt-1 text-sm font-bold text-emerald-700">{duration(lesson.lesson_minutes)}</p></div><span className={`rounded-full px-3 py-1 text-xs font-bold ${statusClass(lesson.status)}`}>{statusLabel(lesson.status)}</span></div></article>)}{!loading && !error && lessons.length === 0 && <div className="p-4"><EmptyState icon={BookOpen} title="授業申請はありません" /></div>}</div></Card>
        </section>

        <section className="grid items-start gap-5 lg:grid-cols-[360px_1fr]"><form onSubmit={submitTransport} className="cb-card space-y-3 p-card"><SectionTitle icon={Train} title="移動交通費を申請" description="業務での移動理由と経路を登録します。" /><label className={labelClass}>移動日<input required type="date" value={transportForm.expense_date} onChange={event => setTransportForm({ ...transportForm, expense_date: event.target.value })} className={inputClass} /></label><div className="grid grid-cols-2 gap-2"><label className={labelClass}>出発<input required value={transportForm.from} onChange={event => setTransportForm({ ...transportForm, from: event.target.value })} className={inputClass} /></label><label className={labelClass}>到着<input required value={transportForm.to} onChange={event => setTransportForm({ ...transportForm, to: event.target.value })} className={inputClass} /></label></div><label className={labelClass}>金額（円）<input required type="number" min="1" value={transportForm.amount} onChange={event => setTransportForm({ ...transportForm, amount: event.target.value })} className={inputClass} /></label><label className={labelClass}>移動理由<input required value={transportForm.reason} onChange={event => setTransportForm({ ...transportForm, reason: event.target.value })} className={inputClass} placeholder="例：他校舎での会議" /></label><label className={labelClass}>詳細・備考<textarea value={transportForm.details} onChange={event => setTransportForm({ ...transportForm, details: event.target.value })} className={`${inputClass} min-h-20`} /></label><Button type="submit" variant="secondary" loading={working} fullWidth icon={<Send size={17} aria-hidden />} className="min-h-12">交通費を申請</Button></form><Card padded={false} className="overflow-hidden"><div className="border-b border-line p-4"><h2 className="text-base font-bold text-fg">交通費申請履歴</h2></div><div className="divide-y divide-line">{initialLoading ? <div className="p-4"><ListSkeleton rows={2} /></div> : transport.map(item => <article key={item.id} className="p-4"><div className="flex items-center justify-between gap-3"><div><p className="font-bold">{dayText(item.expense_date)} / {item.from}〜{item.to}</p><p className="mt-1 text-xs font-medium text-fg-muted">{item.amount.toLocaleString()}円 / {item.reason}</p></div><span className={`rounded-full px-3 py-1 text-xs font-bold ${statusClass(item.status)}`}>{statusLabel(item.status)}</span></div></article>)}{!loading && !error && transport.length === 0 && <div className="p-4"><EmptyState icon={Train} title="交通費申請はありません" /></div>}</div></Card></section>
      </div>

      <Modal
        open={Boolean(claimTarget)}
        onClose={() => setClaimTarget(null)}
        title="時間外の判断"
        description={claimTarget ? `${dayText(claimTarget.date)} / 自動抽出 ${duration(claimTarget.overtime_minutes)}` : undefined}
        footer={<>
          <Button variant="secondary" onClick={() => setClaimTarget(null)}>キャンセル</Button>
          <Button type="submit" form="overtime-claim-form" loading={working} icon={<CheckCircle2 size={17} aria-hidden />}>登録</Button>
        </>}
      >
        <form id="overtime-claim-form" onSubmit={submitOvertime}>
          <div className="grid grid-cols-2 gap-3"><label className={`flex min-h-11 cursor-pointer items-center justify-center rounded-btn border p-4 text-center text-sm font-bold focus-within:ring-2 focus-within:ring-accent ${claimForm.decision === 'apply' ? 'border-accent bg-accent-soft text-accent' : 'border-line'}`}><input type="radio" className="sr-only" checked={claimForm.decision === 'apply'} onChange={() => setClaimForm({ ...claimForm, decision: 'apply' })} />時間外として申請</label><label className={`flex min-h-11 cursor-pointer items-center justify-center rounded-btn border p-4 text-center text-sm font-bold focus-within:ring-2 focus-within:ring-accent ${claimForm.decision === 'decline' ? 'border-slate-500 bg-slate-100' : 'border-line'}`}><input type="radio" className="sr-only" checked={claimForm.decision === 'decline'} onChange={() => setClaimForm({ ...claimForm, decision: 'decline' })} />申請しない</label></div>
          {claimForm.decision === 'apply' && <label className={`mt-4 ${labelClass}`}>時間外の理由 *<input required value={claimForm.reason} onChange={event => setClaimForm({ ...claimForm, reason: event.target.value })} className={inputClass} placeholder="例：会議・保護者対応" /></label>}
          <label className={`mt-4 ${labelClass}`}>作業の詳細<textarea value={claimForm.details} onChange={event => setClaimForm({ ...claimForm, details: event.target.value })} className={`${inputClass} min-h-24`} placeholder="行った業務を入力" /></label>
        </form>
      </Modal>
      <TimeCorrectionModal
        open={Boolean(correctionTarget)}
        record={correctionTarget}
        initialForm={correctionInitialForm}
        user={user}
        onClose={() => setCorrectionTarget(null)}
        onSubmitted={afterCorrectionSubmitted}
      />
      <MissingClockModal
        open={missingOpen}
        initialForm={missingInitialForm}
        user={user}
        hasRecordOnDate={date => records.some(record => record.date === date) || todayRecord?.date === date || activeRecord?.date === date}
        onClose={() => setMissingOpen(false)}
        onSubmitted={async targetDate => {
          await afterCorrectionSubmitted();
          if (targetDate.slice(0, 7) !== month) setMonth(targetDate.slice(0, 7));
        }}
      />
    </main>
  );
}
