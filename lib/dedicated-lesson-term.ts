import type { DedicatedDivision } from './dedicated-overtime';
import { isInSeason, type DedicatedSeason } from './dedicated-season';

/**
 * 担当加算給の授業分数（4等級以下の授業分数報告書）。2026-10-28 給与担当の回答による。
 *  - 上半期は3〜7月、下半期は9月〜翌2月。どちらも講習期間は除く。
 *  - 年間授業カレンダーの36週の授業（相対評価テスト・オリエンテーション・ポイント確認テストを含む）は数える。
 *  - 数えない授業：時間外申請をした時間帯の授業（公休日の授業を含む）・調整休講日の補講・
 *    通常授業日以外の定期考査対策・突破ゼミ・兵庫統一模試。
 *    振替出勤で時間外申請をしていない授業は数える。
 *  - 複数校で授業をしたときは教室ごとの分数も出す。金額はアプリでは出さない（合計分数だけ）。
 *  - 5等級以上は授業分数報告書がないので、入力欄を出さない。
 */

export type LessonExclusionReason = 'overtime' | 'makeup' | 'exam_prep' | 'toppa' | 'hyogo_mock';
export const LESSON_EXCLUSION_REASONS: LessonExclusionReason[] = ['overtime', 'makeup', 'exam_prep', 'toppa', 'hyogo_mock'];
export const LESSON_EXCLUSION_LABELS: Record<LessonExclusionReason, string> = {
  overtime: '時間外申請をした時間帯の授業（公休日の授業を含む）',
  makeup: '調整休講日の補講',
  exam_prep: '通常授業日以外の定期考査対策',
  toppa: '突破ゼミ',
  hyogo_mock: '兵庫統一模試',
};
export const LESSON_EXCLUSION_SHORT: Record<LessonExclusionReason, string> = {
  overtime: '時間外申請分',
  makeup: '調整休講日の補講',
  exam_prep: '定期考査対策（授業日以外）',
  toppa: '突破ゼミ',
  hyogo_mock: '兵庫統一模試',
};

export type LessonExclusion = { reason: LessonExclusionReason; minutes: number };
export const MAX_LESSON_EXCLUSIONS = LESSON_EXCLUSION_REASONS.length;

/** 数えない授業の一覧を整える。同じ理由はまとめ、合計は授業分数を超えない（超えたら null）。 */
export function normalizeLessonExclusions(value: unknown, totalMinutes: number): LessonExclusion[] | null {
  if (value == null) return [];
  if (!Array.isArray(value) || value.length > 20) return null;
  const sums = new Map<LessonExclusionReason, number>();
  for (const item of value) {
    const reason = String((item as any)?.reason || '') as LessonExclusionReason;
    const minutes = Math.floor(Number((item as any)?.minutes) || 0);
    if (!LESSON_EXCLUSION_REASONS.includes(reason) || minutes < 0 || minutes > 720) return null;
    if (minutes) sums.set(reason, (sums.get(reason) || 0) + minutes);
  }
  const list = LESSON_EXCLUSION_REASONS.filter(reason => sums.has(reason)).map(reason => ({ reason, minutes: sums.get(reason)! }));
  return list.reduce((sum, item) => sum + item.minutes, 0) > totalMinutes ? null : list;
}

export const countedLessonMinutes = (lesson: { lesson_minutes: number; excluded?: LessonExclusion[] }) =>
  Math.max(0, lesson.lesson_minutes - (lesson.excluded || []).reduce((sum, item) => sum + item.minutes, 0));

/** 5等級以上は授業分数を入れない。等級が未設定の人は入れる（4等級以下として扱う）。 */
export const needsLessonMinutes = (grade: number | null) => grade == null || grade <= 4;

export type LessonTerm = { id: string; label: string; start: string; end: string };

const lastDay = (month: string) => {
  const [year, mon] = month.split('-').map(Number);
  return `${month}-${String(new Date(Date.UTC(year, mon, 0)).getUTCDate()).padStart(2, '0')}`;
};

