'use client';

import { FormEvent, useCallback, useEffect, useMemo, useState, type ReactNode } from 'react';
import {
  AlertTriangle,
  BookOpen,
  CalendarClock,
  CheckCircle2,
  ClipboardCheck,
  FileCheck2,
  GraduationCap,
  History,
  Play,
  RefreshCw,
  Send,
  Settings2,
  Square,
  Train,
  Trash2,
} from 'lucide-react';
import { useAuth } from '@/app/context/AuthContext';
import { jstDateKey } from '@/lib/date-key';
import { formatDate, formatTime } from '@/lib/format';
import { hasScienceSocialProgram } from '@/lib/teacher-programs';
import { Button, ButtonLink, Card, EmptyState, ErrorState, IconButton, ListSkeleton, Modal, PageHeader, SectionTitle, StatusPill, useConfirm, useToast, type StatusTone } from '@/app/components/ui';
import { resolveAttendanceSchoolCode } from '@/lib/attendance-schools';
import {
  DAY_STATE_LABELS,
  MONTHLY_OVERTIME_LIMIT_MINUTES,
  checkOvertimePlan,
  formatDuration,
  monthDates,
  type DayState,
  type MonthSummary,
} from '@/lib/dedicated-overtime';
import type { DedicatedDay, DedicatedStaff, LessonDoc, PlanDoc, SeasonView, TransportDoc } from '@/lib/dedicated-month';
import { BASELINE_TYPE_LABELS } from '@/lib/dedicated-season';
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
import { userErrorMessage } from '@/lib/user-error';

type CurrentRecord = { id: string; date: string; start_time: string; end_time?: string | null };
type Route = { from: string; to: string; amount: number; reason: string };
type Monthly = { status: string; review_note: string; submitted_at: string | null } | null;
type Data = {
  month: string;
  today: string;
  staff: DedicatedStaff;
  days: DedicatedDay[];
  summary: MonthSummary;
  active_record: CurrentRecord | null;
  today_record: CurrentRecord | null;
  today_plans: PlanDoc[];
  plans: PlanDoc[];
  lessons: LessonDoc[];
  transport: TransportDoc[];
  recent_routes: Route[];
  seasons: SeasonView[];
  monthly: Monthly;
  open_past_records: Array<{ id: string; date: string; start_time: string }>;
  schools: Array<{ id: string; name: string }>;
  previous_month: { month: string; status: string } | null;
};
type Tab = 'days' | 'plans' | 'lessons' | 'transport' | `season:${string}`;

const CLOCK_ERROR_MESSAGES: Record<string, string> = {
  'clocking is closed after 23:00': '23時以降は出勤打刻できません。打刻を忘れた場合は打刻忘れを申請してください。',
  'active work record already exists': '本日はすでに出勤中の勤務記録があります。',
  'work record already completed today': '本日はすでに勤務記録が完了しています。',
  'work_record_id is required': '出勤中の勤務記録が見つかりません。画面を読み込み直してください。',
  'work record not found': '出勤中の勤務記録が見つかりません。画面を読み込み直してください。',
  'work record already clocked out': 'この勤務記録はすでに退勤済みです。画面を読み込み直してください。',
  'approved work records cannot be changed': '承認済みの勤務記録は変更できません。',
  'work record belongs to another date': '前日以前の勤務記録は退勤打刻できません。修正を申請してください。',
  forbidden: 'この操作を行う権限がありません。',
};
const clockError = (message: unknown, fallback: string) => CLOCK_ERROR_MESSAGES[String(message || '')] || String(message || '') || fallback;

const WEEKDAYS = ['日', '月', '火', '水', '木', '金', '土'];
const dayLabel = (date: string) => `${Number(date.slice(5, 7))}/${Number(date.slice(8, 10))}（${WEEKDAYS[new Date(`${date}T12:00:00+09:00`).getUTCDay()]}）`;
const time = (value?: string | null) => (value ? formatTime(value) : '') || '--:--';
const hours = (minutes: number) => formatDuration(minutes);
const STATUS_LABELS: Record<string, string> = { pending: '承認待ち', approved: '承認済み', rejected: '差し戻し', cancelled: '取り消し' };
const STATUS_TONES: Record<string, StatusTone> = { pending: 'warning', approved: 'success', rejected: 'danger', cancelled: 'neutral' };
const STATE_TONES: Record<DayState, StatusTone> = {
  none: 'neutral', match: 'success', under: 'success', not_worked: 'neutral', plan_pending: 'warning',
  needs_report: 'danger', report_pending: 'warning', reported: 'success', report_rejected: 'danger',
};
const inputClass = 'mt-1 min-h-11 w-full rounded-input border border-line bg-surface px-3 py-2.5 text-sm font-medium text-fg outline-none focus:border-accent focus:ring-2 focus:ring-accent/30';
const labelClass = 'block text-xs font-bold text-fg-muted';

