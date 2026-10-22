import 'server-only';
import { Timestamp } from 'firebase-admin/firestore';
import { adminDb } from '@/lib/firebase-admin';
import { studySummaryForRange } from '@/lib/monoxer-study';
import { learningCompleted, numericScore } from '@/lib/pf-analytics';
import { loadLessonDays } from '@/lib/server/parent-learning-history';
import { buildReportSummary, isDateInMonth, isInJstMonth, jstMonthKey, jstMonthRange, shiftMonthKey, summarizeAttendanceMonth, type JstMonthRange } from '@/lib/server/parent-monthly-report-core';

/**
 * 保護者向け「月ごとの学習レポート」を組み立てる。
 * 項目ごとに別々に読み、1つが失敗しても他の項目は返す（失敗した項目は ok:false）。
 * どの読み込みも件数の上限つき、件数だけでよいものは count() 集計。
 */

const clean = (value: unknown, max = 200) => String(value ?? '').normalize('NFKC').trim().slice(0, max);
const millis = (value: any) => value?.toMillis?.() || value?.toDate?.()?.getTime?.() || (value ? new Date(value).getTime() : 0) || 0;

// 上限（1か月＋比較用の前の月ぶん）
const ATTENDANCE_LIMIT = 70; // 出席は1日1件。2か月は最大62日
const REQUEST_LIMIT = 60;
const VIEW_LIMIT = 300;
const QUIZ_LIMIT = 200;
const QUIZ_FALLBACK_LIMIT = 500;
const QUIZ_LIST_LIMIT = 20;
const COIN_LIMIT = 300;
const CHAT_FALLBACK_LIMIT = 600;

export type Section<T> = { ok: true; data: T } | { ok: false; error: string };

async function section<T>(name: string, run: () => Promise<T>): Promise<Section<T>> {
  try {
    return { ok: true, data: await run() };
  } catch (error) {
    console.warn(`[parent-monthly-report] ${name} failed`, error);
    return { ok: false, error: 'load-failed' };
  }
}

/** 月の終わり（翌月 0:00 の 1ms 前）までを `<=` で切る。 */
const untilTs = (range: JstMonthRange) => Timestamp.fromDate(new Date(range.endMs - 1));
const sinceTs = (range: JstMonthRange) => Timestamp.fromDate(new Date(range.startMs));

async function countOr(query: FirebaseFirestore.Query, fallback: () => Promise<number>) {
  try {
    const snap = await query.count().get();
    return Number(snap.data().count) || 0;
  } catch (error) {
    console.warn('[parent-monthly-report] count fallback', error);
    return fallback();
  }
}

/** 出席：Zoom参加日数・欠席・遅刻・振替（今月と前の月）。 */
async function attendanceSection(studentId: string, range: JstMonthRange, previous: JstMonthRange) {
  const db = adminDb();
  const requests = (type: string) => db.collection('requests')
    .where('user_id', '==', studentId).where('type', '==', type)
    .where('target_date', '>=', previous.startDate).where('target_date', '<=', range.endDate)
    .orderBy('target_date', 'desc').limit(REQUEST_LIMIT).get();
  const [absence, transfer] = await Promise.all([requests('absence'), requests('transfer')]);
  // 録画は「録画」の項目で視聴した時期ごとに数えるので、ここでは最小限（1件）しか読まない。
  const days = await loadLessonDays(studentId, {
    fromDate: previous.startDate, attendanceLimit: ATTENDANCE_LIMIT, viewLimit: 1, viewsSinceFromDate: true, requests: { absence, transfer },
  });
  return { current: summarizeAttendanceMonth(days, range), previous: summarizeAttendanceMonth(days, previous) };
}

/** 録画：その月に見た録画の本数と、実際に再生していた時間（コインの基準は返さない）。 */
async function recordingSection(studentId: string, range: JstMonthRange, previous: JstMonthRange) {
  const views = adminDb().collection('recording_views').where('user_id', '==', studentId);
  let snap: FirebaseFirestore.QuerySnapshot;
  try {
    // 複合インデックス recording_views(user_id, updated_at DESC)。前の月の初めより後に見たものだけ。
    snap = await views.where('updated_at', '>=', sinceTs(previous)).orderBy('updated_at', 'desc').limit(VIEW_LIMIT).get();
  } catch (error) {
    console.warn('[parent-monthly-report] recording_views fallback', error);
    snap = await views.limit(VIEW_LIMIT).get();
  }
  const summarize = (target: JstMonthRange) => {
    let count = 0; let seconds = 0; let completed = 0;
    snap.docs.forEach(doc => {
      const view = doc.data() || {};
      const started = Number(view.started_at_ms) || millis(view.started_at);
      const updated = millis(view.updated_at) || millis(view.completed_at);
      // 1本の録画につき1件の記録なので、見始めた月か、最後に見た月に入れば「その月に見た」とする。
      if (!isInJstMonth(started, target) && !isInJstMonth(updated, target)) return;
      count++;
      seconds += Math.max(0, Number(view.credited_seconds ?? view.watched_seconds) || 0);
      if (clean(view.status, 40) === 'completed') completed++;
    });
    return { count, watched_minutes: Math.round(seconds / 60), completed };
  };
  return { current: summarize(range), previous: summarize(previous), truncated: snap.size >= VIEW_LIMIT };
}

