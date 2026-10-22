import assert from 'node:assert/strict';
import test from 'node:test';
import {
  buildReportSummary, isDateInMonth, isInJstMonth, jstMonthKey, jstMonthRange, parseReportMonth, shiftMonthKey, summarizeAttendanceMonth,
} from '../lib/server/parent-monthly-report-core.ts';

test('月は日本時間で区切る（10月31日 23:30 は10月、11月1日 0:00 は11月）', () => {
  const october = jstMonthRange('2026-10');
  const lateOct31 = Date.parse('2026-10-31T23:30:00+09:00');
  const nov1 = Date.parse('2026-11-01T00:00:00+09:00');
  assert.equal(jstMonthKey(lateOct31), '2026-10');
  assert.equal(isInJstMonth(lateOct31, october), true);
  assert.equal(isInJstMonth(nov1, october), false);
  assert.equal(isInJstMonth(Date.parse('2026-10-01T00:00:00+09:00'), october), true);
  assert.equal(isInJstMonth(Date.parse('2026-09-30T23:59:59+09:00'), october), false);
  assert.equal(october.endDate, '2026-10-31');
  assert.equal(jstMonthRange('2028-02').endDate, '2028-02-29');
  assert.equal(isDateInMonth('2026-10-31', october), true);
  assert.equal(isDateInMonth('2026-11-01', october), false);
});

test('月の移動と、選べる月の確認', () => {
  assert.equal(shiftMonthKey('2026-01', -1), '2025-12');
  assert.equal(shiftMonthKey('2026-12', 1), '2027-01');
  const now = Date.parse('2026-10-19T12:00:00+09:00');
  assert.equal(parseReportMonth('', now), '2026-10');
  assert.equal(parseReportMonth('2026-09', now), '2026-09');
  assert.equal(parseReportMonth('2026-11', now), null);
  assert.equal(parseReportMonth('2026-13', now), null);
  assert.equal(parseReportMonth('2024-09', now), null);
  assert.equal(parseReportMonth('2026/10', now), null);
});

test('出席のまとめ：月の中の日だけ、取り消した振替は数えない', () => {
  const range = jstMonthRange('2026-10');
  const counts = summarizeAttendanceMonth([
    { date: '2026-10-01', classes: [{ live: true }, { live: true }], absence: null, transfer: null },
    { date: '2026-10-08', classes: [], absence: { kind: 'absent' }, transfer: { status: 'approved' } },
    { date: '2026-10-15', classes: [{ live: true }], absence: { kind: 'late' }, transfer: { status: 'cancelled' } },
    { date: '2026-09-30', classes: [{ live: true }], absence: null, transfer: null },
  ], range);
  assert.deepEqual(counts, { live_days: 2, live_classes: 3, absent_days: 1, late_days: 1, transfer_days: 1 });
});

test('ひとことのまとめ：前の月と比べる', () => {
  const base = { isCurrentMonth: true, month: '2026-10', liveDays: 8, recordingCount: 3, homeworkCount: 40, previousHomeworkCount: 28, aiQuestions: 0 };
  assert.equal(buildReportSummary(base), '今月はZoomで8回参加し、録画を3本見ました。宿題の学習回数は先月より12回増えました。');
  assert.equal(buildReportSummary({ ...base, previousHomeworkCount: 45, aiQuestions: 5 }), '今月はZoomで8回参加し、録画を3本見ました。宿題の学習回数は先月より5回少なくなりました。AI学習で5回質問しました。');
  assert.equal(buildReportSummary({ ...base, isCurrentMonth: false, month: '2026-01', recordingCount: 0, previousHomeworkCount: 40 }), '1月はZoomで8回参加しました。宿題の学習回数は12月と同じ40回でした。');
  assert.equal(buildReportSummary({ ...base, liveDays: 0, recordingCount: 0, previousHomeworkCount: null }), '今月の宿題の学習回数は40回でした。');
  assert.equal(buildReportSummary({ ...base, liveDays: 0, recordingCount: 2, homeworkCount: null }), '今月は録画を2本見ました。');
  assert.equal(buildReportSummary({ ...base, liveDays: null, recordingCount: null, homeworkCount: null, aiQuestions: 3 }), '今月はAI学習で3回質問しました。');
  assert.equal(buildReportSummary({ ...base, liveDays: 0, recordingCount: 0, homeworkCount: null, aiQuestions: null }), '今月の学習の記録はまだありません。');
});
