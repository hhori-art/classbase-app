/**
 * 中3の授業の割り当て（純粋関数）。配置表（OL理社講師配置）の決まり：
 *  - 中3は毎日、理科と社会を1時間ずつ受ける（1時限目と2時限目の同じ教科は同じ内容）。
 *  - 理科は期の途中で「物理・生物」と「化学・地学」の時限が入れ替わる（例：11/2、1/18）。
 *    生徒は登録した理科の講座（物理など）をその日の時限で受け、社会はもう一方の時限で受ける。
 *  - 社会（公民）は同じ時限に2教室（1限は公民③④、2限は公民①②）ある。同じ時限に社会を受ける生徒を
 *    生徒IDの順に半分ずつ、番号の小さい教室（1）と大きい教室（2）に割り振る。
 */

import { getCourseSubjectGroup } from './course-text';

export type Chu3Subject = '理科' | '社会';
export type Chu3Choice = { subject: Chu3Subject; course: string; period: 1 | 2 };
/** 曜日（月〜土）ごとの、登録した理科・社会。 */
export type Chu3Selections = Map<string, Chu3Choice[]>;

const WEEKDAYS = ['日', '月', '火', '水', '木', '金', '土'];
export const weekdayOf = (dateKey: string) => WEEKDAYS[new Date(`${dateKey}T12:00:00+09:00`).getUTCDay()] || '';

const nk = (value: unknown) => String(value ?? '').normalize('NFKC').replace(/[\s　]/g, '');
const CIRCLED = '①②③④⑤⑥⑦⑧⑨';

/** 講座名から枝番と【】を外した名前（公民③ → 公民、【通常】物理 → 物理）。 */
export function baseCourseName(value: unknown) {
  return String(value ?? '')
    .replace(/【[^】]*】/g, '')
    .replace(/[①-⑨]/g, '')
    .normalize('NFKC')
    .replace(/[\s　]/g, '')
    .replace(/[0-9]+$/g, '')
    .replace(/[ⅠⅡⅢⅣ]+$/g, '')
    .replace(/(I|II|III|IV)$/g, '');
}

/** 公民③ のような枝番（なければ null）。 */
export function courseBranchNumber(value: unknown) {
  const raw = String(value ?? '').replace(/【[^】]*】/g, '');
  const circled = raw.match(/[①-⑨]/);
  if (circled) return CIRCLED.indexOf(circled[0]) + 1;
  const digit = nk(raw).match(/(?:公民|歴史|地理)([1-9])/);
  return digit ? Number(digit[1]) : null;
}

/** 受講登録の選択（安定キー course_中3_理科_化学_月_2限、または講座ID …_中3_理科_化学_月_2時間目）から中3の選択を読む。 */
export function chu3SelectionsFromIds(selectedIds: Iterable<string>): Chu3Selections {
  const byDay: Chu3Selections = new Map();
  const seen = new Set<string>();
  for (const raw of selectedIds) {
    const text = nk(raw);
    const match = text.match(/中3_(理科|社会)_+(.+?)_([月火水木金土])_([12])(?:限|時間目)/);
    if (!match) continue;
    const subject = match[1] as Chu3Subject;
    // 古い講座IDは「公民_裁判所」のように単元が続くので、最初の区切りまでを講座名にする（「通常_」は外す）。
    const courseToken = match[2].split('_').filter(token => token && token !== '通常')[0] || '';
    const course = baseCourseName(courseToken.replace(/^通常/, ''));
    const day = match[3];
    const period = Number(match[4]) as 1 | 2;
    const key = `${day}|${subject}|${course}|${period}`;
    if (!course || seen.has(key)) continue;
    seen.add(key);
    byDay.set(day, [...(byDay.get(day) || []), { subject, course, period }]);
  }
  return byDay;
}

type ShiftLike = { id: string; target_date?: string; target_grade?: string; target_subject?: string; target_detail_subject?: string; subject?: string };