export default function DedicatedAttendancePage() {
  const { user, profile } = useAuth();
  const toast = useToast();
  const confirm = useConfirm();
  const canApprove = profile?.attendance_school_manager === true;
  const [month, setMonth] = useState(jstDateKey().slice(0, 7));
  const [data, setData] = useState<Data | null>(null);
  const [loading, setLoading] = useState(true);
  const [working, setWorking] = useState(false);
  const [error, setError] = useState('');
  const [tab, setTab] = useState<Tab>('days');
  // 出勤する校舎（複数校舎の人は選ぶ。打刻APIは出勤時に勤務校舎が必要）。
  const [clockSchool, setClockSchool] = useState('');
  const [reportDay, setReportDay] = useState<DedicatedDay | null>(null);
  const [settingsDay, setSettingsDay] = useState<DedicatedDay | null>(null);
  const [correctionTarget, setCorrectionTarget] = useState<CorrectionTargetRecord | null>(null);
  const [correctionInitialForm, setCorrectionInitialForm] = useState<CorrectionForm>({ requested_start_time: '', requested_end_time: '', reason: '' });
  const [missingOpen, setMissingOpen] = useState(false);
  const [missingInitialForm, setMissingInitialForm] = useState<MissingClockForm>(() => missingClockFormForDate(jstDateKey(), ''));
  const corrections = useCorrectionRequests(user, month);
  const correctionAttention = useMemo(() => correctionRequestsNeedingAttention(corrections.requests), [corrections.requests]);
  const profileSchoolId = resolveAttendanceSchoolCode(profile?.school_id || profile?.school_code || profile?.school_name || profile?.school || profile?.classroom || '');

  const call = useCallback(async (init?: { body: Record<string, unknown> }) => {
    const token = await user!.getIdToken();
    const response = await fetch(init ? '/api/dedicated-attendance' : `/api/dedicated-attendance?month=${month}`, {
      method: init ? 'POST' : 'GET',
      headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${token}` },
      body: init ? JSON.stringify(init.body) : undefined,
      cache: 'no-store',
    });
    const body = await response.json().catch(() => ({}));
    if (!response.ok || body.ok === false) throw new Error(body.error || '処理できませんでした。');
    return body;
  }, [month, user]);

  const load = useCallback(async () => {
    if (!user) return;
    setLoading(true);
    setError('');
    try {
      setData(await call());
    } catch (loadError) {
      setError(userErrorMessage(loadError, '専任勤怠を読み込めませんでした。'));
    } finally {
      setLoading(false);
    }
  }, [call, user]);
  useEffect(() => { void load(); }, [load]);

  const post = async (body: Record<string, unknown>, success: string) => {
    if (working) return false;
    setWorking(true);
    try {
      const result = await call({ body });
      toast.success(success);
      if (Array.isArray(result.warnings) && result.warnings.length) toast.info(result.warnings.join('\n'));
      await load();
      return true;
    } catch (postError) {
      toast.error(userErrorMessage(postError, '処理できませんでした。'));
      return false;
    } finally {
      setWorking(false);
    }
  };

  const clock = async (action: 'clock_in' | 'clock_out') => {
    if (!user || working) return;
    setWorking(true);
    try {
      const token = await user.getIdToken();
      const response = await fetch('/api/teacher/attendance-clock', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${token}` },
        body: JSON.stringify({ action, work_record_id: data?.active_record?.id, attendance_kind: 'normal', school_id: clockSchool || data?.schools?.[0]?.id || profileSchoolId }),
      });
      const body = await response.json().catch(() => ({}));
      if (!response.ok || body.ok === false) throw new Error(clockError(body.error, '打刻できませんでした。'));
      toast.success(action === 'clock_in' ? '出勤を打刻しました。' : '退勤を打刻しました。');
      if (month !== jstDateKey().slice(0, 7)) setMonth(jstDateKey().slice(0, 7));
      else await load();
    } catch (clockFailure) {
      toast.error(userErrorMessage(clockFailure, '打刻できませんでした。'));
    } finally {
      setWorking(false);
    }
  };

  const openCorrection = (record: CorrectionTargetRecord, request?: CorrectionRequest | null) => {
    setCorrectionTarget(record);
    setCorrectionInitialForm(correctionFormForRecord(record, request));
  };
  const openMissing = (targetDate = jstDateKey(), request?: CorrectionRequest | null) => {
    setMissingInitialForm(missingClockFormForDate(targetDate, profileSchoolId, request, { start: data?.staff.schedule.start_time, end: data?.staff.schedule.end_time }));
    setMissingOpen(true);
  };
  const reopenRequest = (request: CorrectionRequest) => {
    const day = data?.days.find(item => item.record?.id === request.work_record_id);
    if (day?.record) return openCorrection({ id: day.record.id, date: day.date, start_time: day.record.start_time, end_time: day.record.end_time }, request);
    const targetDate = String(request.target_date || '').slice(0, 10);
    if (!targetDate) return toast.error('申請日を確認できません。新しく打刻忘れの申請をしてください。');
    openMissing(targetDate, request);
  };

  const today = data?.today || jstDateKey();
  const locked = data?.monthly?.status === 'submitted' || data?.monthly?.status === 'confirmed';
  const todayDay = data?.days.find(day => day.date === today);
  const lastDay = monthDates(month).slice(-1)[0];
  const todo = useMemo(() => {
    if (!data) return [] as Array<{ key: string; tone: 'danger' | 'warning' | 'info'; text: string; action?: { label: string; onClick: () => void } }>;
    const list: Array<{ key: string; tone: 'danger' | 'warning' | 'info'; text: string; action?: { label: string; onClick: () => void } }> = [];
    data.days.filter(day => day.reconciliation.state === 'needs_report' || day.reconciliation.state === 'report_rejected').forEach(day => list.push({
      key: `report_${day.date}`,
      tone: 'danger',
      text: `${dayLabel(day.date)} 予定より ${hours(day.reconciliation.unapproved_minutes)} 長く働いています。理由を報告してください。`,
      action: { label: '報告する', onClick: () => setReportDay(day) },
    }));
    // 前日以前の退勤忘れ（直近14日・月をまたいでも出す）。今日の出勤はそのままできる。
    (data.open_past_records || []).forEach(record => list.push({
      key: `clock_${record.date}`,
      tone: 'danger',
      text: `${dayLabel(record.date)} の退勤打刻がありません。退勤した時刻を申請してください。`,
      action: { label: '修正を申請', onClick: () => openCorrection({ id: record.id, date: record.date, start_time: record.start_time, end_time: null }) },
    }));
    // 月初（1〜3日）は、前の月の報告書の提出を案内する（表示中の月に関係なく）。
    if (data.previous_month && !['submitted', 'confirmed'].includes(data.previous_month.status)) {
      const previous = data.previous_month.month;
      list.push({
        key: 'previous_month',
        tone: 'warning',
        text: `${Number(previous.slice(5))}月の時間外報告書がまだ提出されていません（${Number(today.slice(5, 7))}月3日まで）。`,
        action: { label: `${Number(previous.slice(5))}月を開く`, onClick: () => { setMonth(previous); setTab('days'); } },
      });
    }
    data.plans.filter(plan => plan.status === 'rejected').forEach(plan => list.push({
      key: `plan_${plan.id}`,
      tone: 'warning',
      text: `${dayLabel(plan.date)} の時間外の予定が差し戻されました${plan.review_note ? `：${plan.review_note}` : ''}。直して出し直すか、取り消してください。`,
      action: { label: '予定を見る', onClick: () => setTab('plans') },
    }));
    if (data.monthly?.status === 'returned') list.push({ key: 'monthly', tone: 'warning', text: `月の報告書が差し戻されました${data.monthly.review_note ? `：${data.monthly.review_note}` : ''}。直してもう一度提出してください。` });
    if (!locked && today >= lastDay) {
      list.push({ key: 'submit', tone: 'info', text: `${Number(month.slice(5))}月の時間外報告書（D08）を提出してください（翌月3日まで）。`, action: { label: '提出へ', onClick: () => setTab('days') } });
    }
    return list;
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [data, locked, today, lastDay, month]);

  const initialLoading = loading && !data && !error;
  const seasonTabs = (data?.seasons || []).map(view => ({ id: `season:${view.season.id}` as Tab, label: view.season.name }));
  const tabs: Array<{ id: Tab; label: string; icon: typeof History }> = [
    { id: 'days', label: '勤務と時間外', icon: History },
    { id: 'plans', label: '時間外の予定', icon: CalendarClock },
    ...seasonTabs.map(item => ({ ...item, icon: GraduationCap })),
    { id: 'lessons', label: '授業時間', icon: BookOpen },
    { id: 'transport', label: '交通費', icon: Train },
  ];

  return (
    <main className="px-4 py-5 text-fg sm:px-6">
      <div className="mx-auto max-w-5xl space-y-5">
        <PageHeader
          tone="plain"
          title="専任勤怠"
          eyebrow="専任"
          backHref={hasScienceSocialProgram(profile) ? '/teacher/school-students' : undefined}
          description={data ? `${data.staff.name || '専任'} ／ 所定 ${data.staff.schedule.start_time}〜${data.staff.schedule.end_time}（休憩${data.staff.schedule.break_minutes}分）${data.staff.grade ? ` ／ ${data.staff.grade}等級` : ''}` : undefined}
          actions={<>
            {canApprove && <ButtonLink href="/teacher/attendance-approvals/dedicated" variant="secondary" icon={<ClipboardCheck size={17} aria-hidden />}>専任の承認</ButtonLink>}
            {canApprove && <ButtonLink href="/teacher/attendance-approvals" variant="secondary" icon={<ClipboardCheck size={17} aria-hidden />}>自校舎の勤怠承認</ButtonLink>}
            <input type="month" aria-label="表示する月" value={month} onChange={event => event.target.value && setMonth(event.target.value)} className="min-h-11 rounded-input border border-line bg-surface px-3 text-sm font-bold text-fg outline-none focus:border-accent focus:ring-2 focus:ring-accent/30" />
            <IconButton label="読み込み直す" variant="secondary" onClick={() => void load()}><RefreshCw size={17} className={loading ? 'motion-safe:animate-spin' : ''} aria-hidden /></IconButton>
          </>}
        />
        {error && <ErrorState title="専任勤怠を読み込めませんでした" message={error} onRetry={() => void load()} />}
        {initialLoading && <ListSkeleton rows={4} />}

        {data && (
          <>
            <TodayCard
              data={data}
              todayDay={todayDay}
              working={working}
              onClock={clock}
              onCorrect={record => openCorrection(record)}
              onReport={day => setReportDay(day)}
              clockSchool={clockSchool}
              onClockSchool={setClockSchool}
            />

            {todo.length > 0 && (
              <Card className="space-y-2">
                <SectionTitle icon={AlertTriangle} title="やること" className="mb-1" />
                {todo.map(item => (
                  <div key={item.key} className={`flex flex-wrap items-center justify-between gap-2 rounded-input px-3 py-2 text-sm font-bold ${item.tone === 'danger' ? 'bg-danger-soft text-danger' : item.tone === 'warning' ? 'bg-warning-soft text-amber-800' : 'bg-info-soft text-info'}`}>
                    <span className="min-w-0 flex-1">{item.text}</span>
                    {item.action && <Button size="sm" variant="secondary" onClick={item.action.onClick}>{item.action.label}</Button>}
                  </div>
                ))}
              </Card>
            )}

            <nav aria-label="専任勤怠のメニュー" className="-mx-1 flex gap-1 overflow-x-auto px-1 pb-1">
              {tabs.map(item => {
                const Icon = item.icon;
                const current = tab === item.id;
                return (
                  <button
                    key={item.id}
                    type="button"
                    onClick={() => setTab(item.id)}
                    aria-current={current ? 'page' : undefined}
                    className={`inline-flex min-h-11 shrink-0 items-center gap-1.5 rounded-btn px-3 text-sm font-bold ${current ? 'bg-accent text-white' : 'bg-surface text-fg-muted ring-1 ring-line hover:bg-canvas'}`}
                  >
                    <Icon size={16} aria-hidden />{item.label}
                  </button>
                );
              })}
            </nav>

            {tab === 'days' && (
              <DaysTab
                data={data}
                month={month}
                locked={locked}
                working={working}
                lastDay={lastDay}
                onReport={setReportDay}
                onSettings={setSettingsDay}
                onCorrect={day => day.record && openCorrection({ id: day.record.id, date: day.date, start_time: day.record.start_time, end_time: day.record.end_time })}
                onMissing={() => openMissing()}
                onSubmitMonth={async () => {
                  if (!(await confirm({ title: `${Number(month.slice(5))}月の時間外報告書を提出しますか？`, message: '提出すると、承認者が確認するまでこの月の予定・報告・休憩は直せません。', confirmLabel: '提出する' }))) return;
                  await post({ action: 'month_submit', month }, '月の時間外報告書を提出しました。');
                }}
                corrections={
                  <Card>
                    <SectionTitle
                      icon={History}
                      title="打刻の修正・打刻忘れの申請"
                      trailing={<div className="flex flex-wrap justify-end gap-1">
                        {correctionAttention.some(item => item.status === 'rejected') && <StatusPill tone="danger">却下 {correctionAttention.filter(item => item.status === 'rejected').length}件</StatusPill>}
                        {correctionAttention.some(item => item.status === 'pending') && <StatusPill tone="warning">承認待ち {correctionAttention.filter(item => item.status === 'pending').length}件</StatusPill>}
                      </div>}
                    />
                    <CorrectionRequestList requests={corrections.requests} loading={corrections.loading} error={corrections.error} onRetry={corrections.reload} onReopen={reopenRequest} emptyTitle="この月の申請はありません" />
                  </Card>
                }
              />
            )}
            {tab === 'plans' && <PlansTab data={data} working={working} onSubmit={body => post({ action: 'plan_submit', ...body }, '時間外の予定を申請しました。')} onCancel={async plan => {
              if (!(await confirm({ title: `${dayLabel(plan.date)} ${plan.start}〜${plan.end} の予定を取り消しますか？`, tone: 'danger', confirmLabel: '取り消す' }))) return;
              await post({ action: 'plan_cancel', id: plan.id }, '予定を取り消しました。');
            }} />}
            {tab === 'lessons' && <LessonsTab data={data} working={working} defaultSchool={String(profile?.school_name || profile?.school || '')} onSubmit={body => post({ action: 'lesson_apply', ...body }, '授業時間を申請しました。')} onCancel={async id => { if (await confirm({ title: 'この授業時間の申請を取り下げますか？', tone: 'danger', confirmLabel: '取り下げる' })) await post({ action: 'item_cancel', kind: 'lesson', id }, '取り下げました。'); }} />}
            {tab === 'transport' && <TransportTab data={data} working={working} onSubmit={body => post({ action: 'transport_apply', ...body }, '交通費を申請しました。')} onCancel={async id => { if (await confirm({ title: 'この交通費の申請を取り下げますか？', tone: 'danger', confirmLabel: '取り下げる' })) await post({ action: 'item_cancel', kind: 'transport', id }, '取り下げました。'); }} />}
            {data.seasons.map(view => tab === `season:${view.season.id}` && (
              <SeasonTab
                key={view.season.id}
                view={view}
                staff={data.staff}
                today={today}
                working={working}
                defaultSchool={String(profile?.school_name || profile?.school || '')}
                onAdd={body => post({ action: 'season_lesson_add', season_id: view.season.id, ...body }, '授業を登録しました。')}
                onCancel={async id => { if (await confirm({ title: 'この授業の登録を取り下げますか？', tone: 'danger', confirmLabel: '取り下げる' })) await post({ action: 'item_cancel', kind: 'season_lesson', id }, '取り下げました。'); }}
              />
            ))}
          </>
        )}
      </div>

      <ReportModal day={reportDay} working={working} onClose={() => setReportDay(null)} onSubmit={async body => {
        if (await post({ action: 'report_submit', date: reportDay!.date, ...body }, '時間外の実施報告を出しました。')) setReportDay(null);
      }} />
      <DaySettingsModal day={settingsDay} working={working} onClose={() => setSettingsDay(null)} onSubmit={async body => {
        if (await post({ action: 'day_update', work_record_id: settingsDay!.record!.id, ...body }, 'この日の休憩を直しました。')) setSettingsDay(null);
      }} />
      <TimeCorrectionModal open={Boolean(correctionTarget)} record={correctionTarget} initialForm={correctionInitialForm} user={user} onClose={() => setCorrectionTarget(null)} onSubmitted={async () => { setCorrectionTarget(null); await corrections.reload(); }} />
      <MissingClockModal
        allowScienceSocial={hasScienceSocialProgram(profile)}
        open={missingOpen}
        initialForm={missingInitialForm}
        user={user}
        hasRecordOnDate={date => Boolean(data?.days.some(day => day.date === date && day.record))}
        onClose={() => setMissingOpen(false)}
        onSubmitted={async targetDate => {
          setMissingOpen(false);
          await corrections.reload();
          if (targetDate.slice(0, 7) !== month) setMonth(targetDate.slice(0, 7));
        }}
      />
    </main>
  );
}

