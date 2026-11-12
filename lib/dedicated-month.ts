/**
 * 専任1人の月の勤怠（打刻・時間外の予定・実施報告・授業・交通費）を1つの表にまとめる（純粋関数）。
 * 職員の画面と承認者の画面の両方で、同じ計算を使う。
 */

import type { LessonExclusion } from '@/lib/dedicated-lesson-term';
import { normalizeDedicatedSchedule, type DedicatedSchedule } from './dedicated-attendance';
import {
  applyTransferOut,
  computeDayActual,
  computeOvertimePay,
  transferableMinutes,
  divisionEndLimit,
  monthDates,
  normalizeDivision,
  normalizeJobGrade,
  reconcileDay,
  summarizeMonth,
  type DayActual,
  type DayReconciliation,
  type DedicatedDivision,
  type MonthSummary,
  type OvertimePay,
  type PlanLike,
  type ReportLike,
} from './dedicated-overtime';
import {
  computeSeasonAllowance,
  isInSeason,
  normalizeBaselineType,
  seasonRange,
  type BaselineType,
  type DedicatedSeason,
  type SeasonAllowance,
} from './dedicated-season';

export type DedicatedStaff = {
  uid: string;
  name: string;
  school: string;
  schedule: DedicatedSchedule;
  grade: number | null;
  division: DedicatedDivision;
  baseline_type: BaselineType;
  end_limit: string;
  /** 時間外単価（円/時）。時間外勤務手当と過剰授業手当の計算に使う。未設定は null。 */
  unit_rate: number | null;
  /** 時短勤務（5等級のみなしは28時間）。 */
  short_time: boolean;
  /**
   * この人の申請を承認する人（部長・課長・室長など）。空なら校舎の承認者（校長）が承認する。
   * 校長の申請は部長、本部の職員は課長・室長、のように今のワークフローに合わせて設定する。
   */
  approver_ids: string[];
};

export const normalizeUnitRate = (value: unknown): number | null => {
  const rate = Math.round(Number(value));
  return Number.isFinite(rate) && rate > 0 && rate <= 100000 ? rate : null;
};

export function dedicatedStaffFromProfile(uid: string, profile: Record<string, any>): DedicatedStaff {
  const division = normalizeDivision(profile.dedicated_division);
  return {
    uid,
    name: String(profile.name || profile.teacher_name || profile.display_name || '').slice(0, 100),
    school: String(profile.school_id || profile.school_code || profile.school_name || profile.school || ''),
    schedule: normalizeDedicatedSchedule(profile),
    grade: normalizeJobGrade(profile.job_grade),
    division,
    baseline_type: normalizeBaselineType(profile.dedicated_baseline_type),
    end_limit: divisionEndLimit(division),
    unit_rate: normalizeUnitRate(profile.overtime_unit_rate),
    short_time: profile.short_time_work === true,
    approver_ids: Array.isArray(profile.dedicated_approver_ids)
      ? Array.from(new Set(profile.dedicated_approver_ids.map((id: unknown) => String(id || '').slice(0, 128)).filter(Boolean))).slice(0, 5) as string[]
      : [],
  };
}

/** 会社の休日（settings/dedicated_calendar）。 */
export type CompanyHoliday = { date: string; name: string };

/**
 * 時間が足りない日の扱い（2026-10-26 給与担当の回答「半日有休・半日振替・別日からの時間振替にも対応」）。
 *  - half_leave：半日有休。その時間で所定を埋める。
 *  - half_substitute：半日振替。公休日に働いた時間（from_date）を移して所定を埋める。
 *  - time_transfer：時間振替。ほかの勤務日の時間内・時間外（from_date）を移して所定を埋める。
 * 振替の元の日は同じ月に限る。移した分は元の日の支給から差し引く。
 */
export type DayAdjustmentKind = 'half_leave' | 'half_substitute' | 'time_transfer';
export const DAY_ADJUSTMENT_LABELS: Record<DayAdjustmentKind, string> = {
  half_leave: '半日有休',
  half_substitute: '半日振替',
  time_transfer: '時間振替',
};
export type DayAdjustment = { kind: DayAdjustmentKind; minutes: number; from_date?: string };

