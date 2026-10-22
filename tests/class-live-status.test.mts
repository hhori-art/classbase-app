import assert from 'node:assert/strict';
import test from 'node:test';
import { classLiveStatus } from '../lib/class-live-status.ts';

// 2026-10-17 の日本時間 hh:mm を UTC の Date にする
const jst = (time: string) => new Date(`2026-10-17T${time}:00+09:00`);

test('授業時刻と日本時間の現在時刻から開始前・授業中・終了後を判定する', () => {
  assert.equal(classLiveStatus('19:00', '20:20', jst('18:59')), 'before');
  assert.equal(classLiveStatus('19:00', '20:20', jst('19:00')), 'live');
  assert.equal(classLiveStatus('19:00', '20:20', jst('20:19')), 'live');
  assert.equal(classLiveStatus('19:00', '20:20', jst('20:20')), 'ended');
});

test('時刻がない授業は判定しない', () => {
  assert.equal(classLiveStatus('', undefined, jst('19:30')), 'unknown');
  assert.equal(classLiveStatus('19:00', '', jst('19:30')), 'live');
});
