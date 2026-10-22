/**
 * 専任の講習期間（夏期・冬期など）の過剰授業手当（純粋関数）。
 * 各自が講習の授業コマを登録すると、授業時間を自動で合計し、基準授業時間を超えた分を手当として試算する。
 *
 *  過剰授業時間 ＝ 期間中の総授業時間 － 基準授業時間（－ 4等級以下は 時間外合計 ÷ 4 × 3）
 *  基準授業時間 ＝ 1日あたりの分 × 日曜とお盆を除いた講習日数（本部所属などは別に決めた分）
 *  手当 ＝ 過剰授業時間 × 等級ごとの時給
 * 5等級は時間外勤務手当と比べて多いほうだけを支給するので、ここでは両方を出し、支給の判断は給与担当が行う。
 */

import type { DedicatedDivision } from './dedicated-overtime';

export type BaselineType = 'group' | 'academy' | 'hq_group' | 'hq_academy';
export const BASELINE_TYPE_LABELS: Record<BaselineType, string> = {
  group: '集団',
  academy: '創学アカデミー',
  hq_group: '本部所属の集団',
  hq_academy: '本部所属のアカデミー',
};
export const normalizeBaselineType = (value: unknown): BaselineType =>
  value === 'academy' || value === 'hq_group' || value === 'hq_academy' ? value : 'group';

export type SeasonCourse = { id: string; section: string; grade: string; name: string; minutes: number };
export type SeasonRates = { grade5plus: number; grade3to4: number; grade1to2: number };

export type DedicatedSeason = {
  id: string;
  name: string;
  /** 事業部ごとの対象期間。 */
  periods: Record<DedicatedDivision, { start: string; end: string }>;
  /** お盆など、授業日に数えない期間。 */
  excluded: { start: string; end: string };
  per_day_minutes: number;
  /** 基準授業時間（分）。空のときは 1日あたりの分 × 講習日数。 */
  baselines: Partial<Record<BaselineType, number>>;
  courses: SeasonCourse[];
  rates: SeasonRates;
  /** 4等級以下は時間外4時間につき180分を過剰授業に含めて差し引く。 */
  deduct_overtime_for_grade4_or_below: boolean;
  /** 授業登録の締め切り（この日まで登録・修正できる）。 */
  entry_deadline?: string;
};

const DATE = /^\d{4}-\d{2}-\d{2}$/;
const clean = (value: unknown, max = 80) => String(value ?? '').normalize('NFKC').trim().slice(0, max);
const date = (value: unknown, fallback = '') => DATE.test(String(value || '')) ? String(value) : fallback;
const minutes = (value: unknown, max = 100000) => {
  const number = Math.floor(Number(value));
  return Number.isFinite(number) && number >= 0 ? Math.min(max, number) : 0;
};