function TodayCard({ data, todayDay, working, onClock, onCorrect, onReport, clockSchool, onClockSchool }: {
  data: Data;
  todayDay?: DedicatedDay;
  working: boolean;
  clockSchool: string;
  onClockSchool: (school: string) => void;
  onClock: (action: 'clock_in' | 'clock_out') => void;
  onCorrect: (record: CurrentRecord) => void;
  onReport: (day: DedicatedDay) => void;
}) {
  const active = data.active_record;
  const done = data.today_record?.end_time ? data.today_record : null;
  const needsReport = todayDay && (todayDay.reconciliation.state === 'needs_report' || todayDay.reconciliation.state === 'report_rejected');
  return (
    <section className="rounded-hero bg-slate-900 p-5 text-white shadow-card">
      <div className="flex flex-col gap-5 sm:flex-row sm:items-center sm:justify-between">
        <div className="min-w-0">
          <p className="text-xs font-bold text-slate-300">{formatDate(data.today)} の勤務</p>
          <p className="mt-2 text-xl font-black">{active ? `${time(active.start_time)} 出勤中` : done ? `${time(done.start_time)}〜${time(done.end_time)} 退勤済み` : '未打刻'}</p>
          {data.today_plans.length > 0 && (
            <p className="mt-2 flex flex-wrap gap-1.5 text-xs font-bold">
              {data.today_plans.map(plan => (
                <span key={plan.id} className={`rounded-full px-2.5 py-1 ${plan.status === 'approved' ? 'bg-emerald-500/20 text-emerald-200' : 'bg-amber-500/20 text-amber-200'}`}>
                  時間外の予定 {plan.start}〜{plan.end}（{STATUS_LABELS[plan.status]}）
                </span>
              ))}
            </p>
          )}
          {todayDay?.actual && todayDay.actual.overtime_minutes > 0 && (
            <p className="mt-2 text-sm font-bold text-slate-200">今日の時間外 {hours(todayDay.actual.overtime_minutes)}{todayDay.reconciliation.planned_minutes ? `（予定 ${hours(todayDay.reconciliation.planned_minutes)}）` : ''}</p>
          )}
          {(active || data.today_record) && (
            <button type="button" onClick={() => onCorrect((active || data.today_record) as CurrentRecord)} className="mt-2 inline-flex min-h-11 items-center gap-1.5 rounded-btn px-1 text-sm font-bold text-amber-300 underline-offset-4 hover:underline focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-white">
              <Send size={15} aria-hidden /> 打刻時刻の修正を申請する
            </button>
          )}
        </div>
        <div className="flex flex-col gap-2 sm:items-end">
          {!active && !data.today_record && (data.schools || []).length > 1 && (
            <label className="flex flex-col gap-1 text-xs font-bold text-slate-300">
              出勤する校舎
              <select value={clockSchool || data.schools[0].id} onChange={event => onClockSchool(event.target.value)} className="min-h-11 rounded-input border border-white/20 bg-slate-800 px-3 text-sm font-bold text-white">
                {data.schools.map(school => <option key={school.id} value={school.id}>{school.name}</option>)}
              </select>
            </label>
          )}
          {active
            ? <Button variant="danger" size="lg" loading={working} onClick={() => onClock('clock_out')} icon={<Square size={20} aria-hidden />} className="min-h-14 px-8">退勤打刻</Button>
            : <Button size="lg" loading={working} disabled={Boolean(data.today_record)} onClick={() => onClock('clock_in')} icon={<Play size={20} aria-hidden />} className="min-h-14 px-8">出勤打刻</Button>}
          {needsReport && <Button variant="secondary" onClick={() => onReport(todayDay!)} icon={<Send size={16} aria-hidden />}>予定と違う時間外を報告する</Button>}
        </div>
      </div>
    </section>
  );
}