const isChu3 = (shift: ShiftLike) => nk(shift.target_grade).includes('3');
const subjectOf = (shift: ShiftLike) => getCourseSubjectGroup([shift.target_subject, shift.target_detail_subject, shift.subject].filter(Boolean).join(' '));

/** その日の中3の配置から、生徒が受ける理科の時限と、社会を受ける時限を決める。 */
export function chu3DayPlan(choices: Chu3Choice[], shifts: ShiftLike[], periodOf: (shift: ShiftLike) => number | null) {
  const science = choices.filter(choice => choice.subject === '理科');
  const social = choices.filter(choice => choice.subject === '社会');
  const sciencePlan = science.map(choice => {
    const candidates = shifts.filter(shift => isChu3(shift) && subjectOf(shift) === '理科' && baseCourseName(shift.target_detail_subject || shift.target_subject) === choice.course);
    const periods = Array.from(new Set(candidates.map(periodOf).filter((value): value is number => value === 1 || value === 2)));
    // 登録した講座がその日どちらか一方の時限にだけあれば、その時限で受ける（入れ替わりに追従）。
    const period = periods.length === 1 ? periods[0] : choice.period;
    return { choice, period: period as 1 | 2, found: candidates.length > 0 };
  });
  const sciencePeriods = new Set(sciencePlan.filter(plan => plan.found).map(plan => plan.period));
  const socialPlan = social.map(choice => {
    // 理科を1時間だけ受ける日は、社会はもう一方の時限（同じ内容）で受ける。
    const period = sciencePeriods.size === 1 ? (3 - Array.from(sciencePeriods)[0]) as 1 | 2 : choice.period;
    return { choice, period };
  });
  return { sciencePlan, socialPlan };
}

export type CivicsRosterEntry = { student_id: string; selections: Chu3Selections };

/**
 * その日に社会を受ける中3の生徒を、時限ごとに生徒IDの順に並べ、前半を教室1、後半を教室2に割り振る。
 * 戻り値は student_id → 1 | 2。
 */
export function computeCivicsRooms(dateKey: string, shifts: ShiftLike[], roster: CivicsRosterEntry[], periodOf: (shift: ShiftLike) => number | null) {
  const day = weekdayOf(dateKey);
  const dayShifts = shifts.filter(shift => !shift.target_date || shift.target_date === dateKey);
  const byPeriod = new Map<number, string[]>();
  roster.forEach(entry => {
    const choices = entry.selections.get(day) || [];
    if (!choices.some(choice => choice.subject === '社会')) return;
    const { socialPlan } = chu3DayPlan(choices, dayShifts, periodOf);
    Array.from(new Set(socialPlan.map(plan => plan.period))).forEach(period => {
      byPeriod.set(period, [...(byPeriod.get(period) || []), entry.student_id]);
    });
  });
  const rooms = new Map<string, 1 | 2>();
  byPeriod.forEach(ids => {
    const sorted = Array.from(new Set(ids)).sort();
    const half = Math.ceil(sorted.length / 2);
    sorted.forEach((id, index) => rooms.set(id, index < half ? 1 : 2));
  });
  return rooms;
}

/**
 * 中3の生徒の、その日に参加する配置を決め直す（通常授業だけ。対策講座は対象外）。
 * eligible は照合で選ばれた配置ID。登録した講座がその日の配置に見つからないときは、元の照合結果を残す。
 */
