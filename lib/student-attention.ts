/**
 * 声かけの優先順位（講師の「声かけリスト」）。
 *
 * 出席・授業のカメラ・宿題・小テスト・AI学習クエスト・ログイン・質問の記録から、生徒ごとに「声をかける理由」を挙げ、
 * 理由ごとの点数の合計で並べる。判定はすべてルールで、理由と根拠を画面にそのまま出す。
 * AIの退塾予測は参考として小さく加点するだけにする。
 *
 * 対応済みにした理由は、根拠（fingerprint）が変わるまで出さない。
 * 例：2週連続の未参加を「声かけ済み」にしても、3週目も参加がなければ再び出る。
 */

import { cameraOffStreak, type CameraLesson, type CameraMonitorRule } from './camera-time';

export type AttentionSignalKey =
  | 'question_waiting'
  | 'missed_streak'
  | 'participation_drop'
  | 'camera_off_streak'
  | 'homework_low'
  | 'monoxer_stalled'
  | 'quiz_low'
  | 'quest_struggle'
  | 'login_gap'
  | 'ai_churn';

export type AttentionCategory = 'contact' | 'attendance' | 'homework' | 'learning' | 'app';

export type AttentionSignal = {
  key: AttentionSignalKey;
  category: AttentionCategory;
  points: number;
  label: string;
  detail: string;
  fingerprint: string;
  /** false の理由は対応済みにできない（返信など、元の操作をすると消える）。 */
  resolvable: boolean;
};

export type AttentionBand = 'urgent' | 'this_week' | 'watch';

export type AttentionWeek = { start: string; end: string; current: boolean; expected: boolean; attended: boolean };

export type AttentionResolution = {
  fingerprint: string;
  status: 'contacted' | 'watch';
  note?: string;
  actor_name?: string;
  at?: string | null;
};

export type AttentionInput = {
  todayKey: string;
  weeks: AttentionWeek[];
  unreadQuestions: number;
  /** 直近4週の宿題（Monoxer以外の記録）。日付と完了したか。 */
  homework: Array<{ date: string; completed: boolean }>;
  quizzes: Array<{ date: string; completed: boolean; score: number | null }>;
  /** Monoxer 取り込み履歴（古い順）。gained が null は比較できなかった回。 */
  monoxerHistory: Array<{ date: string; gained: number | null }>;
  /** AI学習クエストの解答（古い順）。直近14日分。 */
  questAttempts: Array<{ unitId: string; unitName: string; correct: boolean; date: string }>;
  lastLogin: string | null;
  /** 授業ごとのカメラの記録（古い順。Zoom から毎晩読む）。cameraRule がないか無効なら見ない。 */
  cameraLessons?: CameraLesson[];
  cameraRule?: CameraMonitorRule;
  churnRisk: number | null;
  riskAnalyzedAt: string | null;
  /**
   * 移行期間（旧システムと併用中）。ログイン・参加の記録が少ないのは移行が途中だからなので、
   * ログインは並び順に入れず、出席は「アプリで参加が定着している生徒」だけを控えめに見る。
   */
  transition?: boolean;
};

const DAY_MS = 24 * 60 * 60 * 1000;
const parseKey = (key: string) => {
  const m = String(key || '').match(/^(\d{4})-(\d{2})-(\d{2})/);
  return m ? Date.UTC(Number(m[1]), Number(m[2]) - 1, Number(m[3])) : NaN;
};
export const daysBetween = (fromKey: string, toKey: string) => Math.round((parseKey(toKey) - parseKey(fromKey)) / DAY_MS);
const md = (key: string) => {
  const t = parseKey(key);
  if (Number.isNaN(t)) return key;
  const d = new Date(t);
  return `${d.getUTCMonth() + 1}/${d.getUTCDate()}`;
};

export const SIGNAL_LABELS: Record<AttentionSignalKey, string> = {
  question_waiting: '質問に未返信',
  missed_streak: '授業に続けて不参加',
  participation_drop: '参加が減っている',
  camera_off_streak: '授業で続けてカメラがオフ',
  homework_low: '宿題の提出が少ない',
  monoxer_stalled: 'Monoxerの学習が止まっている',
  quiz_low: '小テストが不調',
  quest_struggle: '同じ単元で続けて不正解',
  login_gap: 'アプリを開いていない',
  ai_churn: 'AI予測（参考）',
};

/** 完了した週のうち、授業があった週（expected）だけを古い順に返す。 */
const completedExpected = (weeks: AttentionWeek[]) => weeks.filter(week => !week.current && week.expected);

