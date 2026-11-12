/**
 * 授業の振り返り（純粋関数だけ。Firestore には触れない）。
 *
 * Zoom の文字起こし（lesson_transcripts に保存済み）と、授業のカメラON率（camera_session_summaries）から、
 * 話し方とやり取りを数値にし、観点ごとのレベルとコメントを決まりで作る。AI は使わない（追加の費用なし・生徒の発言を外に出さない）。
 * - 生徒の名前は「生徒A」などに置き換え、生徒の発言の本文は結果に入れない（根拠の引用は先生の発言だけ）。
 * - 先生の映像の分析はしない（録画は画面共有が中心で、先生の映像がほとんど入っていないため。2026-11-11 に確認）。
 * 映像も含めた試作は worker/lesson-analysis（Python）にある。
 *
 * 判定の決まりは、生徒アンケート（26_理社講座アンケート、2026-03〜11 の64,449件）の自由記述に合わせてある（2026-11-11）：
 *  - いちばん多い不満は「速い」（スライドの切り替え・ノートを書く時間・問題を解く時間が足りない）→「考える・書く時間」を観点に足した。
 *  - よく褒められるのは、分かりやすい説明・途中の問題演習・覚え方（語呂合わせ）・大事なポイント・当てる／チャット・書く時間をくれること
 *    → 覚え方とポイントの言葉、当てる・チャットの声かけ、「書けた人？」などの確認を数える。
 */

export type AnalysisCue = { start: number; end: number; speaker: string; text: string };

export type LessonAnalysisRules = {
  bin_seconds: number;
  question_patterns: string[];
  wait_ok_seconds: number;
  answer_window_seconds: number;
  monologue_gap_seconds: number;
  long_monologue_seconds: number;
  silence_seconds: number;
  intro_patterns: string[];
  intro_good_seconds: number;
  intro_ok_seconds: number;
  intro_late_seconds: number;
  summary_patterns: string[];
  wpm_min: number;
  wpm_max: number;
  questions_per_10min: [number, number, number];
  participation_per_10min: [number, number, number];
  camera_rate_levels: [number, number, number];
  /** 問題を解く・ノートを書くよう促す言い方 */
  work_patterns: string[];
  /** 書けたか・時間が要るかを確かめる言い方 */
  checkin_patterns: string[];
  /** 覚え方・大事なポイントを示す言い方 */
  tip_patterns: string[];
  /** 当てる・チャットで答えてもらうなど、生徒に参加を促す言い方 */
  interaction_patterns: string[];
  /** 促したあと、この秒数以内のだれも話していない時間を「考える・書く時間」として数える */
  work_window_seconds: number;
  /** この秒数以上の間だけを数える（話の切れ目の短い間は入れない） */
  work_min_gap_seconds: number;
  /** 60分あたりの「考える・書く時間」（分）の目安（レベル4・3・2） */
  work_minutes_per_hour: [number, number, number];
  /** 10分あたりの、参加を促す声かけの回数の目安（レベル4・3・2） */
  interaction_per_10min: [number, number, number];
};

export const DEFAULT_LESSON_ANALYSIS_RULES: LessonAnalysisRules = {
  bin_seconds: 10,
  question_patterns: [
    '[？?]', '(ですか|ますか|でしょうか|かな|のか)[。．]?\\s*$', 'どう思う', '(わか|分か)る人', '(知って|しって)る人',
    'どうして', 'なぜ', 'なんで', '答えて', '言ってみて', 'どうなる',
  ],
  wait_ok_seconds: 3,
  answer_window_seconds: 15,
  monologue_gap_seconds: 3,
  long_monologue_seconds: 180,
  silence_seconds: 15,
  intro_patterns: ['今日は', '今日の', 'めあて', '目標', 'ねらい', '学習課題', 'やること', 'について(学|勉強|考え)'],
  intro_good_seconds: 180,
  intro_ok_seconds: 300,
  intro_late_seconds: 600,
  summary_patterns: ['まとめ', '今日のポイント', '振り返', 'ふりかえ', 'おさらい', '今日やった', '復習すると', '大事なところ'],
  wpm_min: 220,
  // 文字起こしの文字数で数えると、実際の授業は400字/分前後になる（11/10 の授業で409・425）。速すぎる区間を見つける目安として450にした
  wpm_max: 450,
  questions_per_10min: [3, 2, 1],
  participation_per_10min: [5, 3, 1],
  // 生徒の参加：授業のカメラON率（%）の目安（レベル4・3・2）
  camera_rate_levels: [70, 50, 30],
  work_patterns: [
    '解いて', '解こう', '解いてみ', '書いて', '書こう', '書き込', 'メモして', 'メモしよう', '写して', 'うつして', '考えて', '考えてみ',
    'やってみ', '取り組', '時間を(とり|取り|あげ)', '[0-9０-９一二三]+分(で|間)', '[0-9０-９]+秒',
  ],
  checkin_patterns: ['書けた', '書けて(ない|いない)', '終わった人', 'できた人', '時間(いる|要る|ほしい|欲しい)', 'もう少し時間', '大丈夫([？?]|かな|ですか)', 'いいですか', 'ついてこれて'],
  tip_patterns: ['語呂', 'ゴロ', 'ごろ合わせ', '覚え方', '覚えよう', '覚えて(ね|おこう|おいて)', 'ポイント', '大事', '重要', 'テストに(出|よく出)', '入試に(出|よく出)', 'ひっかけ', '注意'],
  interaction_patterns: ['チャット', '当て', '指名', '手を挙げ', '手をあげ', '挙手', '発表', '答えて(くれ|もら)', '言ってみて', 'リアクション'],
  work_window_seconds: 180,
  work_min_gap_seconds: 5,
  work_minutes_per_hour: [8, 5, 2],
  interaction_per_10min: [2, 1, 0.5],
};

