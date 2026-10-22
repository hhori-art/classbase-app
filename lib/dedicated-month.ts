/**
 * 専任1人の月の勤怠（打刻・時間外の予定・実施報告・授業・交通費）を1つの表にまとめる（純粋関数）。
 * 職員の画面と承認者の画面の両方で、同じ計算を使う。
 */

import { normalizeDedicatedSchedule, type DedicatedSchedule } from './dedicated-attendance';
import {
  computeDayActual,
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
  };
}

export type WorkRecordLike = { id: string; date: string; start_time?: string; end_time?: string | null; status?: string; dedicated_break_minutes?: number | null; dedicated_day_off?: boolean | null };
export type PlanDoc = PlanLike & { id: string; user_id: string; start: string; end: string; break_minutes: number; reason: string; source: 'bulk' | 'individual'; late?: boolean; day_off?: boolean; review_note?: string; submitted_by?: string };
export type ReportDoc = ReportLike & { id: string; user_id: string; reason: string; details?: string; planned_minutes?: number; review_note?: string };
export type LessonDoc = { id: string; user_id: string; lesson_date: string; lesson_minutes: number; status: string; school_name?: string; review_note?: string };
export type SeasonLessonDoc = { id: string; user_id: string; season_id: string; date: string; course_id: string; course_label: string; count: number; minutes: number; status: string; school_name?: string; review_note?: string };
export type TransportDoc = { id: string; user_id: string; expense_date: string; from: string; to: string; amount: number; reason: string; status: string; review_note?: string };

export type DedicatedDay = {
  date: string;
  record: { id: string; start_time: string; end_time: string | null; break_minutes: number | null; day_off: boolean | null } | null;
  actual: DayActual | null;
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
}): DedicatedDay[] {
  const records = firstRecordByDate(input.records);
  const reports = new Map(input.reports.map(report => [report.date, report]));
  const active = (status: string) => status !== 'rejected' && status !== 'cancelled';
  return input.dates.map(date => {
    const record = records.get(date) || null;
    const actual = record?.start_time && record.end_time
      ? computeDayActual({
        date,
        startIso: record.start_time,
        endIso: record.end_time,
        schedule: input.staff.schedule,
        breakMinutes: record.dedicated_break_minutes ?? null,
        dayOff: record.dedicated_day_off ?? null,
        endLimit: input.staff.end_limit,
      })
      : null;
    const plans = input.plans.filter(plan => plan.date === date && plan.status !== 'cancelled');
    const report = reports.get(date) || null;
    return {
      date,
      record: record ? {
        id: record.id,
        start_time: String(record.start_time || ''),
        end_time: record.end_time ? String(record.end_time) : null,
        break_minutes: record.dedicated_break_minutes ?? null,
        day_off: record.dedicated_day_off ?? null,
      } : null,
      actual,
      reconciliation: reconcileDay(date, actual, plans, report),
      plans,
      report,
      lesson_minutes: (input.lessons || []).filter(item => item.lesson_date === date && active(item.status)).reduce((sum, item) => sum + item.lesson_minutes, 0),
      season_lesson_minutes: (input.seasonLessons || []).filter(item => item.date === date && active(item.status)).reduce((sum, item) => sum + item.minutes, 0),
      transport_amount: (input.transport || []).filter(item => item.expense_date === date && active(item.status)).reduce((sum, item) => sum + item.amount, 0),
    };
  });
}

export function summarizeDays(days: DedicatedDay[], grade: number | null): MonthSummary {
  return summarizeMonth(
    days.map(day => day.reconciliation),
    new Map(days.filter(day => day.actual).map(day => [day.date, day.actual!])),
    grade,
  );
}

export function buildMonth(input: Omit<Parameters<typeof buildDays>[0], 'dates'> & { month: string }) {
  const days = buildDays({ ...input, dates: monthDates(input.month) });
  return { days, summary: summarizeDays(days, input.staff.grade) };
}

export type SeasonView = {
  season: DedicatedSeason;
  in_period: { start: string; end: string };
  allowance: SeasonAllowance;
  overtime_minutes: number;
  lessons: SeasonLessonDoc[];
};

/** 講習期間の過剰授業手当（試算）。期間中の時間外（支給対象）を、4等級以下の差し引きに使う。 */
export function buildSeasonView(input: {
  staff: DedicatedStaff;
  season: DedicatedSeason;
  records: WorkRecordLike[];
  plans: PlanDoc[];
  reports: ReportDoc[];
  seasonLessons: SeasonLessonDoc[];
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
  const days = buildDays({ staff: input.staff, dates, records: input.records, plans: input.plans, reports: input.reports });
  const overtime = days.reduce((sum, day) => sum + day.reconciliation.payable_minutes, 0);
  const lessons = input.seasonLessons
    .filter(item => item.season_id === input.season.id && item.status !== 'cancelled')
    .sort((a, b) => b.date.localeCompare(a.date));
  const inPeriod = (item: SeasonLessonDoc) => isInSeason(input.season, input.staff.division, item.date);
  return {
    season: input.season,
    in_period: period,
    overtime_minutes: overtime,
    lessons,
    allowance: computeSeasonAllowance({
      season: input.season,
      division: input.staff.division,
      baselineType: input.staff.baseline_type,
      grade: input.staff.grade,
      approvedLessonMinutes: lessons.filter(item => item.status === 'approved' && inPeriod(item)).reduce((sum, item) => sum + item.minutes, 0),
      pendingLessonMinutes: lessons.filter(item => item.status === 'pending' && inPeriod(item)).reduce((sum, item) => sum + item.minutes, 0),
      overtimeMinutes: overtime,
    }),
  };
}