/** 2026年度 夏期講習勤怠規則【専任】の一覧表（勤怠システムに登録できる夏期講習授業）。 */
export const SUMMER_2026_COURSES: SeasonCourse[] = [
  ['集団', '年長', 'ジュニアホイッスル', 45],
  ['集団', '小1〜小3', '玉井式国語的算数', 45],
  ['集団', '小1〜小3', '魔法の国語', 45],
  ['集団', '小1〜小3', '算国演習', 45],
  ['集団', '小4（OLのみ）', '玉井式国語的算数', 45],
  ['集団', '小4〜小6', '国語（英語）', 45],
  ['集団', '小4〜小6', '算数', 45],
  ['集団', '中1・中2', '国語', 55],
  ['集団', '中1・中2', '数学', 55],
  ['集団', '中1・中2', '英語', 55],
  ['集団', '中1・中2', '国語（後期の集会実施日）', 60],
  ['集団', '中1・中2', '数学（後期の集会実施日）', 60],
  ['集団', '中1・中2', '英語（後期の集会実施日）', 60],
  ['集団', '中1・中2', '理科', 65],
  ['集団', '中1・中2', '社会', 65],
  ['集団', '中3', '数学', 70],
  ['集団', '中3', '英語', 70],
  ['集団', '中3', '国語', 50],
  ['集団', '中3', '理科', 50],
  ['集団', '中3', '社会', 50],
  ['集団', '小1〜小6', 'Sounds Fun!（OL）', 50],
  ['集団', '小4〜小6', '中学英語につながる！夏の必勝英語講座', 50],
  ['集団', '小3〜小6', 'AI算数ゼミ、KIWAMI AAA⁺（自宅受験型）', 50],
  ['集団', '小4〜中2', '偉人のひらめきラボ', 90],
  ['集団', '中1〜中3', 'オリエンテーション（主担当者）', 40],
  ['私学', '小1〜小2（岡本のみ）', '算数・国語', 80],
  ['私学', '小1〜小2（岡本以外）', '算数', 60],
  ['私学', '小1〜小2（岡本以外）', '国語・理科', 60],
  ['私学', '小3', '算数・国語・理科', 60],
  ['私学', '小4・小5', '算数', 80],
  ['私学', '小4・小5', '国語', 80],
  ['私学', '小4・小5', '理科（最高レベル含む）', 80],
  ['私学', '小5', '社会', 80],
  ['私学', '小6', '算数', 110],
  ['私学', '小6', '国語', 110],
  ['私学', '小6', '理科', 110],
  ['私学', '小6', '社会', 90],
  ['私学三田', '小3', '算数', 50],
  ['私学三田', '小3', '国語', 50],
  ['私学三田', '小4', '算数', 50],
  ['私学三田', '小4', '国語', 50],
  ['私学三田', '小5・小6', '算数', 80],
  ['私学三田', '小5・小6', '国語', 80],
  ['私学三田', '小5・小6', '理科', 80],
  ['私学三田', '小6', '社会', 50],
  ['私学三田', '中1〜中3', '数学', 80],
  ['私学三田', '中1〜中3', '英語', 80],
].map(([section, grade, name, value], index) => ({ id: `c${String(index + 1).padStart(2, '0')}`, section: String(section), grade: String(grade), name: String(name), minutes: Number(value) }));

export const SUMMER_2026_TEMPLATE: DedicatedSeason = {
  id: 'summer_2026',
  name: '2026年度 夏期講習',
  periods: {
    group_online: { start: '2026-07-21', end: '2026-08-31' },
    individual: { start: '2026-07-21', end: '2026-08-31' },
    junior_exam: { start: '2026-07-20', end: '2026-08-31' },
  },
  excluded: { start: '2026-08-08', end: '2026-08-16' },
  per_day_minutes: 203,
  baselines: { group: 5887, academy: 6090, hq_group: 3271, hq_academy: 3383 },
  courses: SUMMER_2026_COURSES,
  rates: { grade5plus: 1500, grade3to4: 400, grade1to2: 250 },
  deduct_overtime_for_grade4_or_below: true,
  entry_deadline: '2026-09-01',
};

export function normalizeSeason(raw: any, id?: string): DedicatedSeason {
  const periods = (raw?.periods || {}) as Record<string, any>;
  const period = (key: DedicatedDivision) => ({ start: date(periods[key]?.start), end: date(periods[key]?.end) });
  const baselines: Partial<Record<BaselineType, number>> = {};
  (['group', 'academy', 'hq_group', 'hq_academy'] as BaselineType[]).forEach(key => {
    const value = raw?.baselines?.[key];
    if (value !== '' && value != null && Number.isFinite(Number(value))) baselines[key] = minutes(value);
  });
  const courses: SeasonCourse[] = (Array.isArray(raw?.courses) ? raw.courses : []).slice(0, 300).map((course: any, index: number) => ({
    id: clean(course?.id, 40).replace(/[^\w-]/g, '') || `c${index + 1}`,
    section: clean(course?.section, 30),
    grade: clean(course?.grade, 40),
    name: clean(course?.name, 80),
    minutes: minutes(course?.minutes, 600),
  })).filter((course: SeasonCourse) => course.name && course.minutes > 0);
  return {
    id: clean(id || raw?.id, 60).replace(/[^\w-]/g, '') || 'season',
    name: clean(raw?.name, 60) || '講習期間',
    periods: { group_online: period('group_online'), individual: period('individual'), junior_exam: period('junior_exam') },
    excluded: { start: date(raw?.excluded?.start), end: date(raw?.excluded?.end) },
    per_day_minutes: minutes(raw?.per_day_minutes, 1440) || 203,
    baselines,
    courses,
    rates: {
      grade5plus: minutes(raw?.rates?.grade5plus, 100000),
      grade3to4: minutes(raw?.rates?.grade3to4, 100000),
      grade1to2: minutes(raw?.rates?.grade1to2, 100000),
    },
    deduct_overtime_for_grade4_or_below: raw?.deduct_overtime_for_grade4_or_below !== false,
    entry_deadline: date(raw?.entry_deadline) || undefined,
  };
}

