import { createHash, randomUUID } from 'crypto';
import { NextRequest } from 'next/server';
import { FieldValue } from 'firebase-admin/firestore';
import { adminDb } from '@/lib/firebase-admin';
import { isDedicatedProfile } from '@/lib/employment-category';
import { getServerUser, jsonError, requireRole } from '@/lib/server-auth';
import { jstDateKey } from '@/lib/date-key';
import { attendanceSchoolName, resolveAttendanceSchoolCode } from '@/lib/attendance-schools';
import { buildMonth, buildSeasonView, dedicatedStaffFromProfile } from '@/lib/dedicated-month';
import { checkOvertimePlan, formatDuration, monthDates } from '@/lib/dedicated-overtime';
import { isInSeason, seasonRange } from '@/lib/dedicated-season';
import {
  LESSONS,
  MONTHLY,
  PLANS,
  REPORTS,
  SEASON_LESSONS,
  TRANSPORT,
  isMonthLocked,
  loadSeasons,
  monthlyReportId,
  notifyDedicatedApprovers,
  reportId,
  toLesson,
  toPlan,
  toRecord,
  toReport,
  toSeasonLesson,
  toTransport,
} from '@/lib/server/dedicated-attendance';

export const runtime = 'nodejs';

/**
 * 専任の勤怠（本人）。打刻は /api/teacher/attendance-clock、打刻の修正は /api/attendance-corrections を使う。
 * ここでは、時間外の予定（D06）・実施報告（D07）・月の提出（D08）・授業・講習の授業コマ・交通費を扱う。
 */

const clean = (value: unknown, max = 500) => String(value ?? '').normalize('NFKC').trim().slice(0, max);
const DATE = /^\d{4}-\d{2}-\d{2}$/;
const monthValue = (value: unknown) => /^\d{4}-\d{2}$/.test(String(value || '')) ? String(value) : jstDateKey().slice(0, 7);
const bad = (error: string) => Response.json({ ok: false, error }, { status: 400 });
const userName = (profile: Record<string, any>) => clean(profile.name || profile.teacher_name || profile.display_name, 100);

function requireDedicated(user: Awaited<ReturnType<typeof getServerUser>>) {
  requireRole(user, ['teacher']);
  if (!isDedicatedProfile(user.profile)) throw new Error('forbidden');
}

const LOCKED_ERROR = 'この月は提出済みです。直すときは承認者に差し戻してもらってください。';

