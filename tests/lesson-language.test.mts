import assert from 'node:assert/strict';
import test from 'node:test';
import { DEFAULT_LANGUAGE_RULES, detectLanguage, effectiveLanguageRules, parseWebVtt, summarizeFindings } from '../lib/lesson-language.ts';

const vtt = (lines: string[]) => ['WEBVTT', '', ...lines.map((text, index) => `${index + 1}\n00:${String(index).padStart(2, '0')}:05.000 --> 00:${String(index).padStart(2, '0')}:09.000\n講師: ${text}\n`)].join('\n');
const labelsOf = (text: string) => detectLanguage(parseWebVtt(vtt([text])), DEFAULT_LANGUAGE_RULES).map(finding => finding.rule_id);

test('parses Zoom WebVTT transcripts with speaker and time', () => {
  const cues = parseWebVtt('WEBVTT\n\n1\n00:00:05.647 --> 00:00:09.757\nチャットはこちらへ！！: それでは二時間目の授業を始めます。\n\n2\n01:02:03.500 --> 01:02:04.000\n本文だけ\n');
  assert.equal(cues.length, 2);
  assert.equal(cues[0].speaker, 'チャットはこちらへ！！');
  assert.equal(cues[0].text, 'それでは二時間目の授業を始めます。');
  assert.equal(cues[1].start, 3723.5);
  assert.equal(cues[1].speaker, '');
});

test('detects negative or harmful remarks a parent would object to', () => {
  assert.ok(labelsOf('こんなのもわからないの、バカじゃないの').includes('baka'));
  assert.ok(labelsOf('お前には無理だよ').includes('muri'));
  assert.ok(labelsOf('何回言ったらわかるんだ').includes('nankai'));
  assert.ok(labelsOf('黙れ').includes('damare'));
  assert.ok(labelsOf('ウザいな').includes('uzai'));
  assert.ok(labelsOf('女のくせに理科なんて').includes('gender'));
  assert.ok(labelsOf('LINE教えてよ').includes('line'));
  assert.ok(labelsOf('そんなんで受かるわけない').includes('dekiruwakenai'));
});

test('does not flag ordinary classroom language', () => {
  for (const text of [
    'バカンスの季節ですね', 'カスタムの設定をします', 'カステラを想像してください', 'ゴミ箱に捨てましょう',
    '無駄なく計算しましょう', 'この問題は難しいけど、みんなならできる', '気持ちよく解けましたね', '激しい反応が起きます',
    'くずれやすい地層です', 'LINE連携の案内は教室から届きます', 'ちしき（知識）を整理しよう',
  ]) {
    assert.deepEqual(labelsOf(text), [], text);
  }
});

test('custom words can be added and default words turned off', () => {
  const rules = effectiveLanguageRules({ custom: [{ id: 'x', label: '赤点確定', category: 'negative', severity: 'high' }], disabled: ['omae'] });
  const findings = detectLanguage(parseWebVtt(vtt(['お前は赤点確定だな'])), rules);
  assert.deepEqual(findings.map(finding => finding.rule_id), ['custom_x']);
  assert.equal(summarizeFindings(findings).by_severity.high, 1);
});

test('does not flag words that only appear across word boundaries in real transcripts', () => {
  for (const text of [
    'どんなグループ分けでしょう？', 'こんなん別に覚えろって言いたいわけじゃない', 'さっきサマリーの方見ましょうか？',
    '微生物をなくす殺すためです', '稲作に向いてない場所', '終わってる人は授業の準備して待っておいてください',
    '大切な問題ばかりなので', 'やばかったかもしれん', 'じゃあホームルームから行きます', 'こうざっくりまず分解されます',
    'エゴノキシノブスギナ', 'お金儲けがメインです', '気持ち悪いことをしてる', 'どうせできるので',
  ]) {
    assert.deepEqual(labelsOf(text), [], text);
  }
});

test('detects remarks that make light of studying, without double counting', () => {
  const cues = [
    { start: 10, end: 12, speaker: '講師', text: 'まあ、こんなのは覚えなくていいです。' },
    { start: 20, end: 22, speaker: '講師', text: 'こんなん覚えなくていいんですけど' },
    { start: 30, end: 32, speaker: '講師', text: '細かく覚えなくていいので楽かなと思います。' },
    { start: 40, end: 42, speaker: '講師', text: '勉強なんか将来役に立たないって思うかもしれないけど' },
    { start: 50, end: 52, speaker: '講師', text: 'こんなの覚えても意味ないよ' },
    { start: 60, end: 62, speaker: '講師', text: 'これは意味がない数字なので無視して計算します。' },
  ];
  const hits = detectLanguage(cues, effectiveLanguageRules({})).map(finding => `${finding.time}:${finding.rule_id}:${finding.severity}`);
  assert.deepEqual(hits, [
    '10:konnanooboe:medium',
    '20:konnanooboe:medium',
    '30:oboenakuteii:low',
    '40:yakunitatanai:medium',
    '50:imiganai:medium',
  ]);
});
