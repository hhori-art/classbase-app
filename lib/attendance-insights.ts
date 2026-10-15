import { attendanceProgramMatches, normalizeAttendanceSegment } from './attendance-work-detail';
import { intervalMinutes, mapWorkTypeToPayrollCategory, normalizePayrollName, normalizePersonCode, type RegularAttendanceInterval } from './attendance-payroll';

export type AttendanceInsightSource = 'combined' | 'system' | 'external';

const WEEKDAYS = ['日', '月', '火', '水', '木', '金', '土'] as const;

type InsightInterval = {
  person_key: string;
  teacher_id: string;
  person_code: string;
  teacher_name: string;
  school: string;
  date: string;
  weekday: number;
  start: string;
  end: string;
  minutes: number;
  source: 'system' | 'external';
  category: 'lesson' | 'office' | 'interview' | 'other';
  detail_complete: boolean | null;
  approved: boolean | null;
  record_id: string;
};

const round1 = (value: number) => Math.round(value * 10) / 10;

const weekdayForDate = (date: string) => {
  const matched = String(date || '').match(/^(\d{4})-(\d{2})-(\d{2})$/);
  if (!matched) return -1;
  return new Date(Date.UTC(Number(matched[1]), Number(matched[2]) - 1, Number(matched[3]))).getUTCDay();
};

const inferredExternalProgram = (item: RegularAttendanceInterval) => {
  const label = `${item.course_code || ''} ${item.course_name || ''} ${item.work_code || ''} ${item.work_type || ''}`.normalize('NFKC');
  return /突破ゼミ|突破/.test(label) ? 'breakthrough' : /理社講座|理社/.test(label) ? 'science_social' : 'normal';
};

const intervalDuration = (start: string, end: string, fallback = 0) => {
  const interval = intervalMinutes(start, end);
  return interval?.duration || Math.max(0, Number(fallback || 0));
};

const mergedMinutes = (items: InsightInterval[]) => {
  const ranges = items.flatMap(item => {
    const interval = intervalMinutes(item.start, item.end);
    return interval ? [{ start: interval.start, end: interval.end }] : [];
  }).sort((a, b) => a.start - b.start || a.end - b.end);
  let total = 0;
  let current: { start: number; end: number } | null = null;
  for (const range of ranges) {
    if (!current) current = { ...range };
    else if (range.start <= current.end) current.end = Math.max(current.end, range.end);
    else { total += current.end - current.start; current = { ...range }; }
  }
  if (current) total += current.end - current.start;
  const fallback = items.filter(item => !intervalMinutes(item.start, item.end)).reduce((sum, item) => sum + item.minutes, 0);
  return total + fallback;
};

const sourceMinutes = (items: InsightInterval[], source: 'system' | 'external') =>
  mergedMinutes(items.filter(item => item.source === source));

const defaultAggregate = () => ({
  total_minutes: 0,
  system_minutes: 0,
  external_minutes: 0,
  lesson_minutes: 0,
  individual_minutes: 0,
  office_minutes: 0,
  support_minutes: 0,
  work_days: new Set<string>(),
  record_ids: new Set<string>(),
  approved_record_ids: new Set<string>(),
  detail_count: 0,
  complete_detail_count: 0,
});

function profileLookups(profiles: Map<string, any>) {
  const byCode = new Map<string, { id: string; profile: any }>();
  const byName = new Map<string, { id: string; profile: any }>();
  profiles.forEach((profile, id) => {
    const code = normalizePersonCode(profile.lifetime_id || profile.staff_id || profile.staffId || profile.employee_id || profile.employeeId || profile.teacher_code);
    const name = normalizePayrollName(profile.name || profile.teacher_name || profile.student_name || profile.displayName);
    if (code) byCode.set(code, { id, profile });
    if (name && !byName.has(name)) byName.set(name, { id, profile });
  });
  return { byCode, byName };
}