function SummaryTile({ label, value, tone = 'neutral', note }: { label: string; value: string; tone?: 'neutral' | 'accent' | 'warning' | 'danger'; note?: string }) {
  const tones = { neutral: 'bg-surface ring-1 ring-line', accent: 'bg-accent-soft', warning: 'bg-warning-soft', danger: 'bg-danger-soft' };
  return (
    <div className={`rounded-card p-3 ${tones[tone]}`}>
      <p className="text-xs font-bold text-fg-muted">{label}</p>
      <p className="mt-1 font-mono text-xl font-black text-fg">{value}</p>
      {note && <p className="mt-0.5 text-[11px] font-bold text-fg-muted">{note}</p>}
    </div>
  );
}

function DaysTab({ data, month, locked, working, lastDay, onReport, onSettings, onCorrect, onMissing, onSubmitMonth, corrections }: {
  data: Data;
  month: string;
  locked: boolean;
  working: boolean;
  lastDay: string;
  onReport: (day: DedicatedDay) => void;
  onSettings: (day: DedicatedDay) => void;
  onCorrect: (day: DedicatedDay) => void;
  onMissing: () => void;
  onSubmitMonth: () => void;
  corrections: ReactNode;
}) {
  const visible = data.days.filter(day => day.record || day.plans.length || day.report);
  const summary = data.summary;
  const missingClockOut = data.days.filter(day => day.record && !day.record.end_time && day.date < data.today).length;
  const canSubmit = !locked && data.today >= lastDay && summary.open_days.length === 0 && missingClockOut === 0;
  return (
    <div className="space-y-4">
      <section className="grid grid-cols-2 gap-2 sm:grid-cols-4">
        <SummaryTile label="時間外（支給の対象）" value={hours(summary.payable_minutes)} tone="accent" note={summary.grade_payable_minutes != null && summary.grade_payable_minutes !== summary.payable_minutes ? `手当の対象 ${hours(summary.grade_payable_minutes)}` : undefined} />
        <SummaryTile label="うち深夜（22時〜）" value={hours(summary.payable_night_minutes)} />
        <SummaryTile label="承認された予定" value={hours(summary.planned_minutes)} />
        <SummaryTile label="未承認の時間外" value={hours(summary.unapproved_minutes)} tone={summary.unapproved_minutes ? 'danger' : 'neutral'} note={summary.unapproved_minutes ? '報告して承認されると対象になります' : undefined} />
      </section>
      {summary.over_monthly_limit && <p role="alert" className="rounded-input bg-danger-soft px-3 py-2 text-sm font-bold text-danger">この月の時間外が {hours(summary.actual_minutes)} で、上限の {hours(MONTHLY_OVERTIME_LIMIT_MINUTES)} を超えています。</p>}

      <Card padded={false} className="overflow-hidden">
        <div className="flex flex-wrap items-center justify-between gap-2 border-b border-line p-4">
          <div>
            <h2 className="text-base font-bold text-fg">{Number(month.slice(5))}月の勤務</h2>
            <p className="text-xs font-bold text-fg-muted">打刻から時間外を出し、承認された予定と突き合わせます（8時間を超えた分・公休日は全部）。</p>
          </div>
          <Button size="sm" variant="secondary" onClick={onMissing} icon={<Send size={15} aria-hidden />}>打刻を忘れた日の申請</Button>
        </div>
        {visible.length === 0 ? <div className="p-4"><EmptyState icon={History} title="この月の勤務はまだありません" /></div> : (
          <ul className="divide-y divide-line">
            {visible.map(day => {
              const rec = day.reconciliation;
              const needsReport = rec.state === 'needs_report' || rec.state === 'report_rejected';
              return (
                <li key={day.date} className={`grid gap-2 px-4 py-3 sm:grid-cols-[7rem_1fr_auto] sm:items-center ${needsReport ? 'bg-danger-soft/40' : ''}`}>
                  <p className="whitespace-nowrap text-sm font-black text-fg">{dayLabel(day.date)}{day.actual?.day_off && <span className="ml-1 text-xs text-info sm:ml-0 sm:block">公休日</span>}</p>
                  <div className="min-w-0 text-sm">
                    <p className="font-bold text-fg">
                      {day.record ? <span className="font-mono">{day.actual ? `${day.actual.start}〜${day.actual.end}` : `${time(day.record.start_time)}〜${day.record.end_time ? time(day.record.end_time) : day.date < data.today ? '退勤打刻なし' : '勤務中'}`}</span> : <span className="text-fg-muted">打刻なし</span>}
                      {day.actual && <span className="ml-2 text-xs text-fg-muted">休憩{day.actual.break_minutes}分・実働{hours(day.actual.worked_minutes)}</span>}
                    </p>
                    <p className="mt-0.5 flex flex-wrap items-center gap-x-3 gap-y-1 text-xs font-bold text-fg-muted">
                      {day.actual && day.actual.overtime_minutes > 0 && <span className="text-accent">時間外 {hours(day.actual.overtime_minutes)}{day.actual.night_overtime_minutes ? `（深夜 ${hours(day.actual.night_overtime_minutes)}）` : ''}</span>}
                      {day.plans.map(plan => <span key={plan.id}>予定 {plan.start}〜{plan.end}（{STATUS_LABELS[plan.status]}）</span>)}
                      {day.report && <span>報告：{STATUS_LABELS[day.report.status]}{day.report.review_note ? `（${day.report.review_note}）` : ''}</span>}
                      {day.actual?.warnings.map(warning => <span key={warning} className="text-amber-700">⚠ {warning}</span>)}
                    </p>
                  </div>
                  <div className="flex flex-wrap items-center gap-1.5 sm:justify-end">
                    {rec.state !== 'none' && <StatusPill tone={STATE_TONES[rec.state]}>{DAY_STATE_LABELS[rec.state]}</StatusPill>}
                    {needsReport && !locked && <Button size="sm" onClick={() => onReport(day)} icon={<Send size={14} aria-hidden />}>報告する</Button>}
                    {day.record?.end_time && !locked && <IconButton label={`${dayLabel(day.date)} の休憩・公休日`} size="sm" variant="secondary" onClick={() => onSettings(day)}><Settings2 size={15} /></IconButton>}
                    {day.record && <Button size="sm" variant="ghost" onClick={() => onCorrect(day)}>打刻の修正</Button>}
                  </div>
                </li>
              );
            })}
          </ul>
        )}
      </Card>

      <Card>
        <SectionTitle icon={FileCheck2} title="月の時間外報告書（D08）" description="月末日から提出できます。予定と実績が一致しているかを承認者が確認して、給与に反映します。" />
        {data.monthly && ['submitted', 'confirmed'].includes(data.monthly.status) ? (
          <StatusPill tone={data.monthly.status === 'confirmed' ? 'success' : 'warning'} icon={<CheckCircle2 size={14} aria-hidden />}>{data.monthly.status === 'confirmed' ? '承認者が確認しました' : '提出済み（確認待ち）'}</StatusPill>
        ) : (
          <div className="space-y-2">
            {summary.open_days.length > 0 && <p className="text-sm font-bold text-danger">報告が必要な日が {summary.open_days.length}日 あります。先に報告してください。</p>}
            {missingClockOut > 0 && <p className="text-sm font-bold text-danger">退勤打刻のない日が {missingClockOut}日 あります。先に打刻の修正を申請してください。</p>}
            {summary.waiting_days.length > 0 && <p className="text-sm font-bold text-amber-700">承認待ちの日が {summary.waiting_days.length}日 あります（提出はできます）。</p>}
            <Button onClick={onSubmitMonth} disabled={!canSubmit} loading={working} icon={<FileCheck2 size={17} aria-hidden />}>
              {data.today < lastDay ? `${Number(lastDay.slice(5, 7))}/${Number(lastDay.slice(8))} から提出できます` : 'この月を提出する'}
            </Button>
          </div>
        )}
      </Card>
      {corrections}
    </div>
  );
}