export function computeAttentionSignals(input: AttentionInput): AttentionSignal[] {
  const signals: AttentionSignal[] = [];
  const today = input.todayKey;

  if (input.unreadQuestions > 0) {
    signals.push({
      key: 'question_waiting', category: 'contact', points: 40,
      label: SIGNAL_LABELS.question_waiting,
      detail: `生徒からのメッセージが${input.unreadQuestions}件、未読のままです。`,
      fingerprint: `unread:${input.unreadQuestions}`,
      resolvable: false,
    });
  }

  // 出席：授業があった週だけを数える（休講週・講習の切り替えで誤って出さない）。
  const expected = completedExpected(input.weeks);
  let streak = 0;
  for (let i = expected.length - 1; i >= 0; i -= 1) {
    if (expected[i].attended) break;
    streak += 1;
  }
  // 授業ボタンで参加したことがない生徒（教室で受けている・まだアプリを使っていない）は、
  // 参加の記録から出欠を判断できないので、出席の理由は出さない。
  // 移行期間は、アプリで3週以上参加している（定着している）生徒だけを見る。
  const attendedCount = expected.filter(week => week.attended).length + input.weeks.filter(week => week.current && week.attended).length;
  const judgeable = input.transition ? attendedCount >= 3 : attendedCount >= 1;
  const transitionNote = input.transition ? '（移行期間のため、アプリ以外から参加している可能性もあります）' : '';
  if (judgeable && streak >= 2) {
    const first = expected[expected.length - streak];
    signals.push({
      key: 'missed_streak', category: 'attendance',
      points: input.transition ? Math.min(40, 20 + (streak - 2) * 10) : Math.min(60, 35 + (streak - 2) * 15),
      label: `${streak}週続けて授業に不参加`,
      detail: `${md(first.start)}の週から、授業の参加記録がありません。${transitionNote}`,
      fingerprint: `streak:${first.start}:${Math.min(streak, 4)}`,
      resolvable: true,
    });
  } else if (judgeable && !input.transition && expected.length >= 6) {
    const recent = expected.slice(-4);
    const prior = expected.slice(-8, -4);
    const recentCount = recent.filter(week => week.attended).length;
    const priorRate = prior.length ? prior.filter(week => week.attended).length / prior.length : 0;
    const recentRate = recentCount / recent.length;
    if (prior.length >= 2 && priorRate - recentRate >= 0.5) {
      signals.push({
        key: 'participation_drop', category: 'attendance', points: 20,
        label: SIGNAL_LABELS.participation_drop,
        detail: `直近4週の参加は${recentCount}週。その前（${Math.round(priorRate * 100)}%）より減っています。`,
        fingerprint: `drop:${recent[recent.length - 1].start}`,
        resolvable: true,
      });
    }
  }

  // 授業のカメラ：ON率が低い授業が続いている（カメラを隠してオンにもできるので、オフが続くことだけを見る）。
  const cameraRule = input.cameraRule;
  if (cameraRule?.enabled && input.cameraLessons?.length) {
    const { streak, since } = cameraOffStreak(input.cameraLessons, cameraRule);
    if (streak >= cameraRule.streak_lessons) {
      const extra = streak - cameraRule.streak_lessons;
      signals.push({
        key: 'camera_off_streak', category: 'attendance', points: Math.min(40, 25 + extra * 5),
        label: `${streak}回続けて授業でカメラがオフ`,
        detail: `${md(since)}の授業から${streak}回続けて、カメラのON率が${cameraRule.off_rate_percent}%未満です。授業に入っていても、気持ちが離れている兆しのことがあります。`,
        fingerprint: `camera:${since}:${Math.min(streak, cameraRule.streak_lessons + 2)}`,
        resolvable: true,
      });
    }
  }

  // 宿題（アプリ・取り込みの記録）
  if (input.homework.length >= 2) {
    const done = input.homework.filter(item => item.completed).length;
    const rate = Math.round((done / input.homework.length) * 100);
    if (rate < 70) {
      const lastMissing = input.homework.filter(item => !item.completed).map(item => item.date).sort().pop() || today;
      signals.push({
        key: 'homework_low', category: 'homework', points: rate < 50 ? 25 : 15,
        label: SIGNAL_LABELS.homework_low,
        detail: `直近4週の宿題 ${input.homework.length}回のうち、提出は${done}回（${rate}%）です。`,
        fingerprint: `hw:${lastMissing}`,
        resolvable: true,
      });
    }
  }

  // Monoxer：取り込みのたびに学習回数の増え方を見る。直近で増えていない回が続くほど高く。
  const measured = input.monoxerHistory.filter(entry => entry.gained !== null);
  let stalled = 0;
  for (let i = measured.length - 1; i >= 0; i -= 1) {
    if ((measured[i].gained || 0) > 0) break;
    stalled += 1;
  }
  const latestMeasured = measured[measured.length - 1];
  if (stalled >= 1 && latestMeasured && daysBetween(latestMeasured.date, today) <= 21) {
    const since = measured[measured.length - stalled];
    signals.push({
      key: 'monoxer_stalled', category: 'homework', points: stalled >= 2 ? 25 : 15,
      label: SIGNAL_LABELS.monoxer_stalled,
      detail: stalled >= 2
        ? `${md(since.date)}以降の取り込み${stalled}回とも、Monoxerの学習回数が増えていません。`
        : `${md(latestMeasured.date)}の取り込みで、前回からMonoxerの学習回数が増えていません。`,
      fingerprint: `monoxer:${latestMeasured.date}`,
      resolvable: true,
    });
  }

  // 小テスト
  if (input.quizzes.length >= 2) {
    const done = input.quizzes.filter(item => item.completed).length;
    const rate = Math.round((done / input.quizzes.length) * 100);
    const scores = input.quizzes.map(item => item.score).filter((value): value is number => value !== null);
    const average = scores.length ? Math.round(scores.reduce((sum, value) => sum + value, 0) / scores.length) : null;
    if (rate < 70 || (average !== null && average < 60)) {
      const last = input.quizzes.map(item => item.date).sort().pop() || today;
      signals.push({
        key: 'quiz_low', category: 'learning', points: 15,
        label: SIGNAL_LABELS.quiz_low,
        detail: [
          rate < 70 ? `直近4週の小テスト ${input.quizzes.length}回のうち、実施は${done}回です。` : '',
          average !== null && average < 60 ? `平均点は${average}点です。` : '',
        ].filter(Boolean).join(''),
        fingerprint: `quiz:${last}`,
        resolvable: true,
      });
    }
  }

  // AI学習クエスト：同じ単元の直近3問がすべて不正解。
  const byUnit = new Map<string, Array<{ unitName: string; correct: boolean; date: string }>>();
  input.questAttempts.forEach(item => {
    const key = item.unitId || item.unitName;
    if (!key) return;
    if (!byUnit.has(key)) byUnit.set(key, []);
    byUnit.get(key)!.push(item);
  });
  const struggling = Array.from(byUnit.values())
    .filter(items => items.length >= 3 && items.slice(-3).every(item => !item.correct))
    .map(items => ({ unitName: items[items.length - 1].unitName || '単元', date: items[items.length - 1].date }));
  if (struggling.length) {
    signals.push({
      key: 'quest_struggle', category: 'learning', points: 10,
      label: SIGNAL_LABELS.quest_struggle,
      detail: `AI学習クエストの「${struggling.slice(0, 2).map(item => item.unitName).join('」「')}」で、直近3問が続けて不正解です。`,
      fingerprint: `quest:${struggling.map(item => `${item.unitName}@${item.date}`).sort().join('|')}`,
      resolvable: true,
    });
  }

  // ログイン（移行期間は並び順に入れず、別の「アプリ未利用」一覧で扱う）
  if (input.transition) {
    // 判定しない
  } else if (!input.lastLogin) {
    signals.push({
      key: 'login_gap', category: 'app', points: 20,
      label: 'まだアプリにログインしていない',
      detail: '一度もログインした記録がありません。ID書面が届いているか確認してください。',
      fingerprint: 'login:never',
      resolvable: true,
    });
  } else {
    const gap = daysBetween(input.lastLogin.slice(0, 10), today);
    if (gap >= 14) {
      signals.push({
        key: 'login_gap', category: 'app', points: gap >= 30 ? 25 : 15,
        label: `${gap}日間アプリを開いていない`,
        detail: `最後にログインしたのは${md(input.lastLogin)}です。`,
        fingerprint: `login:${input.lastLogin.slice(0, 10)}:${gap >= 30 ? 30 : 14}`,
        resolvable: true,
      });
    }
  }

  if (input.churnRisk !== null && input.churnRisk >= 70) {
    signals.push({
      key: 'ai_churn', category: 'contact', points: 10,
      label: `AI予測（参考） ${input.churnRisk}%`,
      detail: 'AIの退塾予測です。判断の参考にとどめてください。',
      fingerprint: `ai:${input.riskAnalyzedAt || ''}`,
      resolvable: true,
    });
  }

  return signals.sort((a, b) => b.points - a.points);
}