export type RubricCriterion = { criterion: string; description: string; enabled: boolean };

export const DEFAULT_RUBRIC: RubricCriterion[] = [
  { criterion: '導入', description: 'ねらいが明確に示されたか', enabled: true },
  { criterion: '発問', description: '問いの頻度と待ち時間', enabled: true },
  { criterion: '生徒の参加', description: 'カメラON率・発言・チャットの量', enabled: true },
  { criterion: '説明の分かりやすさ', description: '速さ、一方的な説明が長すぎないか', enabled: true },
  { criterion: '時間配分', description: 'まとめまで到達したか', enabled: true },
  { criterion: '考える・書く時間', description: '問題を解く・ノートを書く時間をとり、書けたか確かめたか', enabled: true },
];

const finiteNumber = (value: unknown, fallback: number, min: number, max: number) => {
  const number = Number(value);
  return Number.isFinite(number) ? Math.min(max, Math.max(min, number)) : fallback;
};

/** 正しく読める正規表現だけ残す（管理画面で入れた言葉の確認）。 */
const patternList = (value: unknown, fallback: string[]) => {
  if (!Array.isArray(value)) return fallback;
  const list = value.map(item => String(item ?? '').trim()).filter(item => item && item.length <= 80).filter(item => {
    try { new RegExp(item, 'u'); return true; } catch { return false; }
  }).slice(0, 40);
  return list.length ? list : fallback;
};

const triple = (value: unknown, fallback: [number, number, number], max: number): [number, number, number] => {
  if (!Array.isArray(value) || value.length !== 3) return fallback;
  const list = value.map((item, index) => finiteNumber(item, fallback[index], 0, max));
  return [list[0], list[1], list[2]];
};

export function normalizeLessonAnalysisRules(value: unknown): LessonAnalysisRules {
  const data = (value && typeof value === 'object' ? value : {}) as Record<string, unknown>;
  const d = DEFAULT_LESSON_ANALYSIS_RULES;
  return {
    bin_seconds: d.bin_seconds,
    question_patterns: patternList(data.question_patterns, d.question_patterns),
    wait_ok_seconds: finiteNumber(data.wait_ok_seconds, d.wait_ok_seconds, 0, 30),
    answer_window_seconds: finiteNumber(data.answer_window_seconds, d.answer_window_seconds, 1, 60),
    monologue_gap_seconds: finiteNumber(data.monologue_gap_seconds, d.monologue_gap_seconds, 0.5, 30),
    long_monologue_seconds: finiteNumber(data.long_monologue_seconds, d.long_monologue_seconds, 30, 1800),
    silence_seconds: finiteNumber(data.silence_seconds, d.silence_seconds, 5, 300),
    intro_patterns: patternList(data.intro_patterns, d.intro_patterns),
    intro_good_seconds: finiteNumber(data.intro_good_seconds, d.intro_good_seconds, 30, 1800),
    intro_ok_seconds: finiteNumber(data.intro_ok_seconds, d.intro_ok_seconds, 30, 1800),
    intro_late_seconds: finiteNumber(data.intro_late_seconds, d.intro_late_seconds, 60, 3600),
    summary_patterns: patternList(data.summary_patterns, d.summary_patterns),
    wpm_min: finiteNumber(data.wpm_min, d.wpm_min, 50, 1000),
    wpm_max: finiteNumber(data.wpm_max, d.wpm_max, 50, 1000),
    questions_per_10min: triple(data.questions_per_10min, d.questions_per_10min, 100),
    participation_per_10min: triple(data.participation_per_10min, d.participation_per_10min, 500),
    camera_rate_levels: triple(data.camera_rate_levels, d.camera_rate_levels, 100),
    work_patterns: patternList(data.work_patterns, d.work_patterns),
    checkin_patterns: patternList(data.checkin_patterns, d.checkin_patterns),
    tip_patterns: patternList(data.tip_patterns, d.tip_patterns),
    interaction_patterns: patternList(data.interaction_patterns, d.interaction_patterns),
    work_window_seconds: finiteNumber(data.work_window_seconds, d.work_window_seconds, 30, 900),
    work_min_gap_seconds: finiteNumber(data.work_min_gap_seconds, d.work_min_gap_seconds, 2, 60),
    work_minutes_per_hour: triple(data.work_minutes_per_hour, d.work_minutes_per_hour, 60),
    interaction_per_10min: triple(data.interaction_per_10min, d.interaction_per_10min, 50),
  };
}

