import test from 'node:test';
import assert from 'node:assert/strict';
import {
  DEFAULT_LESSON_ANALYSIS_RULES, analyzeTranscript, clockLabel, evaluateLesson, fastStretches, lessonEvents, normalizeLessonAnalysisRules, normalizeRubric, overallScore,
  type AnalysisCue,
} from '../lib/lesson-analysis.ts';

const T = '山田 先生';
const cues: AnalysisCue[] = [
  { start: 5, end: 12, speaker: T, text: 'こんばんは。今日は電流と電圧の関係について学びます。' },
  { start: 12.5, end: 20, speaker: T, text: '前回やったオームの法則、覚えている人はいますか？' },
  { start: 24, end: 27, speaker: 'テスト生徒一郎', text: '電圧は電流かける抵抗です。' },
  { start: 28, end: 35, speaker: T, text: 'そうですね、よく覚えていました。では、この回路を見てください。' },
  { start: 35.5, end: 45, speaker: T, text: '抵抗が二つ直列につながっています。全体の抵抗はどうなる？' },
  { start: 45.5, end: 48, speaker: 'テスト生徒二子', text: '足し算です。' },
  { start: 70, end: 80, speaker: T, text: 'そのとおり。では、ここからは並列の場合を説明していきます。' },
  { start: 81, end: 100, speaker: T, text: '並列のときは、それぞれの抵抗に同じ電圧がかかります。' },
  { start: 101, end: 120, speaker: T, text: 'なので、流れる電流はそれぞれの抵抗で変わります。' },
  { start: 121, end: 140, speaker: T, text: '最後にまとめです。今日のポイントは、直列は足し算、並列は逆数の足し算です。' },
];
const rules = DEFAULT_LESSON_ANALYSIS_RULES;
const analysis = analyzeTranscript({ cues, rules, teacherNames: ['山田先生'], durationSec: 150 });

test('先生と生徒を分け、生徒は仮名にする', () => {
  assert.equal(analysis.teacher_detection, 'registered_name');
  assert.deepEqual(analysis.student_aliases, ['生徒A', '生徒B']);
  assert.equal(analysis.summary.student_turns, 2);
  const fallback = analyzeTranscript({ cues, rules });
  assert.equal(fallback.teacher_detection, 'most_talk');
});

test('問いかけ・待ち時間・続けて話した時間・沈黙', () => {
  assert.equal(analysis.questions.length, 2);
  assert.equal(analysis.questions[0].wait_seconds, 4);
  assert.equal(analysis.questions[0].student_answered, true);
  assert.equal(analysis.questions[1].wait_seconds, 0.5);
  assert.deepEqual(analysis.summary.longest_monologue, { start: 70, end: 140, seconds: 70 });
  assert.equal(analysis.silences[0].start, 48);
  assert.equal(analysis.series.length, 15);
  assert.equal(analysis.series[2].student_turns, 1);
  assert.equal(lessonEvents(analysis).filter(event => event.type === 'question').length, 2);
});

test('観点ごとのレベルと時刻つきの根拠（生徒の名前や発言は入らない）', () => {
  const evaluation = evaluateLesson({ transcript: analysis, camera: { students: 4, camera_minutes: 200, present_minutes: 260, off_students: 1 }, rules });
  assert.deepEqual(evaluation.scores.map(score => score.criterion), ['導入', '発問', '生徒の参加', '説明の分かりやすさ', '時間配分', '考える・書く時間']);
  assert.equal(evaluation.scores[0].level, 4);
  assert.equal(evaluation.scores[0].evidence[0].time, '00:00:05');
  assert.equal(evaluation.scores[2].level, 3); // カメラON 77%（4）・発言（4）・参加を促す声かけなし（1）の平均
  assert.equal(evaluation.scores[4].level, 3);
  const text = JSON.stringify(evaluation);
  for (const banned of ['テスト生徒一郎', 'テスト生徒二子', '電圧は電流かける抵抗']) assert.equal(text.includes(banned), false, banned);
});

test('話者が先生だけでも、生徒の参加は参加を促す声かけとカメラで見る', () => {
  const teacherOnly = analyzeTranscript({ cues: cues.map(cue => ({ ...cue, speaker: 'ROOM' })), rules, teacherNames: ['山田先生'] });
  assert.equal(teacherOnly.speaker_count, 1);
  const evaluation = evaluateLesson({ transcript: teacherOnly, camera: null, rules });
  const participation = evaluation.scores.find(score => score.criterion === '生徒の参加')!;
  assert.equal(participation.level, 1); // 声かけなし・カメラの記録なし
  assert.match(participation.comment, /区別できませんでした/);
  const withCamera = evaluateLesson({ transcript: teacherOnly, camera: { students: 3, camera_minutes: 60, present_minutes: 200, off_students: 2 }, rules });
  assert.equal(withCamera.scores.find(score => score.criterion === '生徒の参加')!.level, 2); // 30%（2）と声かけ（1）の平均を四捨五入
});