export function applyChu3Rules(input: {
  shifts: ShiftLike[];
  eligible: Set<string>;
  selections: Chu3Selections;
  periodOf: (shift: ShiftLike) => number | null;
  isTestPrep: (shift: ShiftLike) => boolean;
  /** 日付ごとの社会の教室（1か2）。分からなければ null（両方の教室を出す）。 */
  civicsRoomFor?: (dateKey: string) => 1 | 2 | null;
  /** 講師配置IDで直接登録された配置（そのまま残す）。 */
  directShiftIds?: Set<string>;
  /** 理科・社会の時限を決めるのに使う、その日のすべての時限の配置（shifts が1つの時限だけのとき）。 */
  planShifts?: ShiftLike[];
}) {
  const eligible = new Set(input.eligible);
  const group = (list: ShiftLike[]) => {
    const map = new Map<string, ShiftLike[]>();
    list.forEach(shift => {
      const date = String(shift.target_date || '');
      if (date) map.set(date, [...(map.get(date) || []), shift]);
    });
    return map;
  };
  const byDate = group(input.shifts);
  const planByDate = group(input.planShifts || input.shifts);
  byDate.forEach((dayShifts, date) => {
    const choices = input.selections.get(weekdayOf(date)) || [];
    if (!choices.length) return;
    const regular = dayShifts.filter(shift => isChu3(shift) && !input.isTestPrep(shift));
    const planRegular = (planByDate.get(date) || dayShifts).filter(shift => isChu3(shift) && !input.isTestPrep(shift));
    const { sciencePlan, socialPlan } = chu3DayPlan(choices, planRegular, input.periodOf);
    const keep = (shift: ShiftLike) => input.directShiftIds?.has(String(shift.id));
    const courseOf = (shift: ShiftLike) => baseCourseName(shift.target_detail_subject || shift.target_subject);

    // 受ける配置は、その日のすべての時限の配置から決める（1つの時限だけ渡されても、もう一方の時限を考えに入れる）。
    const assignedScience = new Set<string>();
    sciencePlan.filter(plan => plan.found).forEach(plan => {
      planRegular
        .filter(shift => subjectOf(shift) === '理科' && input.periodOf(shift) === plan.period && courseOf(shift) === plan.choice.course)
        .forEach(shift => assignedScience.add(String(shift.id)));
    });
    const room = input.civicsRoomFor ? input.civicsRoomFor(date) : null;
    const assignedSocial = new Set<string>();
    socialPlan.forEach(plan => {
      const candidates = planRegular.filter(shift => subjectOf(shift) === '社会' && input.periodOf(shift) === plan.period && courseOf(shift) === plan.choice.course);
      const branches = Array.from(new Set(candidates.map(shift => courseBranchNumber(shift.target_detail_subject)).filter((value): value is number => value != null))).sort((a, b) => a - b);
      const branch = room && branches.length >= 2 ? (room === 1 ? branches[0] : branches[branches.length - 1]) : null;
      candidates
        .filter(shift => branch == null || courseBranchNumber(shift.target_detail_subject) === branch)
        .forEach(shift => assignedSocial.add(String(shift.id)));
    });

    const apply = (subject: Chu3Subject, assigned: Set<string>) => {
      if (!assigned.size) return; // 登録した講座がその日の配置にないときは、元の照合のまま。
      regular.filter(shift => subjectOf(shift) === subject).forEach(shift => {
        const id = String(shift.id);
        if (assigned.has(id)) eligible.add(id);
        else if (!keep(shift)) eligible.delete(id);
      });
    };
    apply('理科', assignedScience);
    apply('社会', assignedSocial);
  });
  return eligible;
}

const slotNumber = (option: any) => Number(String(option?.resolved_slot || option?.slot || option?.time_slot || option?.period || '').normalize('NFKC').match(/[12]/)?.[0] || 0);

/**
 * 期のはじめ（最初の週）の配置から、中3の理科の講座ごとの時限を読む（配置表どおりの、その期の時限）。
 * 期の途中で入れ替わる週があっても、登録の画面はこの時限で表示する。
 */
export function chu3TermSciencePeriods(shifts: ShiftLike[], periodOf: (shift: ShiftLike) => number | null, isTestPrep: (shift: ShiftLike) => boolean) {
  const periods = new Map<string, 1 | 2>();
  [...shifts]
    .filter(shift => isChu3(shift) && subjectOf(shift) === '理科' && !isTestPrep(shift))
    .sort((a, b) => String(a.target_date || '').localeCompare(String(b.target_date || '')))
    .forEach(shift => {
      const course = baseCourseName(shift.target_detail_subject || shift.target_subject);
      const period = periodOf(shift);
      if (course && (period === 1 || period === 2) && !periods.has(course)) periods.set(course, period);
    });
  return periods;
}

