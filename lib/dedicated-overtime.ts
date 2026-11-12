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
 *    事務職員など、終業側に広げる人は職員の設定で切り替える。
 *    所定を超えて8時間までの分は「時間内」（1倍）として別に数える。
 *  - 公休日（振替なし）・会社の休日：その日の実労働すべて。
 *  - 深夜：22:00〜翌5:00 にかかった分（別に数える）。
 * 時刻は5分単位（出勤は切り上げ・退勤は切り捨て）。
 *
 * 手当の割増率（2026-10-26 給与担当の回答）：
 *  普通 1.25・深夜 1.5・休日 1.35・休日深夜 1.6・時間内 1・深夜手当（所定内の22時以降）1.25
 *  月60時間を超えた時間外（2026-10-28 回答で対応を依頼。率は法定の 1.5・深夜 1.75 を仮に使う＝確認中）
 *
 * 特訓（日曜特訓・突破ゼミ・お盆特訓・年末年始特訓など。2026-10-28 給与担当の回答）：
 *  - 時間外の申請・報告で本人が種類を選ぶ。
 *  - 特訓の時間は手当で払うので、時間外勤務手当・5等級の35時間・過剰授業手当との比較には入れない。
 *  - 月75時間の上限には入れる。人件費の集計のため、種類ごとの時間を出す。
 */

import type { DedicatedSchedule } from './dedicated-attendance';

export const LEGAL_DAILY_MINUTES = 8 * 60;
/** 23:00 完全退社。これより後の予定は入れられない。 */
export const ABSOLUTE_END = '23:00';
/** 1か月の時間外の上限（健康管理）。 */
export const MONTHLY_OVERTIME_LIMIT_MINUTES = 75 * 60;
/** 5等級は月35時間を超えた分から時間外勤務手当（みなし残業）。時短勤務の人は28時間。 */
export const GRADE5_THRESHOLD_MINUTES = 35 * 60;
export const GRADE5_SHORT_TIME_THRESHOLD_MINUTES = 28 * 60;
export const grade5ThresholdMinutes = (shortTime: boolean) => shortTime ? GRADE5_SHORT_TIME_THRESHOLD_MINUTES : GRADE5_THRESHOLD_MINUTES;

/** 月60時間を超えた時間外（公休日の分は数えない）。 */
export const OVER60_THRESHOLD_MINUTES = 60 * 60;

/** 時間外勤務手当の割増率。 */
export const OVERTIME_MULTIPLIERS = {
  normal: 1.25,
  night: 1.5,
  holiday: 1.35,
  holiday_night: 1.6,
  over60: 1.5,
  over60_night: 1.75,
  within: 1,
} as const;

export type SpecialKind = 'sunday' | 'toppa' | 'obon' | 'new_year' | 'other';
export const SPECIAL_KINDS: SpecialKind[] = ['sunday', 'toppa', 'obon', 'new_year', 'other'];
export const SPECIAL_KIND_LABELS: Record<SpecialKind, string> = {
  sunday: '日曜特訓',
  toppa: '突破ゼミ',
  obon: 'お盆特訓',
  new_year: '年末年始特訓',
  other: 'その他の特訓',
};
export const normalizeSpecialKind = (value: unknown): SpecialKind | null =>
  SPECIAL_KINDS.includes(value as SpecialKind) ? value as SpecialKind : null;
