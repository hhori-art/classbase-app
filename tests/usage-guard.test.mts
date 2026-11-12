import assert from 'node:assert/strict';
import test from 'node:test';
import { evaluateUsage, shouldSkipInSavingMode } from '../lib/usage-guard.ts';

const period = { periodStart: '2026-11-05T08:00:00.000Z', periodEnd: '2026-12-05T08:00:00.000Z' };
const at = (day: number) => new Date(Date.parse(period.periodStart) + day * 86400e3);

test('今のペース（月に数ドル）なら通常のまま', () => {
  const result = evaluateUsage({ ...period, creditUsed: 1.5, onDemand: 0 }, at(10));
  assert.equal(result.level, 'normal');
  assert.ok(result.projected < 5);
});

test('月末に含まれる額（$20）を超えそうなら節約モード', () => {
  assert.equal(evaluateUsage({ ...period, creditUsed: 8, onDemand: 0 }, at(10)).level, 'saving');
});

test('月のはじめの少しの利用では見込みを跳ねさせない', () => {
  assert.equal(evaluateUsage({ ...period, creditUsed: 1, onDemand: 0 }, at(0.5)).level, 'normal');
});

test('従量課金が始まったら節約モード、上限の半分を超えたら critical', () => {
  assert.equal(evaluateUsage({ ...period, creditUsed: 20, onDemand: 0.5 }, at(29)).level, 'saving');
  assert.equal(evaluateUsage({ ...period, creditUsed: 20, onDemand: 10 }, at(29)).level, 'critical');
  assert.equal(evaluateUsage({ ...period, creditUsed: 15, onDemand: 0 }, at(10)).level, 'critical');
});

test('節約中は見込みが$16を下回るまで戻さない', () => {
  const snapshot = { ...period, creditUsed: 5.5, onDemand: 0 };
  assert.equal(evaluateUsage(snapshot, at(10), 'normal').level, 'normal');
  assert.equal(evaluateUsage(snapshot, at(10), 'saving').level, 'saving');
  assert.equal(evaluateUsage({ ...snapshot, creditUsed: 4 }, at(10), 'saving').level, 'normal');
});

test('節約モードで間引くもの', () => {
  const minute = (m: number) => new Date(Date.UTC(2026, 10, 6, 11, m));
  for (const job of ['security_monitor_frequent', 'missed_class', 'recordings_evening', 'beta_events'] as const) {
    assert.equal(shouldSkipInSavingMode(job, 'normal', minute(20)), false, job);
  }
  // セキュリティ監視は毎時0分台だけ。
  assert.equal(shouldSkipInSavingMode('security_monitor_frequent', 'saving', minute(0)), false);
  assert.equal(shouldSkipInSavingMode('security_monitor_frequent', 'saving', minute(25)), true);
  // 未参加の通知は15分ごと（0・15・30・45分台）。
  assert.equal(shouldSkipInSavingMode('missed_class', 'saving', minute(15)), false);
  assert.equal(shouldSkipInSavingMode('missed_class', 'saving', minute(20)), true);
  assert.equal(shouldSkipInSavingMode('recordings_evening', 'critical', minute(30)), true);
  assert.equal(shouldSkipInSavingMode('beta_events', 'saving', minute(3)), true);
});