export function normalizeRubric(value: unknown): RubricCriterion[] {
  const saved = Array.isArray(value) ? value : [];
  // 観点は決まりで判定するので、名前は既定の5つに固定し、説明と使う・使わないだけ変えられる。
  return DEFAULT_RUBRIC.map(item => {
    const found = saved.find((entry: any) => String(entry?.criterion) === item.criterion) as Record<string, unknown> | undefined;
    return {
      criterion: item.criterion,
      description: String(found?.description ?? item.description).trim().slice(0, 100) || item.description,
      enabled: found ? found.enabled !== false : true,
    };
  });
}

const normalizeName = (value: string) => String(value || '').normalize('NFKC').replace(/[\s　]+/g, '').toLowerCase();

const letters = (index: number) => {
  let text = '';
  let rest = index + 1;
  while (rest > 0) {
    const mod = (rest - 1) % 26;
    text = String.fromCharCode(65 + mod) + text;
    rest = Math.floor((rest - 1) / 26);
  }
  return text;
};

export const clockLabel = (seconds: number) => {
  const total = Math.max(0, Math.round(seconds));
  const pad = (value: number) => String(value).padStart(2, '0');
  return `${pad(Math.floor(total / 3600))}:${pad(Math.floor((total % 3600) / 60))}:${pad(total % 60)}`;
};

export type TeacherDetection = 'registered_name' | 'most_talk' | 'no_speaker';

export function classifySpeakers(cues: AnalysisCue[], teacherNames: string[]) {
  const talk = new Map<string, number>();
  cues.forEach(cue => {
    if (cue.speaker) talk.set(cue.speaker, (talk.get(cue.speaker) || 0) + Math.max(0, cue.end - cue.start));
  });
  const names = teacherNames.map(normalizeName).filter(Boolean);
  let teachers = new Set(Array.from(talk.keys()).filter(speaker => {
    const key = normalizeName(speaker);
    return key.length >= 2 && names.some(name => name.includes(key) || key.includes(name));
  }));
  let method: TeacherDetection = 'registered_name';
  if (!teachers.size && talk.size) {
    teachers = new Set([Array.from(talk.entries()).sort((a, b) => b[1] - a[1])[0][0]]);
    method = 'most_talk';
  }
  const roles = new Map<string, 'teacher' | 'student'>();
  talk.forEach((_, speaker) => roles.set(speaker, teachers.has(speaker) ? 'teacher' : 'student'));
  return { roles, method: talk.size ? method : 'no_speaker' as TeacherDetection };
}

export type SeriesRow = {
  t_sec: number;
  teacher_talk_ratio: number;
  student_talk_ratio: number;
  wpm: number | null;
  student_turns: number;
};

export type QuestionItem = { time: number; end: number; quote: string; wait_seconds: number | null; student_answered: boolean };
export type Span = { start: number; end: number; seconds: number };
export type SilenceSpan = Span & { during_work: boolean };
export type QuotedMoment = { time: number; quote: string };
/** 問題を解く・書くよう促した発言と、そのあとの考える・書く時間（秒） */
export type WorkPrompt = QuotedMoment & { work_seconds: number };

export type TranscriptAnalysis = {
  duration_sec: number;
  teacher_detection: TeacherDetection;
  speaker_count: number;
  student_aliases: string[];
  summary: {
    teacher_talk_ratio: number | null;
    wpm: number | null;
    questions: number;
    questions_answered: number;
    median_wait_seconds: number | null;
    student_turns: number;
    student_speakers: number;
    longest_monologue: Span | null;
    silence_count: number;
    work_seconds: number;
    work_prompts: number;
    checkins: number;
    tips: number;
    interactions: number;
  };
  series: SeriesRow[];
  questions: QuestionItem[];
  monologues: Span[];
  silences: SilenceSpan[];
  work_prompts: WorkPrompt[];
  checkins: QuotedMoment[];
  tips: QuotedMoment[];
  interactions: QuotedMoment[];
  teacher_cues: { time: number; end: number; text: string }[];
};

const round = (value: number, digits = 1) => Math.round(value * 10 ** digits) / 10 ** digits;
const median = (values: number[]) => {
  if (!values.length) return null;
  const sorted = [...values].sort((a, b) => a - b);
  const middle = Math.floor(sorted.length / 2);
  return round(sorted.length % 2 ? sorted[middle] : (sorted[middle - 1] + sorted[middle]) / 2);
};

