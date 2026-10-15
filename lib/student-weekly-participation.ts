export type ParticipationWeek = {
  key: string;
  start_date: string;
  end_date: string;
  label: string;
  is_current: boolean;
};

export type WeeklyParticipation = ParticipationWeek & {
  expected: boolean;
  attended: boolean;
  dates: string[];
  subjects: { subject: string; dates: string[] }[];
};

const DAY_MS = 24 * 60 * 60 * 1000;

const parseDateKey = (value: string) => {
  const match = String(value || '').match(/^(\d{4})-(\d{2})-(\d{2})$/);
  if (!match) return null;
  return new Date(Date.UTC(Number(match[1]), Number(match[2]) - 1, Number(match[3])));
};

const dateKey = (date: Date) => date.toISOString().slice(0, 10);
const shortDate = (value: string) => {
  const date = parseDateKey(value);
  return date ? `${date.getUTCMonth() + 1}/${date.getUTCDate()}` : value;
};

export function buildRecentParticipationWeeks(todayKey: string, completedWeeks = 8): ParticipationWeek[] {
  const today = parseDateKey(todayKey) || new Date();
  const weekday = today.getUTCDay();
  const daysFromMonday = weekday === 0 ? 6 : weekday - 1;
  const currentMonday = new Date(today.getTime() - daysFromMonday * DAY_MS);

  return Array.from({ length: completedWeeks + 1 }, (_, index) => {
    const offset = completedWeeks - index;
    const start = new Date(currentMonday.getTime() - offset * 7 * DAY_MS);
    const end = new Date(start.getTime() + 6 * DAY_MS);
    const startKey = dateKey(start);
    const endKey = dateKey(end);
    return {
      key: startKey,
      start_date: startKey,
      end_date: endKey,
      label: `${shortDate(startKey)}〜${shortDate(endKey)}`,
      is_current: offset === 0,
    };
  });
}

/** 記録がある最初の週から今週まで。全期間表示を選んだときだけ使用する。 */
export function buildParticipationWeeksSince(todayKey: string, earliestKey: string): ParticipationWeek[] {
  const earliest = parseDateKey(earliestKey);
  if (!earliest) return buildRecentParticipationWeeks(todayKey);
  const currentMonday = parseDateKey(buildRecentParticipationWeeks(todayKey, 0)[0].start_date)!;
  const completedWeeks = Math.max(0, Math.ceil((currentMonday.getTime() - earliest.getTime()) / (7 * DAY_MS)));
  return buildRecentParticipationWeeks(todayKey, completedWeeks);
}

const isParticipation = (record: Record<string, any>) => {
  const status = String(record.type || record.attendance_status || record.status || '').normalize('NFKC').toLowerCase();
  return ['joined', 'present', '出席', '遅刻'].some(value => status.includes(value));
};

const cleanSubject = (value: unknown) => String(value || '').normalize('NFKC').trim();

export function aggregateStudentParticipation(
  records: Record<string, any>[],
  weeks: ParticipationWeek[],
  fallbackSubject = '受講科目',
  activeFrom = '',
) {
  const subjectDatesByWeek = new Map<string, Map<string, Set<string>>>();
  const attendedDatesByWeek = new Map<string, Set<string>>();

  records.filter(isParticipation).forEach(record => {
    const recordDate = String(record.target_date || record.date || '').slice(0, 10);
    const week = weeks.find(item => recordDate >= item.start_date && recordDate <= item.end_date);
    if (!week) return;

    const detailed = Array.isArray(record.participations) ? record.participations : [];
    const detailedSubjects = detailed
      .map((item: any) => cleanSubject(item?.subject || item?.course_name))
      .filter(Boolean);
    const subjects = [
      ...detailedSubjects,
      ...(Array.isArray(record.participation_subjects) ? record.participation_subjects.map(cleanSubject) : []),
      cleanSubject(record.subject || record.course_name || record.target_subject),
    ].filter(Boolean);
    const uniqueSubjects = Array.from(new Set(subjects.length ? subjects : [fallbackSubject || '受講科目']));

    if (!attendedDatesByWeek.has(week.key)) attendedDatesByWeek.set(week.key, new Set());
    attendedDatesByWeek.get(week.key)!.add(recordDate);
    if (!subjectDatesByWeek.has(week.key)) subjectDatesByWeek.set(week.key, new Map());
    uniqueSubjects.forEach(subject => {
      const bySubject = subjectDatesByWeek.get(week.key)!;
      if (!bySubject.has(subject)) bySubject.set(subject, new Set());
      bySubject.get(subject)!.add(recordDate);
    });
  });

  const weekly: WeeklyParticipation[] = weeks.map(week => {
    const dates = Array.from(attendedDatesByWeek.get(week.key) || []).sort();
    const subjects = Array.from(subjectDatesByWeek.get(week.key) || [])
      .map(([subject, subjectDates]) => ({ subject, dates: Array.from(subjectDates).sort() }))
      .sort((a, b) => a.subject.localeCompare(b.subject, 'ja'));
    const expected = !activeFrom || week.end_date >= activeFrom;
    return { ...week, expected, attended: dates.length > 0, dates, subjects };
  });

  let consecutiveMissedWeeks = 0;
  for (let index = weekly.length - 1; index >= 0; index -= 1) {
    const week = weekly[index];
    if (week.is_current) continue;
    if (!week.expected || week.attended) break;
    consecutiveMissedWeeks += 1;
  }

  return {
    weeks: weekly,
    consecutive_missed_weeks: consecutiveMissedWeeks,
    warning: consecutiveMissedWeeks >= 2,
  };
}
