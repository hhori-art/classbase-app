/**
 * 専任の時間外勤務（純粋関数）。紙の様式をそのまま置き換える。
 *  - D05 時間外勤務時間 一括申請（校長が翌月の予定をまとめて申請）
 *  - D06 時間外業務 実施申請（各自が2日前までに個別に申請）
 *  - D07 時間外業務 実施報告（予定と違った・突発の時間外を事後に報告）
 *  - D08 時間外勤務 実施予定・実施報告書（月初に予定と実績を突き合わせて提出）
 *
 * 時間外の数え方（D05 の入力規則）：
 *  - 勤務日：休憩を除いた実労働が 1日8時間を超えた分。
 *    所定が8時間に満たないときは、足りない分だけ始業側を前に広げた枠の外を時間外とする
 *    （例：所定 13:50〜22:20・休憩60分 → 7時間30分なので 13:20 より前の勤務が時間外）。
 *  - 公休日（振替なし）：その日の実労働すべて。
 *  - 深夜：22:00〜翌5:00 にかかった分（別に数える）。
 * 時刻は5分単位（出勤は切り上げ・退勤は切り捨て）。
 */

import type { DedicatedSchedule } from './dedicated-attendance';

export const LEGAL_DAILY_MINUTES = 8 * 60;
/** 23:00 完全退社。これより後の予定は入れられない。 */
export const ABSOLUTE_END = '23:00';
/** 1か月の時間外の上限（健康管理）。 */
export const MONTHLY_OVERTIME_LIMIT_MINUTES = 75 * 60;
/** 5等級は月35時間を超えた分から時間外勤務手当（みなし残業）。 */
export const GRADE5_THRESHOLD_MINUTES = 35 * 60;
/** 個別の事前申請（D06）は実施の2日前まで。 */
export const INDIVIDUAL_PLAN_LEAD_DAYS = 2;

export type DedicatedDivision = 'group_online' | 'individual' | 'junior_exam';
export const DEDICATED_DIVISION_LABELS: Record<DedicatedDivision, string> = {
  group_online: '集団指導・オンライン事業部',
  individual: '個別指導事業部',
  junior_exam: '中学受験事業部',
};
export const normalizeDivision = (value: unknown): DedicatedDivision =>
  value === 'individual' || value === 'junior_exam' ? value : 'group_online';
/** 勤務終了の最終時刻（集団・オンラインは 22:00、そのほかは 22:20）。 */
export const divisionEndLimit = (division: DedicatedDivision) => division === 'group_online' ? '22:00' : '22:20';

/** 等級（1〜9）。未設定は null（時間外の支給区分を出せないので「等級未設定」と表示する）。 */
export const normalizeJobGrade = (value: unknown): number | null => {
  const grade = Math.floor(Number(value));
  return Number.isInteger(grade) && grade >= 1 && grade <= 9 ? grade : null;
};

const TIME = /^([01]\d|2[0-3]):([0-5]\d)$/;
export const isTime = (value: unknown): value is string => TIME.test(String(value || ''));
export const toMinutes = (value: string) => {
  const [hour, minute] = value.split(':').map(Number);
  return hour * 60 + minute;
};
export const fromMinutes = (value: number) => {
  const minutes = ((Math.round(value) % 1440) + 1440) % 1440;
  return `${String(Math.floor(minutes / 60)).padStart(2, '0')}:${String(minutes % 60).padStart(2, '0')}`;
};
export const formatDuration = (minutes: number) => {
  const value = Math.max(0, Math.round(minutes));
  return `${Math.floor(value / 60)}:${String(value % 60).padStart(2, '0')}`;
};

const jstMinuteOfDay = (iso: string, date: string) => {
  const ms = Date.parse(iso);
  const dayStart = Date.parse(`${date}T00:00:00+09:00`);
  return Math.round((ms - dayStart) / 60000);
};
const overlap = (aStart: number, aEnd: number, bStart: number, bEnd: number) => Math.max(0, Math.min(aEnd, bEnd) - Math.max(aStart, bStart));
/** 22:00〜翌5:00（と、その日の0:00〜5:00）にかかる分。 */
export const nightMinutes = (start: number, end: number) =>
  overlap(start, end, 0, 5 * 60) + overlap(start, end, 22 * 60, 29 * 60);

const weekdayOf = (date: string) => new Date(`${date}T12:00:00+09:00`).getUTCDay();
export const isScheduledWorkDay = (date: string, schedule: DedicatedSchedule) => schedule.work_days.includes(weekdayOf(date));