export async function GET(request: NextRequest) {
  try {
    const user = await getServerUser(request);
    requireDedicated(user);
    const month = monthValue(request.nextUrl.searchParams.get('month'));
    const db = adminDb();
    const [recordSnap, planSnap, reportSnap, lessonSnap, seasonLessonSnap, transportSnap, monthlySnap, seasons] = await Promise.all([
      db.collection('work_records').where('teacher_id', '==', user.uid).limit(1000).get(),
      db.collection(PLANS).where('user_id', '==', user.uid).limit(1000).get(),
      db.collection(REPORTS).where('user_id', '==', user.uid).limit(1000).get(),
      db.collection(LESSONS).where('user_id', '==', user.uid).limit(1000).get(),
      db.collection(SEASON_LESSONS).where('user_id', '==', user.uid).limit(1000).get(),
      db.collection(TRANSPORT).where('user_id', '==', user.uid).limit(1000).get(),
      db.collection(MONTHLY).doc(monthlyReportId(user.uid, month)).get(),
      loadSeasons(),
    ]);
    const staff = dedicatedStaffFromProfile(user.uid, user.profile);
    const records = recordSnap.docs.map(toRecord);
    const plans = planSnap.docs.map(toPlan);
    const reports = reportSnap.docs.map(toReport);
    const lessons = lessonSnap.docs.map(toLesson);
    const seasonLessons = seasonLessonSnap.docs.map(toSeasonLesson);
    const transport = transportSnap.docs.map(toTransport);
    const view = buildMonth({ staff, month, records, plans, reports, lessons, seasonLessons, transport });
    const today = jstDateKey();
    const inMonth = (date: string) => date.startsWith(`${month}-`);

    // 本日の打刻状態は表示中の月に関係なく、全勤務記録から判定する（過去月表示中の二重出勤防止）。
    const byStartDesc = (a: { start_time?: string }, b: { start_time?: string }) => String(b.start_time).localeCompare(String(a.start_time));
    // 出勤中は「今日の退勤していない記録」だけ。前日以前の退勤忘れは別に知らせ、今日の出勤は止めない。
    const activeRecord = records.filter(record => !record.end_time && record.date === today).sort(byStartDesc)[0] || null;
    const todayRecord = records.filter(record => record.date === today).sort(byStartDesc)[0] || null;
    const fourteenDaysAgo = new Date(Date.parse(`${today}T12:00:00+09:00`) - 14 * 86_400_000).toISOString().slice(0, 10);
    const openPastRecords = records
      .filter(record => !record.end_time && record.date < today && record.date >= fourteenDaysAgo)
      .sort((a, b) => b.date.localeCompare(a.date))
      .map(record => ({ id: record.id, date: record.date, start_time: record.start_time }));

    // 表示中の月か今日にかかる講習期間。
    const monthStart = `${month}-01`;
    const monthEnd = monthDates(month).slice(-1)[0];
    const seasonViews = seasons
      .filter(season => {
        const range = seasonRange(season);
        return range && ((range.start <= monthEnd && range.end >= monthStart) || (range.start <= today && range.end >= today));
      })
      .map(season => buildSeasonView({ staff, season, records, plans, reports, seasonLessons }))
      .filter(Boolean);

    const recentRoutes = Array.from(new Map(
      [...transport].sort((a, b) => b.expense_date.localeCompare(a.expense_date))
        .map(item => [`${item.from}→${item.to}→${item.amount}`, { from: item.from, to: item.to, amount: item.amount, reason: item.reason }]),
    ).values()).slice(0, 6);

    const monthly = monthlySnap.exists ? monthlySnap.data() || {} : null;
    // 月初（1〜3日）は、前の月の報告書が出ているかも返す（表示中の月に関係なく提出を案内する）。
    const previousMonth = new Date(Date.parse(`${today.slice(0, 7)}-01T12:00:00+09:00`) - 86_400_000).toISOString().slice(0, 7);
    const previousMonthly = Number(today.slice(8, 10)) <= 3
      ? await db.collection(MONTHLY).doc(monthlyReportId(user.uid, previousMonth)).get()
      : null;
    const schoolIds = Array.from(new Set([staff.school, ...(Array.isArray(user.profile.school_ids) ? user.profile.school_ids : [])]
      .map(value => resolveAttendanceSchoolCode(value)).filter(Boolean)));
    return Response.json({
      ok: true,
      month,
      today,
      staff,
      days: view.days,
      summary: view.summary,
      active_record: activeRecord,
      today_record: todayRecord,
      open_past_records: openPastRecords,
      schools: schoolIds.map(id => ({ id, name: attendanceSchoolName(id) })),
      previous_month: previousMonthly ? { month: previousMonth, status: String(previousMonthly.data()?.status || '') } : null,
      today_plans: plans.filter(plan => plan.date === today && (plan.status === 'approved' || plan.status === 'pending')),
      plans: plans.filter(plan => (inMonth(plan.date) || plan.date >= today) && plan.status !== 'cancelled').sort((a, b) => a.date.localeCompare(b.date) || a.start.localeCompare(b.start)),
      lessons: lessons.filter(item => inMonth(item.lesson_date)).sort((a, b) => b.lesson_date.localeCompare(a.lesson_date)),
      transport: transport.filter(item => inMonth(item.expense_date)).sort((a, b) => b.expense_date.localeCompare(a.expense_date)),
      recent_routes: recentRoutes,
      seasons: seasonViews,
      monthly: monthly ? {
        status: String(monthly.status || ''),
        review_note: String(monthly.review_note || ''),
        submitted_at: monthly.submitted_at?.toDate?.().toISOString?.() || null,
      } : null,
    }, { headers: { 'Cache-Control': 'no-store' } });
  } catch (error) {
    return jsonError(error);
  }
}