/** 所定の勤務のうち22時以降にかかった分（深夜手当）。基本給に含まれる1倍を除いた0.25倍を手当にする。 */
export const NIGHT_PREMIUM_MULTIPLIER = 0.25;
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
  /** 所定を超えて8時間までの分（時間内・1倍）。 */
  within_minutes: number;
  /** 時間外ではない勤務のうち22時以降の分（深夜手当）。 */
  night_regular_minutes: number;
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
  /** 会社の休日（祝日・夏季休暇など）。勤務日でも公休日として数える。 */
  holiday?: boolean;
  /** 半日有休・半日振替・時間振替で埋める時間（分）。所定に足りない分を埋め、所定の外の勤務を時間内として数える。 */
  creditMinutes?: number;
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
  const dayOff = input.dayOff ?? (input.holiday === true || !isScheduledWorkDay(input.date, input.schedule));
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
  let within = 0;
  let nightRegular = 0;
  if (dayOff) {
    add('day_off', start, end);
    overtime = worked;
    night = Math.min(worked, nightMinutes(start, end));
  } else {
    const scheduleStart = toMinutes(input.schedule.start_time);
    let scheduleEnd = toMinutes(input.schedule.end_time);
    if (scheduleEnd <= scheduleStart) scheduleEnd += 1440;
    const scheduledWork = scheduleEnd - scheduleStart - input.schedule.break_minutes;
    const gap = Math.max(0, LEGAL_DAILY_MINUTES - scheduledWork);
    const extendAfter = input.schedule.extend_side === 'after';
    const windowStart = extendAfter ? scheduleStart : scheduleStart - gap;
    const windowEnd = extendAfter ? scheduleEnd + gap : scheduleEnd;
    add('before', start, Math.min(end, windowStart));
    add('after', Math.max(start, windowEnd), end);
    const outside = spans.reduce((sum, item) => sum + item.minutes, 0);
    overtime = Math.min(outside, Math.max(0, worked - LEGAL_DAILY_MINUTES));
    offset = outside - overtime;
    const after = spans.find(item => item.kind === 'after');
    // 深夜は終業後の時間外のうち22時以降。相殺で時間外が短くなったときは、その分だけ減らす。
    night = Math.min(overtime, after ? nightMinutes(Math.max(start, windowEnd), end) : 0);
    // 時間内：所定の外で働いた分のうち、時間外にならず、実労働が所定を超えた分（8時間まで）。
    const outsidePrescribed = Math.max(0, Math.min(end, scheduleStart) - start) + Math.max(0, end - Math.max(start, scheduleEnd));
    // 有休・振替の時間は所定を埋めるのに使うが、時間外（実労働8時間超）には数えない。
    const credited = Math.max(0, Math.round(input.creditMinutes || 0));
    within = Math.max(0, Math.min(outsidePrescribed - overtime, Math.min(worked + credited, LEGAL_DAILY_MINUTES) - scheduledWork));
    nightRegular = Math.max(0, nightMinutes(start, end) - night);
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
    within_minutes: within,
    night_regular_minutes: nightRegular,
    offset_minutes: offset,
    warnings,
  };
}

export type PlanInput = { date: string; start: string; end: string; break_minutes?: number; day_off?: boolean; reason?: string; special_kind?: SpecialKind | null };
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
export type PlanLike = { date: string; minutes: number; night_minutes?: number; status: PlanStatus; special_kind?: SpecialKind | null };
export type ReportLike = { date: string; status: 'pending' | 'approved' | 'rejected'; actual_minutes?: number; special_kind?: SpecialKind | null };

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
  /** 時間内（所定を超えて8時間まで）。時間外ではないので予定・報告の承認とは関係なく打刻から数える。 */
  within_minutes: number;
  /** 時間外ではない勤務のうち22時以降（深夜手当）。 */
  night_regular_minutes: number;
  /** ほかの日へ時間振替・半日振替で移した分（この日の時間内・時間外から差し引く）。 */
  transferred_out_minutes: number;
  /** 移した分のうち時間外だった分（勤務日）。振り替えても割増分（0.25）は支給する。 */
  transfer_premium_minutes: number;
  /** 支給の対象のうち特訓の分（手当で払うので時間外勤務手当には入れない）。 */
  special_minutes: number;
  /** 特訓の分のうち22時以降（深夜ではない時間から先に当てる）。 */
  special_night_minutes: number;
  special_by_kind: Partial<Record<SpecialKind, number>>;
  state: DayState;
};