/** 休憩の最低時間（6時間超〜8時間以下は45分、8時間超は60分）。 */
export const requiredBreakMinutes = (workedMinutes: number) => workedMinutes > 8 * 60 ? 60 : workedMinutes > 6 * 60 ? 45 : 0;

export type OvertimeSpan = { kind: 'before' | 'after' | 'day_off'; start: string; end: string; minutes: number };

export type DayActual = {
  date: string;
  /** 5分単位にそろえた出勤・退勤（HH:MM、24時以降は 24:30 のように表す）。 */
  start: string;
  end: string;
  break_minutes: number;
  worked_minutes: number;
  day_off: boolean;
  spans: OvertimeSpan[];
  /** 時間外（勤務日は8時間を超えた分、公休日は全部）。 */
  overtime_minutes: number;
  /** 時間外のうち22時以降の分。 */
  night_overtime_minutes: number;
  /** 遅出・早帰りで、所定の外にいた時間より時間外が短くなった分（講習期間は他日と相殺）。 */
  offset_minutes: number;
  warnings: string[];
};

const clockLabel = (minutes: number) => minutes >= 1440
  ? `${Math.floor(minutes / 60)}:${String(minutes % 60).padStart(2, '0')}`
  : fromMinutes(minutes);

/** 打刻（ISO）から、その日の実労働と時間外を出す。 */
export function computeDayActual(input: {
  date: string;
  startIso: string;
  endIso: string;
  schedule: DedicatedSchedule;
  breakMinutes?: number | null;
  dayOff?: boolean | null;
  endLimit?: string;
}): DayActual | null {
  const rawStart = jstMinuteOfDay(input.startIso, input.date);
  const rawEnd = jstMinuteOfDay(input.endIso, input.date);
  if (!Number.isFinite(rawStart) || !Number.isFinite(rawEnd)) return null;
  const start = Math.ceil(rawStart / 5) * 5;
  const end = Math.floor(rawEnd / 5) * 5;
  if (end <= start) return null;
  const span = end - start;
  // 休憩を入れていない日は、6時間を超えて勤務したときだけ所定の休憩を取ったものとする（短い日に休憩を引かない）。
  const defaultBreak = span > 6 * 60 ? input.schedule.break_minutes : 0;
  const breakMinutes = Math.max(0, Math.min(span, Math.round(input.breakMinutes ?? defaultBreak)));
  const worked = span - breakMinutes;
  const dayOff = input.dayOff ?? !isScheduledWorkDay(input.date, input.schedule);
  const warnings: string[] = [];
  const required = requiredBreakMinutes(worked);
  if (breakMinutes < required) warnings.push(`休憩が足りません（${worked > 480 ? '8時間超' : '6時間超'}は${required}分以上）`);
  if (input.endLimit && end > toMinutes(input.endLimit)) warnings.push(`勤務終了の最終時刻（${input.endLimit}）を過ぎています`);
  if (worked > 12 * 60) warnings.push('1日の勤務が12時間を超えています');

  const spans: OvertimeSpan[] = [];
  const add = (kind: OvertimeSpan['kind'], from: number, to: number) => {
    if (to > from) spans.push({ kind, start: clockLabel(from), end: clockLabel(to), minutes: to - from });
  };
  let overtime: number;
  let night: number;
  let offset = 0;
  if (dayOff) {
    add('day_off', start, end);
    overtime = worked;
    night = Math.min(worked, nightMinutes(start, end));
  } else {
    const scheduleStart = toMinutes(input.schedule.start_time);
    let scheduleEnd = toMinutes(input.schedule.end_time);
    if (scheduleEnd <= scheduleStart) scheduleEnd += 1440;
    const scheduledWork = scheduleEnd - scheduleStart - input.schedule.break_minutes;
    const windowStart = scheduleStart - Math.max(0, LEGAL_DAILY_MINUTES - scheduledWork);
    add('before', start, Math.min(end, windowStart));
    add('after', Math.max(start, scheduleEnd), end);
    const outside = spans.reduce((sum, item) => sum + item.minutes, 0);
    overtime = Math.min(outside, Math.max(0, worked - LEGAL_DAILY_MINUTES));
    offset = outside - overtime;
    const after = spans.find(item => item.kind === 'after');
    // 深夜は終業後の時間外のうち22時以降。相殺で時間外が短くなったときは、その分だけ減らす。
    night = Math.min(overtime, after ? nightMinutes(Math.max(start, scheduleEnd), end) : 0);
  }
  return {
    date: input.date,
    start: clockLabel(start),
    end: clockLabel(end),
    break_minutes: breakMinutes,
    worked_minutes: worked,
    day_off: dayOff,
    spans,
    overtime_minutes: overtime,
    night_overtime_minutes: night,
    offset_minutes: offset,
    warnings,
  };
}