function displaySchool(profile: any, fallback: any) {
  return String(profile?.school_name || profile?.schoolName || profile?.school || profile?.school_id || fallback?.school_name || fallback?.school_id || fallback?.school_code || '校舎未設定');
}

function buildSystemIntervals(records: any[], profiles: Map<string, any>, program: string): InsightInterval[] {
  return records.flatMap(record => {
    const teacherId = String(record.teacher_id || '');
    const profile = profiles.get(teacherId) || {};
    const personCode = normalizePersonCode(profile.lifetime_id || profile.staff_id || profile.staffId || profile.employee_id || profile.employeeId || profile.teacher_code);
    const teacherName = String(record.teacher_name || profile.name || profile.teacher_name || '職員未設定');
    const personKey = personCode ? `code:${personCode}` : teacherId ? `uid:${teacherId}` : `name:${normalizePayrollName(teacherName)}`;
    const weekday = weekdayForDate(String(record.date || ''));
    if (weekday < 0) return [];
    const approved = record.detail_approval_status === 'approved' || record.status === 'approved';
    return (Array.isArray(record.work_segments) ? record.work_segments : [])
      .map(normalizeAttendanceSegment)
      .filter((segment: any) => segment.type !== 'break' && attendanceProgramMatches(segment, program))
      .map((segment: any): InsightInterval => {
        const category = mapWorkTypeToPayrollCategory(segment.type) || 'other';
        const detailComplete = segment.type === 'individual'
          ? Boolean(segment.grade && segment.individual_level && segment.individual_ratio)
          : segment.type === 'lesson' || segment.type === 'breakthrough_lesson'
            ? Boolean(segment.grade)
            : segment.type === 'office' || segment.type === 'breakthrough_office'
              ? Boolean(segment.office_task)
              : segment.type !== 'other' || Boolean(segment.note);
        return {
          person_key: personKey,
          teacher_id: teacherId,
          person_code: personCode,
          teacher_name: teacherName,
          school: displaySchool(profile, { school_name: segment.school_id || record.school_name, school_id: record.school_id }),
          date: String(record.date || ''), weekday, start: String(segment.start || ''), end: String(segment.end || ''),
          minutes: intervalDuration(segment.start, segment.end), source: 'system', category,
          detail_complete: detailComplete, approved, record_id: String(record.id || ''),
        };
      });
  });
}

function buildExternalIntervals(items: RegularAttendanceInterval[], profiles: Map<string, any>, program: string): InsightInterval[] {
  const lookups = profileLookups(profiles);
  return items.flatMap((item, index) => {
    if (program !== 'all' && inferredExternalProgram(item) !== program) return [];
    const code = normalizePersonCode(item.person_code);
    const name = normalizePayrollName(item.person_name);
    const matched = (code && lookups.byCode.get(code)) || (name && lookups.byName.get(name)) || undefined;
    const profile = matched?.profile || {};
    const teacherId = matched?.id || '';
    const profileCode = normalizePersonCode(profile.lifetime_id || profile.staff_id || profile.staffId || profile.employee_id || profile.employeeId || profile.teacher_code);
    const personCode = profileCode || code;
    const teacherName = String(profile.name || profile.teacher_name || item.person_name || '職員未設定');
    const personKey = personCode ? `code:${personCode}` : teacherId ? `uid:${teacherId}` : `name:${name}`;
    const weekday = weekdayForDate(item.date);
    if (weekday < 0) return [];
    return [{
      person_key: personKey,
      teacher_id: teacherId,
      person_code: personCode,
      teacher_name: teacherName,
      school: displaySchool(profile, item),
      date: item.date, weekday, start: item.start_time, end: item.end_time,
      minutes: intervalDuration(item.start_time, item.end_time, item.actual_minutes), source: 'external' as const,
      category: mapWorkTypeToPayrollCategory(item.work_type) || 'other',
      detail_complete: null, approved: null, record_id: String(item.id || `external-${index}`),
    }];
  });
}