export function analyzeTranscript(input: { cues: AnalysisCue[]; rules: LessonAnalysisRules; teacherNames?: string[]; durationSec?: number }): TranscriptAnalysis {
  const { rules } = input;
  const cues = [...input.cues].filter(cue => Number.isFinite(cue.start)).sort((a, b) => a.start - b.start);
  const bin = rules.bin_seconds;
  const { roles, method } = classifySpeakers(cues, input.teacherNames || []);
  const roleOf = (cue: AnalysisCue) => (cue.speaker ? roles.get(cue.speaker) || 'unknown' : 'unknown');
  const lastEnd = cues.reduce((max, cue) => Math.max(max, cue.end), 0);
  const total = Math.max(input.durationSec || 0, lastEnd);
  const bins = total ? Math.max(1, Math.ceil(total / bin)) : 0;

  const aliases = new Map<string, string>();
  cues.forEach(cue => {
    if (roleOf(cue) === 'student' && !aliases.has(cue.speaker)) aliases.set(cue.speaker, `生徒${letters(aliases.size)}`);
  });

  const teacherSeconds = new Array(bins).fill(0);
  const teacherChars = new Array(bins).fill(0);
  const studentSeconds = new Array(bins).fill(0);
  const studentTurns = new Array(bins).fill(0);
  cues.forEach(cue => {
    const role = roleOf(cue);
    const length = Math.max(0, cue.end - cue.start);
    const first = Math.max(0, Math.floor(cue.start / bin));
    const last = Math.min(bins - 1, Math.floor(Math.max(cue.start, cue.end - 1e-6) / bin));
    for (let index = first; index <= last; index += 1) {
      const share = Math.max(0, Math.min(cue.end, (index + 1) * bin) - Math.max(cue.start, index * bin));
      if (role === 'teacher') {
        teacherSeconds[index] += share;
        teacherChars[index] += cue.text.length * (length ? share / length : 1);
      } else if (role === 'student') {
        studentSeconds[index] += share;
      }
    }
  });

  // 同じ生徒の続けての発言（間が1.5秒未満）は1回と数える
  let studentTurnTotal = 0;
  let previous: AnalysisCue | null = null;
  cues.forEach(cue => {
    const same = previous && previous.speaker === cue.speaker && cue.start - previous.end < 1.5;
    if (roleOf(cue) === 'student' && !same) {
      studentTurnTotal += 1;
      const index = Math.floor(cue.start / bin);
      if (index >= 0 && index < bins) studentTurns[index] += 1;
    }
    previous = cue;
  });

  const patterns = rules.question_patterns.map(pattern => new RegExp(pattern, 'u'));
  const questions: QuestionItem[] = [];
  cues.forEach((cue, index) => {
    if (roleOf(cue) !== 'teacher' || !patterns.some(pattern => pattern.test(cue.text))) return;
    const following = cues.slice(index + 1).find(other => other.start >= cue.end - 0.2) || null;
    const wait = following ? Math.max(0, following.start - cue.end) : null;
    // 10秒以内に続けた問いかけ（言い直し・付け足し）は1回と数え、待ち時間は最後の問いかけから測る
    const last = questions[questions.length - 1];
    if (last && cue.start - last.end < 10) {
      last.end = cue.end;
      last.wait_seconds = wait === null ? null : round(wait);
      last.student_answered = Boolean(following && roleOf(following) === 'student' && following.start - cue.end <= rules.answer_window_seconds);
      return;
    }
    questions.push({
      time: cue.start,
      end: cue.end,
      quote: cue.text.slice(0, 120),
      wait_seconds: wait === null ? null : round(wait),
      student_answered: Boolean(following && roleOf(following) === 'student' && following.start - cue.end <= rules.answer_window_seconds),
    });
  });

  // 先生が続けて話した区間（生徒の発言をはさまず、間が monologue_gap 秒未満）
  const spans: Span[] = [];
  let open: { start: number; end: number } | null = null;
  cues.forEach(cue => {
    const role = roleOf(cue);
    if (role !== 'teacher') {
      if (role === 'student' && open) { spans.push({ ...open, seconds: open.end - open.start }); open = null; }
      return;
    }
    if (open && cue.start - open.end < rules.monologue_gap_seconds) open.end = Math.max(open.end, cue.end);
    else {
      if (open) spans.push({ ...open, seconds: open.end - open.start });
      open = { start: cue.start, end: cue.end };
    }
  });
  if (open) spans.push({ ...(open as { start: number; end: number }), seconds: (open as { start: number; end: number }).end - (open as { start: number; end: number }).start });
  const longest = spans.reduce<Span | null>((best, span) => (!best || span.seconds > best.seconds ? span : best), null);

  // だれも話していない間（短い間も含めて集める）
  const gaps: Span[] = [];
  let cursor = 0;
  cues.forEach(cue => {
    if (cue.start - cursor >= rules.work_min_gap_seconds) gaps.push({ start: cursor, end: cue.start, seconds: cue.start - cursor });
    cursor = Math.max(cursor, cue.end);
  });

  // 考える・書く時間：問題を解く・書くよう促した発言から work_window 秒のうち、だれも話していない間の合計
  const teacherOnly = cues.filter(cue => roleOf(cue) === 'teacher');
  const matching = (list: string[]) => {
    const compiled = list.map(pattern => new RegExp(pattern, 'u'));
    return teacherOnly.filter(cue => compiled.some(pattern => pattern.test(cue.text)));
  };
  const workCues = matching(rules.work_patterns);
  const windows: { start: number; end: number; cue: AnalysisCue }[] = [];
  workCues.forEach(cue => {
    const last = windows[windows.length - 1];
    if (last && cue.start <= last.end) last.end = Math.max(last.end, cue.end + rules.work_window_seconds);
    else windows.push({ start: cue.end, end: cue.end + rules.work_window_seconds, cue });
  });
  const overlap = (gap: Span, window: { start: number; end: number }) => Math.max(0, Math.min(gap.end, window.end) - Math.max(gap.start, window.start));
  const workPrompts: WorkPrompt[] = windows.map(window => ({
    time: window.cue.start,
    quote: window.cue.text.slice(0, 120),
    work_seconds: round(gaps.reduce((sum, gap) => sum + overlap(gap, window), 0)),
  }));
  const workSeconds = workPrompts.reduce((sum, item) => sum + item.work_seconds, 0);
  const quoted = (list: AnalysisCue[]) => {
    // 30秒以内に続いた同じ種類の言葉は1回と数える
    const result: QuotedMoment[] = [];
    list.forEach(cue => {
      const last = result[result.length - 1];
      if (!last || cue.start - last.time >= 30) result.push({ time: cue.start, quote: cue.text.slice(0, 120) });
    });
    return result;
  };
  const checkins = quoted(matching(rules.checkin_patterns));
  const tips = quoted(matching(rules.tip_patterns));
  const interactions = quoted(matching(rules.interaction_patterns));

  const silences: SilenceSpan[] = gaps.filter(gap => gap.seconds >= rules.silence_seconds).map(gap => ({
    start: round(gap.start),
    end: round(gap.end),
    seconds: round(gap.seconds),
    during_work: windows.some(window => overlap(gap, window) > 0),
  }));

  const teacherTotal = teacherSeconds.reduce((sum, value) => sum + value, 0);
  const charTotal = teacherChars.reduce((sum, value) => sum + value, 0);
  const span = (item: Span): Span => ({ start: round(item.start), end: round(item.end), seconds: round(item.seconds) });
  return {
    duration_sec: round(total),
    teacher_detection: method,
    speaker_count: roles.size,
    student_aliases: Array.from(aliases.values()),
    summary: {
      teacher_talk_ratio: total ? round(teacherTotal / total, 3) : null,
      wpm: teacherTotal >= 10 ? Math.round((charTotal / teacherTotal) * 60) : null,
      questions: questions.length,
      questions_answered: questions.filter(item => item.student_answered).length,
      median_wait_seconds: median(questions.map(item => item.wait_seconds).filter((value): value is number => value !== null)),
      student_turns: studentTurnTotal,
      student_speakers: aliases.size,
      longest_monologue: longest ? span(longest) : null,
      silence_count: silences.filter(item => !item.during_work).length,
      work_seconds: round(workSeconds),
      work_prompts: workPrompts.length,
      checkins: checkins.length,
      tips: tips.length,
      interactions: interactions.length,
    },
    series: Array.from({ length: bins }, (_, index) => ({
      t_sec: index * bin,
      teacher_talk_ratio: round(Math.min(1, teacherSeconds[index] / bin), 3),
      student_talk_ratio: round(Math.min(1, studentSeconds[index] / bin), 3),
      // 話す速さは、その10秒に2秒以上話したときだけ（短いと値がぶれる）
      wpm: teacherSeconds[index] >= 2 ? Math.round((teacherChars[index] / teacherSeconds[index]) * 60) : null,
      student_turns: studentTurns[index],
    })),
    questions,
    monologues: spans.filter(item => item.seconds >= rules.long_monologue_seconds).map(span),
    silences,
    work_prompts: workPrompts,
    checkins,
    tips,
    interactions,
    teacher_cues: cues.filter(cue => roleOf(cue) === 'teacher').map(cue => ({ time: cue.start, end: cue.end, text: cue.text })),
  };
}