/** 特訓の分が支給の対象を超えないようにそろえる（振替で支給の対象が減ったとき）。 */
function clampSpecial(day: DayReconciliation): DayReconciliation {
  let room = day.payable_minutes;
  const byKind: Partial<Record<SpecialKind, number>> = {};
  SPECIAL_KINDS.forEach(kind => {
    const take = Math.min(room, day.special_by_kind[kind] || 0);
    if (take > 0) byKind[kind] = take;
    room -= take;
  });
  const special = day.payable_minutes - room;
  return {
    ...day,
    special_minutes: special,
    special_night_minutes: Math.max(0, special - (day.payable_minutes - day.payable_night_minutes)),
    special_by_kind: byKind,
  };
}

/** 時間振替・半日振替で、この日の時間をほかの日へ移す。時間内から先に使い、足りなければ時間外（深夜は最後）から使う。 */
export function applyTransferOut(day: DayReconciliation, minutes: number, dayOff: boolean): DayReconciliation {
  const want = Math.max(0, Math.round(minutes));
  const fromWithin = Math.min(want, day.within_minutes);
  const fromOvertime = Math.min(want - fromWithin, day.payable_minutes);
  const payable = day.payable_minutes - fromOvertime;
  return clampSpecial({
    ...day,
    within_minutes: day.within_minutes - fromWithin,
    payable_minutes: payable,
    payable_night_minutes: Math.min(day.payable_night_minutes, payable),
    transferred_out_minutes: day.transferred_out_minutes + fromWithin + fromOvertime,
    transfer_premium_minutes: day.transfer_premium_minutes + (dayOff ? 0 : fromOvertime),
  });
}

/** その日に移せる時間（時間内＋支給対象の時間外）。 */
export const transferableMinutes = (day: DayReconciliation) => day.within_minutes + day.payable_minutes;

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
  // 特訓：予定の範囲で支給する分は特訓の予定から先に当て、予定を超えて報告した分は報告で選んだ種類にする。
  const fromPlans = Math.min(actualMinutes, planned);
  const byKind: Partial<Record<SpecialKind, number>> = {};
  let planRoom = fromPlans;
  dayPlans.filter(plan => plan.status === 'approved' && plan.special_kind).forEach(plan => {
    const take = Math.min(planRoom, plan.minutes);
    if (take > 0) byKind[plan.special_kind!] = (byKind[plan.special_kind!] || 0) + take;
    planRoom -= take;
  });
  if (state === 'reported' && report?.special_kind && payable > fromPlans) {
    byKind[report.special_kind] = (byKind[report.special_kind] || 0) + payable - fromPlans;
  }
  return clampSpecial({
    date,
    actual_minutes: actualMinutes,
    night_minutes: night,
    planned_minutes: planned,
    pending_plan_minutes: pending,
    payable_minutes: payable,
    payable_night_minutes: payableNight,
    unapproved_minutes: Math.max(0, actualMinutes - payable),
    within_minutes: actual?.within_minutes || 0,
    night_regular_minutes: actual?.night_regular_minutes || 0,
    transferred_out_minutes: 0,
    transfer_premium_minutes: 0,
    special_minutes: 0,
    special_night_minutes: 0,
    special_by_kind: byKind,
    state,
  });
}

/**
 * この月の時間外の見込み（特訓も含む）。日ごとに、打刻の時間外と、承認済み・承認待ちの予定の多いほうを足し、
 * これから申請する分を加える。月75時間を超えそうなときに、申請の前に知らせるために使う。
 */
export const projectedMonthOvertime = (days: DayReconciliation[], extraMinutes = 0) =>
  days.reduce((total, day) => total + Math.max(day.actual_minutes, day.planned_minutes + day.pending_plan_minutes), 0) + Math.max(0, extraMinutes);