/** "2026-H1"（2026年3〜7月）・"2026-H2"（2026年9月〜2027年2月）。 */
export function lessonTerm(id: unknown): LessonTerm | null {
  const match = /^(\d{4})-H([12])$/.exec(String(id || ''));
  if (!match) return null;
  const year = Number(match[1]);
  if (year < 2020 || year > 2100) return null;
  return match[2] === '1'
    ? { id: `${year}-H1`, label: `${year}年度 上半期（3〜7月）`, start: `${year}-03-01`, end: `${year}-07-31` }
    : { id: `${year}-H2`, label: `${year}年度 下半期（9月〜翌2月）`, start: `${year}-09-01`, end: lastDay(`${year + 1}-02`) };
}

/** その日を含む半期（8月は直前の上半期）。 */
export function lessonTermOf(day: string): LessonTerm {
  const year = Number(day.slice(0, 4));
  const month = Number(day.slice(5, 7));
  if (month <= 2) return lessonTerm(`${year - 1}-H2`)!;
  if (month <= 8) return lessonTerm(`${year}-H1`)!;
  return lessonTerm(`${year}-H2`)!;
}

export type TermLesson = { lesson_date: string; lesson_minutes: number; status: string; school_name?: string; excluded?: LessonExclusion[] };

export type LessonTermSummary = {
  /** 担当加算給に数える分数（承認済み）。 */
  counted_minutes: number;
  /** 承認待ちの、数える分数。 */
  pending_minutes: number;
  /** 承認済みの授業のうち数えない分数（理由ごと）。 */
  excluded_by_reason: Partial<Record<LessonExclusionReason, number>>;
  excluded_minutes: number;
  /** 講習期間に入っていて数えない分数。 */
  season_minutes: number;
  /** 教室ごとの数える分数（承認済み）。 */
  by_school: { school_name: string; minutes: number }[];
  days: number;
};

export function summarizeLessonTerm(input: {
  term: LessonTerm;
  lessons: TermLesson[];
  seasons: DedicatedSeason[];
  division: DedicatedDivision;
}): LessonTermSummary {
  const summary: LessonTermSummary = { counted_minutes: 0, pending_minutes: 0, excluded_by_reason: {}, excluded_minutes: 0, season_minutes: 0, by_school: [], days: 0 };
  const schools = new Map<string, number>();
  for (const lesson of input.lessons) {
    if (lesson.lesson_date < input.term.start || lesson.lesson_date > input.term.end) continue;
    if (lesson.status !== 'approved' && lesson.status !== 'pending') continue;
    const counted = countedLessonMinutes(lesson);
    if (lesson.status === 'pending') {
      if (!input.seasons.some(season => isInSeason(season, input.division, lesson.lesson_date))) summary.pending_minutes += counted;
      continue;
    }
    if (input.seasons.some(season => isInSeason(season, input.division, lesson.lesson_date))) {
      summary.season_minutes += lesson.lesson_minutes;
      continue;
    }
    summary.days += 1;
    summary.counted_minutes += counted;
    for (const item of lesson.excluded || []) {
      summary.excluded_by_reason[item.reason] = (summary.excluded_by_reason[item.reason] || 0) + item.minutes;
      summary.excluded_minutes += item.minutes;
    }
    const school = lesson.school_name || '（教室名なし）';
    schools.set(school, (schools.get(school) || 0) + counted);
  }
  summary.by_school = Array.from(schools, ([school_name, minutes]) => ({ school_name, minutes })).sort((a, b) => b.minutes - a.minutes);
  return summary;
}

/** 半期にかかる講習期間（その事業部の期間）。日別の一覧で「講習期間」と示すのに使う。 */
export function termSeasonDates(term: LessonTerm, seasons: DedicatedSeason[], division: DedicatedDivision) {
  return seasons
    .map(season => ({ name: season.name, ...season.periods[division] }))
    .filter(period => period.start && period.end && period.start <= term.end && period.end >= term.start)
    .map(period => ({ name: period.name, start: period.start, end: period.end }));
}