test('使わない観点は出さず、設定の読めない言葉は外す', () => {
  const rubric = normalizeRubric([{ criterion: '導入', enabled: false }, { criterion: 'ほか', enabled: true }]);
  assert.equal(rubric.length, 6);
  const evaluation = evaluateLesson({ transcript: analysis, camera: null, rules, rubric });
  assert.equal(evaluation.scores.some(score => score.criterion === '導入'), false);
  assert.equal(evaluation.strengths.some(item => item.text.includes('ねらい')), false);
  const normalized = normalizeLessonAnalysisRules({ question_patterns: ['(', 'どう？'], wait_ok_seconds: 999 });
  assert.deepEqual(normalized.question_patterns, ['どう？']);
  assert.equal(normalized.wait_ok_seconds, 30);
  assert.equal(clockLabel(3725), '01:02:05');
});

test('総合点は判定できた観点の平均を0〜100にする', () => {
  assert.equal(overallScore({ 導入: 4, 発問: 4 }), 100);
  assert.equal(overallScore({ 導入: 1, 発問: 1 }), 0);
  assert.equal(overallScore({ 導入: 2, 発問: 3, 生徒の参加: null, 説明の分かりやすさ: 1, 時間配分: 1 }), 25);
  assert.equal(overallScore({ 生徒の参加: null }), null);
  assert.equal(overallScore(undefined), null);
});

test('既定の言葉の決まりは、すべて正規表現として読める', () => {
  for (const key of ['question_patterns', 'intro_patterns', 'summary_patterns', 'work_patterns', 'checkin_patterns', 'tip_patterns', 'interaction_patterns'] as const) {
    for (const pattern of DEFAULT_LESSON_ANALYSIS_RULES[key]) assert.doesNotThrow(() => new RegExp(pattern, 'u'), `${key}: ${pattern}`);
  }
});

test('アンケートに合わせた項目：考える・書く時間、確かめ、覚え方、参加を促す声かけ', () => {
  const lesson: AnalysisCue[] = [
    { start: 0, end: 8, speaker: T, text: '今日は地層について学びます。' },
    { start: 10, end: 16, speaker: T, text: 'ここは大事なポイントです。語呂合わせで覚えよう。' },
    { start: 20, end: 26, speaker: T, text: 'では問題を解いてみてください。2分でやってみよう。' },
    { start: 86, end: 90, speaker: T, text: '書けた人？もう少し時間いる？' },
    { start: 120, end: 126, speaker: T, text: '答えをチャットに送ってください。' },
    { start: 130, end: 136, speaker: T, text: 'じゃあ答え合わせ。テストによく出るよ。' },
    { start: 560, end: 590, speaker: T, text: '最後にまとめです。今日のポイントをもう一度。' },
  ];
  const result = analyzeTranscript({ cues: lesson, rules, teacherNames: ['山田先生'], durationSec: 600 });
  assert.equal(result.summary.work_prompts, 1);
  assert.equal(result.work_prompts[0].work_seconds, 60 + 30 + 70); // 26〜86・90〜120・136〜206（促してから180秒の窓の終わりまで）
  assert.equal(result.summary.checkins, 1);
  assert.equal(result.summary.tips, 3); // 10秒・130秒・560秒（30秒以内の重なりは1回）
  assert.equal(result.summary.interactions, 1);
  assert.equal(result.silences.filter(item => item.during_work).length >= 1, true);
  const evaluation = evaluateLesson({ transcript: result, camera: null, rules });
  const work = evaluation.scores.find(score => score.criterion === '考える・書く時間')!;
  assert.equal(work.level, 4); // 60分あたり17分（4）
  assert.match(work.comment, /確かめは1回/);
  const explanation = evaluation.scores.find(score => score.criterion === '説明の分かりやすさ')!;
  assert.match(explanation.comment, /覚え方・大事なポイントを示す言葉は3回/);
  assert.ok(explanation.evidence.some(item => item.quote.includes('語呂合わせ')));
});

test('続けて言い直した問いかけは1回と数える', () => {
  const merged = analyzeTranscript({
    cues: [
      { start: 0, end: 4, speaker: T, text: 'これは何でしょうか？' },
      { start: 5, end: 8, speaker: T, text: 'わかる人？' },
      { start: 12, end: 14, speaker: 'テスト生徒一郎', text: 'はい' },
    ],
    rules, teacherNames: ['山田先生'],
  });
  assert.equal(merged.questions.length, 1);
  assert.equal(merged.questions[0].wait_seconds, 4);
  assert.equal(merged.questions[0].student_answered, true);
});

test('話す速さが目安を超えて30秒以上続いた区間を見つける', () => {
  const row = (t_sec: number, wpm: number | null) => ({ t_sec, wpm, teacher_talk_ratio: 1, student_talk_ratio: 0, student_turns: 0 });
  const stretches = fastStretches([row(0, 500), row(10, 520), row(20, 480), row(30, 300), row(40, 600), row(50, 600)], 450);
  assert.deepEqual(stretches, [{ start: 0, end: 30, wpm: 500 }]);
});