export function normalizeDayAdjustment(value: unknown): DayAdjustment | null {
  const raw = (value || {}) as Record<string, unknown>;
  const kind = raw.kind === 'half_leave' || raw.kind === 'half_substitute' || raw.kind === 'time_transfer' ? raw.kind : null;
  const minutes = Math.floor(Number(raw.minutes));
  if (!kind || !Number.isFinite(minutes) || minutes <= 0 || minutes > 480) return null;
  const fromDate = /^\d{4}-\d{2}-\d{2}$/.test(String(raw.from_date || '')) ? String(raw.from_date) : undefined;
  if (kind !== 'half_leave' && !fromDate) return null;
  return { kind, minutes, ...(kind === 'half_leave' ? {} : { from_date: fromDate }) };
}

export type WorkRecordLike = { id: string; date: string; start_time?: string; end_time?: string | null; status?: string; dedicated_break_minutes?: number | null; dedicated_day_off?: boolean | null; dedicated_adjustment?: DayAdjustment | null };
export type PlanDoc = PlanLike & { id: string; user_id: string; start: string; end: string; break_minutes: number; reason: string; source: 'bulk' | 'individual'; late?: boolean; day_off?: boolean; review_note?: string; submitted_by?: string };
export type ReportDoc = ReportLike & { id: string; user_id: string; reason: string; details?: string; planned_minutes?: number; review_note?: string };
export type LessonDoc = { id: string; user_id: string; lesson_date: string; lesson_minutes: number; status: string; school_name?: string; review_note?: string; excluded?: LessonExclusion[] };
export type SeasonLessonDoc = { id: string; user_id: string; season_id: string; date: string; course_id: string; course_label: string; count: number; minutes: number; status: string; school_name?: string; review_note?: string };
export type TransportDoc = { id: string; user_id: string; expense_date: string; from: string; to: string; amount: number; reason: string; status: string; review_note?: string };

export type DedicatedDay = {
  date: string;
  record: { id: string; start_time: string; end_time: string | null; break_minutes: number | null; day_off: boolean | null; adjustment: DayAdjustment | null } | null;
  actual: DayActual | null;
  /** この日の有休・振替と、実際に所定を埋めた時間（振替は元の日に残っている分まで）。 */
  adjustment: (DayAdjustment & { credited_minutes: number }) | null;
  /** ほかの日へ移した時間。 */
  transferred_to: Array<{ date: string; minutes: number }>;
  reconciliation: DayReconciliation;
  plans: PlanDoc[];
  report: ReportDoc | null;
  lesson_minutes: number;
  season_lesson_minutes: number;
  transport_amount: number;
};

const firstRecordByDate = (records: WorkRecordLike[]) => {
  const byDate = new Map<string, WorkRecordLike>();
  [...records]
    .filter(record => record.date && record.start_time)
    .sort((a, b) => String(a.start_time).localeCompare(String(b.start_time)))
    .forEach(record => { if (!byDate.has(record.date)) byDate.set(record.date, record); });
  return byDate;
};

