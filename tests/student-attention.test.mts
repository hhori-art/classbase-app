import assert from 'node:assert/strict';
import test from 'node:test';
import { attentionBand, computeAttentionSignals, splitByResolution, type AttentionInput, type AttentionWeek } from '../lib/student-attention.ts';

const weeks = (pattern: string): AttentionWeek[] => {
  // 古い順。o=参加、x=不参加、-=授業なし。最後が今週（current）。
  const start = Date.UTC(2026, 8, 7);
  return pattern.split('').map((ch, i) => {
    const key = new Date(start + i * 7 * 86400000).toISOString().slice(0, 10);
    return { start: key, end: key, current: i === pattern.length - 1, expected: ch !== '-', attended: ch === 'o' };
  });
};

const base = (overrides: Partial<AttentionInput> = {}): AttentionInput => ({
  todayKey: '2026-11-02',
  weeks: weeks('ooooooooo'),
  unreadQuestions: 0,
  homework: [],
  quizzes: [],
  monoxerHistory: [],
  questAttempts: [],
  lastLogin: '2026-11-01T10:00:00.000Z',
  churnRisk: null,
  riskAnalyzedAt: null,
  ...overrides,
});

test('記録に問題がなければ理由は出ない', () => {
  assert.deepEqual(computeAttentionSignals(base()), []);
  assert.equal(attentionBand([]), null);
});

test('2週続けて不参加で「今週中に」、3週で「今すぐ」', () => {
  const two = computeAttentionSignals(base({ weeks: weeks('ooooooxxo') }));
  assert.equal(two[0].key, 'missed_streak');
  assert.equal(two[0].points, 35);
  assert.equal(attentionBand(two), 'this_week');
  const three = computeAttentionSignals(base({ weeks: weeks('oooooxxxo') }));
  assert.equal(three[0].points, 50);
  assert.equal(attentionBand(three), 'urgent');
});

test('授業がなかった週は不参加に数えない', () => {
  const signals = computeAttentionSignals(base({ weeks: weeks('oooooox--o') }));
  assert.equal(signals.find(signal => signal.key === 'missed_streak'), undefined);
});

test('質問への未返信は対応済みにできず、常に「今すぐ」', () => {
  const signals = computeAttentionSignals(base({ unreadQuestions: 2 }));
  assert.equal(signals[0].key, 'question_waiting');
  assert.equal(signals[0].resolvable, false);
  assert.equal(attentionBand(signals), 'urgent');
});

test('AI予測だけでは一覧に出さない', () => {
  const signals = computeAttentionSignals(base({ churnRisk: 90, riskAnalyzedAt: '2026-10-30' }));
  assert.equal(signals.length, 1);
  assert.equal(attentionBand(signals), null);
});

test('Monoxerの学習回数が2回続けて増えていない', () => {
  const signals = computeAttentionSignals(base({ monoxerHistory: [
    { date: '2026-10-12', gained: 30 }, { date: '2026-10-19', gained: 0 }, { date: '2026-10-26', gained: 0 },
  ] }));
  assert.equal(signals[0].key, 'monoxer_stalled');
  assert.equal(signals[0].points, 25);
});

test('同じ単元の直近3問が不正解', () => {
  const attempt = (correct: boolean) => ({ unitId: 'u1', unitName: '光の性質', correct, date: '2026-10-30' });
  const signals = computeAttentionSignals(base({ questAttempts: [attempt(true), attempt(false), attempt(false), attempt(false)] }));
  assert.equal(signals[0].key, 'quest_struggle');
  assert.match(signals[0].detail, /光の性質/);
});

test('対応済みは根拠が同じあいだだけ外れ、次の週も不参加なら再び出る', () => {
  const before = computeAttentionSignals(base({ weeks: weeks('ooooooxxo') }));
  const resolution = { missed_streak: { fingerprint: before[0].fingerprint, status: 'contacted' as const } };
  assert.equal(splitByResolution(before, resolution).open.length, 0);
  const after = computeAttentionSignals(base({ weeks: weeks('oooooxxxo') }));
  const split = splitByResolution(after, resolution);
  assert.equal(split.open.length, 1);
  assert.equal(split.open[0].key, 'missed_streak');
});

test('一度もログインしていない生徒', () => {
  const signals = computeAttentionSignals(base({ lastLogin: null }));
  assert.equal(signals[0].key, 'login_gap');
  assert.equal(signals[0].fingerprint, 'login:never');
});

test('授業ボタンで参加したことがない生徒は、出席の理由を出さない（教室で受けている生徒など）', () => {
  const signals = computeAttentionSignals(base({ weeks: weeks('xxxxxxxxx') }));
  assert.equal(signals.filter(signal => signal.category === 'attendance').length, 0);
});

test('移行期間：ログインは理由にせず、出席はアプリで3週以上参加した生徒だけを控えめに見る', () => {
  assert.deepEqual(computeAttentionSignals(base({ transition: true, lastLogin: null })), []);
  // アプリでの参加が2週だけ → 判定しない
  assert.deepEqual(computeAttentionSignals(base({ transition: true, weeks: weeks('xxxxooxxx') })), []);
  // 3週以上参加して定着 → 2週不参加で20点（気にかける）、3週で30点（今週中に）
  const two = computeAttentionSignals(base({ transition: true, weeks: weeks('xxoooxxo') }));
  assert.equal(two[0].points, 20);
  assert.equal(attentionBand(two), 'watch');
  const three = computeAttentionSignals(base({ transition: true, weeks: weeks('xoooxxxo') }));
  assert.equal(three[0].points, 30);
  assert.equal(attentionBand(three), 'this_week');
  assert.match(three[0].detail, /移行期間/);
});

test('授業でカメラのオフが設定の回数続くと理由に出る（設定が無効なら出ない）', () => {
  const rule = { enabled: true, off_rate_percent: 20, streak_lessons: 3, min_present_minutes: 10 };
  const off = (date: string) => ({ date, camera_minutes: 2, present_minutes: 70 });
  const two = computeAttentionSignals(base({ cameraRule: rule, cameraLessons: [off('2026-10-19'), off('2026-10-26')] }));
  assert.equal(two.some(signal => signal.key === 'camera_off_streak'), false);
  const three = computeAttentionSignals(base({ cameraRule: rule, cameraLessons: [off('2026-10-19'), off('2026-10-26'), off('2026-11-02')] }));
  const signal = three.find(item => item.key === 'camera_off_streak');
  assert.equal(signal?.points, 25);
  assert.equal(signal?.fingerprint, 'camera:2026-10-19:3');
  assert.equal(attentionBand(three), 'this_week');
  const disabled = computeAttentionSignals(base({ cameraRule: { ...rule, enabled: false }, cameraLessons: [off('2026-10-19'), off('2026-10-26'), off('2026-11-02')] }));
  assert.equal(disabled.length, 0);
});