/** 宿題（Monoxer）：取り込みの記録から、その月の学習回数・累計・取り組んだBook数。 */
async function homeworkSection(studentId: string, range: JstMonthRange, previous: JstMonthRange) {
  const snap = await adminDb().collection('pf_study_progress').doc(studentId).get();
  const progress = snap.exists ? snap.data() || {} : null;
  const current = studySummaryForRange(progress, range.startDate, range.endDate);
  const before = studySummaryForRange(progress, previous.startDate, previous.endDate);
  return {
    measured: current.measured,
    period_count: current.period_count,
    previous_period_count: before.period_count,
    total_count: current.total_count,
    books_studied: current.books_studied,
    last_snapshot_date: current.last_snapshot_date,
  };
}

/** 小テスト：その月の記録があれば、受けた数・平均点と一覧（新しい順に20件まで）。無ければ null。 */
async function quizSection(studentId: string, range: JstMonthRange) {
  const records = adminDb().collection('pf_learning_records').where('student_id', '==', studentId);
  let docs: FirebaseFirestore.QueryDocumentSnapshot[];
  try {
    // 複合インデックス pf_learning_records(student_id, date)。
    docs = (await records.where('date', '>=', range.startDate).where('date', '<=', range.endDate).limit(QUIZ_LIMIT).get()).docs;
  } catch (error) {
    console.warn('[parent-monthly-report] pf_learning_records fallback', error);
    docs = (await records.limit(QUIZ_FALLBACK_LIMIT).get()).docs;
  }
  const quizzes = docs.map(doc => doc.data() || {})
    .filter(record => record.kind === 'quiz' && isDateInMonth(clean(record.date, 10), range));
  if (!quizzes.length) return null;
  const scores = quizzes.map(record => numericScore(record.score)).filter((value): value is number => value !== null);
  return {
    total: quizzes.length,
    completed: quizzes.filter(record => record.completed === true || learningCompleted(record.status)).length,
    average_score: scores.length ? Math.round((scores.reduce((sum, value) => sum + value, 0) / scores.length) * 10) / 10 : null,
    records: quizzes
      .sort((a, b) => clean(b.date, 10).localeCompare(clean(a.date, 10)))
      .slice(0, QUIZ_LIST_LIMIT)
      .map(record => ({ date: clean(record.date, 10), title: clean(record.title, 120) || '小テスト', score: numericScore(record.score) })),
  };
}

/** AI学習：その月に質問した回数（count() 集計。複合インデックス chat_history(role, createdAt DESC)）。 */
async function aiSection(studentId: string, range: JstMonthRange, previous: JstMonthRange) {
  const history = adminDb().collection('users').doc(studentId).collection('chat_history');
  const questions = (target: JstMonthRange) => {
    const windowed = history.where('createdAt', '>=', sinceTs(target)).where('createdAt', '<=', untilTs(target));
    return countOr(windowed.where('role', '==', 'user').orderBy('createdAt', 'desc'), async () => {
      const snap = await windowed.select('role').limit(CHAT_FALLBACK_LIMIT).get();
      return snap.docs.filter(doc => doc.data()?.role === 'user').length;
    });
  };
  const [current, before] = await Promise.all([questions(range), questions(previous)]);
  return { questions: current, previous_questions: before };
}

/** コイン：その月に増えたコイン（使った分は含めない）。複合インデックス coin_transactions(user_id, created_at DESC)。 */
async function coinSection(studentId: string, range: JstMonthRange) {
  const snap = await adminDb().collection('coin_transactions')
    .where('user_id', '==', studentId)
    .where('created_at', '>=', sinceTs(range)).where('created_at', '<=', untilTs(range))
    .orderBy('created_at', 'desc').select('amount', 'created_at').limit(COIN_LIMIT).get();
  let earned = 0; let times = 0;
  snap.docs.forEach(doc => {
    const data = doc.data() || {};
    const amount = Number(data.amount) || 0;
    if (amount <= 0 || !isInJstMonth(millis(data.created_at), range)) return;
    earned += amount; times++;
  });
  return { earned, times, truncated: snap.size >= COIN_LIMIT };
}

export async function buildParentMonthlyReport(studentId: string, month: string, nowMs: number) {
  const range = jstMonthRange(month);
  const previous = jstMonthRange(shiftMonthKey(month, -1));
  const [attendance, recordings, homework, quiz, ai, coins] = await Promise.all([
    section('attendance', () => attendanceSection(studentId, range, previous)),
    section('recordings', () => recordingSection(studentId, range, previous)),
    section('homework', () => homeworkSection(studentId, range, previous)),
    section('quiz', () => quizSection(studentId, range)),
    section('ai', () => aiSection(studentId, range, previous)),
    section('coins', () => coinSection(studentId, range)),
  ]);
  const isCurrentMonth = month === jstMonthKey(nowMs);
  const summary = buildReportSummary({
    isCurrentMonth,
    month,
    liveDays: attendance.ok ? attendance.data.current.live_days : null,
    recordingCount: recordings.ok ? recordings.data.current.count : null,
    homeworkCount: homework.ok ? homework.data.period_count : null,
    previousHomeworkCount: homework.ok ? homework.data.previous_period_count : null,
    aiQuestions: ai.ok ? ai.data.questions : null,
  });
  return {
    month,
    is_current_month: isCurrentMonth,
    range: { start: range.startDate, end: range.endDate },
    summary,
    sections: { attendance, recordings, homework, quiz, ai, coins },
  };
}