function PlansTab({ data, working, onSubmit, onCancel }: { data: Data; working: boolean; onSubmit: (body: Record<string, unknown>) => Promise<boolean>; onCancel: (plan: PlanDoc) => void }) {
  const [form, setForm] = useState({ date: '', start: data.staff.schedule.end_time, end: '', break_minutes: '0', reason: '', day_off: false });
  const check = form.date && form.start && form.end
    ? checkOvertimePlan({ ...form, break_minutes: Number(form.break_minutes) || 0 }, { today: data.today, endLimit: data.staff.end_limit, individual: true })
    : null;
  const submit = async (event: FormEvent) => {
    event.preventDefault();
    if (await onSubmit({ ...form, break_minutes: Number(form.break_minutes) || 0 })) setForm(current => ({ ...current, date: '', end: '', reason: '' }));
  };
  const upcoming = data.plans;
  return (
    <section className="grid items-start gap-5 lg:grid-cols-[380px_1fr]">
      <form onSubmit={submit} className="cb-card space-y-3 p-card">
        <SectionTitle icon={CalendarClock} title="時間外の予定を申請（D06）" description="実施の2日前までに申請します。校舎でまとめて申請（D05）された予定は自動で載ります。" className="mb-1" />
        <label className={labelClass}>日付<input required type="date" min={data.today} value={form.date} onChange={event => setForm({ ...form, date: event.target.value })} className={inputClass} /></label>
        <div className="grid grid-cols-3 gap-2">
          <label className={labelClass}>開始<input required type="time" step={300} value={form.start} onChange={event => setForm({ ...form, start: event.target.value })} className={inputClass} /></label>
          <label className={labelClass}>終了<input required type="time" step={300} value={form.end} onChange={event => setForm({ ...form, end: event.target.value })} className={inputClass} /></label>
          <label className={labelClass}>休憩（分）<input type="number" min={0} step={5} value={form.break_minutes} onChange={event => setForm({ ...form, break_minutes: event.target.value })} className={inputClass} /></label>
        </div>
        <label className={labelClass}>業務内容（超過理由）<input required value={form.reason} onChange={event => setForm({ ...form, reason: event.target.value })} className={inputClass} placeholder="例：保護者会の準備、三者面談、教室会議（所管：○○部）" /></label>
        <label className="flex min-h-11 items-center gap-2 text-sm font-bold text-fg"><input type="checkbox" checked={form.day_off} onChange={event => setForm({ ...form, day_off: event.target.checked })} className="h-4 w-4 accent-accent" />公休日の出勤（振替なし）</label>
        {check && (
          <div className="rounded-input bg-canvas px-3 py-2 text-xs font-bold">
            <p className="text-fg">時間外 {hours(check.minutes)}{check.night_minutes ? `（うち深夜 ${hours(check.night_minutes)}）` : ''}</p>
            {check.errors.map(text => <p key={text} className="mt-1 text-danger">{text}</p>)}
            {check.warnings.map(text => <p key={text} className="mt-1 text-amber-700">⚠ {text}</p>)}
          </div>
        )}
        <Button type="submit" fullWidth loading={working} disabled={Boolean(check && !check.ok)} icon={<Send size={17} aria-hidden />} className="min-h-12">この予定を申請</Button>
      </form>
      <Card padded={false} className="overflow-hidden">
        <div className="border-b border-line p-4"><h2 className="text-base font-bold text-fg">予定の一覧（この月とこれから）</h2></div>
        {upcoming.length === 0 ? <div className="p-4"><EmptyState icon={CalendarClock} title="時間外の予定はありません" /></div> : (
          <ul className="divide-y divide-line">
            {upcoming.map(plan => (
              <li key={plan.id} className="flex flex-wrap items-center justify-between gap-2 px-4 py-3">
                <div className="min-w-0">
                  <p className="text-sm font-bold text-fg">{dayLabel(plan.date)} <span className="ml-1 font-mono">{plan.start}〜{plan.end}</span><span className="ml-2 text-accent">{hours(plan.minutes)}</span></p>
                  <p className="mt-0.5 text-xs font-bold text-fg-muted">{plan.source === 'bulk' ? '一括申請' : plan.late ? '突発' : '個別申請'}・{plan.reason}{plan.review_note ? `（${plan.review_note}）` : ''}</p>
                </div>
                <div className="flex items-center gap-1.5">
                  <StatusPill tone={STATUS_TONES[plan.status]}>{STATUS_LABELS[plan.status]}</StatusPill>
                  {(plan.status === 'pending' || plan.status === 'rejected' || (plan.status === 'approved' && plan.date >= data.today)) && <IconButton label="予定を取り消す" size="sm" variant="ghost" onClick={() => onCancel(plan)}><Trash2 size={15} /></IconButton>}
                </div>
              </li>
            ))}
          </ul>
        )}
      </Card>
    </section>
  );
}