export type MonthSummary = {
  actual_minutes: number;
  planned_minutes: number;
  /** 支給の対象になる時間外（特訓も含む）。 */
  payable_minutes: number;
  /** そのうち特訓の分（手当で払う）。 */
  special_minutes: number;
  special_by_kind: Partial<Record<SpecialKind, number>>;
  /** 時間外勤務手当の対象（支給の対象から特訓を除いた分）。 */
  overtime_minutes: number;
  /** 時間外勤務手当の対象のうち、月60時間を超えた分（公休日を除く）と、その22時以降。 */
  over60_minutes: number;
  over60_night_minutes: number;
  /** 時間外勤務手当の対象のうち22時以降（特訓を除く）。 */
  payable_night_minutes: number;
  /** 時間外勤務手当の対象のうち公休日の分（特訓を除く）。 */
  payable_day_off_minutes: number;
  /** 公休日の分のうち22時以降（休日深夜）。 */
  payable_day_off_night_minutes: number;
  within_minutes: number;
  night_regular_minutes: number;
  /** 時間振替で移した時間外の割増分（0.25）の対象。 */
  transfer_premium_minutes: number;
  unapproved_minutes: number;
  /** 報告が必要・差し戻しの日（月の提出前に片づける）。 */
  open_days: string[];
  /** 承認待ちがある日。 */
  waiting_days: string[];
  over_monthly_limit: boolean;
  /**
   * 等級から見た時間外勤務手当の対象（試算、1.25倍に換算した分）。6等級以上は対象外、
   * 5等級は深夜・休日を1.25倍に換算した合計が35時間（時短は28時間）を超えた分。
   */
  grade_payable_minutes: number | null;
};

export function summarizeMonth(days: DayReconciliation[], actuals: Map<string, DayActual>, grade: number | null, options: { shortTime?: boolean } = {}): MonthSummary {
  const sum = (pick: (day: DayReconciliation) => number) => days.reduce((total, day) => total + pick(day), 0);
  const isDayOff = (day: DayReconciliation) => actuals.get(day.date)?.day_off === true;
  // 時間外勤務手当の対象は、支給の対象から特訓（手当で払う）を除いた分。
  const ownOvertime = (day: DayReconciliation) => day.payable_minutes - (day.special_minutes ?? 0);
  const ownNight = (day: DayReconciliation) => day.payable_night_minutes - (day.special_night_minutes ?? 0);
  const overtime = sum(ownOvertime);
  const dayOff = sum(day => isDayOff(day) ? ownOvertime(day) : 0);
  const dayOffNight = sum(day => isDayOff(day) ? ownNight(day) : 0);
  const night = sum(ownNight);
  // 月60時間を超えた分は日付の順に数え、その日の分のうち遅い時間（22時以降）から当てる。
  let running = 0;
  let over60 = 0;
  let over60Night = 0;
  [...days].sort((a, b) => a.date.localeCompare(b.date)).filter(day => !isDayOff(day)).forEach(day => {
    const minutes = ownOvertime(day);
    const beyond = Math.min(minutes, Math.max(0, running + minutes - OVER60_THRESHOLD_MINUTES));
    const beyondNight = Math.min(beyond, ownNight(day));
    over60 += beyond - beyondNight;
    over60Night += beyondNight;
    running += minutes;
  });
  const specialByKind: Partial<Record<SpecialKind, number>> = {};
  days.forEach(day => SPECIAL_KINDS.forEach(kind => {
    const minutes = day.special_by_kind?.[kind] || 0;
    if (minutes > 0) specialByKind[kind] = (specialByKind[kind] || 0) + minutes;
  }));
  const equivalent = overtimeEquivalentMinutes(splitOvertime({ payable: overtime, night, dayOff, dayOffNight, over60, over60Night }));
  const gradePayable = grade == null ? null
    : grade >= 6 ? 0
      : grade === 5 ? Math.max(0, Math.ceil(equivalent - grade5ThresholdMinutes(options.shortTime === true)))
        : overtime;
  return {
    actual_minutes: sum(day => day.actual_minutes),
    planned_minutes: sum(day => day.planned_minutes),
    payable_minutes: sum(day => day.payable_minutes),
    special_minutes: sum(day => day.special_minutes ?? 0),
    special_by_kind: specialByKind,
    overtime_minutes: overtime,
    over60_minutes: over60,
    over60_night_minutes: over60Night,
    payable_night_minutes: night,
    payable_day_off_minutes: dayOff,
    payable_day_off_night_minutes: dayOffNight,
    within_minutes: sum(day => day.within_minutes),
    night_regular_minutes: sum(day => day.night_regular_minutes),
    transfer_premium_minutes: sum(day => day.transfer_premium_minutes ?? 0),
    unapproved_minutes: sum(day => day.unapproved_minutes),
    open_days: days.filter(day => day.state === 'needs_report' || day.state === 'report_rejected').map(day => day.date),
    waiting_days: days.filter(day => day.state === 'plan_pending' || day.state === 'report_pending').map(day => day.date),
    over_monthly_limit: sum(day => day.actual_minutes) > MONTHLY_OVERTIME_LIMIT_MINUTES,
    grade_payable_minutes: gradePayable,
  };
}