/** 授業のカメラON率（授業ボタンから入った生徒の分）。 */
export type LessonCameraInput = { students: number; camera_minutes: number; present_minutes: number; off_students: number };

export type Evidence = { time: string; t_sec: number; quote: string };
export type ScoreItem = { criterion: string; level: number | null; comment: string; evidence: Evidence[] };
export type LessonEvaluation = {
  summary: string;
  scores: ScoreItem[];
  strengths: { text: string; time: string; t_sec: number }[];
  improvements: { text: string; time: string; t_sec: number; suggestion: string }[];
  notable_moments: { time: string; t_sec: number; description: string }[];
};

const levelOf = (value: number, thresholds: [number, number, number]) => (value >= thresholds[0] ? 4 : value >= thresholds[1] ? 3 : value >= thresholds[2] ? 2 : 1);
const shortQuote = (text: string) => (text.length <= 60 ? text : `${text.slice(0, 60)}…`);
const evidence = (time: number, quote: string): Evidence => ({ time: clockLabel(time), t_sec: Math.round(time), quote: shortQuote(quote) });

/**
 * 観点ごとのレベル（1〜4）・コメント・時刻つきの根拠を、決まりで作る。
 * 判定の材料がない観点（例：カメラの記録も生徒の発言もない「生徒の参加」）は level を null にして、そう書く。
 */