/** 講習の期間全体（どれかの事業部の期間にかかる最初と最後の日）。 */
export function seasonRange(season: DedicatedSeason) {
  const periods = Object.values(season.periods).filter(item => item.start && item.end);
  if (!periods.length) return null;
  return {
    start: periods.map(item => item.start).sort()[0],
    end: periods.map(item => item.end).sort().reverse()[0],
  };
}

const eachDate = (start: string, end: string) => {
  const dates: string[] = [];
  if (!start || !end || end < start) return dates;
  const cursor = new Date(`${start}T12:00:00Z`);
  const last = new Date(`${end}T12:00:00Z`);
  while (cursor <= last && dates.length < 400) {
    dates.push(cursor.toISOString().slice(0, 10));
    cursor.setUTCDate(cursor.getUTCDate() + 1);
  }
  return dates;
};

/** 講習の授業日（日曜とお盆などの期間を除く）の数。 */
export function seasonLessonDays(season: DedicatedSeason, division: DedicatedDivision) {
  const period = season.periods[division];
  return eachDate(period.start, period.end).filter(day => {
    if (new Date(`${day}T12:00:00Z`).getUTCDay() === 0) return false;
    return !(season.excluded.start && season.excluded.end && day >= season.excluded.start && day <= season.excluded.end);
  }).length;
}

export const isInSeason = (season: DedicatedSeason, division: DedicatedDivision, day: string) => {
  const period = season.periods[division];
  return Boolean(period.start && period.end && day >= period.start && day <= period.end);
};

export function seasonBaselineMinutes(season: DedicatedSeason, division: DedicatedDivision, type: BaselineType) {
  const fixed = season.baselines[type];
  return fixed != null ? fixed : season.per_day_minutes * seasonLessonDays(season, division);
}

export const seasonRateFor = (season: DedicatedSeason, grade: number | null) =>
  grade == null ? 0 : grade >= 5 ? season.rates.grade5plus : grade >= 3 ? season.rates.grade3to4 : season.rates.grade1to2;

export type SeasonAllowance = {
  lesson_minutes: number;
  pending_minutes: number;
  baseline_minutes: number;
  overtime_deduction_minutes: number;
  excess_minutes: number;
  rate: number;
  /** 過剰授業手当（円、試算）。 */
  amount: number;
  /** 5等級は時間外勤務手当と比べて多いほうを支給する。 */
  compare_with_overtime: boolean;
  grade_missing: boolean;
};

export function computeSeasonAllowance(input: {
  season: DedicatedSeason;
  division: DedicatedDivision;
  baselineType: BaselineType;
  grade: number | null;
  approvedLessonMinutes: number;
  pendingLessonMinutes?: number;
  /** 講習期間中の時間外（支給対象）の合計（分）。 */
  overtimeMinutes: number;
}): SeasonAllowance {
  const baseline = seasonBaselineMinutes(input.season, input.division, input.baselineType);
  const deduct = input.season.deduct_overtime_for_grade4_or_below && input.grade != null && input.grade <= 4
    ? Math.floor((input.overtimeMinutes / 4) * 3)
    : 0;
  const excess = Math.max(0, input.approvedLessonMinutes - baseline - deduct);
  const rate = seasonRateFor(input.season, input.grade);
  return {
    lesson_minutes: input.approvedLessonMinutes,
    pending_minutes: input.pendingLessonMinutes || 0,
    baseline_minutes: baseline,
    overtime_deduction_minutes: deduct,
    excess_minutes: excess,
    rate,
    amount: Math.floor((excess * rate) / 60),
    compare_with_overtime: input.grade === 5,
    grade_missing: input.grade == null,
  };
}