type OvertimeSplit = { normal: number; night: number; holiday: number; holiday_night: number; over60: number; over60_night: number };
const splitOvertime = (input: { payable: number; night: number; dayOff: number; dayOffNight: number; over60: number; over60Night: number }): OvertimeSplit => ({
  normal: Math.max(0, input.payable - input.dayOff - (input.night - input.dayOffNight) - input.over60),
  night: Math.max(0, input.night - input.dayOffNight - input.over60Night),
  holiday: Math.max(0, input.dayOff - input.dayOffNight),
  holiday_night: input.dayOffNight,
  over60: input.over60,
  over60_night: input.over60Night,
});
/** 深夜・休日の時間外を、普通の時間外（1.25倍）に換算した分。5等級の35時間の判定に使う。 */
const overtimeEquivalentMinutes = (split: OvertimeSplit) =>
  (Object.keys(split) as Array<keyof OvertimeSplit>).reduce((total, key) => total + split[key] * OVERTIME_MULTIPLIERS[key] / OVERTIME_MULTIPLIERS.normal, 0);

export type OvertimePayKey = keyof typeof OVERTIME_MULTIPLIERS | 'night_premium' | 'transfer_premium';
export const OVERTIME_PAY_LABELS: Record<OvertimePayKey, string> = {
  normal: '普通残業',
  night: '深夜残業',
  holiday: '休日残業',
  holiday_night: '休日深夜残業',
  over60: '60時間超残業',
  over60_night: '60時間超深夜残業',
  within: '時間内',
  night_premium: '深夜手当',
  transfer_premium: '振替の割増分',
};
export type OvertimePayLine = { key: OvertimePayKey; minutes: number; multiplier: number; amount: number };
export type OvertimePay = {
  lines: OvertimePayLine[];
  /** 1.25倍に換算した時間外（5等級の判定用）。 */
  equivalent_minutes: number;
  /** 5等級のみなしの時間（それ以外は0）。 */
  threshold_minutes: number;
  /** みなしを差し引く前の時間外勤務手当（普通・深夜・休日・休日深夜）。 */
  overtime_amount: number;
  /** 支給する時間外勤務手当（5等級はみなしを超えた分、6等級以上は0）。 */
  overtime_payable_amount: number;
  /** 時間内・深夜手当を足した、この月の支給額（試算）。 */
  total_amount: number;
  rate_missing: boolean;
  grade_missing: boolean;
};

/**
 * 月の時間外勤務手当（試算）。単価は本人の時間外単価（円/時）。円未満は項目ごとに切り上げ。特訓の分は入れない（手当で払う）。
 *  - 4等級以下：時間外をすべて支給
 *  - 5等級：1.25倍に換算した時間外が35時間（時短28時間）を超えた分だけ支給
 *  - 6等級以上：時間外・時間内は支給しない（深夜手当だけ）
 */
