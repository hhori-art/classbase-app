import { createHash, randomUUID } from 'crypto';
import { NextRequest } from 'next/server';
import { FieldValue } from 'firebase-admin/firestore';
import { adminDb } from '@/lib/firebase-admin';
import { isDedicatedProfile } from '@/lib/employment-category';
import { getServerUser, jsonError, requireRole } from '@/lib/server-auth';
import { jstDateKey } from '@/lib/date-key';
import { attendanceSchoolName, resolveAttendanceSchoolCode } from '@/lib/attendance-schools';
import { buildMonth, buildSeasonView, dedicatedStaffFromProfile, normalizeDayAdjustment } from '@/lib/dedicated-month';
import { MONTHLY_OVERTIME_LIMIT_MINUTES, MONTHLY_REPORT_DEADLINE_BUSINESS_DAYS, SPECIAL_KIND_LABELS, checkOvertimePlan, formatDuration, monthDates, normalizeSpecialKind, nthBusinessDay, projectedMonthOvertime, type SpecialKind } from '@/lib/dedicated-overtime';
import { lessonTermOf, needsLessonMinutes, normalizeLessonExclusions, summarizeLessonTerm } from '@/lib/dedicated-lesson-term';
import { isInSeason, seasonRange } from '@/lib/dedicated-season';
import {
  LESSONS,
  MONTHLY,
  PLANS,
  REPORTS,
  SEASON_LESSONS,
  TRANSPORT,
  holidaySet,
  isMonthLocked,
  loadCompanyHolidays,
  loadOwnOvertimeInputs,
  loadSeasons,
  monthlyReportId,
  notifyDedicatedApprovers,
  notifyOwner,
  reportId,
  toLesson,
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

/**
 * 月75時間（特訓を含む）を超える見込みの申請は止めずに、申請の前に本人に確かめる（2026-10-28 給与担当の回答）。
 * 本人が確かめて申請したら、本人と承認者に通知する。
 */
const overLimitResponse = (projected: number) => Response.json({
  ok: false,
  over_limit: true,
  projected_minutes: projected,
  limit_minutes: MONTHLY_OVERTIME_LIMIT_MINUTES,
  error: `この申請で、この月の時間外（特訓を含む）の見込みが ${formatDuration(projected)} になり、上限の ${formatDuration(MONTHLY_OVERTIME_LIMIT_MINUTES)} を超えます。振替などで調整できないか確かめてください。このまま申請すると、本人と承認者に通知します。`,
}, { status: 409 });

async function notifyOverLimit(input: { staff: ReturnType<typeof dedicatedStaffFromProfile>; uid: string; name: string; id: string; month: string; projected: number }) {
  const message = `${input.month.replace('-', '年')}月の時間外の見込み ${formatDuration(input.projected)}（上限 ${formatDuration(MONTHLY_OVERTIME_LIMIT_MINUTES)}）`;
  await notifyDedicatedApprovers({
    school: input.staff.school,
    exceptUid: input.uid,
    approverIds: input.staff.approver_ids,
    idPrefix: `dedicated_over_limit_${input.id}`,
    title: `時間外が月75時間を超える申請：${input.name || '専任'}`,
    message,
  });
  const batch = adminDb().batch();
  notifyOwner(batch, { uid: input.uid, id: `over_limit_${input.id}`, title: '時間外が月75時間を超える見込みです', message });
  await batch.commit();
}

const specialLabel = (kind: SpecialKind | null) => kind ? `【${SPECIAL_KIND_LABELS[kind]}】` : '';

export async function GET(request: NextRequest) {
  try {
    const user = await getServerUser(request);
    requireDedicated(user);
    const month = monthValue(request.nextUrl.searchParams.get('month'));
    const db = adminDb();
    const [{ records, plans, reports }, lessonSnap, seasonLessonSnap, transportSnap, monthlySnap, seasons, companyHolidays] = await Promise.all([
      loadOwnOvertimeInputs(user.uid),
      db.collection(LESSONS).where('user_id', '==', user.uid).limit(1000).get(),
      db.collection(SEASON_LESSONS).where('user_id', '==', user.uid).limit(1000).get(),
      db.collection(TRANSPORT).where('user_id', '==', user.uid).limit(1000).get(),
      db.collection(MONTHLY).doc(monthlyReportId(user.uid, month)).get(),
      loadSeasons(),
      loadCompanyHolidays(),
    ]);
    const holidays = holidaySet(companyHolidays);
    const staff = dedicatedStaffFromProfile(user.uid, user.profile);
    const lessons = lessonSnap.docs.map(toLesson);
    const seasonLessons = seasonLessonSnap.docs.map(toSeasonLesson);
    const transport = transportSnap.docs.map(toTransport);
    const view = buildMonth({ staff, month, records, plans, reports, lessons, seasonLessons, transport, holidays });
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
      .map(season => buildSeasonView({ staff, season, records, plans, reports, seasonLessons, holidays }))
      .filter(Boolean);

    const recentRoutes = Array.from(new Map(
      [...transport].sort((a, b) => b.expense_date.localeCompare(a.expense_date))
        .map(item => [`${item.from}→${item.to}→${item.amount}`, { from: item.from, to: item.to, amount: item.amount, reason: item.reason }]),
    ).values()).slice(0, 6);

    const monthly = monthlySnap.exists ? monthlySnap.data() || {} : null;
    // 月初（2営業日目まで）は、前の月の報告書が出ているかも返す（表示中の月に関係なく提出を案内する）。
    const previousMonth = new Date(Date.parse(`${today.slice(0, 7)}-01T12:00:00+09:00`) - 86_400_000).toISOString().slice(0, 7);
    const reportDeadline = nthBusinessDay(today.slice(0, 7), MONTHLY_REPORT_DEADLINE_BUSINESS_DAYS, holidays);
    const previousMonthly = today <= reportDeadline
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
      previous_month: previousMonthly ? { month: previousMonth, status: String(previousMonthly.data()?.status || ''), deadline: reportDeadline } : null,
      pay: view.pay,
      today_plans: plans.filter(plan => plan.date === today && (plan.status === 'approved' || plan.status === 'pending')),
      plans: plans.filter(plan => (inMonth(plan.date) || plan.date >= today) && plan.status !== 'cancelled').sort((a, b) => a.date.localeCompare(b.date) || a.start.localeCompare(b.start)),
      lessons: lessons.filter(item => inMonth(item.lesson_date)).sort((a, b) => b.lesson_date.localeCompare(a.lesson_date)),
      // 担当加算給の半期の授業分数（表示中の月を含む半期）。5等級以上は出さない。
      lesson_term: needsLessonMinutes(staff.grade)
        ? (() => {
          const term = lessonTermOf(`${month}-01`);
          return { term, summary: summarizeLessonTerm({ term, lessons, seasons, division: staff.division }) };
        })()
        : null,
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
        // 特訓（日曜特訓・突破ゼミなど）は本人が種類を選ぶ。手当で払うので時間外勤務手当とは別に数える。
        special_kind: normalizeSpecialKind(body.special_kind),
      };
      const check = checkOvertimePlan(plan, { today, endLimit: staff.end_limit, individual: true });
      if (!check.ok) return bad(check.errors.join('。'));
      if (plan.date < today) return bad('過ぎた日の時間外は、予定ではなく「報告する」から報告してください。');
      const month = plan.date.slice(0, 7);
      if (await isMonthLocked(user.uid, month)) return bad(LOCKED_ERROR);
      const [inputs, companyHolidays] = await Promise.all([loadOwnOvertimeInputs(user.uid), loadCompanyHolidays()]);
      const projected = projectedMonthOvertime(
        buildMonth({ staff, month, ...inputs, holidays: holidaySet(companyHolidays) }).days.map(day => day.reconciliation),
        check.minutes,
      );
      const overLimit = projected > MONTHLY_OVERTIME_LIMIT_MINUTES;
      if (overLimit && body.confirm_over_limit !== true) return overLimitResponse(projected);
      const id = randomUUID();
      await db.collection(PLANS).doc(id).set({
        ...base,
        ...plan,
        minutes: check.minutes,
        night_minutes: check.night_minutes,
        late: check.late,
        warnings: check.warnings,
        ...(overLimit ? { over_limit: true, projected_month_minutes: projected } : {}),
        source: 'individual',
        status: 'pending',
        submitted_by: user.uid,
        submitted_at: FieldValue.serverTimestamp(),
        updated_at: FieldValue.serverTimestamp(),
      });
      await notifyDedicatedApprovers({
        school: staff.school,
        exceptUid: user.uid,
        approverIds: staff.approver_ids,
        idPrefix: `dedicated_plan_${id}`,
        title: `時間外の${check.late ? '突発' : '事前'}申請：${base.user_name || '専任'}`,
        message: `${plan.date} ${plan.start}〜${plan.end}（${formatDuration(check.minutes)}）${specialLabel(plan.special_kind)}${plan.reason}`,
      }).catch(error => console.warn('[dedicated] notify failed', error?.message));
      if (overLimit) {
        await notifyOverLimit({ staff, uid: user.uid, name: base.user_name, id, month, projected })
          .catch(error => console.warn('[dedicated] over-limit notify failed', error?.message));
      }
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
      const specialKind = normalizeSpecialKind(body.special_kind);
      if (!DATE.test(date) || !reason) return bad('日付と業務内容（超過理由）を入れてください。');
      const month = date.slice(0, 7);
      if (await isMonthLocked(user.uid, month)) return bad(LOCKED_ERROR);
      const [inputs, companyHolidays] = await Promise.all([loadOwnOvertimeInputs(user.uid), loadCompanyHolidays()]);
      const view = buildMonth({ staff, month, ...inputs, holidays: holidaySet(companyHolidays) });
      const day = view.days.find(item => item.date === date);
      if (!day?.actual) return bad('この日の退勤打刻がありません。先に打刻の修正を申請してください。');
      if (day.reconciliation.actual_minutes <= day.reconciliation.planned_minutes) return bad('この日の時間外は、承認された予定の範囲に収まっています。');
      // 報告する時間はもう打刻に入っているので、見込みはこの月の分そのもの。
      const projected = projectedMonthOvertime(view.days.map(item => item.reconciliation));
      const overLimit = projected > MONTHLY_OVERTIME_LIMIT_MINUTES;
      if (overLimit && body.confirm_over_limit !== true) return overLimitResponse(projected);
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
        special_kind: specialKind,
        ...(overLimit ? { over_limit: true, projected_month_minutes: projected } : {}),
        status: 'pending',
        review_note: '',
        submitted_at: FieldValue.serverTimestamp(),
        updated_at: FieldValue.serverTimestamp(),
      });
      await notifyDedicatedApprovers({
        school: staff.school,
        exceptUid: user.uid,
        approverIds: staff.approver_ids,
        idPrefix: `dedicated_report_${user.uid}_${date}`,
        title: `時間外の実施報告：${base.user_name || '専任'}`,
        message: `${date} 実績 ${formatDuration(day.reconciliation.actual_minutes)}（予定 ${formatDuration(day.reconciliation.planned_minutes)}）${specialLabel(specialKind)}${reason}`,
      }).catch(error => console.warn('[dedicated] notify failed', error?.message));
      if (overLimit) {
        await notifyOverLimit({ staff, uid: user.uid, name: base.user_name, id: `report_${user.uid}_${date}`, month, projected })
          .catch(error => console.warn('[dedicated] over-limit notify failed', error?.message));
      }
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
      if (body.adjustment !== undefined) {
        // 半日有休・半日振替・時間振替。振替の元の日は同じ月の別の日だけ（月の報告書で承認者が確認する）。
        if (body.adjustment === null) patch.dedicated_adjustment = FieldValue.delete();
        else {
          const adjustment = normalizeDayAdjustment(body.adjustment);
          if (!adjustment || adjustment.minutes % 5) return bad('有休・振替の時間は5分単位で入れてください（8時間まで）。振替は元の日も選んでください。');
          if (adjustment.from_date && (adjustment.from_date === data.date || adjustment.from_date.slice(0, 7) !== String(data.date).slice(0, 7))) {
            return bad('振替の元の日は、同じ月の別の日を選んでください。');
          }
          patch.dedicated_adjustment = adjustment;
        }
      }
      await ref.set(patch, { merge: true });
      return Response.json({ ok: true });
    }

    if (action === 'lesson_apply') {
      const lessonDate = clean(body.lesson_date, 10);
      const minutes = Math.floor(Number(body.lesson_minutes) || 0);
      if (!DATE.test(lessonDate) || minutes < 1 || minutes > 720) return bad('授業日と授業分数（1〜720分）を入れてください。');
      // 授業分数報告書は4等級以下だけ（2026-10-28 回答）。
      if (!needsLessonMinutes(staff.grade)) return bad('5等級以上の方は授業時間の申請はいりません。');
      const excluded = normalizeLessonExclusions(body.excluded, minutes);
      if (!excluded) return bad('数えない授業の分数は、授業分数の合計以内で入れてください。');
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
        excluded,
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
      // 授業の一覧は管理者が作らなくてもよい（2026-10-26 回答：授業は各自が登録し、管理者は授業コマを登録しない）。
      // 一覧にない授業は、各自が授業名と1コマの分数を入れる。
      const courseId = clean(body.course_id, 40);
      const listed = courseId ? season.courses.find(item => item.id === courseId) : null;
      if (courseId && !listed) return bad('授業を一覧から選び直してください。');
      const customName = clean(body.course_label, 100);
      const customMinutes = Math.floor(Number(body.minutes_per_lesson));
      if (!listed && (!customName || !Number.isFinite(customMinutes) || customMinutes < 5 || customMinutes > 300)) return bad('授業名（学年・教科）と1コマの分数（5〜300分）を入れてください。');
      const course = listed || { id: 'custom', section: '', grade: '', name: customName, minutes: customMinutes };
      const count = Math.floor(Number(body.count) || 1);
      if (count < 1 || count > 10) return bad('コマ数は1〜10で入れてください。');
      if (await isMonthLocked(user.uid, date.slice(0, 7))) return bad(LOCKED_ERROR);
      const id = randomUUID();
      await db.collection(SEASON_LESSONS).doc(id).set({
        ...base,
        season_id: season.id,
        date,
        course_id: course.id,
        course_label: listed ? `${course.section} ${course.grade} ${course.name}` : course.name,
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
      const [inputs, companyHolidays] = await Promise.all([loadOwnOvertimeInputs(user.uid), loadCompanyHolidays()]);
      const view = buildMonth({ staff, month, ...inputs, holidays: holidaySet(companyHolidays) });
      if (view.summary.open_days.length) {
        return bad(`報告が必要な日があります（${view.summary.open_days.map(day => day.slice(5).replace('-', '/')).join('、')}）。先に「報告する」から報告してください。`);
      }
      if (view.days.some(day => day.record && !day.record.end_time)) return bad('退勤打刻のない日があります。先に打刻の修正を申請してください。');
      await db.collection(MONTHLY).doc(monthlyReportId(user.uid, month)).set({
        ...base,
        month,
        status: 'submitted',
        summary: view.summary,
        pay: view.pay,
        grade: staff.grade,
        review_note: '',
        submitted_at: FieldValue.serverTimestamp(),
        updated_at: FieldValue.serverTimestamp(),
      });
      await notifyDedicatedApprovers({
        school: staff.school,
        exceptUid: user.uid,
        approverIds: staff.approver_ids,
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
