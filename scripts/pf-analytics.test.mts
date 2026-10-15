import assert from 'node:assert/strict';
import test from 'node:test';
import {
  aggregatePfStudent,
  attendanceState,
  learningCompleted,
  parsePfCsv,
  pfDateRange,
} from '../lib/pf-analytics.ts';

test('週次は月曜から日曜、月次は月初から月末になる', () => {
  assert.deepEqual(pfDateRange('week', '2026-08-25'), {
    start: '2026-08-24', end: '2026-08-30', label: '2026-08-24〜2026-08-30',
  });
  assert.deepEqual(pfDateRange('month', '2026-02-15'), {
    start: '2026-02-01', end: '2026-02-28', label: '2026年2月',
  });
});

test('出欠とMonoxerステータスを表記揺れ込みで判定する', () => {
  assert.equal(attendanceState({ type: 'joined' }), 'present');
  assert.equal(attendanceState({ attendance_status: '欠' }), 'absent');
  assert.equal(attendanceState({ status: '遅刻' }), 'late');
  assert.equal(learningCompleted('提出済'), true);
  assert.equal(learningCompleted('未提出'), false);
  assert.equal(learningCompleted('未実施'), false);
});

test('生徒別の出席・宿題・小テスト率を集計する', () => {
  const metric = aggregatePfStudent('student-1', [
    { type: 'joined' }, { attendance_status: '遅' }, { attendance_status: '欠' },
  ], [
    { kind: 'homework', status: '完了' }, { kind: 'homework', status: '未提出' },
    { kind: 'quiz', status: '実施済', score: '80%' }, { kind: 'quiz', status: '未実施' },
  ]);
  assert.equal(metric.attendance_rate, 67);
  assert.equal(metric.homework_rate, 50);
  assert.equal(metric.quiz_rate, 50);
  assert.equal(metric.quiz_average_score, 80);
  assert.equal(metric.alert_count, 3);
});

test('CSV内のカンマと改行を含む引用セルを解析する', () => {
  const rows = parsePfCsv('氏名,課題名\n"山田,太郎","課題\nその1"\n');
  assert.deepEqual(rows, [['氏名', '課題名'], ['山田,太郎', '課題\nその1']]);
});