export function computeOvertimePay(summary: MonthSummary, input: { grade: number | null; unitRate: number | null | undefined; shortTime?: boolean }): OvertimePay {
  const rate = Math.max(0, Number(input.unitRate) || 0);
  const split = splitOvertime({
    payable: summary.overtime_minutes ?? summary.payable_minutes,
    night: summary.payable_night_minutes,
    dayOff: summary.payable_day_off_minutes,
    dayOffNight: summary.payable_day_off_night_minutes ?? 0,
    over60: summary.over60_minutes ?? 0,
    over60Night: summary.over60_night_minutes ?? 0,
  });
  const management = input.grade != null && input.grade >= 6;
  const yen = (minutes: number, multiplier: number) => Math.ceil((minutes * rate * multiplier) / 60);
  const lines: OvertimePayLine[] = [
    ...(Object.keys(split) as Array<keyof OvertimeSplit>).map(key => ({ key, minutes: split[key], multiplier: OVERTIME_MULTIPLIERS[key], amount: yen(split[key], OVERTIME_MULTIPLIERS[key]) })),
    { key: 'within' as const, minutes: management ? 0 : summary.within_minutes ?? 0, multiplier: OVERTIME_MULTIPLIERS.within, amount: management ? 0 : yen(summary.within_minutes ?? 0, OVERTIME_MULTIPLIERS.within) },
    { key: 'night_premium' as const, minutes: summary.night_regular_minutes ?? 0, multiplier: NIGHT_PREMIUM_MULTIPLIER, amount: yen(summary.night_regular_minutes ?? 0, NIGHT_PREMIUM_MULTIPLIER) },
    // 時間外をほかの日へ振り替えたときも、割増分（1.25 − 1）は残る。
    { key: 'transfer_premium' as const, minutes: management ? 0 : summary.transfer_premium_minutes ?? 0, multiplier: OVERTIME_MULTIPLIERS.normal - 1, amount: management ? 0 : yen(summary.transfer_premium_minutes ?? 0, OVERTIME_MULTIPLIERS.normal - 1) },
  ];
  const equivalent = overtimeEquivalentMinutes(split);
  const overtimeAmount = lines.filter(line => line.key in split).reduce((total, line) => total + line.amount, 0);
  const threshold = input.grade === 5 ? grade5ThresholdMinutes(input.shortTime === true) : 0;
  const overtimePayable = management ? 0
    : input.grade === 5 ? (equivalent > threshold ? Math.ceil(((equivalent - threshold) * rate * OVERTIME_MULTIPLIERS.normal) / 60) : 0)
      : overtimeAmount;
  const extras = lines.filter(line => line.key === 'within' || line.key === 'night_premium' || line.key === 'transfer_premium').reduce((total, line) => total + line.amount, 0);
  return {
    lines,
    equivalent_minutes: Math.round(equivalent * 100) / 100,
    threshold_minutes: threshold,
    overtime_amount: overtimeAmount,
    overtime_payable_amount: overtimePayable,
    total_amount: overtimePayable + extras,
    rate_missing: rate <= 0,
    grade_missing: input.grade == null,
  };
}

/** その月の n 番目の営業日（土日と会社の休日を除く）。月の時間外報告書の提出期限（2営業日）に使う。 */
export function nthBusinessDay(month: string, n: number, holidays: ReadonlySet<string> = new Set()) {
  let count = 0;
  for (const date of monthDates(month)) {
    const weekday = weekdayOf(date);
    if (weekday === 0 || weekday === 6 || holidays.has(date)) continue;
    count += 1;
    if (count >= n) return date;
  }
  return monthDates(month).slice(-1)[0];
}
/** 月の時間外報告書（D08）の提出期限は、翌月の2営業日目。 */
export const MONTHLY_REPORT_DEADLINE_BUSINESS_DAYS = 2;

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