export type PlanInput = { date: string; start: string; end: string; break_minutes?: number; day_off?: boolean; reason?: string };
export type PlanCheck = { ok: boolean; minutes: number; night_minutes: number; errors: string[]; warnings: string[]; late: boolean };

const addDays = (date: string, days: number) => {
  const value = new Date(`${date}T12:00:00+09:00`);
  value.setUTCDate(value.getUTCDate() + days);
  return value.toISOString().slice(0, 10);
};

/** 時間外の予定（D05/D06）を確かめる。errors があると登録できない。warnings は表示だけ。 */
export function checkOvertimePlan(plan: PlanInput, options: { today: string; endLimit: string; individual: boolean }): PlanCheck {
  const errors: string[] = [];
  const warnings: string[] = [];
  if (!/^\d{4}-\d{2}-\d{2}$/.test(plan.date)) errors.push('日付を選んでください');
  if (!isTime(plan.start) || !isTime(plan.end)) errors.push('開始・終了の時刻を入れてください');
  if (errors.length) return { ok: false, minutes: 0, night_minutes: 0, errors, warnings, late: false };
  const start = toMinutes(plan.start);
  const end = toMinutes(plan.end);
  const breakMinutes = Math.max(0, Math.round(Number(plan.break_minutes) || 0));
  if (start % 5 || end % 5 || breakMinutes % 5) errors.push('時刻と休憩は5分単位で入れてください');
  if (end <= start) errors.push('終了は開始より後にしてください');
  if (end > toMinutes(ABSOLUTE_END)) errors.push('23:00 以降の予定は入れられません（23:00 完全退社）');
  const minutes = Math.max(0, end - start - breakMinutes);
  if (end > start && minutes <= 0) errors.push('休憩が長すぎます');
  if (!String(plan.reason || '').trim()) errors.push('業務内容（超過理由）を入れてください');
  if (end > toMinutes(options.endLimit) && end <= toMinutes(ABSOLUTE_END)) warnings.push(`勤務終了の最終時刻（${options.endLimit}）を過ぎます。上長の承認が必要です`);
  if (minutes > 4 * 60) warnings.push('1日の時間外が4時間を超えています');
  const late = options.individual && plan.date < addDays(options.today, INDIVIDUAL_PLAN_LEAD_DAYS);
  if (late) warnings.push('実施の2日前を過ぎています（突発の時間外として扱います）');
  return { ok: errors.length === 0, minutes, night_minutes: nightMinutes(start, end), errors, warnings, late };
}

export type PlanStatus = 'pending' | 'approved' | 'rejected' | 'cancelled';
export type PlanLike = { date: string; minutes: number; night_minutes?: number; status: PlanStatus };
export type ReportLike = { date: string; status: 'pending' | 'approved' | 'rejected'; actual_minutes?: number };

export type DayState =
  | 'none'          // 時間外なし・予定なし
  | 'match'         // 承認された予定の範囲で時間外をした
  | 'under'         // 予定より短かった（実績で支給）
  | 'not_worked'    // 予定はあったが時間外をしなかった
  | 'plan_pending'  // 予定が承認待ち
  | 'needs_report'  // 予定を超えた・予定のない時間外 → 実施報告が必要
  | 'report_pending'// 実施報告が承認待ち
  | 'reported'      // 実施報告が承認された
  | 'report_rejected';

export const DAY_STATE_LABELS: Record<DayState, string> = {
  none: '',
  match: '予定どおり',
  under: '予定より短い',
  not_worked: '時間外なし',
  plan_pending: '予定の承認待ち',
  needs_report: '報告が必要',
  report_pending: '報告の承認待ち',
  reported: '報告承認済み',
  report_rejected: '報告が差し戻し',
};

export type DayReconciliation = {
  date: string;
  actual_minutes: number;
  night_minutes: number;
  planned_minutes: number;
  pending_plan_minutes: number;
  /** 支給の対象になる時間外（承認された予定の範囲、または承認された報告の実績）。 */
  payable_minutes: number;
  payable_night_minutes: number;
  /** 承認がないため、まだ支給の対象にならない時間外。 */
  unapproved_minutes: number;
  state: DayState;
};