export function evaluateLesson(input: {
  transcript: TranscriptAnalysis;
  camera: LessonCameraInput | null;
  rules: LessonAnalysisRules;
  rubric?: RubricCriterion[];
}): LessonEvaluation {
  const { transcript, camera, rules } = input;
  const rubric = (input.rubric || DEFAULT_RUBRIC).filter(item => item.enabled);
  const cues = transcript.teacher_cues;
  const summary = transcript.summary;
  const duration = transcript.duration_sec || 0;
  const per10 = (count: number) => count / Math.max(duration / 600, 0.1);
  const scores: ScoreItem[] = [];
  const strengths: LessonEvaluation['strengths'] = [];
  const improvements: LessonEvaluation['improvements'] = [];
  const findCue = (patterns: string[], from = 0, to = Infinity) => {
    const compiled = patterns.map(pattern => new RegExp(pattern, 'u'));
    return cues.find(cue => cue.time >= from && cue.time < to && compiled.some(pattern => pattern.test(cue.text))) || null;
  };
  const enabled = new Set(rubric.map(item => item.criterion));
  const add = (item: ScoreItem, good: string | null, tip: [string, string] | null, at: number | null) => {
    scores.push(item);
    // 使わない観点は、良かった点・改善のヒントにも出さない
    if (!enabled.has(item.criterion)) return;
    if (item.level !== null && item.level >= 3 && good && at !== null) strengths.push({ text: good, time: clockLabel(at), t_sec: Math.round(at) });
    if (item.level !== null && item.level <= 2 && tip) improvements.push({ text: tip[0], time: clockLabel(at ?? 0), t_sec: Math.round(at ?? 0), suggestion: tip[1] });
  };

  // 導入
  const intro = findCue(rules.intro_patterns, 0, rules.intro_late_seconds);
  if (intro) {
    const level = intro.time <= rules.intro_good_seconds ? 4 : intro.time <= rules.intro_ok_seconds ? 3 : 2;
    add({ criterion: '導入', level, comment: `${clockLabel(intro.time)}に、ねらいを示す言葉がありました。`, evidence: [evidence(intro.time, intro.text)] },
      '授業のはじめに、今日のねらいを示しています。', ['ねらいを示すのが少し遅めでした。', '最初の3分以内に「今日は〜ができるようになる」と伝えてみてください。'], intro.time);
  } else {
    add({ criterion: '導入', level: 1, comment: `最初の${Math.round(rules.intro_late_seconds / 60)}分に、ねらいやめあてを示す言葉が見つかりませんでした。`, evidence: [] },
      null, ['ねらいを示す言葉が見つかりませんでした。', '授業のはじめに、今日のねらい・めあてを言葉で伝えてみてください。'], 0);
  }

  // 発問
  const questions = transcript.questions;
  const waited = questions.filter(item => item.wait_seconds !== null && item.wait_seconds >= rules.wait_ok_seconds);
  const waitShare = questions.length ? waited.length / questions.length : 0;
  let questionLevel = levelOf(per10(questions.length), rules.questions_per_10min);
  if (questionLevel >= 3 && waitShare < 0.3) questionLevel -= 1;
  const short = questions.filter(item => item.wait_seconds !== null).sort((a, b) => (a.wait_seconds as number) - (b.wait_seconds as number)).slice(0, 2);
  const picked = Array.from(new Map([...waited.slice(0, 2), ...short].map(item => [item.time, item])).values()).sort((a, b) => a.time - b.time).slice(0, 3);
  add({
    criterion: '発問',
    level: questionLevel,
    comment: `問いかけは${questions.length}回（10分あたり${per10(questions.length).toFixed(1)}回）。${rules.wait_ok_seconds}秒以上待てたのは${waited.length}回（${Math.round(waitShare * 100)}%）、`
      + `待ち時間の中央値は${summary.median_wait_seconds ?? '—'}秒です。`,
    evidence: picked.map(item => evidence(item.time, item.quote)),
  },
  waited.length ? '問いかけのあと、生徒が考える時間をとれています。' : '問いかけを多く入れています。',
  questions.length
    ? ['問いかけのあとの待ち時間が短めです。', '問いかけたら、心の中で3つ数えてから次に進んでみてください。']
    : ['問いかけがほとんどありませんでした。', '説明の区切りごとに、生徒に1つ問いかけてみてください。'],
  questionLevel >= 3 && waited.length ? waited[0].time : short[0]?.time ?? questions[0]?.time ?? null);

  // 生徒の参加（カメラON率が中心。文字起こしで生徒の発言を区別できたときは、その回数も見る）
  const cameraRate = camera && camera.present_minutes > 0 ? Math.round((Math.min(camera.camera_minutes, camera.present_minutes) / camera.present_minutes) * 100) : null;
  const turnLevel = transcript.student_aliases.length ? levelOf(per10(summary.student_turns), rules.participation_per_10min) : null;
  const cameraLevel = cameraRate !== null ? levelOf(cameraRate, rules.camera_rate_levels) : null;
  // 当てる・チャットで答えてもらうなどの声かけ（アンケートで「当ててくれた」「チャットで答えられた」が好評）
  const interactionLevel = levelOf(per10(summary.interactions), rules.interaction_per_10min);
  const levels = [cameraLevel, turnLevel, interactionLevel].filter((value): value is number => value !== null);
  const participationLevel = levels.length ? Math.round(levels.reduce((sum, value) => sum + value, 0) / levels.length) : null;
  const busiest = [...transcript.series].filter(row => row.student_turns > 0).sort((a, b) => b.student_turns - a.student_turns).slice(0, 3);
  const lastTeacherBefore = (time: number) => [...cues].reverse().find(cue => cue.time <= time) || null;
  const participationParts = [
    camera ? `授業ボタンから入った生徒${camera.students}人のカメラON率は${cameraRate ?? '—'}%` + (camera.off_students ? `（ほぼオフの生徒${camera.off_students}人）` : '') + 'です。' : 'カメラの記録はありません。',
    transcript.student_aliases.length
      ? `生徒の発言は${summary.student_turns}回（${summary.student_speakers}人）です。`
      : '文字起こしでは生徒の発言を区別できませんでした（話者が先生だけ）。',
    `当てる・チャットなど参加を促す声かけは${summary.interactions}回（10分あたり${per10(summary.interactions).toFixed(1)}回）です。`,
  ];
  add({
    criterion: '生徒の参加',
    level: participationLevel,
    comment: participationLevel === null ? `${participationParts.join('')}判定の材料がないため、レベルは付けていません。` : participationParts.join(''),
    evidence: [
      ...transcript.interactions.slice(0, 2).map(item => evidence(item.time, item.quote)),
      ...busiest.slice(0, 2).map(row => evidence(row.t_sec, lastTeacherBefore(row.t_sec)?.text || '')),
    ],
  },
  '当てたりチャットで答えてもらったりして、生徒が参加する場面をつくっています。',
  ['生徒の参加の様子が少なめでした。', 'アンケートでは「当ててくれた」「チャットで答えられた」が好評です。カメラがオフの生徒もチャットで答えられるよう、問いかけのたびに「チャットに送ってね」と声をかけてみてください。'],
  transcript.interactions[0]?.time ?? busiest[0]?.t_sec ?? 0);

  // 説明の分かりやすさ
  const wpm = summary.wpm;
  const longest = summary.longest_monologue;
  let points = 1;
  if (wpm !== null && wpm >= rules.wpm_min && wpm <= rules.wpm_max) points += 1;
  if (longest && longest.seconds <= (rules.long_monologue_seconds * 5) / 3) points += 1;
  if (longest && longest.seconds <= rules.long_monologue_seconds) points += 1;
  // 覚え方（語呂合わせ）・大事なポイントを示す言葉（アンケートで「分かりやすい」の理由として多い）
  if (summary.tips >= 2) points += 1;
  const longestCue = longest ? cues.find(cue => cue.time >= longest.start && cue.time <= longest.end) || null : null;
  const tooLong = Boolean(longest && longest.seconds > rules.long_monologue_seconds);
  add({
    criterion: '説明の分かりやすさ',
    level: Math.min(4, points),
    comment: `話す速さは${wpm === null ? '—' : `${wpm}字/分`}（目安${rules.wpm_min}〜${rules.wpm_max}）。続けて話した最長は`
      + (longest ? `${clockLabel(longest.start)}からの${(longest.seconds / 60).toFixed(1)}分です。` : '記録がありません。')
      + `覚え方・大事なポイントを示す言葉は${summary.tips}回です。`,
    evidence: [
      ...(longest && longestCue ? [evidence(longest.start, longestCue.text)] : []),
      ...transcript.tips.slice(0, 2).map(item => evidence(item.time, item.quote)),
    ],
  },
  summary.tips >= 2 ? '覚え方や大事なポイントを言葉にして示しています。' : '説明を区切りながら進めています。',
  tooLong
    ? ['一方的な説明が長く続いた場面がありました。', '3分を目安に区切り、問いかけや確認を1つはさんでみてください。']
    : ['話す速さが目安から外れていました。', '大事なところは少しゆっくり話してみてください。'],
  longest?.start ?? null);

  // 考える・書く時間（アンケートでいちばん多い声は「速い」「書く時間・解く時間がほしい」）
  const workMinutes = summary.work_seconds / 60;
  const workPerHour = workMinutes / Math.max(duration / 3600, 0.1);
  let workLevel = levelOf(workPerHour, rules.work_minutes_per_hour);
  if (workLevel >= 2 && workLevel < 4 && summary.checkins >= 1) workLevel += 1;
  const longestWork = [...transcript.work_prompts].sort((a, b) => b.work_seconds - a.work_seconds).slice(0, 2).sort((a, b) => a.time - b.time);
  add({
    criterion: '考える・書く時間',
    level: workLevel,
    comment: `問題を解く・書くよう促したのは${summary.work_prompts}回、そのあとの考える・書く時間は合計${workMinutes.toFixed(1)}分（60分あたり${workPerHour.toFixed(1)}分）。`
      + `「書けた人？」など、書けたか・時間が要るかの確かめは${summary.checkins}回です。`,
    evidence: [
      ...longestWork.map(item => evidence(item.time, `${item.quote}（このあと${Math.round(item.work_seconds)}秒）`)),
      ...transcript.checkins.slice(0, 1).map(item => evidence(item.time, item.quote)),
    ],
  },
  summary.checkins ? '問題を解く・書く時間をとり、書けたかを確かめています。' : '問題を解く・ノートを書く時間をとっています。',
  ['考える・書く時間が少なめでした。', 'アンケートでいちばん多い声は「速い」「ノートを書く時間・問題を解く時間がほしい」です。スライドを進める前に「書けた人？」と確かめ、問題には1〜2分の時間をとってみてください。'],
  longestWork[0]?.time ?? transcript.work_prompts[0]?.time ?? null);

  // 時間配分
  const tail = duration - 600;
  const wrap = findCue(rules.summary_patterns, Math.max(0, tail));
  if (wrap) {
    add({ criterion: '時間配分', level: wrap.time <= duration - 120 ? 4 : 3, comment: `${clockLabel(wrap.time)}に、まとめに入る言葉がありました。`, evidence: [evidence(wrap.time, wrap.text)] },
      '終わりの時間までに、まとめに入れています。', ['まとめが終わりぎりぎりでした。', '終わりの5分前には、まとめに入ってみてください。'], wrap.time);
  } else {
    const earlier = findCue(rules.summary_patterns, Math.max(0, duration - 1200), Math.max(0, tail));
    add({
      criterion: '時間配分',
      level: earlier ? 2 : 1,
      comment: `最後の10分に、まとめに入る言葉が見つかりませんでした。${earlier ? `${clockLabel(earlier.time)}にそれらしい言葉があります。` : ''}`,
      evidence: earlier ? [evidence(earlier.time, earlier.text)] : [],
    }, null, ['まとめの場面が見つかりませんでした。', '最後に「今日のポイントは〜」と、まとめを言葉にしてみてください。'], Math.max(0, tail));
  }

  const ordered = rubric.map(item => scores.find(score => score.criterion === item.criterion)).filter((item): item is ScoreItem => Boolean(item));
  const moments: LessonEvaluation['notable_moments'] = [
    ...transcript.silences.filter(item => !item.during_work).slice(0, 3).map(item => ({ time: clockLabel(item.start), t_sec: Math.round(item.start), description: `${Math.round(item.seconds)}秒、だれも話していない時間がありました（画面での作業などかもしれません）。` })),
    ...longestWork.slice(0, 1).filter(item => item.work_seconds >= 30).map(item => ({ time: clockLabel(item.time), t_sec: Math.round(item.time), description: `問題を解く・書く時間を${Math.round(item.work_seconds)}秒とりました。` })),
    ...fastStretches(transcript.series, rules.wpm_max).slice(0, 2).map(item => ({ time: clockLabel(item.start), t_sec: item.start, description: `${Math.round((item.end - item.start) / 60 * 10) / 10}分ほど、話す速さが目安より速い区間がありました（平均${item.wpm}字/分）。` })),
    ...transcript.monologues.slice(0, 2).map(item => ({ time: clockLabel(item.start), t_sec: Math.round(item.start), description: `先生が${(item.seconds / 60).toFixed(1)}分続けて話しました。` })),
    ...busiest.slice(0, 2).map(row => ({ time: clockLabel(row.t_sec), t_sec: row.t_sec, description: '生徒の発言が増えました。' })),
  ].sort((a, b) => a.t_sec - b.t_sec);
  const low = ordered.filter(item => item.level !== null && item.level <= 2).map(item => item.criterion);
  return {
    summary: [
      `${Math.round(duration / 60)}分の授業で、先生が話していた割合は${Math.round((summary.teacher_talk_ratio || 0) * 100)}%でした。`,
      `問いかけは${summary.questions}回、続けて話した最長は${longest ? `${(longest.seconds / 60).toFixed(1)}分` : '—'}` + (cameraRate !== null ? `、生徒のカメラON率は${cameraRate}%です。` : 'です。'),
      low.length ? `振り返りのポイントは「${low.slice(0, 2).join('」「')}」です。` : 'どの観点も目安に届いています。',
    ].join(''),
    scores: ordered,
    strengths,
    improvements,
    notable_moments: moments,
  };
}