export async function POST(request: NextRequest) {
  try {
    const user = await getServerUser(request);
    requireDedicated(user);
    const body = await request.json() as Record<string, unknown>;
    const action = clean(body.action, 40);
    const db = adminDb();
    const staff = dedicatedStaffFromProfile(user.uid, user.profile);
    const today = jstDateKey();
    const base = { user_id: user.uid, user_name: userName(user.profile), school_id: staff.school };

    if (action === 'plan_submit') {
      // D06：時間外業務の実施申請（各自・2日前まで。過ぎたものは突発として申請する）。
      const plan = {
        date: clean(body.date, 10),
        start: clean(body.start, 5),
        end: clean(body.end, 5),
        break_minutes: Math.max(0, Math.floor(Number(body.break_minutes) || 0)),
        day_off: body.day_off === true,
        reason: clean(body.reason, 300),
      };
      const check = checkOvertimePlan(plan, { today, endLimit: staff.end_limit, individual: true });
      if (!check.ok) return bad(check.errors.join('。'));
      if (plan.date < today) return bad('過ぎた日の時間外は、予定ではなく「報告する」から報告してください。');
      if (await isMonthLocked(user.uid, plan.date.slice(0, 7))) return bad(LOCKED_ERROR);
      const id = randomUUID();
      await db.collection(PLANS).doc(id).set({
        ...base,
        ...plan,
        minutes: check.minutes,
        night_minutes: check.night_minutes,
        late: check.late,
        warnings: check.warnings,
        source: 'individual',
        status: 'pending',
        submitted_by: user.uid,
        submitted_at: FieldValue.serverTimestamp(),
        updated_at: FieldValue.serverTimestamp(),
      });
      await notifyDedicatedApprovers({
        school: staff.school,
        exceptUid: user.uid,
        idPrefix: `dedicated_plan_${id}`,
        title: `時間外の${check.late ? '突発' : '事前'}申請：${base.user_name || '専任'}`,
        message: `${plan.date} ${plan.start}〜${plan.end}（${formatDuration(check.minutes)}）${plan.reason}`,
      }).catch(error => console.warn('[dedicated] notify failed', error?.message));
      return Response.json({ ok: true, id, minutes: check.minutes, warnings: check.warnings });
    }

    if (action === 'plan_cancel') {
      const ref = db.collection(PLANS).doc(clean(body.id, 80));
      const snap = await ref.get();
      const data = snap.data() || {};
      if (!snap.exists || data.user_id !== user.uid) throw new Error('forbidden');
      if (data.status === 'approved' && String(data.date) < today) return bad('過ぎた日の承認済みの予定は取り消せません。');
      if (!['pending', 'approved', 'rejected'].includes(String(data.status))) return bad('取り消せる予定ではありません。');
      if (await isMonthLocked(user.uid, String(data.date).slice(0, 7))) return bad(LOCKED_ERROR);
      await ref.set({ status: 'cancelled', cancelled_at: FieldValue.serverTimestamp(), updated_at: FieldValue.serverTimestamp() }, { merge: true });
      return Response.json({ ok: true });
    }

    if (action === 'report_submit') {
      // D07：予定を超えた・予定のない時間外の実施報告（事後承認）。
      const date = clean(body.date, 10);
      const reason = clean(body.reason, 300);
      if (!DATE.test(date) || !reason) return bad('日付と業務内容（超過理由）を入れてください。');
      if (await isMonthLocked(user.uid, date.slice(0, 7))) return bad(LOCKED_ERROR);
      const [recordSnap, planSnap] = await Promise.all([
        db.collection('work_records').where('teacher_id', '==', user.uid).where('date', '==', date).limit(5).get(),
        db.collection(PLANS).where('user_id', '==', user.uid).limit(1000).get(),
      ]);
      const view = buildMonth({ staff, month: date.slice(0, 7), records: recordSnap.docs.map(toRecord), plans: planSnap.docs.map(toPlan), reports: [] });
      const day = view.days.find(item => item.date === date);
      if (!day?.actual) return bad('この日の退勤打刻がありません。先に打刻の修正を申請してください。');
      if (day.reconciliation.actual_minutes <= day.reconciliation.planned_minutes) return bad('この日の時間外は、承認された予定の範囲に収まっています。');
      await db.collection(REPORTS).doc(reportId(user.uid, date)).set({
        ...base,
        date,
        actual_minutes: day.reconciliation.actual_minutes,
        planned_minutes: day.reconciliation.planned_minutes,
        night_minutes: day.reconciliation.night_minutes,
        actual_start: day.actual.start,
        actual_end: day.actual.end,
        reason,
        details: clean(body.details, 1000),
        status: 'pending',
        review_note: '',
        submitted_at: FieldValue.serverTimestamp(),
        updated_at: FieldValue.serverTimestamp(),
      });
      await notifyDedicatedApprovers({
        school: staff.school,
        exceptUid: user.uid,
        idPrefix: `dedicated_report_${user.uid}_${date}`,
        title: `時間外の実施報告：${base.user_name || '専任'}`,
        message: `${date} 実績 ${formatDuration(day.reconciliation.actual_minutes)}（予定 ${formatDuration(day.reconciliation.planned_minutes)}）${reason}`,
      }).catch(error => console.warn('[dedicated] notify failed', error?.message));
      return Response.json({ ok: true });
    }

    if (action === 'day_update') {
      // その日の休憩時間と、公休日に出勤したかどうか（時間外の計算に使う）。
      const ref = db.collection('work_records').doc(clean(body.work_record_id, 120));
      const snap = await ref.get();
      const data = snap.data() || {};
      if (!snap.exists || data.teacher_id !== user.uid) throw new Error('forbidden');
      if (await isMonthLocked(user.uid, String(data.date).slice(0, 7))) return bad(LOCKED_ERROR);
      const patch: Record<string, unknown> = { updated_at_server: FieldValue.serverTimestamp() };
      if (body.break_minutes !== undefined) {
        const minutes = Math.floor(Number(body.break_minutes));
        if (!Number.isFinite(minutes) || minutes < 0 || minutes > 240 || minutes % 5) return bad('休憩は0〜240分の5分単位で入れてください。');
        patch.dedicated_break_minutes = minutes;
      }
      if (body.day_off !== undefined) patch.dedicated_day_off = body.day_off === null ? FieldValue.delete() : body.day_off === true;
      await ref.set(patch, { merge: true });
      return Response.json({ ok: true });
    }

    if (action === 'lesson_apply') {
      const lessonDate = clean(body.lesson_date, 10);
      const minutes = Math.floor(Number(body.lesson_minutes) || 0);
      if (!DATE.test(lessonDate) || minutes < 1 || minutes > 720) return bad('授業日と授業分数（1〜720分）を入れてください。');
      if (await isMonthLocked(user.uid, lessonDate.slice(0, 7))) return bad(LOCKED_ERROR);
      const key = `daily_${createHash('sha256').update([user.uid, lessonDate].join('\u001f')).digest('hex').slice(0, 34)}`;
      // 同じ日の申請は1件（出し直すと置き換わる）。承認済みの日は、黙って承認待ちに戻さない。
      const existing = await db.collection(LESSONS).doc(key).get();
      if (existing.exists && existing.data()?.status === 'approved') {
        return bad('この日の授業時間は承認済みです。直すときは承認者に差し戻してもらってください。');
      }
      await db.collection(LESSONS).doc(key).set({
        ...base,
        person_code: clean(user.profile.lifetime_id || user.profile.staff_id || user.profile.employee_id, 40),
        school_name: clean(body.school_name || user.profile.school_name || user.profile.school || user.profile.classroom, 100),
        lesson_date: lessonDate,
        start_time: '',
        end_time: '',
        lesson_minutes: minutes,
        course_name: '授業時間申請',
        details: '',
        entry_type: 'daily_minutes',
        source_type: 'self_report',
        status: 'pending',
        review_note: '',
        submitted_at: FieldValue.serverTimestamp(),
        updated_at: FieldValue.serverTimestamp(),
      }, { merge: true });
      return Response.json({ ok: true, lesson_minutes: minutes });
    }

    if (action === 'season_lesson_add') {
      const seasons = await loadSeasons();
      const season = seasons.find(item => item.id === clean(body.season_id, 60));
      if (!season) return bad('講習期間が見つかりません。');
      const date = clean(body.date, 10);
      if (!DATE.test(date) || !isInSeason(season, staff.division, date)) return bad('講習期間の中の日付を選んでください。');
      if (season.entry_deadline && today > season.entry_deadline) return bad(`${season.name}の授業の登録は締め切りました。`);
      const course = season.courses.find(item => item.id === clean(body.course_id, 40));
      if (!course) return bad('授業を一覧から選んでください。');
      const count = Math.floor(Number(body.count) || 1);
      if (count < 1 || count > 10) return bad('コマ数は1〜10で入れてください。');
      if (await isMonthLocked(user.uid, date.slice(0, 7))) return bad(LOCKED_ERROR);
      const id = randomUUID();
      await db.collection(SEASON_LESSONS).doc(id).set({
        ...base,
        season_id: season.id,
        date,
        course_id: course.id,
        course_label: `${course.section} ${course.grade} ${course.name}`,
        count,
        minutes: course.minutes * count,
        school_name: clean(body.school_name || user.profile.school_name || user.profile.school, 100),
        status: 'pending',
        review_note: '',
        submitted_at: FieldValue.serverTimestamp(),
        updated_at: FieldValue.serverTimestamp(),
      });
      return Response.json({ ok: true, id, minutes: course.minutes * count });
    }

    if (action === 'transport_apply') {
      const expenseDate = clean(body.expense_date, 10);
      const from = clean(body.from, 100);
      const to = clean(body.to, 100);
      const amount = Math.max(0, Math.floor(Number(body.amount) || 0));
      const reason = clean(body.reason, 300);
      if (!DATE.test(expenseDate) || !from || !to || !amount || !reason) return bad('日付・移動区間・金額・理由を入れてください。');
      if (amount > 100000) return bad('金額が大きすぎます。');
      if (await isMonthLocked(user.uid, expenseDate.slice(0, 7))) return bad(LOCKED_ERROR);
      const key = createHash('sha256').update([user.uid, expenseDate, from, to, String(amount), reason].join('\u001f')).digest('hex').slice(0, 40);
      await db.collection(TRANSPORT).doc(key).set({
        ...base,
        expense_date: expenseDate,
        from,
        to,
        amount,
        reason,
        details: clean(body.details, 1000),
        status: 'pending',
        review_note: '',
        submitted_at: FieldValue.serverTimestamp(),
        updated_at: FieldValue.serverTimestamp(),
      }, { merge: true });
      return Response.json({ ok: true, amount });
    }

    if (action === 'item_cancel') {
      // 承認前の授業・講習の授業コマ・交通費を取り下げる。
      const kind = clean(body.kind, 20);
      const collection = kind === 'lesson' ? LESSONS : kind === 'season_lesson' ? SEASON_LESSONS : kind === 'transport' ? TRANSPORT : '';
      if (!collection) return bad('取り下げる申請を選んでください。');
      const ref = db.collection(collection).doc(clean(body.id, 80));
      const snap = await ref.get();
      const data = snap.data() || {};
      if (!snap.exists || data.user_id !== user.uid) throw new Error('forbidden');
      if (data.status !== 'pending' && data.status !== 'rejected') return bad('承認済みの申請は取り下げられません。');
      const date = String(data.date || data.lesson_date || data.expense_date || '');
      if (await isMonthLocked(user.uid, date.slice(0, 7))) return bad(LOCKED_ERROR);
      await ref.delete();
      return Response.json({ ok: true });
    }

    if (action === 'month_submit') {
      // D08：時間外勤務 実施予定・実施報告書。月末日から提出できる。報告が必要な日が残っていると出せない。
      const month = monthValue(body.month);
      const lastDay = monthDates(month).slice(-1)[0];
      if (today < lastDay) return bad(`${month.replace('-', '年')}月の提出は、月末日（${lastDay.slice(5).replace('-', '/')}）から行えます。`);
      if (await isMonthLocked(user.uid, month)) return bad('この月はすでに提出済みです。');
      const [recordSnap, planSnap, reportSnap] = await Promise.all([
        db.collection('work_records').where('teacher_id', '==', user.uid).limit(1000).get(),
        db.collection(PLANS).where('user_id', '==', user.uid).limit(1000).get(),
        db.collection(REPORTS).where('user_id', '==', user.uid).limit(1000).get(),
      ]);
      const view = buildMonth({ staff, month, records: recordSnap.docs.map(toRecord), plans: planSnap.docs.map(toPlan), reports: reportSnap.docs.map(toReport) });
      if (view.summary.open_days.length) {
        return bad(`報告が必要な日があります（${view.summary.open_days.map(day => day.slice(5).replace('-', '/')).join('、')}）。先に「報告する」から報告してください。`);
      }
      if (view.days.some(day => day.record && !day.record.end_time)) return bad('退勤打刻のない日があります。先に打刻の修正を申請してください。');
      await db.collection(MONTHLY).doc(monthlyReportId(user.uid, month)).set({
        ...base,
        month,
        status: 'submitted',
        summary: view.summary,
        grade: staff.grade,
        review_note: '',
        submitted_at: FieldValue.serverTimestamp(),
        updated_at: FieldValue.serverTimestamp(),
      });
      await notifyDedicatedApprovers({
        school: staff.school,
        exceptUid: user.uid,
        idPrefix: `dedicated_month_${user.uid}_${month}`,
        title: `月の時間外報告書が提出されました：${base.user_name || '専任'}`,
        message: `${month} 時間外 ${formatDuration(view.summary.payable_minutes)}（うち深夜 ${formatDuration(view.summary.payable_night_minutes)}）`,
      }).catch(error => console.warn('[dedicated] notify failed', error?.message));
      return Response.json({ ok: true });
    }

    return bad('操作が不正です。');
  } catch (error) {
    return jsonError(error);
  }
}