function dateRange(start: string, end: string) {
  const result: string[] = [];
  const current = new Date(`${start}T00:00:00Z`);
  const last = new Date(`${end}T00:00:00Z`);
  if (Number.isNaN(current.getTime()) || Number.isNaN(last.getTime())) return result;
  while (current <= last && result.length < 370) {
    result.push(current.toISOString().slice(0, 10));
    current.setUTCDate(current.getUTCDate() + 1);
  }
  return result;
}

export function calculateAttendanceInsights(
  records: any[],
  profiles: Map<string, any>,
  program = 'all',
  externalAttendance: RegularAttendanceInterval[] = [],
  source: AttendanceInsightSource = 'combined',
  period?: { start: string; end: string },
) {
  const allIntervals = [
    ...(source === 'external' ? [] : buildSystemIntervals(records, profiles, program)),
    ...(source === 'system' ? [] : buildExternalIntervals(externalAttendance, profiles, program)),
  ];
  const dates = period ? dateRange(period.start, period.end) : Array.from(new Set(allIntervals.map(item => item.date))).sort();
  const coveredWeekdays = new Set(dates.map(weekdayForDate).filter(day => day >= 0));

  const personDays = new Map<string, InsightInterval[]>();
  const schoolDays = new Map<string, InsightInterval[]>();
  allIntervals.forEach(item => {
    const personDayKey = `${item.person_key}\u001f${item.date}`;
    personDays.set(personDayKey, [...(personDays.get(personDayKey) || []), item]);
    // 校舎集計でも職員ごとに時間帯を統合する。職員をまたいで同時刻を重複扱いしない。
    const schoolDayKey = `${item.school}\u001f${item.person_key}\u001f${item.date}`;
    schoolDays.set(schoolDayKey, [...(schoolDays.get(schoolDayKey) || []), item]);
  });

  const teacherMap = new Map<string, any>();
  const schoolMap = new Map<string, any>();
  const weekdayRows = WEEKDAYS.map((label, weekday) => ({ weekday, label, total_minutes: 0, system_minutes: 0, external_minutes: 0, people: new Set<string>(), work_days: new Set<string>() }));

  personDays.forEach(items => {
    const first = items[0];
    const row = teacherMap.get(first.person_key) || { ...defaultAggregate(), person_key: first.person_key, teacher_id: first.teacher_id, person_code: first.person_code, teacher_name: first.teacher_name, school: first.school, weekdays: WEEKDAYS.map((label, weekday) => ({ weekday, label, total_minutes: 0, system_minutes: 0, external_minutes: 0, work_days: 0, last_work_date: '' })) };
    const total = mergedMinutes(items);
    const system = sourceMinutes(items, 'system');
    const external = sourceMinutes(items, 'external');
    row.total_minutes += total; row.system_minutes += system; row.external_minutes += external; row.work_days.add(first.date);
    const day = row.weekdays[first.weekday];
    day.total_minutes += total; day.system_minutes += system; day.external_minutes += external; day.work_days += 1; day.last_work_date = first.date;
    const weekdayRow = weekdayRows[first.weekday];
    weekdayRow.total_minutes += total; weekdayRow.system_minutes += system; weekdayRow.external_minutes += external; weekdayRow.people.add(first.person_key); weekdayRow.work_days.add(first.date);
    items.forEach(item => {
      if (item.category === 'lesson') row.lesson_minutes += item.minutes;
      if (item.category === 'office') row.office_minutes += item.minutes;
      if (item.category === 'interview') row.support_minutes += item.minutes;
      if (item.detail_complete !== null) { row.detail_count += 1; if (item.detail_complete) row.complete_detail_count += 1; }
      if (item.approved !== null) { row.record_ids.add(item.record_id); if (item.approved) row.approved_record_ids.add(item.record_id); }
    });
    teacherMap.set(first.person_key, row);
  });

  schoolDays.forEach(items => {
    const first = items[0];
    const row = schoolMap.get(first.school) || { ...defaultAggregate(), school: first.school };
    row.total_minutes += mergedMinutes(items); row.system_minutes += sourceMinutes(items, 'system'); row.external_minutes += sourceMinutes(items, 'external'); row.work_days.add(first.date);
    items.forEach(item => {
      if (item.category === 'lesson') row.lesson_minutes += item.minutes;
      if (item.category === 'office') row.office_minutes += item.minutes;
      if (item.category === 'interview') row.support_minutes += item.minutes;
      if (item.detail_complete !== null) { row.detail_count += 1; if (item.detail_complete) row.complete_detail_count += 1; }
      if (item.approved !== null) { row.record_ids.add(item.record_id); if (item.approved) row.approved_record_ids.add(item.record_id); }
    });
    schoolMap.set(first.school, row);
  });

  const finish = (row: any) => ({
    ...row,
    work_days: row.work_days.size,
    records: row.record_ids.size,
    record_ids: undefined,
    approved_record_ids: undefined,
    average_minutes_per_work_day: row.work_days.size ? Math.round(row.total_minutes / row.work_days.size) : 0,
    lesson_share: row.total_minutes ? round1(row.lesson_minutes / row.total_minutes * 100) : 0,
    detail_completion_rate: row.detail_count ? round1(row.complete_detail_count / row.detail_count * 100) : null,
    approval_rate: row.record_ids.size ? round1(row.approved_record_ids.size / row.record_ids.size * 100) : null,
  });

  const teachers = Array.from(teacherMap.values()).map(row => {
    const finished = finish(row);
    return {
      ...finished,
      zero_weekdays: finished.weekdays.filter((day: any) => coveredWeekdays.has(day.weekday) && day.total_minutes === 0).map((day: any) => day.weekday),
      last_work_date: finished.weekdays.map((day: any) => day.last_work_date).filter(Boolean).sort().at(-1) || '',
    };
  }).sort((a, b) => b.total_minutes - a.total_minutes || a.teacher_name.localeCompare(b.teacher_name, 'ja'));
  const schools = Array.from(schoolMap.values()).map(finish).sort((a, b) => b.total_minutes - a.total_minutes);
  const weekday_totals = weekdayRows.map(row => ({
    weekday: row.weekday, label: row.label, total_minutes: row.total_minutes, system_minutes: row.system_minutes,
    external_minutes: row.external_minutes, people: row.people.size, work_days: row.work_days.size,
    average_minutes_per_date: row.work_days.size ? Math.round(row.total_minutes / row.work_days.size) : 0,
  }));
  const totalMinutes = Array.from(personDays.values()).reduce((sum, items) => sum + mergedMinutes(items), 0);
  const uniqueWorkDays = new Set(allIntervals.map(item => item.date)).size;
  const summary = {
    people: teachers.length,
    total_minutes: totalMinutes,
    system_minutes: Array.from(personDays.values()).reduce((sum, items) => sum + sourceMinutes(items, 'system'), 0),
    external_minutes: Array.from(personDays.values()).reduce((sum, items) => sum + sourceMinutes(items, 'external'), 0),
    work_days: uniqueWorkDays,
    average_minutes_per_person: teachers.length ? Math.round(totalMinutes / teachers.length) : 0,
    both_source_people: teachers.filter(row => row.system_minutes > 0 && row.external_minutes > 0).length,
  };
  const attention = teachers.filter(row => row.detail_completion_rate !== null && (row.detail_completion_rate < 100 || row.approval_rate < 100)).map(row => ({
    ...row,
    reasons: [row.detail_completion_rate < 100 ? '詳細未入力あり' : '', row.approval_rate !== null && row.approval_rate < 100 ? '未承認あり' : ''].filter(Boolean),
  }));
  return { summary, schools, teachers, weekday_totals, attention, weekdays: WEEKDAYS.map((label, weekday) => ({ weekday, label, covered: coveredWeekdays.has(weekday) })) };
}