export function attentionBand(signals: AttentionSignal[]): AttentionBand | null {
  if (!signals.length) return null;
  const score = signals.reduce((sum, signal) => sum + signal.points, 0);
  // AI予測だけでは並べない（ルールで説明できる理由がある生徒だけ）。
  if (signals.every(signal => signal.key === 'ai_churn')) return null;
  if (score >= 50 || signals.some(signal => signal.key === 'question_waiting')) return 'urgent';
  if (score >= 25) return 'this_week';
  return 'watch';
}

/** 対応済みにした理由を、根拠が同じあいだだけ外す。 */
export function splitByResolution(signals: AttentionSignal[], resolutions: Partial<Record<AttentionSignalKey, AttentionResolution>>) {
  const open: AttentionSignal[] = [];
  const handled: Array<AttentionSignal & { resolution: AttentionResolution }> = [];
  signals.forEach(signal => {
    const resolution = resolutions[signal.key];
    if (signal.resolvable && resolution && resolution.fingerprint === signal.fingerprint) handled.push({ ...signal, resolution });
    else open.push(signal);
  });
  return { open, handled };
}

export const attentionScore = (signals: AttentionSignal[]) => signals.reduce((sum, signal) => sum + signal.points, 0);

/** 移行期間に、声かけリストとは別に出す「アプリをまだ使っていない」生徒か。 */
export function onboardingStatus(lastLogin: string | null, todayKey: string): 'never' | 'inactive' | null {
  if (!lastLogin) return 'never';
  return daysBetween(lastLogin.slice(0, 10), todayKey) >= 14 ? 'inactive' : null;
}
