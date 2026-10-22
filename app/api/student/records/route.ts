import { NextRequest } from 'next/server';
import { FieldPath, Timestamp } from 'firebase-admin/firestore';
import { adminDb } from '@/lib/firebase-admin';
import { getServerUser, jsonError, requireRole } from '@/lib/server-auth';
import { jstDateKey } from '@/lib/date-key';
import { badgeStatsFromProfile, findBadge } from '@/lib/gamification';
import { studySummaryForRange, type MonoxerStudyHistoryEntry } from '@/lib/monoxer-study';
import {
  bucketByWeek,
  buildRecordWeeks,
  jstDateKeyFromMillis,
  monthStartKey,
  nextBadgeTargets,
  participationDates,
  studentBadgeText,
  weeklyStreak,
} from '@/lib/student-records';

export const runtime = 'nodejs';

/**
 * 生徒本人の「自分の記録」。読むのはログイン中の生徒自身のデータだけ（uid は認証から取り、指定は受け付けない）。
 * 読取は次の6回で、どれも本人分・件数上限つき。1つ失敗しても他の欄は返し、失敗した欄は errors に true を立てる。
 *  1. 出席：直近8週（ドキュメントID「生徒ID_日付」の範囲）最大70件
 *  2. 出席の通算：count() 集計（文書は読まない）
 *  3. 録画視聴：直近8週に更新された本人分 最大200件（既存インデックス recording_views(user_id, updated_at DESC)）
 *  4. 宿題（Monoxer）：pf_study_progress/{本人} の1件
 *  5. AIクエスト：今月の本人分 最大200件（既存インデックス quest_results(student_id, created_at DESC)）
 *  6. コイン：今月の本人分 最大300件（既存インデックス coin_transactions(user_id, created_at DESC)）
 * 通算の録画・クエスト・コインはプロフィールのカウンター（認証時に読み込み済み）を使う。
 */
const ATTENDANCE_LIMIT = 70;
const VIEW_LIMIT = 200;
const QUEST_LIMIT = 200;
const COIN_LIMIT = 300;
const PARTICIPATION_TYPES = ['joined', 'present', '出席', '遅刻'];

const millis = (value: any) => value?.toMillis?.() || value?.toDate?.()?.getTime?.() || (value ? new Date(value).getTime() : 0) || 0;
const num = (value: unknown) => {
  const parsed = Number(value || 0);
  return Number.isFinite(parsed) && parsed > 0 ? Math.floor(parsed) : 0;
};
const settle = async <T>(section: string, work: () => Promise<T>) => {
  try {
    return { ok: true as const, value: await work() };
  } catch (error) {
    console.warn(`[student-records] ${section} failed`, error);
    return { ok: false as const, value: null };
  }
};

