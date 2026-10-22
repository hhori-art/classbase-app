import assert from 'node:assert/strict';
import test from 'node:test';
import { formatDateKeyMonthDay, formatDateKeySlash, isHomeworkOverdue, parseHomeworkDeadline } from '../lib/homework-deadline.ts';

test('日付だけの期限は期限日の日本時間23:59まで期限内', () => {
  // 2026-10-17 09:30 JST（UTC 00:30）。以前は UTC 0時と比べて期限切れになっていた。
  assert.equal(isHomeworkOverdue('2026-10-17', new Date('2026-10-17T00:30:00Z')), false);
  // 2026-10-17 23:59 JST
  assert.equal(isHomeworkOverdue('2026-10-17', new Date('2026-10-17T14:59:00Z')), false);
  // 2026-10-18 00:00 JST
  assert.equal(isHomeworkOverdue('2026-10-17', new Date('2026-10-17T15:00:00Z')), true);
});

test('日付だけの期限には時刻を付けない', () => {
  assert.deepEqual(parseHomeworkDeadline('2026-10-17'), { dateKey: '2026-10-17', time: '', instant: null });
});

test('タイムゾーンのない日時は日本時間として扱う', () => {
  const deadline = parseHomeworkDeadline('2026-10-17T18:00');
  assert.equal(deadline.dateKey, '2026-10-17');
  assert.equal(deadline.time, '18:00');
  assert.equal(isHomeworkOverdue('2026-10-17T18:00', new Date('2026-10-17T08:59:00Z')), false);
  assert.equal(isHomeworkOverdue('2026-10-17T18:00', new Date('2026-10-17T09:01:00Z')), true);
});

test('UTCの日時は日本時間の日付と時刻に直す', () => {
  const deadline = parseHomeworkDeadline('2026-10-17T15:30:00.000Z');
  assert.equal(deadline.dateKey, '2026-10-18');
  assert.equal(deadline.time, '00:30');
});

test('読めない期限は期限切れにしない', () => {
  assert.equal(isHomeworkOverdue('', new Date()), false);
  assert.equal(isHomeworkOverdue('不明', new Date()), false);
  assert.equal(parseHomeworkDeadline(undefined).dateKey, '');
});

test('日付キーの表示', () => {
  assert.equal(formatDateKeySlash('2026-01-05'), '2026/1/5');
  assert.equal(formatDateKeyMonthDay('2026-01-05'), '1/5');
  assert.equal(formatDateKeySlash(''), '');
});
