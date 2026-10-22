import assert from 'node:assert/strict';
import test from 'node:test';
import { formatDate, formatDateTime, formatShortDate, formatTime, toDate } from '../lib/format.ts';

test('date-only keys stay on that day and have no time', () => {
  assert.equal(formatDate('2026-10-17'), '10月17日(土)');
  assert.equal(formatDate('2026-10-17', { withYear: true }), '2026年10月17日(土)');
  assert.equal(formatTime('2026-10-17'), '');
  assert.equal(formatDateTime('2026-10-17'), '10月17日(土)');
});

test('timestamps are shown in Japan time even before 9am JST', () => {
  // 2026-10-17 00:30 JST = 2026-10-16T15:30Z
  assert.equal(formatDateTime('2026-10-16T15:30:00Z'), '10月17日(土) 00:30');
  assert.equal(formatShortDate(new Date('2026-10-16T15:30:00Z')), '10/17');
  assert.equal(formatDateTime({ toMillis: () => Date.parse('2026-10-17T10:20:00Z') }), '10月17日(土) 19:20');
});

test('unreadable values become empty strings', () => {
  assert.equal(toDate('not a date'), null);
  assert.equal(formatDate(undefined), '');
});