function LessonsTab({ data, working, defaultSchool, onSubmit, onCancel }: { data: Data; working: boolean; defaultSchool: string; onSubmit: (body: Record<string, unknown>) => Promise<boolean>; onCancel: (id: string) => void }) {
  const [form, setForm] = useState({ lesson_date: data.today, school_name: defaultSchool, lesson_minutes: '' });
  const total = data.lessons.filter(item => item.status !== 'rejected').reduce((sum, item) => sum + item.lesson_minutes, 0);
  return (
    <section className="grid items-start gap-5 lg:grid-cols-[360px_1fr]">
      <form onSubmit={async event => { event.preventDefault(); if (await onSubmit(form)) setForm({ ...form, lesson_minutes: '' }); }} className="cb-card space-y-3 p-card">
        <SectionTitle icon={BookOpen} title="授業時間を申請" description="その日に授業をした合計の分数を入れます（講習期間は講習のタブから授業を登録）。" className="mb-1" />
        <label className={labelClass}>授業日<input required type="date" value={form.lesson_date} onChange={event => setForm({ ...form, lesson_date: event.target.value })} className={inputClass} /></label>
        <label className={labelClass}>校舎<input required value={form.school_name} onChange={event => setForm({ ...form, school_name: event.target.value })} className={inputClass} /></label>
        <label className={labelClass}>授業分数<input required type="number" min={1} max={720} inputMode="numeric" value={form.lesson_minutes} onChange={event => setForm({ ...form, lesson_minutes: event.target.value })} className={`${inputClass} text-2xl`} placeholder="60" /></label>
        <div className="grid grid-cols-4 gap-2">{[45, 60, 90, 120].map(minutes => <button key={minutes} type="button" aria-pressed={form.lesson_minutes === String(minutes)} onClick={() => setForm({ ...form, lesson_minutes: String(minutes) })} className={`min-h-11 rounded-btn border text-sm font-bold ${form.lesson_minutes === String(minutes) ? 'border-accent bg-accent-soft text-accent' : 'border-line text-fg-muted hover:bg-canvas'}`}>{minutes}分</button>)}</div>
        <Button type="submit" fullWidth loading={working} icon={<Send size={17} aria-hidden />} className="min-h-12">申請する</Button>
      </form>
      <Card padded={false} className="overflow-hidden">
        <div className="flex items-center justify-between border-b border-line p-4"><h2 className="text-base font-bold text-fg">この月の授業時間</h2><span className="font-mono text-lg font-black text-accent">{hours(total)}</span></div>
        {data.lessons.length === 0 ? <div className="p-4"><EmptyState icon={BookOpen} title="授業時間の申請はありません" /></div> : (
          <ul className="divide-y divide-line">
            {data.lessons.map(item => (
              <li key={item.id} className="flex items-center justify-between gap-2 px-4 py-3">
                <p className="text-sm font-bold text-fg">{dayLabel(item.lesson_date)} <span className="ml-2 text-xs text-fg-muted">{item.school_name}</span><span className="ml-2 text-accent">{hours(item.lesson_minutes)}</span></p>
                <div className="flex items-center gap-1.5"><StatusPill tone={STATUS_TONES[item.status] || 'neutral'}>{STATUS_LABELS[item.status] || item.status}</StatusPill>{item.status !== 'approved' && <IconButton label="取り下げる" size="sm" variant="ghost" onClick={() => onCancel(item.id)}><Trash2 size={15} /></IconButton>}</div>
              </li>
            ))}
          </ul>
        )}
      </Card>
    </section>
  );
}