/**
 * 受講登録の画面で、中3の理科を曜日×講座ごとに1つにし、その期の時限で表示する。
 * 時限は termPeriods（期のはじめの配置）を優先し、なければ期の中でいちばん授業日の多い時限。
 * 期の途中で時限が入れ替わっても、生徒は講座で選び、その日の時限はその日の配置で決まる（社会はもう一方の時限）。
 * まとめた・時限を直した候補の元のIDは alias_selection_ids に残し、前に選んだ登録がそのまま選択済みに見えるようにする。
 */
export function collapseChu3ScienceOptions(
  options: any[],
  today: string,
  identityIds: (option: any) => string[],
  termPeriods?: Map<string, Map<string, 1 | 2>>,
) {
  const isTarget = (option: any) => nk(option?.grade).includes('3') && getCourseSubjectGroup(option?.subject) === '理科' && option?.registration_type !== 'test_prep';
  const courseOf = (option: any) => baseCourseName(option.course_name || option.title);
  const termKey = (option: any) => `${Number(option.year || 0)}__${String(option.term || option.term_label || 'term')}`;
  const upcoming = (option: any) => (Array.isArray(option.matched_dates) ? option.matched_dates : []).map(String).filter((date: string) => date >= today);

  const slotVotes = new Map<string, Map<number, number>>();
  options.forEach(option => {
    if (!isTarget(option)) return;
    const key = `${termKey(option)}|${courseOf(option)}`;
    const votes = slotVotes.get(key) || new Map<number, number>();
    votes.set(slotNumber(option), (votes.get(slotNumber(option)) || 0) + Math.max(1, upcoming(option).length));
    slotVotes.set(key, votes);
  });
  const termSlot = (option: any) => {
    const fixed = termPeriods?.get(termKey(option))?.get(courseOf(option));
    if (fixed) return fixed;
    const votes = slotVotes.get(`${termKey(option)}|${courseOf(option)}`);
    return votes ? Array.from(votes.entries()).filter(([slot]) => slot).sort((a, b) => b[1] - a[1] || a[0] - b[0])[0]?.[0] || 0 : 0;
  };

  const groups = new Map<string, any[]>();
  options.forEach(option => {
    if (!isTarget(option)) return;
    const day = nk(option.resolved_day || option.day || option.day_of_week).replace('曜日', '');
    groups.set(`${termKey(option)}|${day}|${courseOf(option)}`, [...(groups.get(`${termKey(option)}|${day}|${courseOf(option)}`) || []), option]);
  });
  const drop = new Set<any>();
  const replace = new Map<any, any>();
  groups.forEach(list => {
    const preferred = termSlot(list[0]);
    if (!preferred) return;
    const kept = list.find(option => slotNumber(option) === preferred) || list[0];
    const removed = list.filter(option => option !== kept);
    removed.forEach(option => drop.add(option));
    const relabel = slotNumber(kept) !== preferred;
    if (!removed.length && !relabel) return;
    const aliasIds = [...removed.flatMap(identityIds), ...(relabel ? identityIds(kept) : [])];
    replace.set(kept, {
      ...kept,
      // 時限を直したときは、元の時限で作った安定キーを外す（表示の時限から作り直す。元のキーは alias に残す）。
      ...(relabel ? { resolved_slot: `${preferred}時間目`, resolved_slot_source: 'chu3_term_period', stable_course_key: undefined } : {}),
      alias_selection_ids: Array.from(new Set([...(kept.alias_selection_ids || []), ...aliasIds])),
      chu3_period_varies: true,
    });
  });
  return options
    .filter(option => !drop.has(option))
    .map(option => replace.get(option) || option);
}