/** 指定した日付の一覧について、打刻と予定・報告を突き合わせる。 */
export function buildDays(input: {
  staff: DedicatedStaff;
  dates: string[];
  records: WorkRecordLike[];
  plans: PlanDoc[];
  reports: ReportDoc[];
  lessons?: LessonDoc[];
  seasonLessons?: SeasonLessonDoc[];
  transport?: TransportDoc[];
  /** 会社の休日（YYYY-MM-DD）。 */
  holidays?: ReadonlySet<string>;
}): DedicatedDay[] {
  const records = firstRecordByDate(input.records);
  const reports = new Map(input.reports.map(report => [report.date, report]));
  const active = (status: string) => status !== 'rejected' && status !== 'cancelled';
  const actualFor = (date: string, creditMinutes = 0) => {
    const record = records.get(date);
    return record?.start_time && record.end_time
      ? computeDayActual({
        date,
        startIso: record.start_time,
        endIso: record.end_time,
        schedule: input.staff.schedule,
        breakMinutes: record.dedicated_break_minutes ?? null,
        dayOff: record.dedicated_day_off ?? null,
        holiday: input.holidays?.has(date) === true,
        creditMinutes,
        endLimit: input.staff.end_limit,
      })
      : null;
  };
  const plansFor = (date: string) => input.plans.filter(plan => plan.date === date && plan.status !== 'cancelled');

  // 1回目：有休・振替なしで各日を出す。振替の元の日に残っている時間を知るため。
  const base = new Map(input.dates.map(date => {
    const actual = actualFor(date);
    return [date, { actual, reconciliation: reconcileDay(date, actual, plansFor(date), reports.get(date) || null) }];
  }));
  // 2回目：振替は元の日に残っている分だけ移す（日付の順に先着）。
  const remaining = new Map(Array.from(base.entries()).map(([date, item]) => [date, transferableMinutes(item.reconciliation)]));
  const credits = new Map<string, number>();
  const outgoing = new Map<string, Array<{ date: string; minutes: number }>>();
  input.dates.forEach(date => {
    const adjustment = normalizeDayAdjustment(records.get(date)?.dedicated_adjustment);
    if (!adjustment) return;
    if (adjustment.kind === 'half_leave' || !adjustment.from_date || !remaining.has(adjustment.from_date) || adjustment.from_date === date) {
      credits.set(date, adjustment.kind === 'half_leave' ? adjustment.minutes : 0);
      return;
    }
    const moved = Math.min(adjustment.minutes, remaining.get(adjustment.from_date) || 0);
    remaining.set(adjustment.from_date, (remaining.get(adjustment.from_date) || 0) - moved);
    credits.set(date, moved);
    if (moved > 0) outgoing.set(adjustment.from_date, [...(outgoing.get(adjustment.from_date) || []), { date, minutes: moved }]);
  });

  return input.dates.map(date => {
    const record = records.get(date) || null;
    const adjustment = normalizeDayAdjustment(record?.dedicated_adjustment);
    const credited = credits.get(date) || 0;
    const actual = credited > 0 ? actualFor(date, credited) : base.get(date)!.actual;
    const plans = plansFor(date);
    const report = reports.get(date) || null;
    const transferredTo = outgoing.get(date) || [];
    let reconciliation = credited > 0 ? reconcileDay(date, actual, plans, report) : base.get(date)!.reconciliation;
    const out = transferredTo.reduce((sum, item) => sum + item.minutes, 0);
    if (out > 0) reconciliation = applyTransferOut(reconciliation, out, actual?.day_off === true);
    return {
      date,
      record: record ? {
        id: record.id,
        start_time: String(record.start_time || ''),
        end_time: record.end_time ? String(record.end_time) : null,
        break_minutes: record.dedicated_break_minutes ?? null,
        day_off: record.dedicated_day_off ?? null,
        adjustment,
      } : null,
      actual,
      adjustment: adjustment ? { ...adjustment, credited_minutes: credited } : null,
      transferred_to: transferredTo,
      reconciliation,
      plans,
      report,
      lesson_minutes: (input.lessons || []).filter(item => item.lesson_date === date && active(item.status)).reduce((sum, item) => sum + item.lesson_minutes, 0),
      season_lesson_minutes: (input.seasonLessons || []).filter(item => item.date === date && active(item.status)).reduce((sum, item) => sum + item.minutes, 0),
      transport_amount: (input.transport || []).filter(item => item.expense_date === date && active(item.status)).reduce((sum, item) => sum + item.amount, 0),
    };
  });
}

export function summarizeDays(days: DedicatedDay[], staff: Pick<DedicatedStaff, 'grade' | 'short_time'>): MonthSummary {
  return summarizeMonth(
    days.map(day => day.reconciliation),
    new Map(days.filter(day => day.actual).map(day => [day.date, day.actual!])),
    staff.grade,
    { shortTime: staff.short_time },
  );
}

export function buildMonth(input: Omit<Parameters<typeof buildDays>[0], 'dates'> & { month: string }) {
  const days = buildDays({ ...input, dates: monthDates(input.month) });
  const summary = summarizeDays(days, input.staff);
  const pay = computeOvertimePay(summary, { grade: input.staff.grade, unitRate: input.staff.unit_rate, shortTime: input.staff.short_time });
  return { days, summary, pay };
}