function TransportTab({ data, working, onSubmit, onCancel }: { data: Data; working: boolean; onSubmit: (body: Record<string, unknown>) => Promise<boolean>; onCancel: (id: string) => void }) {
  const empty = { expense_date: data.today, from: '', to: '', amount: '', reason: '', details: '' };
  const [form, setForm] = useState(empty);
  const total = data.transport.filter(item => item.status !== 'rejected').reduce((sum, item) => sum + item.amount, 0);
  return (
    <section className="grid items-start gap-5 lg:grid-cols-[360px_1fr]">
      <form onSubmit={async event => { event.preventDefault(); if (await onSubmit(form)) setForm({ ...empty, expense_date: form.expense_date }); }} className="cb-card space-y-3 p-card">
        <SectionTitle icon={Train} title="移動交通費を申請" description="教室間の移動など、通常の通勤区間の外で使った交通費。通勤の高速代はここには入れません。" className="mb-1" />
        {data.recent_routes.length > 0 && (
          <div>
            <p className={labelClass}>前に使った経路</p>
            <div className="mt-1 flex flex-wrap gap-1.5">
              {data.recent_routes.map(route => (
                <button key={`${route.from}_${route.to}_${route.amount}`} type="button" onClick={() => setForm({ ...form, from: route.from, to: route.to, amount: String(route.amount), reason: form.reason || route.reason })} className="min-h-9 rounded-full border border-line px-3 text-xs font-bold text-fg hover:bg-canvas">
                  {route.from}→{route.to} {route.amount.toLocaleString()}円
                </button>
              ))}
            </div>
          </div>
        )}
        <label className={labelClass}>移動日<input required type="date" value={form.expense_date} onChange={event => setForm({ ...form, expense_date: event.target.value })} className={inputClass} /></label>
        <div className="grid grid-cols-2 gap-2">
          <label className={labelClass}>出発<input required value={form.from} onChange={event => setForm({ ...form, from: event.target.value })} className={inputClass} /></label>
          <label className={labelClass}>到着<input required value={form.to} onChange={event => setForm({ ...form, to: event.target.value })} className={inputClass} /></label>
        </div>
        <label className={labelClass}>金額（円・往復なら往復分）<input required type="number" min={1} inputMode="numeric" value={form.amount} onChange={event => setForm({ ...form, amount: event.target.value })} className={inputClass} /></label>
        <label className={labelClass}>移動の理由<input required value={form.reason} onChange={event => setForm({ ...form, reason: event.target.value })} className={inputClass} placeholder="例：他校舎での授業、企画会場への移動" /></label>
        <Button type="submit" fullWidth loading={working} icon={<Send size={17} aria-hidden />} className="min-h-12">申請する</Button>
      </form>
      <Card padded={false} className="overflow-hidden">
        <div className="flex items-center justify-between border-b border-line p-4"><h2 className="text-base font-bold text-fg">この月の交通費</h2><span className="font-mono text-lg font-black text-accent">{total.toLocaleString()}円</span></div>
        {data.transport.length === 0 ? <div className="p-4"><EmptyState icon={Train} title="交通費の申請はありません" /></div> : (
          <ul className="divide-y divide-line">
            {data.transport.map(item => (
              <li key={item.id} className="flex items-center justify-between gap-2 px-4 py-3">
                <div className="min-w-0"><p className="text-sm font-bold text-fg">{dayLabel(item.expense_date)} {item.from}→{item.to}</p><p className="text-xs font-bold text-fg-muted">{item.amount.toLocaleString()}円・{item.reason}{item.review_note ? `（${item.review_note}）` : ''}</p></div>
                <div className="flex items-center gap-1.5"><StatusPill tone={STATUS_TONES[item.status] || 'neutral'}>{STATUS_LABELS[item.status] || item.status}</StatusPill>{item.status !== 'approved' && <IconButton label="取り下げる" size="sm" variant="ghost" onClick={() => onCancel(item.id)}><Trash2 size={15} /></IconButton>}</div>
              </li>
            ))}
          </ul>
        )}
      </Card>
    </section>
  );
}

function SeasonTab({ view, staff, today, working, defaultSchool, onAdd, onCancel }: {
  view: SeasonView;
  staff: DedicatedStaff;
  today: string;
  working: boolean;
  defaultSchool: string;
  onAdd: (body: Record<string, unknown>) => Promise<boolean>;
  onCancel: (id: string) => void;
}) {
  const sections = Array.from(new Set(view.season.courses.map(course => course.section)));
  const defaultDate = today >= view.in_period.start && today <= view.in_period.end ? today : view.in_period.start;
  const [form, setForm] = useState({ date: defaultDate, section: sections[0] || '', course_id: '', count: 1, school_name: defaultSchool });
  const courses = view.season.courses.filter(course => course.section === form.section);
  const course = view.season.courses.find(item => item.id === form.course_id);
  const allowance = view.allowance;
  const progress = allowance.baseline_minutes ? Math.min(100, Math.round(((allowance.lesson_minutes + allowance.pending_minutes) / allowance.baseline_minutes) * 100)) : 0;
  const closed = Boolean(view.season.entry_deadline && today > view.season.entry_deadline);
  return (
    <section className="space-y-4">
      <Card>
        <SectionTitle icon={GraduationCap} title={`${view.season.name}の授業`} description={`期間 ${formatDate(view.in_period.start)}〜${formatDate(view.in_period.end)} ／ 基準は${BASELINE_TYPE_LABELS[staff.baseline_type]}の ${hours(allowance.baseline_minutes)}（${allowance.baseline_minutes.toLocaleString()}分）`} className="mb-3" />
        <div className="h-3 overflow-hidden rounded-full bg-canvas ring-1 ring-line" role="progressbar" aria-valuenow={progress} aria-valuemin={0} aria-valuemax={100} aria-label="基準授業時間に対する登録済みの授業">
          <div className="h-full rounded-full bg-accent" style={{ width: `${progress}%` }} />
        </div>
        <div className="mt-3 grid grid-cols-2 gap-2 sm:grid-cols-4">
          <SummaryTile label="承認済みの授業" value={hours(allowance.lesson_minutes)} note={allowance.pending_minutes ? `承認待ち ${hours(allowance.pending_minutes)}` : undefined} />
          <SummaryTile label="基準授業時間" value={hours(allowance.baseline_minutes)} note={allowance.overtime_deduction_minutes ? `時間外分 −${hours(allowance.overtime_deduction_minutes)}` : undefined} />
          <SummaryTile label="過剰授業時間" value={hours(allowance.excess_minutes)} tone="accent" />
          <SummaryTile label="過剰授業手当（試算）" value={allowance.grade_missing ? '等級未設定' : `${allowance.amount.toLocaleString()}円`} note={allowance.compare_with_overtime ? '時間外勤務手当と比べて多いほう' : allowance.rate ? `時給 ${allowance.rate.toLocaleString()}円` : undefined} />
        </div>
      </Card>
      <section className="grid items-start gap-5 lg:grid-cols-[380px_1fr]">
        <form onSubmit={async event => { event.preventDefault(); if (await onAdd({ date: form.date, course_id: form.course_id, count: form.count, school_name: form.school_name })) setForm({ ...form, course_id: '', count: 1 }); }} className="cb-card space-y-3 p-card">
          <SectionTitle icon={BookOpen} title="担当した授業を登録" description="一覧の授業だけが数えられます。通常授業を講習期間に振り替えたものは入れません。" className="mb-1" />
          {closed && <p className="rounded-input bg-warning-soft px-3 py-2 text-sm font-bold text-amber-800">登録は締め切りました。</p>}
          <label className={labelClass}>授業日<input required type="date" min={view.in_period.start} max={view.in_period.end} value={form.date} onChange={event => setForm({ ...form, date: event.target.value })} className={inputClass} /></label>
          <div className="flex flex-wrap gap-1.5">
            {sections.map(section => <button key={section} type="button" aria-pressed={form.section === section} onClick={() => setForm({ ...form, section, course_id: '' })} className={`min-h-10 rounded-btn border px-3 text-sm font-bold ${form.section === section ? 'border-accent bg-accent-soft text-accent' : 'border-line text-fg-muted'}`}>{section}</button>)}
          </div>
          <label className={labelClass}>授業（学年・教科）
            <select required value={form.course_id} onChange={event => setForm({ ...form, course_id: event.target.value })} className={inputClass}>
              <option value="">選んでください</option>
              {courses.map(item => <option key={item.id} value={item.id}>{item.grade} {item.name}（{item.minutes}分）</option>)}
            </select>
          </label>
          <div className="flex items-end gap-3">
            <label className={`${labelClass} flex-1`}>コマ数<input required type="number" min={1} max={10} value={form.count} onChange={event => setForm({ ...form, count: Math.max(1, Math.min(10, Number(event.target.value) || 1)) })} className={inputClass} /></label>
            <p className="pb-3 font-mono text-lg font-black text-accent">{course ? hours(course.minutes * form.count) : '--:--'}</p>
          </div>
          <label className={labelClass}>校舎<input value={form.school_name} onChange={event => setForm({ ...form, school_name: event.target.value })} className={inputClass} /></label>
          <Button type="submit" fullWidth loading={working} disabled={closed || !form.course_id} icon={<Send size={17} aria-hidden />} className="min-h-12">登録する</Button>
        </form>
        <Card padded={false} className="overflow-hidden">
          <div className="border-b border-line p-4"><h2 className="text-base font-bold text-fg">登録した授業</h2></div>
          {view.lessons.length === 0 ? <div className="p-4"><EmptyState icon={GraduationCap} title="まだ登録はありません" /></div> : (
            <ul className="divide-y divide-line">
              {view.lessons.map(item => (
                <li key={item.id} className="flex items-center justify-between gap-2 px-4 py-3">
                  <div className="min-w-0"><p className="text-sm font-bold text-fg">{dayLabel(item.date)} {item.course_label}</p><p className="text-xs font-bold text-fg-muted">{item.count}コマ・{hours(item.minutes)}{item.review_note ? `（${item.review_note}）` : ''}</p></div>
                  <div className="flex items-center gap-1.5"><StatusPill tone={STATUS_TONES[item.status] || 'neutral'}>{STATUS_LABELS[item.status] || item.status}</StatusPill>{item.status !== 'approved' && !closed && <IconButton label="取り下げる" size="sm" variant="ghost" onClick={() => onCancel(item.id)}><Trash2 size={15} /></IconButton>}</div>
                </li>
              ))}
            </ul>
          )}
        </Card>
      </section>
    </section>
  );
}

