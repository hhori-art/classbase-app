export type PfPeriod = 'week' | 'month';
export type PfLearningKind = 'homework' | 'quiz';

export type PfDateRange = {
  start: string;
  end: string;
  label: string;
};

export type PfStudentMetric = {
  student_id: string;
  attendance_present: number;
  attendance_absent: number;
  attendance_late: number;
  attendance_total: number;
  attendance_rate: number | null;
  homework_completed: number;
  homework_total: number;
  homework_rate: number | null;
  quiz_completed: number;
  quiz_total: number;
  quiz_rate: number | null;
  quiz_average_score: number | null;
  alert_count: number;
};

const dateKey = (date: Date) => date.toISOString().slice(0, 10);

const safeAnchor = (value: unknown) => {
  const raw = String(value || '');
  return /^\d{4}-\d{2}-\d{2}$/.test(raw) ? raw : dateKey(new Date());
};

export function pfDateRange(periodValue: unknown, anchorValue: unknown): PfDateRange {
  const period: PfPeriod = periodValue === 'month' ? 'month' : 'week';
  const anchor = safeAnchor(anchorValue);
  const date = new Date(`${anchor}T00:00:00Z`);

  if (period === 'month') {
    const year = date.getUTCFullYear();
    const month = date.getUTCMonth();
    const start = new Date(Date.UTC(year, month, 1));
    const end = new Date(Date.UTC(year, month + 1, 0));
    return { start: dateKey(start), end: dateKey(end), label: `${year}年${month + 1}月` };
  }

  const day = date.getUTCDay();
  const mondayOffset = day === 0 ? -6 : 1 - day;
  const start = new Date(date);
  start.setUTCDate(start.getUTCDate() + mondayOffset);
  const end = new Date(start);
  end.setUTCDate(end.getUTCDate() + 6);
  return { start: dateKey(start), end: dateKey(end), label: `${dateKey(start)}〜${dateKey(end)}` };
}

const normalized = (value: unknown) => String(value || '').normalize('NFKC').trim().toLowerCase();

export function attendanceState(record: Record<string, any>): 'present' | 'absent' | 'late' | 'unknown' {
  const value = normalized([
    record.attendance_status,
    record.status,
    record.type,
    record.result,
  ].filter(Boolean).join(' '));
  if (!value) return 'unknown';
  if (/(欠席|欠|absent|no-show|noshow)/.test(value)) return 'absent';
  if (/(遅刻|遅|late)/.test(value)) return 'late';
  if (/(出席|出|参加|joined|present|attended|ok)/.test(value)) return 'present';
  return 'unknown';
}

export function learningCompleted(value: unknown) {
  const status = normalized(value);
  if (!status) return false;
  if (/(未提出|未実施|未完了|未着手|未受験|not.?submitted|not.?completed|incomplete|false|^0$)/.test(status)) return false;
  return /(提出済|提出|実施済|実施|完了|受験済|受験|合格|済|completed|submitted|done|passed|true|^1$)/.test(status);
}

export function numericScore(value: unknown): number | null {
  const match = normalized(value).replace(/,/g, '').match(/-?\d+(?:\.\d+)?/);
  if (!match) return null;
  const score = Number(match[0]);
  return Number.isFinite(score) ? score : null;
}

export function aggregatePfStudent(
  studentId: string,
  attendance: Record<string, any>[],
  learning: Record<string, any>[],
): PfStudentMetric {
  let attendancePresent = 0;
  let attendanceAbsent = 0;
  let attendanceLate = 0;
  attendance.forEach(record => {
    const state = attendanceState(record);
    if (state === 'present') attendancePresent++;
    if (state === 'absent') attendanceAbsent++;
    if (state === 'late') attendanceLate++;
  });
  const attendanceTotal = attendancePresent + attendanceAbsent + attendanceLate;

  const byKind = (kind: PfLearningKind) => learning.filter(record => record.kind === kind);
  const homework = byKind('homework');
  const quizzes = byKind('quiz');
  const homeworkCompleted = homework.filter(record => record.completed === true || learningCompleted(record.status)).length;
  const quizCompleted = quizzes.filter(record => record.completed === true || learningCompleted(record.status)).length;
  const quizScores = quizzes.map(record => numericScore(record.score)).filter((value): value is number => value !== null);
  const attendanceRate = attendanceTotal ? Math.round(((attendancePresent + attendanceLate) / attendanceTotal) * 100) : null;
  const homeworkRate = homework.length ? Math.round((homeworkCompleted / homework.length) * 100) : null;
  const quizRate = quizzes.length ? Math.round((quizCompleted / quizzes.length) * 100) : null;
  const quizAverageScore = quizScores.length ? Math.round((quizScores.reduce((sum, value) => sum + value, 0) / quizScores.length) * 10) / 10 : null;
  const alertCount = Number(attendanceRate !== null && attendanceRate < 80)
    + Number(homeworkRate !== null && homeworkRate < 70)
    + Number(quizRate !== null && quizRate < 70);

  return {
    student_id: studentId,
    attendance_present: attendancePresent,
    attendance_absent: attendanceAbsent,
    attendance_late: attendanceLate,
    attendance_total: attendanceTotal,
    attendance_rate: attendanceRate,
    homework_completed: homeworkCompleted,
    homework_total: homework.length,
    homework_rate: homeworkRate,
    quiz_completed: quizCompleted,
    quiz_total: quizzes.length,
    quiz_rate: quizRate,
    quiz_average_score: quizAverageScore,
    alert_count: alertCount,
  };
}

export function parsePfCsv(text: string): string[][] {
  const rows: string[][] = [];
  let row: string[] = [];
  let cell = '';
  let quoted = false;
  const source = String(text || '').replace(/^\uFEFF/, '');
  for (let index = 0; index < source.length; index++) {
    const char = source[index];
    if (char === '"') {
      if (quoted && source[index + 1] === '"') {
        cell += '"';
        index++;
      } else {
        quoted = !quoted;
      }
    } else if (char === ',' && !quoted) {
      row.push(cell.trim());
      cell = '';
    } else if ((char === '\n' || char === '\r') && !quoted) {
      if (char === '\r' && source[index + 1] === '\n') index++;
      row.push(cell.trim());
      if (row.some(value => value !== '')) rows.push(row);
      row = [];
      cell = '';
    } else {
      cell += char;
    }
  }
  row.push(cell.trim());
  if (row.some(value => value !== '')) rows.push(row);
  return rows;
}

export const normalizePfHeader = (value: unknown) => normalized(value).replace(/[\s　_\-／/()（）【】\[\]]/g, '');