/**
 * 総合点（0〜100）。レベルを付けられた観点の平均を、レベル1＝0点・レベル4＝100点にならして出す。
 * 判定なし（null）の観点は数えない。1つも判定できなければ null。
 */
export function overallScore(levels: Record<string, number | null | undefined> | null | undefined) {
  const values = Object.values(levels || {}).filter((value): value is number => typeof value === 'number' && value >= 1 && value <= 4);
  if (!values.length) return null;
  const average = values.reduce((sum, value) => sum + value, 0) / values.length;
  return Math.round(((average - 1) / 3) * 100);
}

/** 話す速さが目安を超えた10秒が3つ以上（30秒以上）続いた区間。長い順。 */
export function fastStretches(series: SeriesRow[], wpmMax: number) {
  const result: { start: number; end: number; wpm: number }[] = [];
  let run: SeriesRow[] = [];
  const flush = () => {
    if (run.length >= 3) {
      const values = run.map(row => row.wpm as number);
      result.push({ start: run[0].t_sec, end: run[run.length - 1].t_sec + 10, wpm: Math.round(values.reduce((sum, value) => sum + value, 0) / values.length) });
    }
    run = [];
  };
  series.forEach(row => {
    if (row.wpm !== null && row.wpm > wpmMax) run.push(row);
    else flush();
  });
  flush();
  return result.sort((a, b) => (b.end - b.start) - (a.end - a.start));
}

export type LessonEvent = { t_sec: number; type: 'question' | 'long_monologue' | 'silence'; detail: Record<string, unknown> };

/** グラフに印を付ける出来事（問いかけ・長い説明・沈黙）。 */
export function lessonEvents(transcript: TranscriptAnalysis): LessonEvent[] {
  return [
    ...transcript.questions.map(item => ({ t_sec: round(item.time), type: 'question' as const, detail: { wait_seconds: item.wait_seconds, student_answered: item.student_answered, quote: shortQuote(item.quote) } })),
    ...transcript.monologues.map(item => ({ t_sec: item.start, type: 'long_monologue' as const, detail: { seconds: item.seconds } })),
    ...transcript.silences.map(item => ({ t_sec: item.start, type: 'silence' as const, detail: { seconds: item.seconds } })),
  ].sort((a, b) => a.t_sec - b.t_sec);
}