function ReportModal({ day, working, onClose, onSubmit }: { day: DedicatedDay | null; working: boolean; onClose: () => void; onSubmit: (body: { reason: string; details: string }) => void }) {
  const [form, setForm] = useState({ reason: '', details: '' });
  useEffect(() => { setForm({ reason: day?.report?.reason || '', details: day?.report?.details || '' }); }, [day]);
  const rec = day?.reconciliation;
  return (
    <Modal
      open={Boolean(day)}
      onClose={onClose}
      closeOnBackdrop={false}
      title="時間外の実施報告（D07）"
      description={day && rec ? `${dayLabel(day.date)} 実績 ${hours(rec.actual_minutes)} ／ 承認された予定 ${hours(rec.planned_minutes)}（${hours(rec.actual_minutes - rec.planned_minutes)} 超過）` : undefined}
      footer={<><Button variant="secondary" onClick={onClose}>やめる</Button><Button type="submit" form="dedicated-report-form" loading={working} icon={<Send size={16} aria-hidden />}>報告する</Button></>}
    >
      <form id="dedicated-report-form" onSubmit={event => { event.preventDefault(); onSubmit(form); }} className="space-y-3">
        {day?.actual && <p className="rounded-input bg-canvas px-3 py-2 text-xs font-bold text-fg-muted">打刻 {day.actual.start}〜{day.actual.end}・休憩{day.actual.break_minutes}分 ／ 時間外 {day.actual.spans.map(span => `${span.start}〜${span.end}`).join('、')}</p>}
        {day?.report?.status === 'rejected' && day.report.review_note && <p className="rounded-input bg-danger-soft px-3 py-2 text-sm font-bold text-danger">差し戻しの理由：{day.report.review_note}</p>}
        <label className={labelClass}>業務内容（超過理由）<input required value={form.reason} onChange={event => setForm({ ...form, reason: event.target.value })} className={inputClass} placeholder="例：保護者対応が長引いたため" /></label>
        <label className={labelClass}>くわしく（会議名・所管の部署・教室業務の内容など）<textarea value={form.details} onChange={event => setForm({ ...form, details: event.target.value })} className={`${inputClass} min-h-24`} /></label>
      </form>
    </Modal>
  );
}

function DaySettingsModal({ day, working, onClose, onSubmit }: { day: DedicatedDay | null; working: boolean; onClose: () => void; onSubmit: (body: { break_minutes: number; day_off: boolean | null }) => void }) {
  const [breakMinutes, setBreakMinutes] = useState('60');
  const [dayOff, setDayOff] = useState<'auto' | 'yes' | 'no'>('auto');
  useEffect(() => {
    setBreakMinutes(String(day?.actual?.break_minutes ?? 60));
    setDayOff(day?.record?.day_off == null ? 'auto' : day.record.day_off ? 'yes' : 'no');
  }, [day]);
  return (
    <Modal
      open={Boolean(day)}
      onClose={onClose}
      title={day ? `${dayLabel(day.date)} の休憩・公休日` : ''}
      description="実際に取った休憩の合計を入れます（6時間を超えたら45分、8時間を超えたら60分以上）。"
      footer={<><Button variant="secondary" onClick={onClose}>やめる</Button><Button loading={working} onClick={() => onSubmit({ break_minutes: Number(breakMinutes) || 0, day_off: dayOff === 'auto' ? null : dayOff === 'yes' })}>保存</Button></>}
    >
      <div className="space-y-4">
        <label className={labelClass}>休憩（分）<input type="number" min={0} max={240} step={5} value={breakMinutes} onChange={event => setBreakMinutes(event.target.value)} className={inputClass} /></label>
        <div className="flex flex-wrap gap-1.5">{[0, 45, 60, 90].map(value => <button key={value} type="button" aria-pressed={breakMinutes === String(value)} onClick={() => setBreakMinutes(String(value))} className={`min-h-10 rounded-btn border px-3 text-sm font-bold ${breakMinutes === String(value) ? 'border-accent bg-accent-soft text-accent' : 'border-line text-fg-muted'}`}>{value}分</button>)}</div>
        <fieldset>
          <legend className={labelClass}>この日は</legend>
          <div className="mt-1 grid grid-cols-3 gap-1.5">
            {([['auto', '勤務表どおり'], ['no', '出勤日'], ['yes', '公休日の出勤']] as const).map(([value, label]) => (
              <button key={value} type="button" aria-pressed={dayOff === value} onClick={() => setDayOff(value)} className={`min-h-11 rounded-btn border px-2 text-sm font-bold ${dayOff === value ? 'border-accent bg-accent-soft text-accent' : 'border-line text-fg-muted'}`}>{label}</button>
            ))}
          </div>
        </fieldset>
      </div>
    </Modal>
  );
}