export async function GET(request: NextRequest) {
  try {
    const user = await getServerUser(request);
    requireRole(user, ['student']);
    const uid = user.uid;
    const profile = user.profile || {};
    const db = adminDb();

    const today = jstDateKey();
    const monthStart = monthStartKey(today);
    const weeks = buildRecordWeeks(today);
    const windowStart = weeks[0].start_date;
    const since = (dateKey: string) => Timestamp.fromDate(new Date(`${dateKey}T00:00:00+09:00`));

    const [attendance, attendanceTotal, views, study, quests, coins] = await Promise.all([
      settle('attendance', () => db.collection('attendance')
        .where(FieldPath.documentId(), '>=', `${uid}_${windowStart}`)
        .where(FieldPath.documentId(), '<=', `${uid}_9999`)
        .limit(ATTENDANCE_LIMIT).get()),
      settle('attendance_total', () => db.collection('attendance')
        .where('user_id', '==', uid).where('type', 'in', PARTICIPATION_TYPES)
        .count().get()),
      settle('recording_views', () => db.collection('recording_views')
        .where('user_id', '==', uid).where('updated_at', '>=', since(windowStart))
        .orderBy('updated_at', 'desc').select('status', 'completed_at').limit(VIEW_LIMIT).get()),
      settle('homework', () => db.collection('pf_study_progress').doc(uid).get()),
      settle('quests', () => db.collection('quest_results')
        .where('student_id', '==', uid).where('created_at', '>=', since(monthStart))
        .orderBy('created_at', 'desc').select('is_passed').limit(QUEST_LIMIT).get()),
      settle('coins', () => db.collection('coin_transactions')
        .where('user_id', '==', uid).where('created_at', '>=', since(monthStart))
        .orderBy('created_at', 'desc').select('amount').limit(COIN_LIMIT).get()),
    ]);

    const errors: Record<string, boolean> = {};

    // Zoom参加（参加した日の数）
    let zoomWeekly: number[] | null = null;
    let zoomMonth: number | null = null;
    if (attendance.ok) {
      const records = attendance.value.docs
        .map(doc => doc.data() || {})
        .filter(record => String(record.user_id || record.student_id || '') === uid);
      const dates = participationDates(records);
      zoomWeekly = bucketByWeek(dates.map(date => ({ date, value: 1 })), weeks);
      zoomMonth = dates.filter(date => date >= monthStart && date <= today).length;
    } else {
      errors.zoom = true;
    }
    const zoomTotal = attendanceTotal.ok
      ? Math.max(Number(attendanceTotal.value.data().count) || 0, zoomMonth || 0)
      : null;
    if (!attendanceTotal.ok) errors.zoom_total = true;

    // 録画（最後まで見た本数）
    let recordingMonth: number | null = null;
    if (views.ok) {
      recordingMonth = views.value.docs.filter(doc => {
        const view = doc.data() || {};
        if (String(view.status || '') !== 'completed') return false;
        const date = jstDateKeyFromMillis(millis(view.completed_at));
        return date >= monthStart && date <= today;
      }).length;
    } else {
      errors.recordings = true;
    }

    // 宿題（Monoxer の学習回数。取り込みのたびに前回からの増えた回数が記録される）
    let homework: { measured: boolean; month_count: number | null; total_count: number | null; last_snapshot_date: string | null } | null = null;
    let homeworkWeekly: (number | null)[] | null = null;
    if (study.ok) {
      const progress = study.value.exists ? study.value.data() || {} : null;
      const history: MonoxerStudyHistoryEntry[] = Array.isArray(progress?.history) ? progress!.history : [];
      const summary = studySummaryForRange(progress, monthStart, today);
      homework = {
        measured: summary.measured,
        month_count: summary.period_count,
        total_count: progress ? num(progress.total_count) : null,
        last_snapshot_date: summary.last_snapshot_date,
      };
      const measured = history.filter(entry => entry && entry.gained !== null && entry.gained !== undefined);
      const totals = bucketByWeek(measured.map(entry => ({ date: String(entry.date), value: Number(entry.gained) || 0 })), weeks);
      homeworkWeekly = weeks.map((week, index) => (
        measured.some(entry => entry.date >= week.start_date && entry.date <= week.end_date) ? totals[index] : null
      ));
    } else {
      errors.homework = true;
    }

    // AIクエスト（合格した回数）
    let questMonth: number | null = null;
    let questCapped = false;
    if (quests.ok) {
      questMonth = quests.value.docs.filter(doc => doc.data()?.is_passed === true).length;
      questCapped = quests.value.docs.length >= QUEST_LIMIT;
    } else {
      errors.quests = true;
    }

    // コイン（今月もらった分。使った分は数えない）
    let coinMonth: number | null = null;
    let coinCapped = false;
    if (coins.ok) {
      coinMonth = coins.value.docs.reduce((sum, doc) => {
        const amount = Number(doc.data()?.amount) || 0;
        return amount > 0 ? sum + amount : sum;
      }, 0);
      coinCapped = coins.value.docs.length >= COIN_LIMIT;
    } else {
      errors.coins = true;
    }

    const stats = badgeStatsFromProfile(profile);
    const earnedIds = Array.from(new Set((Array.isArray(profile.earned_badges) ? profile.earned_badges : []).map(String)));
    const earned = earnedIds.flatMap(id => {
      const item = findBadge(id);
      return item ? [{ id: item.id, name: item.name, icon: item.icon, description: studentBadgeText(item.description), rarity: item.rarity }] : [];
    });

    return Response.json({
      ok: true,
      today,
      month_start: monthStart,
      zoom: { month_days: zoomMonth, total_days: zoomTotal },
      recordings: { month_completed: recordingMonth, total_completed: stats.recording_complete_count },
      homework,
      quests: { month_cleared: questMonth, month_capped: questCapped, total_cleared: stats.quest_clear_count },
      coins: { balance: num(profile.coins), total_earned: stats.total_coins, month_earned: coinMonth, month_capped: coinCapped },
      streak: {
        zoom_weeks: zoomWeekly ? weeklyStreak(zoomWeekly, weeks) : null,
        login_days: num(profile.login_streak),
      },
      weekly: weeks.map((week, index) => ({
        key: week.key,
        start_date: week.start_date,
        end_date: week.end_date,
        is_current: week.is_current,
        zoom_days: zoomWeekly ? zoomWeekly[index] : null,
        homework_gained: homeworkWeekly ? homeworkWeekly[index] : null,
      })),
      badges: { earned, next: nextBadgeTargets(stats) },
      errors,
    }, { headers: { 'Cache-Control': 'private, no-store' } });
  } catch (error) {
    return jsonError(error);
  }
}
