import { NextRequest } from 'next/server';
import { Timestamp } from 'firebase-admin/firestore';
import { adminDb } from '@/lib/firebase-admin';
import { getServerUser, isAdminLike, jsonError } from '@/lib/server-auth';

export const runtime = 'nodejs';

const toDate = (value: any): Date | null => {
  if (!value) return null;
  if (value.toDate) return value.toDate();
  const date = new Date(value);
  return Number.isNaN(date.getTime()) ? null : date;
};

const dateKey = (date: Date) => date.toISOString().slice(0, 10);

const emptyDaily = (days: number) => {
  const rows: any[] = [];
  const today = new Date();
  for (let i = days - 1; i >= 0; i -= 1) {
    const d = new Date(today);
    d.setDate(today.getDate() - i);
    rows.push({
      date: dateKey(d),
      active_users: 0,
      student_users: 0,
      teacher_users: 0,
      page_views: 0,
      clicks: 0,
      errors: 0,
      total_events: 0,
      avg_minutes: 0,
    });
  }
  return rows;
};

const increment = (map: Record<string, number>, key: string, amount = 1) => {
  if (!key) return;
  map[key] = (map[key] || 0) + amount;
};

export async function GET(request: NextRequest) {
  try {
    const actor = await getServerUser(request);
    if (!isAdminLike(actor)) throw new Error('forbidden');

    const url = new URL(request.url);
    const days = Math.max(7, Math.min(90, Number(url.searchParams.get('days') || 30)));
    const since = new Date();
    since.setDate(since.getDate() - days + 1);
    since.setHours(0, 0, 0, 0);
    const sinceTs = Timestamp.fromDate(since);
    const db = adminDb();

    const [
      dailySnap,
      userMetricsSnap,
      usersSnap,
      questSnap,
      recordingSnap,
      coinSnap,
      surveySnap,
    ] = await Promise.all([
      db.collection('beta_test_daily').where('date', '>=', dateKey(since)).get(),
      db.collection('beta_user_metrics').limit(3000).get(),
      db.collection('users').where('role', '==', 'student').limit(5000).get(),
      db.collection('quest_results').where('created_at', '>=', sinceTs).limit(3000).get().catch(() => ({ docs: [] as any[] })),
      db.collection('recording_views').where('created_at', '>=', sinceTs).limit(3000).get().catch(() => ({ docs: [] as any[] })),
      db.collection('coin_transactions').where('created_at', '>=', sinceTs).limit(3000).get().catch(() => ({ docs: [] as any[] })),
      db.collection('survey_responses').where('created_at', '>=', sinceTs).limit(3000).get().catch(() => ({ docs: [] as any[] })),
    ]);

    const dailyRows = emptyDaily(days);
    const dailyByDate = new Map(dailyRows.map(row => [row.date, row]));
    const featureMap: Record<string, number> = {};
    const eventTypeMap: Record<string, number> = {};
    let totalEvents = 0;
    let totalDuration = 0;
    let errorCount = 0;

    dailySnap.docs.forEach(doc => {
      const data = doc.data();
      const row = dailyByDate.get(String(data.date || doc.id));
      if (!row) return;
      const eventsByType = data.events_by_type || {};
      const activeUids = Array.isArray(data.active_uids) ? data.active_uids : [];
      const studentUids = Array.isArray(data.student_uids) ? data.student_uids : [];
      const teacherUids = Array.isArray(data.teacher_uids) ? data.teacher_uids : [];
      row.active_users = activeUids.length;
      row.student_users = studentUids.length;
      row.teacher_users = teacherUids.length;
      row.page_views = Number(eventsByType.page_view || 0);
      row.clicks = Number(eventsByType.click || 0);
      row.errors = Number(eventsByType.error || 0);
      row.total_events = Number(data.total_events || 0);
      row.avg_minutes = activeUids.length > 0 ? Math.round(Number(data.total_duration_ms || 0) / activeUids.length / 600) / 100 : 0;
      totalEvents += row.total_events;
      totalDuration += Number(data.total_duration_ms || 0);
      errorCount += row.errors;
      Object.entries(eventsByType).forEach(([key, value]) => increment(eventTypeMap, key, Number(value || 0)));
      Object.entries(data.features || {}).forEach(([key, value]) => increment(featureMap, key, Number(value || 0)));
    });

    const studentTotal = usersSnap.size;
    const userMetrics = userMetricsSnap.docs.map(doc => ({ id: doc.id, ...doc.data() } as any));
    const activeMetrics = userMetrics.filter(item => {
      const lastSeen = toDate(item.last_seen_at);
      return lastSeen && lastSeen >= since;
    });
    const activeStudentCount = new Set(activeMetrics.filter(item => item.role === 'student').map(item => item.uid || item.id)).size;
    const activeTeacherCount = new Set(activeMetrics.filter(item => item.role === 'teacher').map(item => item.uid || item.id)).size;
    const activationRate = studentTotal > 0 ? Math.round((activeStudentCount / studentTotal) * 100) : 0;
    const avgMinutes = activeMetrics.length > 0
      ? Math.round(activeMetrics.reduce((sum, item) => sum + Number(item.total_duration_ms || 0), 0) / activeMetrics.length / 600) / 100
      : 0;

    const questResults = questSnap.docs.map((doc: any) => doc.data());
    const questCount = questResults.length;
    const questPassed = questResults.filter((item: any) => item.is_passed === true || Number(item.score || 0) >= 80).length;
    const avgScore = questCount > 0
      ? Math.round(questResults.reduce((sum: number, item: any) => sum + Number(item.score || 0), 0) / questCount)
      : 0;

    const recordingCount = recordingSnap.docs.length;
    const missionRewards = coinSnap.docs
      .map((doc: any) => doc.data())
      .filter((item: any) => String(item.source || '').includes('mission') || String(item.reason || '').includes('ミッション'));
    const surveys = surveySnap.docs.map((doc: any) => doc.data());
    const surveyCount = surveys.length;
    const avgSurveyScore = surveyCount > 0
      ? Math.round(surveys.reduce((sum: number, item: any) => sum + Number(item.rating || item.score || 0), 0) / surveyCount * 10) / 10
      : 0;

    const topFeatures = Object.entries(featureMap)
      .sort((a, b) => b[1] - a[1])
      .slice(0, 12)
      .map(([name, count]) => ({ name, count }));

    const usersNeedingFollowUp = userMetrics
      .filter(item => item.role === 'student')
      .map(item => {
        const lastSeen = toDate(item.last_seen_at);
        const daysSince = lastSeen ? Math.floor((Date.now() - lastSeen.getTime()) / 86400000) : 999;
        return {
          uid: item.uid || item.id,
          name: item.name || '生徒',
          grade: item.grade || '',
          days_since: daysSince,
          event_count: Number(item.event_count || 0),
          last_path: item.last_path || '',
        };
      })
      .filter(item => item.days_since >= 3 || item.event_count <= 2)
      .sort((a, b) => b.days_since - a.days_since || a.event_count - b.event_count)
      .slice(0, 30);

    const evidenceScore = Math.min(100, Math.round(
      (activationRate * 0.35) +
      (Math.min(100, recordingCount / Math.max(1, studentTotal) * 100) * 0.15) +
      (Math.min(100, questCount / Math.max(1, studentTotal) * 100) * 0.2) +
      (Math.min(100, surveyCount / Math.max(1, studentTotal) * 100) * 0.15) +
      (Math.max(0, 100 - errorCount * 2) * 0.15)
    ));

    return Response.json({
      ok: true,
      period: { days, since: dateKey(since) },
      kpis: {
        student_total: studentTotal,
        active_students: activeStudentCount,
        active_teachers: activeTeacherCount,
        activation_rate: activationRate,
        total_events: totalEvents,
        avg_minutes: avgMinutes,
        errors: errorCount,
        quest_count: questCount,
        quest_pass_rate: questCount > 0 ? Math.round((questPassed / questCount) * 100) : 0,
        avg_score: avgScore,
        recording_views: recordingCount,
        mission_rewards: missionRewards.length,
        survey_count: surveyCount,
        avg_survey_score: avgSurveyScore,
        evidence_score: evidenceScore,
      },
      daily: dailyRows,
      top_features: topFeatures,
      events_by_type: Object.entries(eventTypeMap).map(([type, count]) => ({ type, count })),
      follow_up: usersNeedingFollowUp,
    });
  } catch (error) {
    return jsonError(error);
  }
}
