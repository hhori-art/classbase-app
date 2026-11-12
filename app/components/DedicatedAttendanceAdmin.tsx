'use client';

import { useCallback, useEffect, useMemo, useState } from 'react';
import { Check, ClipboardCheck, Download, FileCheck2, GraduationCap, Plus, RefreshCw, Save, Trash2, UserCog, Users, X } from 'lucide-react';
import { useAuth } from '@/app/context/AuthContext';
import { Button, Card, EmptyState, ErrorState, IconButton, ListSkeleton, Modal, SectionTitle, StatusPill, useConfirm, useToast, type StatusTone } from '@/app/components/ui';
import { jstDateKey } from '@/lib/date-key';
import {
  DAY_STATE_LABELS,
  DEDICATED_DIVISION_LABELS,
  MONTHLY_OVERTIME_LIMIT_MINUTES,
  OVERTIME_PAY_LABELS,
  SPECIAL_KINDS,
  SPECIAL_KIND_LABELS,
  formatDuration,
  monthDates,
  nextMonthOf,
  type DayState,
  type DedicatedDivision,
  type MonthSummary,
  type OvertimePay,
  type SpecialKind,
} from '@/lib/dedicated-overtime';
import { DAY_ADJUSTMENT_LABELS, type CompanyHoliday, type DedicatedDay, type DedicatedStaff, type LessonDoc, type PlanDoc, type SeasonView } from '@/lib/dedicated-month';
import { BASELINE_TYPE_LABELS, SUMMER_2026_TEMPLATE, seasonBaselineMinutes, seasonLessonDays, type BaselineType, type DedicatedSeason, type SeasonCourse } from '@/lib/dedicated-season';
import {
  LESSON_EXCLUSION_REASONS,
  LESSON_EXCLUSION_SHORT,
  countedLessonMinutes,
  lessonTerm,
  lessonTermOf,
  type LessonExclusionReason,
  type LessonTerm,
  type LessonTermSummary,
} from '@/lib/dedicated-lesson-term';
import { userErrorMessage } from '@/lib/user-error';

/**
 * 専任の勤怠の承認と確認（マスター・勤怠管理者は管理画面、専任の校舎承認者は講師の画面で使う）。
 * 紙の D05〜D08 を、承認待ちの一覧・月の照合・一括申請の3つの画面にまとめる。
 */

type Kind = 'plan' | 'report' | 'lesson' | 'season_lesson' | 'transport' | 'monthly';
type QueueItem = { kind: Kind; id: string; user_id: string; user_name: string; school: string; date: string; data: Record<string, any>; can_review: boolean; needs_system: boolean };
type Row = {
  staff: DedicatedStaff;
  days: DedicatedDay[];
  summary: MonthSummary;
  pay: OvertimePay;
  lesson_minutes: number;
  season_lesson_minutes: number;
  transport_amount: number;
  next_month_plans: PlanDoc[];
  monthly: { status: string; review_note: string } | null;
};
type ApproverCandidate = { uid: string; name: string; school: string };
type Data = { month: string; rows: Row[]; queue: QueueItem[]; seasons: DedicatedSeason[]; holidays: CompanyHoliday[]; approver_candidates: ApproverCandidate[]; can_manage_system: boolean; can_bulk: boolean; viewer: string };
type Tab = 'queue' | 'month' | 'bulk' | 'term' | 'season' | 'staff';

const KIND_LABELS: Record<Kind, string> = {
  plan: '時間外の予定',
  report: '実施報告',
  lesson: '授業時間',
  season_lesson: '講習の授業',
  transport: '交通費',
  monthly: '月の報告書',
};
const STATE_TONES: Record<DayState, StatusTone> = {
  none: 'neutral', match: 'success', under: 'success', not_worked: 'neutral', plan_pending: 'warning',
  needs_report: 'danger', report_pending: 'warning', reported: 'success', report_rejected: 'danger',
};
const MONTHLY_LABELS: Record<string, { label: string; tone: StatusTone }> = {
  submitted: { label: '提出済み', tone: 'warning' },
  confirmed: { label: '確認済み', tone: 'success' },
  returned: { label: '差し戻し', tone: 'danger' },
};
const WEEKDAYS = ['日', '月', '火', '水', '木', '金', '土'];
const dayLabel = (date: string) => date ? `${Number(date.slice(5, 7))}/${Number(date.slice(8, 10))}（${WEEKDAYS[new Date(`${date}T12:00:00+09:00`).getUTCDay()]}）` : '';
const hours = formatDuration;
const inputClass = 'min-h-10 w-full rounded-input border border-line bg-surface px-2 py-1.5 text-sm font-medium text-fg outline-none focus:border-accent focus:ring-2 focus:ring-accent/30';
const labelClass = 'block text-xs font-bold text-fg-muted';
const csvCell = (value: unknown) => `"${String(value ?? '').replaceAll('"', '""')}"`;
const downloadCsv = (name: string, rows: unknown[][]) => {
  const blob = new Blob([`﻿${rows.map(row => row.map(csvCell).join(',')).join('\r\n')}`], { type: 'text/csv;charset=utf-8' });
  const url = URL.createObjectURL(blob);
  const link = document.createElement('a');
  link.href = url;
  link.download = name;
  link.click();
  URL.revokeObjectURL(url);
};

const specialTag = (kind: unknown) => SPECIAL_KINDS.includes(kind as SpecialKind) ? `【${SPECIAL_KIND_LABELS[kind as SpecialKind]}】` : '';

function itemSummary(item: QueueItem) {
  const d = item.data;
  if (item.kind === 'plan') return `${d.start}〜${d.end}（${hours(Number(d.minutes || 0))}${d.night_minutes ? `・深夜${hours(Number(d.night_minutes))}` : ''}）${specialTag(d.special_kind)}${d.reason || ''}`;
  if (item.kind === 'report') return `実績 ${hours(Number(d.actual_minutes || 0))}（${d.actual_start || ''}〜${d.actual_end || ''}）／予定 ${hours(Number(d.planned_minutes || 0))}　${specialTag(d.special_kind)}${d.reason || ''}${d.details ? `：${d.details}` : ''}`;
  if (item.kind === 'lesson') {
    const excluded = (Array.isArray(d.excluded) ? d.excluded : []).filter((ex: any) => LESSON_EXCLUSION_REASONS.includes(ex?.reason));
    return `${hours(Number(d.lesson_minutes || 0))} ${d.school_name || ''}${excluded.length ? `（数えない：${excluded.map((ex: any) => `${LESSON_EXCLUSION_SHORT[ex.reason as LessonExclusionReason]} ${Number(ex.minutes) || 0}分`).join('・')}）` : ''}`;
  }
  if (item.kind === 'season_lesson') return `${d.course_label || ''} ${d.count || 1}コマ（${hours(Number(d.minutes || 0))}）`;
  if (item.kind === 'transport') return `${d.from}→${d.to} ${Number(d.amount || 0).toLocaleString()}円　${d.reason || ''}`;
  const summary = d.summary || {};
  return `時間外 ${hours(Number(summary.payable_minutes || 0))}（深夜 ${hours(Number(summary.payable_night_minutes || 0))}・承認待ちの日 ${(summary.waiting_days || []).length}日）`;
}