/** 1日の予定（承認済み）と実績を突き合わせる。 */
export function reconcileDay(date: string, actual: DayActual | null, plans: PlanLike[], report: ReportLike | null): DayReconciliation {
  const dayPlans = plans.filter(plan => plan.date === date);
  const planned = dayPlans.filter(plan => plan.status === 'approved').reduce((sum, plan) => sum + plan.minutes, 0);
  const plannedNight = dayPlans.filter(plan => plan.status === 'approved').reduce((sum, plan) => sum + (plan.night_minutes || 0), 0);
  const pending = dayPlans.filter(plan => plan.status === 'pending').reduce((sum, plan) => sum + plan.minutes, 0);
  const actualMinutes = actual?.overtime_minutes || 0;
  const night = actual?.night_overtime_minutes || 0;
  let payable = Math.min(actualMinutes, planned);
  let payableNight = Math.min(night, plannedNight, payable);
  let state: DayState;
  if (actualMinutes === 0) state = planned > 0 ? 'not_worked' : pending > 0 ? 'plan_pending' : 'none';
  else if (actualMinutes <= planned) state = actualMinutes < planned ? 'under' : 'match';
  else if (report?.status === 'approved') {
    state = 'reported';
    payable = actualMinutes;
    payableNight = night;
  } else if (report?.status === 'pending') state = 'report_pending';
  else if (report?.status === 'rejected') state = 'report_rejected';
  else if (pending > 0 && actualMinutes <= planned + pending) state = 'plan_pending';
  else state = 'needs_report';
  return {
    date,
    actual_minutes: actualMinutes,
    night_minutes: night,
    planned_minutes: planned,
    pending_plan_minutes: pending,
    payable_minutes: payable,
    payable_night_minutes: payableNight,
    unapproved_minutes: Math.max(0, actualMinutes - payable),
    state,
  };
}

export type MonthSummary = {
  actual_minutes: number;
  planned_minutes: number;
  payable_minutes: number;
  payable_night_minutes: number;
  payable_day_off_minutes: number;
  unapproved_minutes: number;
  /** 報告が必要・差し戻しの日（月の提出前に片づける）。 */
  open_days: string[];
  /** 承認待ちがある日。 */
  waiting_days: string[];
  over_monthly_limit: boolean;
  /** 等級から見た時間外勤務手当の対象（試算）。6等級以上は対象外、5等級は35時間を超えた分。 */
  grade_payable_minutes: number | null;
};

export function summarizeMonth(days: DayReconciliation[], actuals: Map<string, DayActual>, grade: number | null): MonthSummary {
  const sum = (pick: (day: DayReconciliation) => number) => days.reduce((total, day) => total + pick(day), 0);
  const payable = sum(day => day.payable_minutes);
  const dayOff = sum(day => actuals.get(day.date)?.day_off ? day.payable_minutes : 0);
  const gradePayable = grade == null ? null : grade >= 6 ? 0 : grade === 5 ? Math.max(0, payable - GRADE5_THRESHOLD_MINUTES) : payable;
  return {
    actual_minutes: sum(day => day.actual_minutes),
    planned_minutes: sum(day => day.planned_minutes),
    payable_minutes: payable,
    payable_night_minutes: sum(day => day.payable_night_minutes),
    payable_day_off_minutes: dayOff,
    unapproved_minutes: sum(day => day.unapproved_minutes),
    open_days: days.filter(day => day.state === 'needs_report' || day.state === 'report_rejected').map(day => day.date),
    waiting_days: days.filter(day => day.state === 'plan_pending' || day.state === 'report_pending').map(day => day.date),
    over_monthly_limit: sum(day => day.actual_minutes) > MONTHLY_OVERTIME_LIMIT_MINUTES,
    grade_payable_minutes: gradePayable,
  };
}

/** 月の日付（YYYY-MM-DD）の一覧。 */
export function monthDates(month: string) {
  const [year, monthNumber] = month.split('-').map(Number);
  const last = new Date(Date.UTC(year, monthNumber, 0)).getUTCDate();
  return Array.from({ length: last }, (_, index) => `${month}-${String(index + 1).padStart(2, '0')}`);
}

export const nextMonthOf = (month: string) => {
  const [year, monthNumber] = month.split('-').map(Number);
  const value = new Date(Date.UTC(year, monthNumber, 1));
  return value.toISOString().slice(0, 7);
};
