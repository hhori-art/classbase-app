import assert from 'node:assert/strict';
import test from 'node:test';
import { registrationTermRanges } from '../lib/course-registration-match.ts';

const option = (term: string, grade: string) => ({ year: 2026, term, term_label: '第III期', grade });

test('中3専用の期IDの日付を、候補の代表の期ID（term3）でも引ける', () => {
  const options = [option('term3', '中1'), option('term3', '中2'), option('term3', '中3'), option('term_custom_1', '中3')];
  const ranges = registrationTermRanges(options, { '2026__term_custom_1': { start: '2026-09-07', end: '2026-11-28' } });
  assert.deepEqual(ranges['2026__term3'], { start: '2026-09-07', end: '2026-11-28' });
  assert.deepEqual(ranges['2026__term_custom_1'], { start: '2026-09-07', end: '2026-11-28' });
});

test('代表の期IDにもともと範囲があれば、そのまま使う（中1・中2は変わらない）', () => {
  const options = [option('term3', '中1'), option('term3', '中2'), option('term_custom_1', '中3')];
  const ranges = registrationTermRanges(options, {
    '2026__term3': { start: '2026-09-01', end: '2026-11-21' },
    '2026__term_custom_1': { start: '2026-09-07', end: '2026-11-28' },
  });
  assert.deepEqual(ranges['2026__term3'], { start: '2026-09-01', end: '2026-11-21' });
});
