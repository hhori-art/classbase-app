import { automaticPremiumMinutes } from './attendance-integrated-payroll.ts';
import { intervalMinutes, normalizePayrollName, normalizePersonCode, type RegularAttendanceInterval } from './attendance-payroll.ts';

export type ScienceSocialWorkInterval = {
  id?: string;
  teacher_id?: string;
  person_code: string;
  person_name: string;
  date: string;
  start_time: string;
  end_time: string;
};

export type ScienceSocialWorkSummary = {
  teacher_id: string;
  person_code: string;
  person_name: string;
  work_days: number;
  work_dates: string[];
  total_minutes: number;
  late_night_minutes: number;
  before_exclusion_work_days: number;
  before_exclusion_work_dates: string[];
  excluded_duplicate_days: number;
  excluded_duplicate_dates: string[];
};

const validDate = (value: unknown) => /^\d{4}-\d{2}-\d{2}$/.test(String(value || ''));

export function buildScienceSocialWorkSummary(
  intervals: ScienceSocialWorkInterval[],
  legacyAttendance: RegularAttendanceInterval[],
): ScienceSocialWorkSummary[] {
  const legacyDatesByCode = new Map<string, Set<string>>();
  const legacyDatesByName = new Map<string, Set<string>>();
  legacyAttendance.forEach(item => {
    if (!validDate(item.date)) return;
    const code = normalizePersonCode(item.person_code);
    const name = normalizePayrollName(item.person_name);
    if (code) {
      const dates = legacyDatesByCode.get(code) || new Set<string>();
      dates.add(item.date);
      legacyDatesByCode.set(code, dates);
    }
    if (name) {
      const dates = legacyDatesByName.get(name) || new Set<string>();
      dates.add(item.date);
      legacyDatesByName.set(name, dates);
    }
  });

  const grouped = new Map<string, {
    teacher_id: string;
    person_code: string;
    person_name: string;
    intervals: ScienceSocialWorkInterval[];
  }>();
  intervals.forEach(item => {
    if (!validDate(item.date) || !intervalMinutes(item.start_time, item.end_time)) return;
    const code = normalizePersonCode(item.person_code);
    const name = normalizePayrollName(item.person_name);
    const key = code || String(item.teacher_id || '') || name;
    if (!key) return;
    const current = grouped.get(key) || {
      teacher_id: String(item.teacher_id || ''),
      person_code: code,
      person_name: String(item.person_name || ''),
      intervals: [],
    };
    current.teacher_id ||= String(item.teacher_id || '');
    current.person_code ||= code;
    current.person_name ||= String(item.person_name || '');
    current.intervals.push(item);
    grouped.set(key, current);
  });

  return Array.from(grouped.values()).map(person => {
    const code = normalizePersonCode(person.person_code);
    const name = normalizePayrollName(person.person_name);
    const legacyDates = new Set([
      ...(code ? legacyDatesByCode.get(code) || [] : []),
      ...(name ? legacyDatesByName.get(name) || [] : []),
    ]);
    const allDates = Array.from(new Set(person.intervals.map(item => item.date))).sort();
    const excludedDates = allDates.filter(date => legacyDates.has(date));
    const includedIntervals = person.intervals.filter(item => !legacyDates.has(item.date));
    // 勤務日数合計は、勤務時間合計と同じ「旧勤怠との重複を除外した実績」から算出する。
    // 別々の集合から数えると、将来フィルター条件を追加した際に日数と時間がずれるため、
    // includedIntervals を両方の唯一の集計元にする。
    const workDates = Array.from(new Set(includedIntervals.map(item => item.date))).sort();
    const totalMinutes = includedIntervals.reduce((sum, item) => {
      const interval = intervalMinutes(item.start_time, item.end_time);
      return sum + (interval?.duration || 0);
    }, 0);
    const lateNightMinutes = includedIntervals.reduce((sum, item) =>
      sum + automaticPremiumMinutes(item.start_time, item.end_time), 0);

    return {
      teacher_id: person.teacher_id,
      person_code: person.person_code,
      person_name: person.person_name,
      work_days: workDates.length,
      work_dates: workDates,
      total_minutes: totalMinutes,
      late_night_minutes: lateNightMinutes,
      before_exclusion_work_days: allDates.length,
      before_exclusion_work_dates: allDates,
      excluded_duplicate_days: excludedDates.length,
      excluded_duplicate_dates: excludedDates,
    };
  }).sort((left, right) =>
    left.person_code.localeCompare(right.person_code, undefined, { numeric: true }) ||
    left.person_name.localeCompare(right.person_name, 'ja'));
}