export type SeasonView = {
  season: DedicatedSeason;
  in_period: { start: string; end: string };
  allowance: SeasonAllowance;
  overtime_minutes: number;
  lessons: SeasonLessonDoc[];
  /**
   * 5等級の比べ方（2026-10-26 給与担当の回答）：時間外勤務手当は月単位、過剰授業手当は講習期間単位で出し、
   * 過剰授業手当のほうが多いときは、講習期間にかかる月にすでに支給した時間外勤務手当を差し引いた分だけ支給する。
   */
  comparison: {
    months: Array<{ month: string; overtime_payable_amount: number }>;
    paid_overtime_amount: number;
    /** 過剰授業手当として追加で支給する分（時間外勤務手当のほうが多ければ0）。 */
    extra_amount: number;
  } | null;
};

const monthsBetween = (start: string, end: string) => {
  const months: string[] = [];
  let cursor = start.slice(0, 7);
  while (cursor <= end.slice(0, 7) && months.length < 24) {
    months.push(cursor);
    const [year, month] = cursor.split('-').map(Number);
    cursor = new Date(Date.UTC(year, month, 1)).toISOString().slice(0, 7);
  }
  return months;
};

/** 講習期間の過剰授業手当（試算）。期間中の時間外（支給対象）を、4等級以下の差し引きに使う。 */
export function buildSeasonView(input: {
  staff: DedicatedStaff;
  season: DedicatedSeason;
  /** 5等級の比較のため、講習期間にかかる月の初めから終わりまでの打刻・予定・報告を渡す。 */
  records: WorkRecordLike[];
  plans: PlanDoc[];
  reports: ReportDoc[];
  seasonLessons: SeasonLessonDoc[];
  holidays?: ReadonlySet<string>;
}): SeasonView | null {
  const period = input.season.periods[input.staff.division];
  if (!period.start || !period.end || !seasonRange(input.season)) return null;
  const dates: string[] = [];
  const cursor = new Date(`${period.start}T12:00:00Z`);
  const last = new Date(`${period.end}T12:00:00Z`);
  while (cursor <= last && dates.length < 200) {
    dates.push(cursor.toISOString().slice(0, 10));
    cursor.setUTCDate(cursor.getUTCDate() + 1);
  }
  const days = buildDays({ staff: input.staff, dates, records: input.records, plans: input.plans, reports: input.reports, holidays: input.holidays });
  // 特訓は手当で払うので、過剰授業手当の計算・比較に使う時間外には入れない（2026-10-28 回答）。
  const overtime = days.reduce((sum, day) => sum + day.reconciliation.payable_minutes - (day.reconciliation.special_minutes ?? 0), 0);
  const lessons = input.seasonLessons
    .filter(item => item.season_id === input.season.id && item.status !== 'cancelled')
    .sort((a, b) => b.date.localeCompare(a.date));
  const inPeriod = (item: SeasonLessonDoc) => isInSeason(input.season, input.staff.division, item.date);
  const allowance = computeSeasonAllowance({
    season: input.season,
    division: input.staff.division,
    baselineType: input.staff.baseline_type,
    grade: input.staff.grade,
    unitRate: input.staff.unit_rate,
    approvedLessonMinutes: lessons.filter(item => item.status === 'approved' && inPeriod(item)).reduce((sum, item) => sum + item.minutes, 0),
    pendingLessonMinutes: lessons.filter(item => item.status === 'pending' && inPeriod(item)).reduce((sum, item) => sum + item.minutes, 0),
    overtimeMinutes: overtime,
  });
  let comparison: SeasonView['comparison'] = null;
  if (allowance.compare_with_overtime) {
    const months = monthsBetween(period.start, period.end).map(month => ({
      month,
      overtime_payable_amount: buildMonth({ staff: input.staff, month, records: input.records, plans: input.plans, reports: input.reports, holidays: input.holidays }).pay.overtime_payable_amount,
    }));
    const paid = months.reduce((sum, item) => sum + item.overtime_payable_amount, 0);
    comparison = { months, paid_overtime_amount: paid, extra_amount: Math.max(0, allowance.amount - paid) };
  }
  return {
    season: input.season,
    in_period: period,
    overtime_minutes: overtime,
    lessons,
    allowance,
    comparison,
  };
}
