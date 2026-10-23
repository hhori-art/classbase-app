import assert from 'node:assert/strict';
import test from 'node:test';
import { isClassButtonVisible, normalizeClassButtonSettings } from '../lib/class-button-settings.ts';

test('the class button follows Japan time even on devices in other time zones', () => {
  const settings = normalizeClassButtonSettings({ period1_start: '19:30', period1_end: '20:30', show_before_minutes: 10, show_after_minutes: 10 });
  // 日本時間 19:25（ニューヨークの端末では同じ日の 6:25）
  const jst1925 = new Date('2026-10-23T10:25:00Z');
  assert.equal(isClassButtonVisible(jst1925, settings.period1_start, settings.period1_end, settings), true);
  // 日本時間 19:00 は表示前、21:00 は表示後
  assert.equal(isClassButtonVisible(new Date('2026-10-23T10:00:00Z'), settings.period1_start, settings.period1_end, settings), false);
  assert.equal(isClassButtonVisible(new Date('2026-10-23T12:00:00Z'), settings.period1_start, settings.period1_end, settings), false);
});