export default function DedicatedAttendanceAdmin({ title = '専任の勤怠' }: { title?: string }) {
  const { user } = useAuth();
  const toast = useToast();
  const [month, setMonth] = useState(jstDateKey().slice(0, 7));
  const [tab, setTab] = useState<Tab>('queue');
  const [data, setData] = useState<Data | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState('');
  const [busy, setBusy] = useState(false);

  const call = useCallback(async (query: string, body?: Record<string, unknown>) => {
    const token = await user!.getIdToken();
    const response = await fetch(`/api/admin/dedicated-attendance${query}`, {
      method: body ? 'POST' : 'GET',
      headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${token}` },
      body: body ? JSON.stringify(body) : undefined,
      cache: 'no-store',
    });
    const result = await response.json().catch(() => ({}));
    if (!response.ok || result.ok === false) throw new Error(result.error || '処理できませんでした。');
    return result;
  }, [user]);

  const load = useCallback(async () => {
    if (!user) return;
    setLoading(true);
    setError('');
    try { setData(await call(`?month=${month}`)); }
    catch (loadError) { setError(userErrorMessage(loadError, '読み込めませんでした。')); }
    finally { setLoading(false); }
  }, [call, month, user]);
  useEffect(() => { void load(); }, [load]);

  const post = async (body: Record<string, unknown>, success: string) => {
    setBusy(true);
    try {
      const result = await call('', body);
      toast.success(success);
      await load();
      return result;
    } catch (postError) {
      toast.error(userErrorMessage(postError, '処理できませんでした。'));
      return null;
    } finally { setBusy(false); }
  };

  const tabs: Array<{ id: Tab; label: string; badge?: number; system?: boolean; hidden?: boolean }> = [
    { id: 'queue', label: '承認待ち', badge: data?.queue.filter(item => item.can_review).length },
    { id: 'month', label: '月の照合' },
    { id: 'bulk', label: '翌月の予定の一括申請', hidden: data ? !data.can_bulk : false },
    { id: 'term', label: '授業分数（半期）' },
    { id: 'season', label: '講習期間', system: true },
    { id: 'staff', label: '職員の設定', system: true },
  ];

  return (
    <div className="space-y-4">
      <div className="flex flex-wrap items-end justify-between gap-3">
        <div>
          <h1 className="text-xl font-black text-fg">{title}</h1>
          <p className="mt-1 text-xs font-bold text-fg-muted">時間外の予定（一括申請・個別申請）、予定と違った時間外の実施報告、月の時間外報告書、授業・講習の授業・交通費を承認します。（紙の様式：D05〜D08）</p>
        </div>
        <div className="flex items-center gap-2">
          <input type="month" aria-label="表示する月" value={month} onChange={event => event.target.value && setMonth(event.target.value)} className="min-h-11 rounded-input border border-line bg-surface px-3 text-sm font-bold text-fg" />
          <IconButton label="読み込み直す" variant="secondary" onClick={() => void load()}><RefreshCw size={17} className={loading ? 'motion-safe:animate-spin' : ''} aria-hidden /></IconButton>
        </div>
      </div>
      <nav aria-label="専任の勤怠のメニュー" className="-mx-1 flex gap-1 overflow-x-auto px-1 pb-1">
        {tabs.filter(item => !item.hidden && (!item.system || data?.can_manage_system)).map(item => (
          <button key={item.id} type="button" onClick={() => setTab(item.id)} aria-current={tab === item.id ? 'page' : undefined} className={`inline-flex min-h-11 shrink-0 items-center gap-1.5 rounded-btn px-3 text-sm font-bold ${tab === item.id ? 'bg-accent text-white' : 'bg-surface text-fg-muted ring-1 ring-line hover:bg-canvas'}`}>
            {item.label}{item.badge ? <span className={`rounded-full px-1.5 text-xs ${tab === item.id ? 'bg-white/25' : 'bg-danger text-white'}`}>{item.badge}</span> : null}
          </button>
        ))}
      </nav>
      {error ? <ErrorState message={error} onRetry={() => void load()} /> : !data ? <ListSkeleton rows={5} /> : (
        <>
          {tab === 'queue' && <QueueTab data={data} busy={busy} onReview={(items, status, note) => post({ action: 'review', items, status, note }, status === 'approved' ? `${items.length}件を承認しました。` : '差し戻しました。')} />}
          {tab === 'month' && <MonthTab data={data} month={month} />}
          {tab === 'bulk' && <BulkTab data={data} month={month} busy={busy} onSubmit={entries => post({ action: 'bulk_plans', entries }, data.can_manage_system ? '予定を登録しました（承認済み）。' : '予定を申請しました。上長の承認を待ってください。')} />}
          {tab === 'term' && <LessonTermTab data={data} call={call} />}
          {tab === 'season' && data.can_manage_system && <SeasonTab data={data} busy={busy} call={call} onSave={season => post({ action: 'season_save', season }, '講習期間を保存しました。')} onDelete={id => post({ action: 'season_delete', id }, '講習期間を消しました。')} />}
          {tab === 'staff' && data.can_manage_system && <StaffTab data={data} busy={busy} onSave={body => post({ action: 'staff_update', ...body }, '保存しました。')} onSaveHolidays={holidays => post({ action: 'calendar_save', holidays }, '会社の休日を保存しました。')} />}
        </>
      )}
    </div>
  );
}

function QueueTab({ data, busy, onReview }: { data: Data; busy: boolean; onReview: (items: Array<{ kind: Kind; id: string }>, status: 'approved' | 'rejected', note: string) => Promise<unknown> }) {
  const confirm = useConfirm();
  const [selected, setSelected] = useState<Set<string>>(new Set());
  const [kind, setKind] = useState<Kind | 'all'>('all');
  const [rejecting, setRejecting] = useState<QueueItem[] | null>(null);
  const [note, setNote] = useState('');
  const key = (item: QueueItem) => `${item.kind}:${item.id}`;
  const visible = data.queue.filter(item => kind === 'all' || item.kind === kind);
  const reviewable = visible.filter(item => item.can_review);
  const chosen = data.queue.filter(item => selected.has(key(item)));
  const counts = data.queue.reduce<Record<string, number>>((acc, item) => ({ ...acc, [item.kind]: (acc[item.kind] || 0) + 1 }), {});
  const toggle = (item: QueueItem) => setSelected(current => { const next = new Set(current); if (next.has(key(item))) next.delete(key(item)); else next.add(key(item)); return next; });
  const approve = async (items: QueueItem[]) => {
    // 月の報告書を確認すると、その月は固まる。同じ人の予定・報告がまだ承認待ちなら、先に知らせる。
    const months = items.filter(item => item.kind === 'monthly');
    const waiting = months.filter(month => data.queue.some(other => other.user_id === month.user_id && (other.kind === 'plan' || other.kind === 'report') && other.date.startsWith(month.date)));
    if (items.length > 1 || waiting.length) {
      const ok = await confirm({
        title: `${items.length}件を承認しますか？`,
        message: waiting.length
          ? `${waiting.map(item => item.user_name).join('、')}さんは、この月の時間外の予定・報告がまだ承認待ちです。月の報告書を確認すると、その月は直せなくなります。`
          : undefined,
        confirmLabel: '承認する',
      });
      if (!ok) return;
    }
    await onReview(items.map(item => ({ kind: item.kind, id: item.id })), 'approved', '');
    setSelected(new Set());
  };
  return (
    <div className="space-y-3">
      <div className="flex flex-wrap items-center gap-1.5">
        {(['all', 'monthly', 'plan', 'report', 'season_lesson', 'lesson', 'transport'] as const).map(value => (
          <button key={value} type="button" aria-pressed={kind === value} onClick={() => setKind(value)} className={`min-h-10 rounded-full border px-3 text-xs font-bold ${kind === value ? 'border-accent bg-accent-soft text-accent' : 'border-line text-fg-muted'}`}>
            {value === 'all' ? 'すべて' : KIND_LABELS[value]} {value === 'all' ? data.queue.length : counts[value] || 0}
          </button>
        ))}
      </div>
      <Card className="flex flex-wrap items-center gap-2 py-3">
        <label className="flex min-h-10 items-center gap-2 text-sm font-bold"><input type="checkbox" className="h-4 w-4 accent-accent" checked={reviewable.length > 0 && reviewable.every(item => selected.has(key(item)))} onChange={event => setSelected(event.target.checked ? new Set(reviewable.map(key)) : new Set())} />表示中をすべて選ぶ</label>
        <span className="text-xs font-bold text-fg-muted">{chosen.length}件を選択中</span>
        <div className="ml-auto flex gap-2">
          <Button size="sm" variant="secondary" disabled={!chosen.length} onClick={() => { setRejecting(chosen); setNote(''); }} icon={<X size={15} aria-hidden />}>差し戻す</Button>
          <Button size="sm" disabled={!chosen.length} loading={busy} onClick={() => void approve(chosen)} icon={<Check size={15} aria-hidden />}>まとめて承認</Button>
        </div>
      </Card>
      {visible.length === 0 ? <EmptyState icon={ClipboardCheck} title="承認待ちはありません" /> : (
        <ul className="space-y-2">
          {visible.map(item => (
            <li key={key(item)} className={`flex flex-wrap items-start gap-3 rounded-card border bg-surface p-3 ${selected.has(key(item)) ? 'border-accent' : 'border-line'}`}>
              <input type="checkbox" aria-label={`${item.user_name} ${KIND_LABELS[item.kind]} を選ぶ`} disabled={!item.can_review} checked={selected.has(key(item))} onChange={() => toggle(item)} className="mt-1 h-5 w-5 accent-accent" />
              <div className="min-w-0 flex-1">
                <p className="flex flex-wrap items-center gap-2 text-sm font-bold text-fg">
                  <StatusPill tone={item.kind === 'monthly' ? 'info' : item.kind === 'report' ? 'danger' : 'accent'}>{KIND_LABELS[item.kind]}</StatusPill>
                  {item.user_name}
                  <span className="text-fg-muted">{item.kind === 'monthly' ? item.date : dayLabel(item.date)}</span>
                  {item.kind === 'plan' && <span className="text-xs text-fg-muted">{item.data.source === 'bulk' ? '一括申請' : item.data.late ? '突発（2日前を過ぎた申請）' : '個別申請'}</span>}
                </p>
                <p className="mt-1 text-sm text-fg">{itemSummary(item)}</p>
                {(item.data.warnings || []).map((warning: string) => <p key={warning} className="mt-0.5 text-xs font-bold text-amber-700">⚠ {warning}</p>)}
                {item.data.over_limit && <p className="mt-0.5 text-xs font-bold text-danger">⚠ この月の時間外が {hours(Number(item.data.projected_month_minutes || 0))} の見込みで、月75時間を超えると確かめたうえで出された申請です</p>}
                {item.user_id === data.viewer && !item.can_review && <p className="mt-0.5 text-xs font-bold text-fg-muted">自分の申請は、ほかの承認者が承認します</p>}
                {item.needs_system && !item.can_review && item.user_id !== data.viewer && <p className="mt-0.5 text-xs font-bold text-fg-muted">上長（勤怠の管理者）が承認します</p>}
                {item.kind === 'monthly' && <p className="mt-0.5 text-xs font-bold text-fg-muted">確認すると、この月の承認待ちの授業・講習の授業・交通費もまとめて承認します。</p>}
              </div>
              {item.can_review && (
                <div className="flex gap-1.5">
                  <Button size="sm" variant="secondary" onClick={() => { setRejecting([item]); setNote(''); }}>差し戻す</Button>
                  <Button size="sm" loading={busy} onClick={() => void approve([item])}>{item.kind === 'monthly' ? '確認' : '承認'}</Button>
                </div>
              )}
            </li>
          ))}
        </ul>
      )}
      <Modal
        open={Boolean(rejecting)}
        onClose={() => setRejecting(null)}
        title={`${rejecting?.length || 0}件を差し戻す`}
        description="理由は申請した人に届きます。"
        footer={<><Button variant="secondary" onClick={() => setRejecting(null)}>やめる</Button><Button variant="danger" loading={busy} disabled={!note.trim()} onClick={async () => {
          // 失敗したときは、書いた理由を残したまま開いておく。
          const result = await onReview(rejecting!.map(item => ({ kind: item.kind, id: item.id })), 'rejected', note);
          if (!result) return;
          setRejecting(null);
          setSelected(new Set());
        }}>差し戻す</Button></>}
      >
        <label className={labelClass}>差し戻す理由<textarea value={note} onChange={event => setNote(event.target.value)} className={`${inputClass} mt-1 min-h-24`} placeholder="例：予定の時刻が勤務表と合っていません" /></label>
      </Modal>
    </div>
  );
}

function MonthTab({ data, month }: { data: Data; month: string }) {
  const [open, setOpen] = useState<Row | null>(null);
  // 交通費（教室間の移動など）は給与では計算せず経費精算で処理する（2026-10-26 給与担当の回答）ので、給与用CSVには入れない。
  const exportCsv = () => {
    const payKeys = Object.keys(OVERTIME_PAY_LABELS) as Array<keyof typeof OVERTIME_PAY_LABELS>;
    const header = [
      '職員', '校舎', '等級', '事業部', '時短', '時間外単価（円）',
      ...payKeys.flatMap(key => [`${OVERTIME_PAY_LABELS[key]}（分）`, `${OVERTIME_PAY_LABELS[key]}（円）`]),
      '1.25倍換算の時間外（分）', 'みなし（分）', '時間外勤務手当（支給・円）', '支給合計（円）',
      // 特訓は手当で払う（金額は特訓の手当の決まりで出す）ので、時間外勤務手当とは別に種類ごとの時間を出す。
      ...SPECIAL_KINDS.map(kind => `${SPECIAL_KIND_LABELS[kind]}（分）`), '特訓の合計（分）', '時間外の合計（特訓を含む・分）',
      '承認済みの予定（分）', '未承認の時間外（分）', '報告が必要な日', '授業時間（分）', '講習の授業（分）', '月の報告書',
    ];
    const rows = data.rows.map(row => [
      row.staff.name, row.staff.school, row.staff.grade ?? '', DEDICATED_DIVISION_LABELS[row.staff.division], row.staff.short_time ? '1' : '', row.staff.unit_rate ?? '',
      ...payKeys.flatMap(key => {
        const line = row.pay.lines.find(item => item.key === key);
        return [line?.minutes ?? 0, line?.amount ?? 0];
      }),
      Math.round(row.pay.equivalent_minutes), row.pay.threshold_minutes || '', row.pay.overtime_payable_amount, row.pay.total_amount,
      ...SPECIAL_KINDS.map(kind => row.summary.special_by_kind?.[kind] ?? 0), row.summary.special_minutes ?? 0, row.summary.actual_minutes,
      row.summary.planned_minutes, row.summary.unapproved_minutes, row.summary.open_days.join(' '),
      row.lesson_minutes, row.season_lesson_minutes, MONTHLY_LABELS[row.monthly?.status || '']?.label || '未提出',
    ]);
    downloadCsv(`専任勤怠_${month}.csv`, [header, ...rows]);
  };
  const exportDays = () => {
    const header = ['職員', '日付', '出勤', '退勤', '休憩（分）', '実働（分）', '公休日', '時間外（分）', '深夜（分）', '時間内（分）', '深夜手当（分）', '有休・振替', '埋めた時間（分）', 'ほかの日へ振替（分）', '承認済みの予定（分）', '支給対象（分）', 'うち特訓（分）', '特訓の種類', '状態', '授業（分）', '講習の授業（分）', '交通費（経費精算・円）'];
    const rows = data.rows.flatMap(row => row.days.filter(day => day.record || day.plans.length).map(day => [
      row.staff.name, day.date, day.actual?.start || '', day.actual?.end || '', day.actual?.break_minutes ?? '', day.actual?.worked_minutes ?? '', day.actual?.day_off ? '1' : '',
      day.reconciliation.actual_minutes, day.reconciliation.night_minutes, day.reconciliation.within_minutes, day.reconciliation.night_regular_minutes,
      day.adjustment ? `${DAY_ADJUSTMENT_LABELS[day.adjustment.kind]}${day.adjustment.from_date ? `（${day.adjustment.from_date}から）` : ''}` : '', day.adjustment?.credited_minutes ?? '', day.reconciliation.transferred_out_minutes || '',
      day.reconciliation.planned_minutes, day.reconciliation.payable_minutes,
      day.reconciliation.special_minutes || '', SPECIAL_KINDS.filter(kind => day.reconciliation.special_by_kind?.[kind]).map(kind => SPECIAL_KIND_LABELS[kind]).join('・'),
      DAY_STATE_LABELS[day.reconciliation.state], day.lesson_minutes, day.season_lesson_minutes, day.transport_amount,
    ]));
    downloadCsv(`専任勤怠_日別_${month}.csv`, [header, ...rows]);
  };
  return (
    <div className="space-y-3">
      <div className="flex flex-wrap justify-end gap-2">
        <Button size="sm" variant="secondary" onClick={exportDays} icon={<Download size={15} aria-hidden />}>日別CSV</Button>
        <Button size="sm" variant="secondary" onClick={exportCsv} icon={<Download size={15} aria-hidden />}>給与用CSV（月の合計）</Button>
      </div>
      {data.rows.length === 0 ? <EmptyState icon={Users} title="担当している専任はいません" /> : (
        <Card padded={false} className="overflow-x-auto">
          <table className="w-full min-w-[760px] text-sm">
            <thead className="bg-canvas text-xs font-bold text-fg-muted">
              <tr>{['職員', '時間外（支給）', '深夜', '予定（承認）', '未承認', '手当（試算）', '授業', '講習', '交通費（経費）', '報告書'].map(label => <th key={label} className="px-3 py-2 text-left">{label}</th>)}</tr>
            </thead>
            <tbody className="divide-y divide-line">
              {data.rows.map(row => {
                const status = MONTHLY_LABELS[row.monthly?.status || ''];
                return (
                  <tr key={row.staff.uid} className="cursor-pointer hover:bg-canvas" onClick={() => setOpen(row)}>
                    <td className="px-3 py-2 font-bold text-fg">{row.staff.name}<span className="ml-1 text-xs text-fg-muted">{row.staff.grade ? `${row.staff.grade}等級` : '等級未設定'}</span></td>
                    <td className="px-3 py-2 font-mono font-bold text-accent">{hours(row.summary.payable_minutes)}{row.summary.actual_minutes > MONTHLY_OVERTIME_LIMIT_MINUTES && <span className="ml-1 text-xs text-danger">75h超</span>}{row.summary.special_minutes ? <span className="block text-xs font-bold text-fg-muted">うち特訓 {hours(row.summary.special_minutes)}</span> : null}</td>
                    <td className="px-3 py-2 font-mono">{hours(row.summary.payable_night_minutes)}</td>
                    <td className="px-3 py-2 font-mono">{hours(row.summary.planned_minutes)}</td>
                    <td className={`px-3 py-2 font-mono ${row.summary.unapproved_minutes ? 'font-bold text-danger' : ''}`}>{hours(row.summary.unapproved_minutes)}{row.summary.open_days.length ? <span className="ml-1 text-xs">（{row.summary.open_days.length}日）</span> : null}</td>
                    <td className="px-3 py-2 font-mono">{row.pay.rate_missing ? <span className="text-xs font-bold text-danger">単価未設定</span> : `${row.pay.total_amount.toLocaleString()}円`}</td>
                    <td className="px-3 py-2 font-mono">{hours(row.lesson_minutes)}</td>
                    <td className="px-3 py-2 font-mono">{hours(row.season_lesson_minutes)}</td>
                    <td className="px-3 py-2 font-mono">{row.transport_amount.toLocaleString()}円</td>
                    <td className="px-3 py-2">{status ? <StatusPill tone={status.tone}>{status.label}</StatusPill> : <StatusPill>未提出</StatusPill>}</td>
                  </tr>
                );
              })}
            </tbody>
          </table>
        </Card>
      )}
      <Modal open={Boolean(open)} onClose={() => setOpen(null)} size="xl" title={open ? `${open.staff.name} ${Number(month.slice(5))}月の勤務` : ''} description={open ? `所定 ${open.staff.schedule.start_time}〜${open.staff.schedule.end_time}（休憩${open.staff.schedule.break_minutes}分）・${DEDICATED_DIVISION_LABELS[open.staff.division]}` : undefined}>
        {open && (
          <div className="space-y-3 overflow-x-auto">
            <PayBreakdown row={open} />
            <table className="w-full min-w-[680px] text-sm">
              <thead className="text-xs font-bold text-fg-muted"><tr>{['日付', '打刻', '休憩', '時間外', '予定', '状態'].map(label => <th key={label} className="px-2 py-1.5 text-left">{label}</th>)}</tr></thead>
              <tbody className="divide-y divide-line">
                {open.days.filter(day => day.record || day.plans.length || day.report).map(day => (
                  <tr key={day.date}>
                    <td className="px-2 py-1.5 font-bold">{dayLabel(day.date)}{day.actual?.day_off && <span className="ml-1 text-xs text-info">公休</span>}</td>
                    <td className="px-2 py-1.5 font-mono">{day.actual ? `${day.actual.start}〜${day.actual.end}` : day.record ? '退勤なし' : '—'}</td>
                    <td className="px-2 py-1.5 font-mono">{day.actual ? `${day.actual.break_minutes}分` : ''}</td>
                    <td className="px-2 py-1.5 font-mono">{day.actual ? hours(day.actual.overtime_minutes) : ''}{day.actual?.night_overtime_minutes ? <span className="ml-1 text-xs">（深夜{hours(day.actual.night_overtime_minutes)}）</span> : null}
                      {day.reconciliation.within_minutes > 0 && <span className="block text-xs">時間内 {hours(day.reconciliation.within_minutes)}</span>}
                      {day.adjustment && <span className="block text-xs font-bold text-info">{DAY_ADJUSTMENT_LABELS[day.adjustment.kind]} {hours(day.adjustment.credited_minutes)}{day.adjustment.from_date ? `（${dayLabel(day.adjustment.from_date)}から）` : ''}</span>}
                      {day.transferred_to.map(item => <span key={item.date} className="block text-xs font-bold text-info">{dayLabel(item.date)}へ振替 −{hours(item.minutes)}</span>)}</td>
                    <td className="px-2 py-1.5 text-xs">{day.plans.map(plan => <span key={plan.id} className="block">{plan.start}〜{plan.end}（{plan.status === 'approved' ? '承認' : plan.status === 'pending' ? '承認待ち' : '差し戻し'}）{specialTag(plan.special_kind)}</span>)}</td>
                    <td className="px-2 py-1.5">{day.reconciliation.state !== 'none' && <StatusPill tone={STATE_TONES[day.reconciliation.state]}>{DAY_STATE_LABELS[day.reconciliation.state]}</StatusPill>}{day.actual?.warnings.map(warning => <span key={warning} className="mt-0.5 block text-xs font-bold text-amber-700">⚠ {warning}</span>)}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
      </Modal>
    </div>
  );
}

function PayBreakdown({ row }: { row: Row }) {
  const { pay, staff } = row;
  return (
    <div className="rounded-card border border-line bg-canvas p-3">
      <div className="flex flex-wrap items-baseline justify-between gap-2">
        <p className="text-sm font-bold text-fg">手当の試算{staff.unit_rate ? `（時間外単価 ${staff.unit_rate.toLocaleString()}円）` : ''}</p>
        <p className="font-mono text-lg font-black text-accent">{pay.total_amount.toLocaleString()}円</p>
      </div>
      {pay.rate_missing && <p className="mt-1 text-xs font-bold text-danger">時間外単価が未設定です。「職員の設定」で入れると金額が出ます。</p>}
      {pay.grade_missing && <p className="mt-1 text-xs font-bold text-danger">等級が未設定です。4等級以下として計算しています。</p>}
      <dl className="mt-2 grid grid-cols-2 gap-x-4 gap-y-1 text-xs sm:grid-cols-3">
        {pay.lines.map(line => (
          <div key={line.key} className="flex justify-between gap-2">
            <dt className="font-bold text-fg-muted">{OVERTIME_PAY_LABELS[line.key]}（{line.multiplier}）</dt>
            <dd className="font-mono">{hours(line.minutes)}・{line.amount.toLocaleString()}円</dd>
          </div>
        ))}
      </dl>
      {(row.summary.special_minutes ?? 0) > 0 && (
        <p className="mt-2 text-xs font-bold text-fg-muted">
          特訓（手当で支給・時間外勤務手当と5等級の35時間には入れません）：{SPECIAL_KINDS.filter(kind => row.summary.special_by_kind?.[kind]).map(kind => `${SPECIAL_KIND_LABELS[kind]} ${hours(row.summary.special_by_kind[kind] || 0)}`).join('・')}
        </p>
      )}
      {staff.grade === 5 && <p className="mt-2 text-xs font-bold text-fg-muted">5等級：1.25倍に換算した時間外 {hours(Math.round(pay.equivalent_minutes))} − みなし {hours(pay.threshold_minutes)}{staff.short_time ? '（時短）' : ''} → 時間外勤務手当 {pay.overtime_payable_amount.toLocaleString()}円</p>}
      {staff.grade != null && staff.grade >= 6 && <p className="mt-2 text-xs font-bold text-fg-muted">6等級以上：時間外・時間内は支給しません（深夜手当だけ）。</p>}
    </div>
  );
}

type BulkRow = { date: string; start: string; end: string; break_minutes: string; reason: string; day_off: boolean; special_kind: SpecialKind | '' };

function BulkTab({ data, month, busy, onSubmit }: { data: Data; month: string; busy: boolean; onSubmit: (entries: Array<Record<string, unknown>>) => Promise<unknown> }) {
  const target = month <= jstDateKey().slice(0, 7) ? nextMonthOf(jstDateKey().slice(0, 7)) : month;
  const [staffId, setStaffId] = useState('');
  const [rows, setRows] = useState<Record<string, BulkRow>>({});
  const [pattern, setPattern] = useState({ weekdays: [1, 2, 3, 4, 5] as number[], start: '', end: '', break_minutes: '0', reason: '', special_kind: '' as SpecialKind | '' });
  const staff = data.rows.find(row => row.staff.uid === staffId)?.staff;
  const existing = data.rows.find(row => row.staff.uid === staffId)?.next_month_plans.filter(plan => plan.date.startsWith(target)) || [];
  const dates = monthDates(target);
  useEffect(() => { setRows({}); }, [staffId, target]);
  const update = (date: string, patch: Partial<BulkRow>) => setRows(current => ({ ...current, [date]: { ...(current[date] || { date, start: '', end: '', break_minutes: '0', reason: '', day_off: false, special_kind: '' }), ...patch } }));
  const applyPattern = () => {
    if (!pattern.start || !pattern.end) return;
    setRows(current => {
      const next = { ...current };
      dates.filter(date => pattern.weekdays.includes(new Date(`${date}T12:00:00+09:00`).getUTCDay())).forEach(date => {
        next[date] = { date, start: pattern.start, end: pattern.end, break_minutes: pattern.break_minutes, reason: pattern.reason, day_off: false, special_kind: pattern.special_kind };
      });
      return next;
    });
  };
  const filled = Object.values(rows).filter(row => row.start && row.end);
  return (
    <div className="space-y-3">
      <Card>
        <SectionTitle icon={FileCheck2} title={`${Number(target.slice(5))}月の時間外の予定をまとめて入れる`} description={data.can_manage_system ? '勤怠の管理者が入れた予定は、そのまま承認済みになります。' : '校長が入れた予定は、上長（勤怠の管理者）の承認待ちになります。毎月25日までに入れてください。'} />
        <label className={`${labelClass} max-w-sm`}>職員
          <select value={staffId} onChange={event => setStaffId(event.target.value)} className={`${inputClass} mt-1`}>
            <option value="">選んでください</option>
            {data.rows.map(row => <option key={row.staff.uid} value={row.staff.uid}>{row.staff.name}（{row.staff.school}）</option>)}
          </select>
        </label>
      </Card>
      {staff && (
        <>
          <Card className="space-y-2">
            <p className="text-sm font-bold text-fg">曜日でまとめて入れる</p>
            <div className="flex flex-wrap gap-1">{WEEKDAYS.map((label, index) => <button key={label} type="button" aria-pressed={pattern.weekdays.includes(index)} onClick={() => setPattern(current => ({ ...current, weekdays: current.weekdays.includes(index) ? current.weekdays.filter(day => day !== index) : [...current.weekdays, index] }))} className={`h-10 w-10 rounded-btn border text-sm font-bold ${pattern.weekdays.includes(index) ? 'border-accent bg-accent-soft text-accent' : 'border-line text-fg-muted'}`}>{label}</button>)}</div>
            <div className="grid gap-2 sm:grid-cols-[repeat(3,8rem)_1fr_10rem_auto] sm:items-end">
              <label className={labelClass}>開始<input type="time" step={300} value={pattern.start} onChange={event => setPattern({ ...pattern, start: event.target.value })} className={`${inputClass} mt-1`} /></label>
              <label className={labelClass}>終了<input type="time" step={300} value={pattern.end} onChange={event => setPattern({ ...pattern, end: event.target.value })} className={`${inputClass} mt-1`} /></label>
              <label className={labelClass}>休憩（分）<input type="number" min={0} step={5} value={pattern.break_minutes} onChange={event => setPattern({ ...pattern, break_minutes: event.target.value })} className={`${inputClass} mt-1`} /></label>
              <label className={labelClass}>業務内容（超過理由）<input value={pattern.reason} onChange={event => setPattern({ ...pattern, reason: event.target.value })} className={`${inputClass} mt-1`} placeholder="例：授業準備・教室業務（三者面談）" /></label>
              <label className={labelClass}>特訓<SpecialSelect value={pattern.special_kind} onChange={value => setPattern({ ...pattern, special_kind: value })} className={`${inputClass} mt-1`} /></label>
              <Button variant="secondary" onClick={applyPattern} disabled={!pattern.start || !pattern.end}>下の表に入れる</Button>
            </div>
            <p className="text-xs font-bold text-fg-muted">所定は {staff.schedule.start_time}〜{staff.schedule.end_time}。時刻は5分単位、勤務日は8時間を超える分、公休日はその日の労働時間を入れます。最終は {staff.end_limit}（23:00 完全退社）。</p>
          </Card>
          {existing.length > 0 && <p className="text-xs font-bold text-fg-muted">この月にすでにある予定：{existing.map(plan => `${dayLabel(plan.date)} ${plan.start}〜${plan.end}`).join('、')}</p>}
          <Card padded={false} className="overflow-x-auto">
            <table className="w-full min-w-[720px] text-sm">
              <thead className="bg-canvas text-xs font-bold text-fg-muted"><tr>{['日付', '開始', '終了', '休憩', '業務内容（超過理由）', '特訓', '公休日', ''].map(label => <th key={label} className="px-2 py-2 text-left">{label}</th>)}</tr></thead>
              <tbody className="divide-y divide-line">
                {dates.map(date => {
                  const row = rows[date];
                  const weekday = new Date(`${date}T12:00:00+09:00`).getUTCDay();
                  return (
                    <tr key={date} className={weekday === 0 ? 'bg-danger-soft/30' : weekday === 6 ? 'bg-info-soft/30' : ''}>
                      <td className="px-2 py-1 font-bold">{dayLabel(date)}</td>
                      <td className="px-2 py-1"><input aria-label={`${date} 開始`} type="time" step={300} value={row?.start || ''} onChange={event => update(date, { start: event.target.value })} className={inputClass} /></td>
                      <td className="px-2 py-1"><input aria-label={`${date} 終了`} type="time" step={300} value={row?.end || ''} onChange={event => update(date, { end: event.target.value })} className={inputClass} /></td>
                      <td className="px-2 py-1"><input aria-label={`${date} 休憩`} type="number" min={0} step={5} value={row?.break_minutes || ''} onChange={event => update(date, { break_minutes: event.target.value })} className={`${inputClass} w-20`} /></td>
                      <td className="px-2 py-1"><input aria-label={`${date} 業務内容`} value={row?.reason || ''} onChange={event => update(date, { reason: event.target.value })} className={inputClass} /></td>
                      <td className="px-2 py-1"><SpecialSelect aria-label={`${date} 特訓`} value={row?.special_kind || ''} onChange={value => update(date, { special_kind: value })} className={inputClass} /></td>
                      <td className="px-2 py-1 text-center"><input aria-label={`${date} 公休日`} type="checkbox" checked={row?.day_off || false} onChange={event => update(date, { day_off: event.target.checked })} className="h-4 w-4 accent-accent" /></td>
                      <td className="px-2 py-1">{row && <IconButton label={`${date} を空にする`} size="sm" variant="ghost" onClick={() => setRows(current => { const next = { ...current }; delete next[date]; return next; })}><X size={14} /></IconButton>}</td>
                    </tr>
                  );
                })}
              </tbody>
            </table>
          </Card>
          <div className="flex justify-end">
            <Button loading={busy} disabled={!filled.length} icon={<FileCheck2 size={17} aria-hidden />} onClick={async () => {
              const result = await onSubmit(filled.map(row => ({ user_id: staff.uid, date: row.date, start: row.start, end: row.end, break_minutes: Number(row.break_minutes) || 0, reason: row.reason, day_off: row.day_off, special_kind: row.special_kind || null })));
              if (result) setRows({});
            }}>{filled.length}日分を{data.can_manage_system ? '登録' : '申請'}する</Button>
          </div>
        </>
      )}
    </div>
  );
}

/** 特訓の種類（日曜特訓・突破ゼミなど）。特訓でなければ空。 */
function SpecialSelect({ value, onChange, className, 'aria-label': ariaLabel }: { value: SpecialKind | ''; onChange: (value: SpecialKind | '') => void; className: string; 'aria-label'?: string }) {
  return (
    <select aria-label={ariaLabel} value={value} onChange={event => onChange(event.target.value as SpecialKind | '')} className={className}>
      <option value="">特訓ではない</option>
      {SPECIAL_KINDS.map(kind => <option key={kind} value={kind}>{SPECIAL_KIND_LABELS[kind]}</option>)}
    </select>
  );
}

const emptySeason = (): DedicatedSeason => ({
  id: '',
  name: '',
  periods: { group_online: { start: '', end: '' }, individual: { start: '', end: '' }, junior_exam: { start: '', end: '' } },
  excluded: { start: '', end: '' },
  per_day_minutes: 203,
  baselines: {},
  courses: [],
  rates: { grade5plus: 1500, grade3to4: 400, grade1to2: 250 },
  deduct_overtime_for_grade4_or_below: true,
});

type TermReport = {
  term: LessonTerm;
  rows: Array<{ staff: DedicatedStaff; summary: LessonTermSummary; lessons: LessonDoc[]; season_dates: Array<{ name: string; start: string; end: string }> }>;
};

/** 半期の選択肢（今の半期と前後）。 */
const termOptions = () => {
  const current = lessonTermOf(jstDateKey());
  const year = Number(current.id.slice(0, 4));
  return [`${year - 1}-H1`, `${year - 1}-H2`, `${year}-H1`, `${year}-H2`, `${year + 1}-H1`].map(id => lessonTerm(id)!);
};

/** 担当加算給の授業分数（4等級以下の授業分数報告書）。上半期3〜7月・下半期9〜2月、講習期間と数えない授業を除く。 */
function LessonTermTab({ data, call }: { data: Data; call: (query: string) => Promise<any> }) {
  const toast = useToast();
  const options = useMemo(termOptions, []);
  const [termId, setTermId] = useState(() => lessonTermOf(jstDateKey()).id);
  const [report, setReport] = useState<TermReport | null>(null);
  const [loading, setLoading] = useState(false);
  const load = useCallback(async () => {
    setLoading(true);
    try { setReport(await call(`?term=${encodeURIComponent(termId)}`)); }
    catch (error) { toast.error(userErrorMessage(error, '読み込めませんでした。')); }
    finally { setLoading(false); }
  }, [call, termId, toast]);
  useEffect(() => { void load(); }, [load]);
  const holidayNames = useMemo(() => new Map(data.holidays.map(item => [item.date, item.name])), [data.holidays]);

  const exportSummary = () => {
    if (!report) return;
    const header = ['職員', '校舎', '等級', '事業部', '期間', '授業分数（数える・承認済み）', '承認待ち（数える分）', ...LESSON_EXCLUSION_REASONS.map(reason => `数えない：${LESSON_EXCLUSION_SHORT[reason]}（分）`), '講習期間の授業（数えない・分）', '授業をした日数', '教室ごとの分数'];
    downloadCsv(`授業分数_${report.term.id}.csv`, [header, ...report.rows.map(({ staff, summary }) => [
      staff.name, staff.school, staff.grade ?? '等級未設定', DEDICATED_DIVISION_LABELS[staff.division], report.term.label,
      summary.counted_minutes, summary.pending_minutes,
      ...LESSON_EXCLUSION_REASONS.map(reason => summary.excluded_by_reason[reason] || 0),
      summary.season_minutes, summary.days,
      summary.by_school.map(item => `${item.school_name}:${item.minutes}`).join(' / '),
    ])]);
  };
  const exportDaily = () => {
    if (!report) return;
    const header = ['職員', '授業日', '曜日', '公休', '教室', '授業分数', '数えない分数', '数える分数', '数えない理由', '講習期間', '状態'];
    const rows = report.rows.flatMap(({ staff, lessons, season_dates }) => lessons.map(item => {
      const season = season_dates.find(period => item.lesson_date >= period.start && item.lesson_date <= period.end);
      const excludedMinutes = (item.excluded || []).reduce((sum, ex) => sum + ex.minutes, 0);
      return [
        staff.name, item.lesson_date, WEEKDAYS[new Date(`${item.lesson_date}T12:00:00+09:00`).getUTCDay()],
        holidayNames.has(item.lesson_date) ? '●' : '', item.school_name || '',
        item.lesson_minutes, excludedMinutes, season ? 0 : countedLessonMinutes(item),
        (item.excluded || []).map(ex => `${LESSON_EXCLUSION_SHORT[ex.reason]} ${ex.minutes}分`).join(' / '),
        season ? season.name : '', item.status === 'approved' ? '承認済み' : '承認待ち',
      ];
    }));
    downloadCsv(`授業分数_日別_${report.term.id}.csv`, [header, ...rows]);
  };

  return (
    <Card padded={false} className="overflow-hidden">
      <div className="flex flex-wrap items-center justify-between gap-2 border-b border-line p-4">
        <div>
          <h2 className="text-base font-bold text-fg">担当加算給の授業分数</h2>
          <p className="mt-1 text-xs font-bold text-fg-muted">4等級以下（等級未設定を含む）の、半期ごとの授業分数の合計です。講習期間と、時間外申請をした時間帯の授業・調整休講日の補講・通常授業日以外の定期考査対策・突破ゼミ・兵庫統一模試は数えません。</p>
        </div>
        <div className="flex flex-wrap items-center gap-2">
          <select aria-label="半期" value={termId} onChange={event => setTermId(event.target.value)} className="min-h-10 rounded-input border border-line bg-surface px-2 text-sm font-bold text-fg">
            {options.map(option => <option key={option.id} value={option.id}>{option.label}</option>)}
          </select>
          <Button size="sm" variant="secondary" icon={<Download size={15} aria-hidden />} disabled={!report?.rows.length} onClick={exportSummary}>CSV（合計）</Button>
          <Button size="sm" variant="secondary" icon={<Download size={15} aria-hidden />} disabled={!report?.rows.length} onClick={exportDaily}>CSV（日別）</Button>
        </div>
      </div>
      {loading && !report ? <div className="p-4"><ListSkeleton rows={4} /></div> : !report?.rows.length ? <div className="p-4"><EmptyState icon={GraduationCap} title="対象の職員はいません" /></div> : (
        <div className="overflow-x-auto">
          <table className="w-full min-w-[720px] text-sm">
            <thead className="bg-canvas text-xs font-bold text-fg-muted"><tr>{['職員', '等級', '数える授業', '承認待ち', '数えない授業', '講習期間', '日数', '教室ごと'].map(label => <th key={label} className="px-3 py-2 text-left">{label}</th>)}</tr></thead>
            <tbody className="divide-y divide-line">
              {report.rows.map(({ staff, summary }) => (
                <tr key={staff.uid}>
                  <td className="px-3 py-2 font-bold">{staff.name}</td>
                  <td className="px-3 py-2">{staff.grade ?? <span className="text-danger">未設定</span>}</td>
                  <td className="px-3 py-2 font-mono font-bold text-accent">{hours(summary.counted_minutes)}<span className="ml-1 text-xs text-fg-muted">{summary.counted_minutes.toLocaleString()}分</span></td>
                  <td className="px-3 py-2 font-mono">{summary.pending_minutes ? hours(summary.pending_minutes) : ''}</td>
                  <td className="px-3 py-2 text-xs">{Object.entries(summary.excluded_by_reason).map(([reason, minutes]) => `${LESSON_EXCLUSION_SHORT[reason as LessonExclusionReason]} ${hours(minutes || 0)}`).join('・')}</td>
                  <td className="px-3 py-2 font-mono text-xs">{summary.season_minutes ? hours(summary.season_minutes) : ''}</td>
                  <td className="px-3 py-2">{summary.days}</td>
                  <td className="px-3 py-2 text-xs">{summary.by_school.length > 1 ? summary.by_school.map(item => `${item.school_name} ${hours(item.minutes)}`).join('・') : summary.by_school[0]?.school_name || ''}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}
    </Card>
  );
}

function SeasonTab({ data, busy, call, onSave, onDelete }: {
  data: Data;
  busy: boolean;
  call: (query: string) => Promise<any>;
  onSave: (season: DedicatedSeason) => Promise<unknown>;
  onDelete: (id: string) => Promise<unknown>;
}) {
  const confirm = useConfirm();
  const toast = useToast();
  const [editing, setEditing] = useState<DedicatedSeason | null>(null);
  const [report, setReport] = useState<{ season: DedicatedSeason; rows: Array<{ staff: DedicatedStaff; view: SeasonView | null }> } | null>(null);
  const [loadingReport, setLoadingReport] = useState('');
  const openReport = async (season: DedicatedSeason) => {
    setLoadingReport(season.id);
    try { setReport(await call(`?season=${encodeURIComponent(season.id)}`)); }
    catch (error) { toast.error(userErrorMessage(error, '読み込めませんでした。')); }
    finally { setLoadingReport(''); }
  };
  const exportReport = () => {
    if (!report) return;
    const header = ['職員', '校舎', '等級', '事業部', '基準区分', '授業（承認済み・分）', '承認待ち（分）', '基準授業時間（分）', '時間外（講習期間・分）', '時間外による差し引き（分）', '過剰授業時間（分）', '時間外単価（円）', '過剰授業手当（円）', '5等級：期間の月の時間外勤務手当（円）', '5等級：過剰授業手当として追加で支給（円）'];
    downloadCsv(`過剰授業手当_${report.season.name}.csv`, [header, ...report.rows.filter(row => row.view).map(({ staff, view }) => [
      staff.name, staff.school, staff.grade ?? '等級未設定', DEDICATED_DIVISION_LABELS[staff.division], BASELINE_TYPE_LABELS[staff.baseline_type],
      view!.allowance.lesson_minutes, view!.allowance.pending_minutes, view!.allowance.baseline_minutes, view!.overtime_minutes, view!.allowance.overtime_deduction_minutes,
      view!.allowance.excess_minutes, view!.allowance.rate || '未設定', view!.allowance.amount,
      view!.comparison?.paid_overtime_amount ?? '', view!.comparison?.extra_amount ?? '',
    ])]);
  };
  return (
    <div className="space-y-3">
      <div className="flex flex-wrap gap-2">
        <Button icon={<Plus size={16} aria-hidden />} onClick={() => setEditing(emptySeason())}>新しい講習期間</Button>
        <Button variant="secondary" onClick={() => setEditing({ ...SUMMER_2026_TEMPLATE, courses: SUMMER_2026_TEMPLATE.courses.map(course => ({ ...course })) })}>2026年度 夏期講習の規則から作る</Button>
      </div>
      {data.seasons.length === 0 ? <EmptyState icon={GraduationCap} title="講習期間はまだありません" description="講習期間を作ると、その期間だけ専任の画面に講習の授業の登録が出ます。" /> : (
        <ul className="space-y-2">
          {data.seasons.map(season => (
            <li key={season.id} className="flex flex-wrap items-center justify-between gap-2 rounded-card border border-line bg-surface p-3">
              <div>
                <p className="font-bold text-fg">{season.name}</p>
                <p className="text-xs font-bold text-fg-muted">集団・オンライン {season.periods.group_online.start}〜{season.periods.group_online.end}・授業 {season.courses.length}種類・基準 集団 {seasonBaselineMinutes(season, 'group_online', 'group').toLocaleString()}分</p>
              </div>
              <div className="flex gap-1.5">
                <Button size="sm" variant="secondary" loading={loadingReport === season.id} onClick={() => void openReport(season)}>手当の一覧</Button>
                <Button size="sm" variant="secondary" onClick={() => setEditing({ ...season, courses: season.courses.map(course => ({ ...course })) })}>編集</Button>
                <IconButton label={`${season.name}を消す`} size="sm" variant="ghost" onClick={async () => { if (await confirm({ title: `${season.name}を消しますか？`, message: '登録された授業は残りますが、画面に出なくなります。', tone: 'danger', confirmLabel: '消す' })) await onDelete(season.id); }}><Trash2 size={15} /></IconButton>
              </div>
            </li>
          ))}
        </ul>
      )}
      {editing && <SeasonEditor season={editing} busy={busy} onClose={() => setEditing(null)} onSave={async season => { if (await onSave(season)) setEditing(null); }} />}
      <Modal open={Boolean(report)} onClose={() => setReport(null)} size="xl" title={report ? `${report.season.name} 過剰授業手当（試算）` : ''} description="承認済みの授業だけで、本人の時間外単価で計算します。5等級は、講習期間の過剰授業手当と、その期間にかかる月の時間外勤務手当を比べ、過剰授業手当のほうが多いときは支給済みの時間外勤務手当を引いた分を支給します。日曜特訓・突破ゼミ・年末年始特訓などの特訓は手当で払うので、比べる時間外には入れません。" footer={<Button variant="secondary" onClick={exportReport} icon={<Download size={15} aria-hidden />}>CSV</Button>}>
        {report && (
          <div className="overflow-x-auto">
            <table className="w-full min-w-[720px] text-sm">
              <thead className="text-xs font-bold text-fg-muted"><tr>{['職員', '等級', '授業', '基準', '時間外の差し引き', '過剰', '手当', '5等級の比較'].map(label => <th key={label} className="px-2 py-1.5 text-left">{label}</th>)}</tr></thead>
              <tbody className="divide-y divide-line">
                {report.rows.filter(row => row.view).map(({ staff, view }) => (
                  <tr key={staff.uid}>
                    <td className="px-2 py-1.5 font-bold">{staff.name}<span className="ml-1 text-xs text-fg-muted">{BASELINE_TYPE_LABELS[staff.baseline_type]}</span></td>
                    <td className="px-2 py-1.5">{staff.grade ?? <span className="text-danger">未設定</span>}</td>
                    <td className="px-2 py-1.5 font-mono">{hours(view!.allowance.lesson_minutes)}{view!.allowance.pending_minutes ? <span className="ml-1 text-xs text-amber-700">＋待ち{hours(view!.allowance.pending_minutes)}</span> : null}</td>
                    <td className="px-2 py-1.5 font-mono">{hours(view!.allowance.baseline_minutes)}</td>
                    <td className="px-2 py-1.5 font-mono">{view!.allowance.overtime_deduction_minutes ? `−${hours(view!.allowance.overtime_deduction_minutes)}` : ''}</td>
                    <td className="px-2 py-1.5 font-mono font-bold text-accent">{hours(view!.allowance.excess_minutes)}</td>
                    <td className="px-2 py-1.5 font-mono font-bold">{view!.allowance.rate_missing ? <span className="text-xs text-danger">単価未設定</span> : `${view!.allowance.amount.toLocaleString()}円`}</td>
                    <td className="px-2 py-1.5 text-xs">{view!.comparison ? <>時間外 {view!.comparison.paid_overtime_amount.toLocaleString()}円 → <span className="font-bold">追加 {view!.comparison.extra_amount.toLocaleString()}円</span></> : ''}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
      </Modal>
    </div>
  );
}

function SeasonEditor({ season, busy, onClose, onSave }: { season: DedicatedSeason; busy: boolean; onClose: () => void; onSave: (season: DedicatedSeason) => void }) {
  const [form, setForm] = useState<DedicatedSeason>(season);
  const setPeriod = (division: DedicatedDivision, key: 'start' | 'end', value: string) => setForm(current => ({ ...current, periods: { ...current.periods, [division]: { ...current.periods[division], [key]: value } } }));
  const setCourse = (index: number, patch: Partial<SeasonCourse>) => setForm(current => ({ ...current, courses: current.courses.map((course, i) => i === index ? { ...course, ...patch } : course) }));
  const days = useMemo(() => ({
    group_online: seasonLessonDays(form, 'group_online'),
    individual: seasonLessonDays(form, 'individual'),
    junior_exam: seasonLessonDays(form, 'junior_exam'),
  }), [form]);
  return (
    <Modal open onClose={onClose} closeOnBackdrop={false} size="xl" title={form.id ? `${form.name}を編集` : '講習期間を作る'} footer={<><Button variant="secondary" onClick={onClose}>やめる</Button><Button loading={busy} icon={<Save size={16} aria-hidden />} onClick={() => onSave(form)}>保存</Button></>}>
      <div className="space-y-4">
        <div className="grid gap-3 sm:grid-cols-[1fr_10rem]">
          <label className={labelClass}>名前<input value={form.name} onChange={event => setForm({ ...form, name: event.target.value })} className={`${inputClass} mt-1`} placeholder="例：2026年度 冬期講習" /></label>
          <label className={labelClass}>登録の締め切り<input type="date" value={form.entry_deadline || ''} onChange={event => setForm({ ...form, entry_deadline: event.target.value || undefined })} className={`${inputClass} mt-1`} /></label>
        </div>
        <fieldset className="space-y-2">
          <legend className="text-sm font-bold text-fg">事業部ごとの対象期間</legend>
          {(Object.keys(DEDICATED_DIVISION_LABELS) as DedicatedDivision[]).map(division => (
            <div key={division} className="grid items-end gap-2 sm:grid-cols-[14rem_10rem_10rem_1fr]">
              <p className="pb-2 text-sm font-bold">{DEDICATED_DIVISION_LABELS[division]}</p>
              <input aria-label={`${DEDICATED_DIVISION_LABELS[division]} 開始`} type="date" value={form.periods[division].start} onChange={event => setPeriod(division, 'start', event.target.value)} className={inputClass} />
              <input aria-label={`${DEDICATED_DIVISION_LABELS[division]} 終了`} type="date" value={form.periods[division].end} onChange={event => setPeriod(division, 'end', event.target.value)} className={inputClass} />
              <p className="pb-2 text-xs font-bold text-fg-muted">授業日 {days[division]}日（日曜・除く期間を除く）</p>
            </div>
          ))}
          <div className="grid items-end gap-2 sm:grid-cols-[14rem_10rem_10rem]">
            <p className="pb-2 text-sm font-bold">除く期間（お盆など）</p>
            <input aria-label="除く期間 開始" type="date" value={form.excluded.start} onChange={event => setForm({ ...form, excluded: { ...form.excluded, start: event.target.value } })} className={inputClass} />
            <input aria-label="除く期間 終了" type="date" value={form.excluded.end} onChange={event => setForm({ ...form, excluded: { ...form.excluded, end: event.target.value } })} className={inputClass} />
          </div>
        </fieldset>
        <fieldset className="grid gap-2 sm:grid-cols-5">
          <legend className="mb-1 text-sm font-bold text-fg">基準授業時間（分）　講習時の勤怠規則の分数を入れます（空欄は「1日あたり × 授業日」）</legend>
          <label className={labelClass}>1日あたり<input type="number" min={0} value={form.per_day_minutes} onChange={event => setForm({ ...form, per_day_minutes: Number(event.target.value) || 0 })} className={`${inputClass} mt-1`} /></label>
          {(Object.keys(BASELINE_TYPE_LABELS) as BaselineType[]).map(type => (
            <label key={type} className={labelClass}>{BASELINE_TYPE_LABELS[type]}<input type="number" min={0} value={form.baselines[type] ?? ''} placeholder={String(form.per_day_minutes * days[type === 'academy' || type === 'hq_academy' ? 'junior_exam' : 'group_online'])} onChange={event => setForm({ ...form, baselines: { ...form.baselines, [type]: event.target.value === '' ? undefined : Number(event.target.value) } })} className={`${inputClass} mt-1`} /></label>
          ))}
        </fieldset>
        <fieldset className="space-y-1">
          <legend className="mb-1 text-sm font-bold text-fg">過剰授業手当</legend>
          <p className="text-xs font-bold text-fg-muted">時給は本人の時間外単価（「職員の設定」）で計算します。</p>
          <label className="flex items-center gap-2 text-xs font-bold text-fg"><input type="checkbox" checked={form.deduct_overtime_for_grade4_or_below} onChange={event => setForm({ ...form, deduct_overtime_for_grade4_or_below: event.target.checked })} className="h-4 w-4 accent-accent" />4等級以下は時間外÷4×3を差し引く</label>
        </fieldset>
        <div>
          <div className="mb-2 flex items-center justify-between"><p className="text-sm font-bold text-fg">授業の一覧（{form.courses.length}）<span className="ml-1 text-xs text-fg-muted">任意。空でも各自が授業名と分数を入れて登録できます</span></p><Button size="sm" variant="secondary" icon={<Plus size={14} aria-hidden />} onClick={() => setForm(current => ({ ...current, courses: [...current.courses, { id: `c${Date.now().toString(36)}`, section: current.courses.slice(-1)[0]?.section || '集団', grade: '', name: '', minutes: 50 }] }))}>授業を足す</Button></div>
          <div className="max-h-[40vh] overflow-y-auto rounded-input border border-line">
            <table className="w-full text-sm">
              <thead className="sticky top-0 bg-canvas text-xs font-bold text-fg-muted"><tr>{['区分', '学年', '授業', '分', ''].map(label => <th key={label} className="px-2 py-1.5 text-left">{label}</th>)}</tr></thead>
              <tbody className="divide-y divide-line">
                {form.courses.map((course, index) => (
                  <tr key={course.id}>
                    <td className="px-1 py-1"><input aria-label="区分" value={course.section} onChange={event => setCourse(index, { section: event.target.value })} className={`${inputClass} w-24`} /></td>
                    <td className="px-1 py-1"><input aria-label="学年" value={course.grade} onChange={event => setCourse(index, { grade: event.target.value })} className={`${inputClass} w-36`} /></td>
                    <td className="px-1 py-1"><input aria-label="授業" value={course.name} onChange={event => setCourse(index, { name: event.target.value })} className={inputClass} /></td>
                    <td className="px-1 py-1"><input aria-label="分" type="number" min={1} value={course.minutes} onChange={event => setCourse(index, { minutes: Number(event.target.value) || 0 })} className={`${inputClass} w-20`} /></td>
                    <td className="px-1 py-1"><IconButton label="この授業を消す" size="sm" variant="ghost" onClick={() => setForm(current => ({ ...current, courses: current.courses.filter((_, i) => i !== index) }))}><Trash2 size={14} /></IconButton></td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </div>
      </div>
    </Modal>
  );
}

function StaffTab({ data, busy, onSave, onSaveHolidays }: { data: Data; busy: boolean; onSave: (body: Record<string, unknown>) => Promise<unknown>; onSaveHolidays: (holidays: CompanyHoliday[]) => Promise<unknown> }) {
  const [drafts, setDrafts] = useState<Record<string, Record<string, unknown>>>({});
  const value = (row: Row, key: string, fallback: unknown) => (drafts[row.staff.uid]?.[key] ?? fallback) as any;
  const set = (uid: string, key: string, next: unknown) => setDrafts(current => ({ ...current, [uid]: { ...current[uid], [key]: next } }));
  return (
    <div className="space-y-2">
      <p className="text-xs font-bold text-fg-muted">時間外単価は時間外勤務手当（普通1.25・深夜1.5・休日1.35・休日深夜1.6・時間内1）と過剰授業手当に使います。等級は5等級のみなし（月35時間、時短は28時間）と6等級以上の対象外に、事業部は講習の期間と勤務終了の最終時刻（集団・オンラインは22:00、そのほかは22:20）に使います。「8時間までの枠」は、所定が8時間に満たない人の時間外を始業の前と終業の後のどちらから数えるかです（教員は始業前）。「承認者」を選ぶと、その人の申請はその人（と勤怠の管理者）だけが承認します。校長は部長、本部の職員は課長・室長を選びます。空のときは校舎の承認者（校長）です。</p>
      {data.rows.length === 0 ? <EmptyState icon={UserCog} title="担当している専任はいません" /> : (
        <Card padded={false} className="overflow-x-auto">
          <table className="w-full min-w-[1460px] text-sm">
            <thead className="bg-canvas text-xs font-bold text-fg-muted"><tr>{['職員', '承認者', '等級', '時間外単価（円）', '時短', '事業部', '講習の基準', '所定の始業', '終業', '休憩', '8時間までの枠', '勤務する曜日', ''].map(label => <th key={label} className="px-2 py-2 text-left">{label}</th>)}</tr></thead>
            <tbody className="divide-y divide-line">
              {data.rows.map(row => {
                const days: number[] = value(row, 'prescribed_work_days', row.staff.schedule.work_days);
                const dirty = Boolean(drafts[row.staff.uid]);
                return (
                  <tr key={row.staff.uid}>
                    <td className="px-2 py-1.5 font-bold">{row.staff.name}<span className="block text-xs text-fg-muted">{row.staff.school}</span></td>
                    <td className="px-2 py-1.5"><select aria-label="承認者" value={(value(row, 'dedicated_approver_ids', row.staff.approver_ids) as string[])[0] || ''} onChange={event => set(row.staff.uid, 'dedicated_approver_ids', event.target.value ? [event.target.value] : [])} className={`${inputClass} w-44`}><option value="">校舎の承認者</option>{data.approver_candidates.filter(item => item.uid !== row.staff.uid).map(item => <option key={item.uid} value={item.uid}>{item.name}（{item.school}）</option>)}</select></td>
                    <td className="px-2 py-1.5"><select aria-label="等級" value={value(row, 'job_grade', row.staff.grade ?? '') ?? ''} onChange={event => set(row.staff.uid, 'job_grade', event.target.value)} className={`${inputClass} w-24`}><option value="">未設定</option>{[1, 2, 3, 4, 5, 6, 7, 8, 9].map(grade => <option key={grade} value={grade}>{grade}等級</option>)}</select></td>
                    <td className="px-2 py-1.5"><input aria-label="時間外単価" type="number" min={0} step={1} value={value(row, 'overtime_unit_rate', row.staff.unit_rate ?? '') ?? ''} onChange={event => set(row.staff.uid, 'overtime_unit_rate', event.target.value)} className={`${inputClass} w-28`} placeholder="未設定" /></td>
                    <td className="px-2 py-1.5 text-center"><input aria-label="時短勤務" type="checkbox" checked={Boolean(value(row, 'short_time_work', row.staff.short_time))} onChange={event => set(row.staff.uid, 'short_time_work', event.target.checked)} className="h-4 w-4 accent-accent" /></td>
                    <td className="px-2 py-1.5"><select aria-label="事業部" value={value(row, 'dedicated_division', row.staff.division)} onChange={event => set(row.staff.uid, 'dedicated_division', event.target.value)} className={`${inputClass} w-44`}>{Object.entries(DEDICATED_DIVISION_LABELS).map(([id, label]) => <option key={id} value={id}>{label}</option>)}</select></td>
                    <td className="px-2 py-1.5"><select aria-label="講習の基準" value={value(row, 'dedicated_baseline_type', row.staff.baseline_type)} onChange={event => set(row.staff.uid, 'dedicated_baseline_type', event.target.value)} className={`${inputClass} w-40`}>{Object.entries(BASELINE_TYPE_LABELS).map(([id, label]) => <option key={id} value={id}>{label}</option>)}</select></td>
                    <td className="px-2 py-1.5"><input aria-label="所定の始業" type="time" step={300} value={value(row, 'prescribed_work_start', row.staff.schedule.start_time)} onChange={event => set(row.staff.uid, 'prescribed_work_start', event.target.value)} className={`${inputClass} w-28`} /></td>
                    <td className="px-2 py-1.5"><input aria-label="所定の終業" type="time" step={300} value={value(row, 'prescribed_work_end', row.staff.schedule.end_time)} onChange={event => set(row.staff.uid, 'prescribed_work_end', event.target.value)} className={`${inputClass} w-28`} /></td>
                    <td className="px-2 py-1.5"><input aria-label="休憩" type="number" min={0} step={5} value={value(row, 'prescribed_break_minutes', row.staff.schedule.break_minutes)} onChange={event => set(row.staff.uid, 'prescribed_break_minutes', Number(event.target.value) || 0)} className={`${inputClass} w-20`} /></td>
                    <td className="px-2 py-1.5"><select aria-label="8時間までの枠" value={value(row, 'prescribed_extend_side', row.staff.schedule.extend_side || 'before')} onChange={event => set(row.staff.uid, 'prescribed_extend_side', event.target.value)} className={`${inputClass} w-28`}><option value="before">始業の前</option><option value="after">終業の後</option></select></td>
                    <td className="px-2 py-1.5"><div className="flex gap-0.5">{WEEKDAYS.map((label, index) => <button key={label} type="button" aria-pressed={days.includes(index)} onClick={() => set(row.staff.uid, 'prescribed_work_days', days.includes(index) ? days.filter(day => day !== index) : [...days, index].sort())} className={`h-8 w-8 rounded border text-xs font-bold ${days.includes(index) ? 'border-accent bg-accent-soft text-accent' : 'border-line text-fg-muted'}`}>{label}</button>)}</div></td>
                    <td className="px-2 py-1.5"><Button size="sm" disabled={!dirty} loading={busy && dirty} onClick={async () => { if (await onSave({ user_id: row.staff.uid, ...drafts[row.staff.uid] })) setDrafts(current => { const next = { ...current }; delete next[row.staff.uid]; return next; }); }}>保存</Button></td>
                  </tr>
                );
              })}
            </tbody>
          </table>
        </Card>
      )}
      <HolidayCalendar holidays={data.holidays} busy={busy} onSave={onSaveHolidays} />
    </div>
  );
}

const holidaysToText = (holidays: CompanyHoliday[]) => holidays.map(item => `${item.date}${item.name ? ` ${item.name}` : ''}`).join('\n');
const parseHolidayText = (text: string) => text.split(/\r?\n/).map(line => line.trim()).filter(Boolean).map(line => {
  const match = line.normalize('NFKC').match(/^(\d{4})[-/](\d{1,2})[-/](\d{1,2})[\s,\t]*(.*)$/);
  return match ? { date: `${match[1]}-${match[2].padStart(2, '0')}-${match[3].padStart(2, '0')}`, name: match[4].trim().slice(0, 40) } : null;
});

/** 会社の休日（祝日・夏季休暇・年末年始など）。この日の勤務は公休日として数え、月の報告書の提出期限（2営業日）からも除く。 */
function HolidayCalendar({ holidays, busy, onSave }: { holidays: CompanyHoliday[]; busy: boolean; onSave: (holidays: CompanyHoliday[]) => Promise<unknown> }) {
  const [text, setText] = useState(() => holidaysToText(holidays));
  useEffect(() => { setText(holidaysToText(holidays)); }, [holidays]);
  const parsed = parseHolidayText(text);
  const invalid = parsed.filter(item => !item).length;
  return (
    <Card className="space-y-2">
      <SectionTitle title="会社の休日" description="1行に1日、「2026-11-03 文化の日」のように入れます（表計算からの貼り付けも可）。この日の勤務は公休日として時間外に数え、月の報告書の提出期限（2営業日目）からも除きます。" />
      <textarea aria-label="会社の休日" value={text} onChange={event => setText(event.target.value)} className={`${inputClass} min-h-40 font-mono`} placeholder={'2026-11-03 文化の日\n2026-11-23 勤労感謝の日'} />
      <div className="flex flex-wrap items-center justify-between gap-2">
        <p className={`text-xs font-bold ${invalid ? 'text-danger' : 'text-fg-muted'}`}>{invalid ? `日付が読めない行が${invalid}行あります` : `${parsed.length}日`}</p>
        <Button size="sm" loading={busy} disabled={invalid > 0} icon={<Save size={15} aria-hidden />} onClick={() => void onSave(parsed.filter((item): item is CompanyHoliday => Boolean(item)))}>保存</Button>
      </div>
    </Card>
  );
}
