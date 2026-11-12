import { randomUUID } from 'crypto';
import { NextRequest } from 'next/server';
import { FieldValue } from 'firebase-admin/firestore';
import { adminDb } from '@/lib/firebase-admin';
import { isDedicatedProfile } from '@/lib/employment-category';
import {
  canManageAttendance,
  canManageAttendanceSchool,
  canManageAttendanceSystem,
  getServerUser,
  jsonError,
  type ServerUser,
} from '@/lib/server-auth';
import { jstDateKey } from '@/lib/date-key';
import { buildMonth, buildSeasonView, dedicatedStaffFromProfile, normalizeUnitRate, type DedicatedStaff } from '@/lib/dedicated-month';
import {
  checkOvertimePlan,
  monthDates,
  nextMonthOf,
  normalizeDivision,
  normalizeJobGrade,
  normalizeSpecialKind,
} from '@/lib/dedicated-overtime';
import { lessonTerm, needsLessonMinutes, summarizeLessonTerm, termSeasonDates } from '@/lib/dedicated-lesson-term';
import { normalizeBaselineType, normalizeSeason, seasonRange } from '@/lib/dedicated-season';
import { writeAuditLog } from '@/lib/server/audit-log';
import {
  LESSONS,
  MONTHLY,
  PLANS,
  REPORTS,
  SEASON_LESSONS,
  TRANSPORT,
  holidaySet,
  loadCompanyHolidays,
  loadLessonsBetween,
  loadSeasons,
  notifyOwner,
  saveCompanyHolidays,
  saveSeasons,
  toPlan,
  toRecord,
  toReport,
  toSeasonLesson,
  toTransport,
} from '@/lib/server/dedicated-attendance';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

/**
 * 専任の勤怠（承認者：マスター・勤怠管理者・専任の校舎承認者）。担当校舎の専任だけを扱う。
 *  GET ?month=     月の照合（専任ごとの予定と実績）と承認待ちの一覧
 *  GET ?season=    講習期間の過剰授業手当の一覧（試算）
 *  POST review     承認・差し戻し（予定・実施報告・授業・講習の授業コマ・交通費・月の提出）
 *  POST bulk_plans D05 一括申請（校長が翌月の時間外の予定をまとめて入れる）
 *  POST staff_update / season_save / season_delete / calendar_save（勤怠システムの管理者だけ）
 */

const clean = (value: unknown, max = 500) => String(value ?? '').normalize('NFKC').trim().slice(0, max);
const bad = (error: string) => Response.json({ ok: false, error }, { status: 400 });
const monthValue = (value: unknown) => /^\d{4}-\d{2}$/.test(String(value || '')) ? String(value) : jstDateKey().slice(0, 7);
const INACTIVE = ['suspended', 'withdrawn', 'archived', 'deleted'];

type Kind = 'plan' | 'report' | 'lesson' | 'season_lesson' | 'transport' | 'monthly';
const COLLECTIONS: Record<Kind, string> = {
  plan: PLANS,
  report: REPORTS,
  lesson: LESSONS,
  season_lesson: SEASON_LESSONS,
  transport: TRANSPORT,
  monthly: MONTHLY,
};
const KIND_LABELS: Record<Kind, string> = {
  plan: '時間外の予定',
  report: '時間外の実施報告',
  lesson: '授業時間',
  season_lesson: '講習の授業',
  transport: '交通費',
  monthly: '月の時間外報告書',
};

const isSystem = (user: ServerUser) => canManageAttendanceSystem(user);

/** 承認者として指名された人（部長など）。校舎の承認者でなくても、指名された職員の分だけ使える。 */
const isDesignatedApprover = (user: ServerUser) => user.role === 'teacher' && user.profile.dedicated_designated_approver === true;
const canUseApprovals = (user: ServerUser) => canManageAttendance(user) || isDesignatedApprover(user);

/** 承認者が指名されている職員は、その人（と勤怠システムの管理者）だけが承認する。いなければ校舎の承認者。 */
const canReviewStaff = (user: ServerUser, staff: DedicatedStaff) => staff.approver_ids.length
  ? staff.approver_ids.includes(user.uid) || isSystem(user)
  : canManageAttendanceSchool(user, staff.school);
const canSeeStaff = (user: ServerUser, staff: DedicatedStaff) => canManageAttendanceSchool(user, staff.school) || staff.approver_ids.includes(user.uid);

const activeDedicated = (data: Record<string, any>) => String(data.role || '').toLowerCase() === 'teacher'
  && isDedicatedProfile(data)
  && !INACTIVE.includes(String(data.account_status || data.status || ''));

/** 全校の在籍中の専任（講師アカウントだけ）。 */
async function loadAllStaff() {
  const snap = await adminDb().collection('users').where('employment_category', '==', 'dedicated').limit(1000).get();
  return snap.docs
    .filter(doc => activeDedicated(doc.data() || {}))
    .map(doc => ({ staff: dedicatedStaffFromProfile(doc.id, doc.data() || {}), profile: doc.data() || {} }));
}

/** 担当校舎の専任と、承認者に指名されている専任。 */
async function loadStaff(user: ServerUser) {
  return (await loadAllStaff()).filter(item => canSeeStaff(user, item.staff));
}

export async function GET(request: NextRequest) {
  try {
    const user = await getServerUser(request);
    if (!canUseApprovals(user)) throw new Error('forbidden');
    const db = adminDb();
    const allStaff = await loadAllStaff();
    const staffList = allStaff.filter(item => canSeeStaff(user, item.staff));
    const staffIds = new Set(staffList.map(item => item.staff.uid));
    const mine = <T extends { user_id: string }>(items: T[]) => items.filter(item => staffIds.has(item.user_id));
    const [seasons, companyHolidays] = await Promise.all([loadSeasons(), loadCompanyHolidays()]);
    const holidays = holidaySet(companyHolidays);

    const seasonId = clean(request.nextUrl.searchParams.get('season'), 60);
    if (seasonId) {
      const season = seasons.find(item => item.id === seasonId);
      if (!season) return Response.json({ ok: false, error: '講習期間が見つかりません。' }, { status: 404 });
      const seasonDates = seasonRange(season)!;
      // 5等級の比較は月単位の時間外勤務手当を使うので、講習期間にかかる月の初めから終わりまで読む。
      const range = { start: `${seasonDates.start.slice(0, 7)}-01`, end: monthDates(seasonDates.end.slice(0, 7)).slice(-1)[0] };
      const [recordSnap, planSnap, reportSnap, lessonSnap] = await Promise.all([
        db.collection('work_records').where('date', '>=', range.start).where('date', '<=', range.end).limit(8000).get(),
        db.collection(PLANS).where('date', '>=', range.start).where('date', '<=', range.end).limit(8000).get(),
        db.collection(REPORTS).where('date', '>=', range.start).where('date', '<=', range.end).limit(8000).get(),
        db.collection(SEASON_LESSONS).where('season_id', '==', season.id).limit(8000).get(),
      ]);
      const records = recordSnap.docs.filter(doc => staffIds.has(String(doc.data()?.teacher_id || ''))).map(doc => ({ ...toRecord(doc), user_id: String(doc.data()?.teacher_id || '') }));
      const plans = mine(planSnap.docs.map(toPlan));
      const reports = mine(reportSnap.docs.map(toReport));
      const lessons = mine(lessonSnap.docs.map(toSeasonLesson));
      const rows = staffList.map(({ staff }) => ({
        staff,
        view: buildSeasonView({
          staff,
          season,
          records: records.filter(record => record.user_id === staff.uid),
          plans: plans.filter(plan => plan.user_id === staff.uid),
          reports: reports.filter(report => report.user_id === staff.uid),
          seasonLessons: lessons.filter(lesson => lesson.user_id === staff.uid),
          holidays,
        }),
      }));
      return Response.json({ ok: true, season, rows }, { headers: { 'Cache-Control': 'no-store' } });
    }

    // 担当加算給の半期の授業分数（4等級以下・等級未設定の人）。
    const termParam = request.nextUrl.searchParams.get('term');
    if (termParam) {
      const term = lessonTerm(termParam);
      if (!term) return bad('半期を選び直してください。');
      const termLessons = mine(await loadLessonsBetween(term.start, term.end));
      const rows = staffList
        .filter(({ staff }) => needsLessonMinutes(staff.grade))
        .map(({ staff }) => {
          const lessons = termLessons.filter(item => item.user_id === staff.uid);
          return {
            staff,
            summary: summarizeLessonTerm({ term, lessons, seasons, division: staff.division }),
            lessons: lessons.filter(item => item.status === 'approved' || item.status === 'pending').sort((a, b) => a.lesson_date.localeCompare(b.lesson_date)),
            season_dates: termSeasonDates(term, seasons, staff.division),
          };
        });
      return Response.json({ ok: true, term, rows }, { headers: { 'Cache-Control': 'no-store' } });
    }

    const month = monthValue(request.nextUrl.searchParams.get('month'));
    const start = `${month}-01`;
    const end = monthDates(month).slice(-1)[0];
    // 一括申請（翌月分）も見られるよう、予定は翌月末まで読む。
    const planEnd = monthDates(nextMonthOf(month)).slice(-1)[0];
    const [recordSnap, planSnap, reportSnap, monthLessons, seasonLessonSnap, transportSnap, monthlySnap, pendingSnaps] = await Promise.all([
      db.collection('work_records').where('date', '>=', start).where('date', '<=', end).limit(8000).get(),
      db.collection(PLANS).where('date', '>=', start).where('date', '<=', planEnd).limit(8000).get(),
      db.collection(REPORTS).where('date', '>=', start).where('date', '<=', end).limit(4000).get(),
      loadLessonsBetween(start, end),
      db.collection(SEASON_LESSONS).where('date', '>=', start).where('date', '<=', end).limit(4000).get(),
      db.collection(TRANSPORT).where('expense_date', '>=', start).where('expense_date', '<=', end).limit(4000).get(),
      db.collection(MONTHLY).where('month', '==', month).limit(1000).get(),
      // 承認待ちは月に関係なく全部出す（前の月の差し戻し後の再申請なども）。
      Promise.all((['plan', 'report', 'lesson', 'season_lesson', 'transport'] as Kind[]).map(kind =>
        db.collection(COLLECTIONS[kind]).where('status', '==', 'pending').limit(1000).get())),
    ]);
    const submittedMonthly = await db.collection(MONTHLY).where('status', '==', 'submitted').limit(1000).get();

    const records = recordSnap.docs.filter(doc => staffIds.has(String(doc.data()?.teacher_id || ''))).map(doc => ({ ...toRecord(doc), user_id: String(doc.data()?.teacher_id || '') }));
    const plans = mine(planSnap.docs.map(toPlan));
    const reports = mine(reportSnap.docs.map(toReport));
    const lessons = mine(monthLessons);
    const seasonLessons = mine(seasonLessonSnap.docs.map(toSeasonLesson));
    const transport = mine(transportSnap.docs.map(toTransport));
    const monthly = new Map(monthlySnap.docs.map(doc => [String(doc.data()?.user_id || ''), doc.data() || {}]));

    const rows = staffList.map(({ staff }) => {
      const view = buildMonth({
        staff,
        month,
        records: records.filter(record => record.user_id === staff.uid),
        plans: plans.filter(plan => plan.user_id === staff.uid),
        reports: reports.filter(report => report.user_id === staff.uid),
        lessons: lessons.filter(item => item.user_id === staff.uid),
        seasonLessons: seasonLessons.filter(item => item.user_id === staff.uid),
        transport: transport.filter(item => item.user_id === staff.uid),
        holidays,
      });
      const report = monthly.get(staff.uid);
      return {
        staff,
        days: view.days,
        summary: view.summary,
        pay: view.pay,
        lesson_minutes: view.days.reduce((sum, day) => sum + day.lesson_minutes, 0),
        season_lesson_minutes: view.days.reduce((sum, day) => sum + day.season_lesson_minutes, 0),
        transport_amount: view.days.reduce((sum, day) => sum + day.transport_amount, 0),
        next_month_plans: plans.filter(plan => plan.user_id === staff.uid && plan.date > end && plan.status !== 'cancelled'),
        monthly: report ? { status: String(report.status || ''), review_note: String(report.review_note || '') } : null,
      };
    });

    const staffById = new Map(staffList.map(item => [item.staff.uid, item.staff]));
    const queue: Array<Record<string, unknown>> = [];
    const pushQueue = (kind: Kind, doc: FirebaseFirestore.QueryDocumentSnapshot) => {
      const data = doc.data() || {};
      const staff = staffById.get(String(data.user_id || ''));
      if (!staff) return;
      const own = data.user_id === user.uid && user.role !== 'master';
      const bulkByManager = kind === 'plan' && data.source === 'bulk' && data.submitted_by_system !== true;
      const reviewer = canReviewStaff(user, staff);
      queue.push({
        kind,
        id: doc.id,
        user_id: staff.uid,
        user_name: staff.name,
        school: staff.school,
        date: String(data.date || data.lesson_date || data.expense_date || data.month || ''),
        data: {
          start: data.start, end: data.end, break_minutes: data.break_minutes, minutes: data.minutes, night_minutes: data.night_minutes,
          reason: data.reason, details: data.details, source: data.source, late: data.late === true, warnings: data.warnings || [],
          special_kind: normalizeSpecialKind(data.special_kind), over_limit: data.over_limit === true, projected_month_minutes: data.projected_month_minutes,
          actual_minutes: data.actual_minutes, planned_minutes: data.planned_minutes, actual_start: data.actual_start, actual_end: data.actual_end,
          lesson_minutes: data.lesson_minutes, excluded: Array.isArray(data.excluded) ? data.excluded : [], school_name: data.school_name, course_label: data.course_label, count: data.count,
          from: data.from, to: data.to, amount: data.amount, summary: data.summary,
        },
        // 校長が入れた一括申請は、上長（勤怠システムの管理者）が承認する。
        can_review: reviewer && !own && (!bulkByManager || isSystem(user)),
        needs_system: bulkByManager,
      });
    };
    (['plan', 'report', 'lesson', 'season_lesson', 'transport'] as Kind[]).forEach((kind, index) => pendingSnaps[index].docs.forEach(doc => pushQueue(kind, doc)));
    submittedMonthly.docs.forEach(doc => pushQueue('monthly', doc));
    queue.sort((a, b) => String(a.date).localeCompare(String(b.date)));

    return Response.json({
      ok: true,
      month,
      rows,
      queue,
      seasons,
      holidays: companyHolidays,
      // 承認者に指名できる人（全校の専任）。勤怠システムの管理者だけに返す。
      approver_candidates: isSystem(user)
        ? allStaff.map(item => ({ uid: item.staff.uid, name: item.staff.name, school: item.staff.school })).sort((a, b) => a.name.localeCompare(b.name, 'ja'))
        : [],
      can_manage_system: isSystem(user),
      // 指名された承認者（部長など）は承認だけ。一括申請は校舎の承認者と勤怠の管理者が行う。
      can_bulk: canManageAttendance(user),
      viewer: user.uid,
    }, { headers: { 'Cache-Control': 'no-store' } });
  } catch (error) {
    return jsonError(error);
  }
}

export async function POST(request: NextRequest) {
  try {
    const user = await getServerUser(request);
    if (!canUseApprovals(user)) throw new Error('forbidden');
    const body = await request.json() as Record<string, unknown>;
    const action = clean(body.action, 40);
    const db = adminDb();

    if (action === 'review') {
      const status = body.status === 'approved' ? 'approved' : body.status === 'rejected' ? 'rejected' : '';
      const note = clean(body.note, 1000);
      const items = (Array.isArray(body.items) ? body.items : []).slice(0, 200).map((item: any) => ({
        kind: (Object.keys(COLLECTIONS).includes(item?.kind) ? item.kind : '') as Kind | '',
        id: clean(item?.id, 120),
      })).filter((item): item is { kind: Kind; id: string } => Boolean(item.kind && item.id));
      if (!status || !items.length) return bad('承認する申請を選んでください。');
      if (status === 'rejected' && !note) return bad('差し戻す理由を入れてください。');
      const snaps = await db.getAll(...items.map(item => db.collection(COLLECTIONS[item.kind]).doc(item.id)));
      const userIds = Array.from(new Set(snaps.map(snap => String(snap.data()?.user_id || '')).filter(Boolean)));
      const profiles = userIds.length ? await db.getAll(...userIds.map(id => db.collection('users').doc(id))) : [];
      const staffById = new Map(profiles.map(doc => [doc.id, dedicatedStaffFromProfile(doc.id, doc.data() || {})]));
      for (const [index, snap] of snaps.entries()) {
        const data = snap.data();
        if (!snap.exists || !data) return Response.json({ ok: false, error: '申請が見つかりません。画面を読み込み直してください。' }, { status: 404 });
        const staff = staffById.get(String(data.user_id || ''));
        if (!staff || !canReviewStaff(user, staff)) throw new Error('forbidden');
        if (data.user_id === user.uid && user.role !== 'master') throw new Error('forbidden');
        const kind = items[index].kind;
        if (kind === 'plan' && data.source === 'bulk' && data.submitted_by_system !== true && !isSystem(user)) throw new Error('forbidden');
        const expected = kind === 'monthly' ? 'submitted' : 'pending';
        if (data.status !== expected) return bad('すでに処理された申請が含まれています。画面を読み込み直してください。');
      }

      const batch = db.batch();
      const touched: string[] = [];
      for (const [index, snap] of snaps.entries()) {
        const data = snap.data() || {};
        const kind = items[index].kind;
        const nextStatus = kind === 'monthly' ? (status === 'approved' ? 'confirmed' : 'returned') : status;
        batch.set(snap.ref, { status: nextStatus, review_note: note, reviewed_by: user.uid, reviewed_at: FieldValue.serverTimestamp(), updated_at: FieldValue.serverTimestamp() }, { merge: true });
        if (kind === 'lesson' && status === 'approved') {
          // 従来の専任別の授業分数（授業担当の一覧）にも載せる。
          batch.set(db.collection('employee_lesson_assignments').doc(`claim_${snap.id}`), {
            employee_id: data.user_id, person_code: data.person_code || '', employee_name: data.user_name || '', school_name: data.school_name || '', lesson_date: data.lesson_date,
            start_time: '', end_time: '', lesson_minutes: Number(data.lesson_minutes || 0), course_name: data.course_name || '授業時間申請', role: 'main', note: '',
            source_type: 'dedicated_self_report', source_claim_id: snap.id, approved_by: user.uid, created_at: FieldValue.serverTimestamp(), updated_at: FieldValue.serverTimestamp(),
          }, { merge: true });
        }
        const label = KIND_LABELS[kind];
        const date = String(data.date || data.lesson_date || data.expense_date || data.month || '');
        notifyOwner(batch, {
          uid: String(data.user_id),
          id: `${kind}_${snap.id}_${nextStatus}`,
          title: `${label}が${status === 'approved' ? (kind === 'monthly' ? '確認されました' : '承認されました') : '差し戻されました'}`,
          message: [date, note || (status === 'approved' ? '' : '内容を直して、もう一度出してください。')].filter(Boolean).join(' '),
        });
        touched.push(`${kind}:${snap.id}`);
      }
      await batch.commit();

      // 月の提出を確認したら、その月の承認待ちの授業・講習の授業コマ・交通費もまとめて承認する（一覧で確認済みのため）。
      const confirmedMonths = snaps.filter((snap, index) => items[index].kind === 'monthly' && status === 'approved').map(snap => snap.data() || {});
      for (const report of confirmedMonths) {
        const month = String(report.month || '');
        const uid = String(report.user_id || '');
        const start = `${month}-01`;
        const end = monthDates(month).slice(-1)[0];
        const [lessonSnap, seasonSnap, transportSnap] = await Promise.all([
          db.collection(LESSONS).where('user_id', '==', uid).limit(1000).get(),
          db.collection(SEASON_LESSONS).where('user_id', '==', uid).limit(1000).get(),
          db.collection(TRANSPORT).where('user_id', '==', uid).limit(1000).get(),
        ]);
        const followUp = db.batch();
        const inMonth = (value: unknown) => String(value || '') >= start && String(value || '') <= end;
        lessonSnap.docs.filter(doc => doc.data().status === 'pending' && inMonth(doc.data().lesson_date)).forEach(doc => {
          followUp.set(doc.ref, { status: 'approved', reviewed_by: user.uid, reviewed_at: FieldValue.serverTimestamp(), approved_with_month: true }, { merge: true });
          const data = doc.data();
          followUp.set(db.collection('employee_lesson_assignments').doc(`claim_${doc.id}`), {
            employee_id: data.user_id, person_code: data.person_code || '', employee_name: data.user_name || '', school_name: data.school_name || '', lesson_date: data.lesson_date,
            start_time: '', end_time: '', lesson_minutes: Number(data.lesson_minutes || 0), course_name: data.course_name || '授業時間申請', role: 'main', note: '',
            source_type: 'dedicated_self_report', source_claim_id: doc.id, approved_by: user.uid, created_at: FieldValue.serverTimestamp(), updated_at: FieldValue.serverTimestamp(),
          }, { merge: true });
        });
        seasonSnap.docs.filter(doc => doc.data().status === 'pending' && inMonth(doc.data().date)).forEach(doc =>
          followUp.set(doc.ref, { status: 'approved', reviewed_by: user.uid, reviewed_at: FieldValue.serverTimestamp(), approved_with_month: true }, { merge: true }));
        transportSnap.docs.filter(doc => doc.data().status === 'pending' && inMonth(doc.data().expense_date)).forEach(doc =>
          followUp.set(doc.ref, { status: 'approved', reviewed_by: user.uid, reviewed_at: FieldValue.serverTimestamp(), approved_with_month: true }, { merge: true }));
        await followUp.commit();
      }

      await writeAuditLog({ actor: user, action: 'dedicated_review', target_type: 'dedicated_attendance', target_id: touched[0] || null, details: { status, count: touched.length, items: touched.slice(0, 20).join(',') } });
      return Response.json({ ok: true, updated: touched.length });
    }

    if (action === 'bulk_plans') {
      // D05：時間外勤務時間 一括申請。勤怠システムの管理者が入れたものはそのまま承認済み、校長が入れたものは上長の承認待ち。
      const entries = (Array.isArray(body.entries) ? body.entries : []).slice(0, 600);
      if (!entries.length) return bad('予定を1件以上入れてください。');
      const userIds = Array.from(new Set(entries.map((entry: any) => clean(entry?.user_id, 128)).filter(Boolean))) as string[];
      if (userIds.length > 100) return bad('一度に入れられるのは100人までです。');
      const profiles = await db.getAll(...userIds.map(id => db.collection('users').doc(id)));
      const staffById = new Map<string, DedicatedStaff>();
      profiles.forEach(doc => {
        const data = doc.data() || {};
        if (!doc.exists || !isDedicatedProfile(data) || String(data.role || '').toLowerCase() !== 'teacher') return;
        const staff = dedicatedStaffFromProfile(doc.id, data);
        if (canManageAttendanceSchool(user, staff.school)) staffById.set(doc.id, staff);
      });
      const today = jstDateKey();
      const system = isSystem(user);
      const errors: string[] = [];
      const writes: Array<Record<string, unknown>> = [];
      entries.forEach((entry: any, index: number) => {
        const staff = staffById.get(clean(entry?.user_id, 128));
        if (!staff) { errors.push(`${index + 1}行目：担当していない専任です`); return; }
        const plan = {
          date: clean(entry?.date, 10),
          start: clean(entry?.start, 5),
          end: clean(entry?.end, 5),
          break_minutes: Math.max(0, Math.floor(Number(entry?.break_minutes) || 0)),
          day_off: entry?.day_off === true,
          reason: clean(entry?.reason, 300),
          special_kind: normalizeSpecialKind(entry?.special_kind),
        };
        const check = checkOvertimePlan(plan, { today, endLimit: staff.end_limit, individual: false });
        if (!check.ok) { errors.push(`${staff.name} ${plan.date}：${check.errors.join('、')}`); return; }
        if (plan.date < today) { errors.push(`${staff.name} ${plan.date}：過ぎた日は入れられません`); return; }
        writes.push({
          user_id: staff.uid,
          user_name: staff.name,
          school_id: staff.school,
          ...plan,
          minutes: check.minutes,
          night_minutes: check.night_minutes,
          late: false,
          warnings: check.warnings,
          source: 'bulk',
          status: system ? 'approved' : 'pending',
          submitted_by: user.uid,
          submitted_by_system: system,
          ...(system ? { reviewed_by: user.uid, reviewed_at: FieldValue.serverTimestamp() } : {}),
          submitted_at: FieldValue.serverTimestamp(),
          updated_at: FieldValue.serverTimestamp(),
        });
      });
      if (errors.length) return Response.json({ ok: false, error: errors.slice(0, 8).join('\n') }, { status: 400 });
      for (let offset = 0; offset < writes.length; offset += 400) {
        const batch = db.batch();
        writes.slice(offset, offset + 400).forEach(write => batch.set(db.collection(PLANS).doc(randomUUID()), write));
        await batch.commit();
      }
      await writeAuditLog({ actor: user, action: 'dedicated_bulk_plans', target_type: 'dedicated_attendance', details: { count: writes.length, staff: userIds.length, approved: system } });
      return Response.json({ ok: true, created: writes.length, status: system ? 'approved' : 'pending' });
    }

    if (action === 'staff_update') {
      if (!isSystem(user)) throw new Error('forbidden');
      const uid = clean(body.user_id, 128);
      const ref = db.collection('users').doc(uid);
      const snap = await ref.get();
      if (!snap.exists || !isDedicatedProfile(snap.data() || {})) return bad('専任のアカウントではありません。');
      const staff = dedicatedStaffFromProfile(uid, snap.data() || {});
      if (!canManageAttendanceSchool(user, staff.school)) throw new Error('forbidden');
      const patch: Record<string, unknown> = { updated_at: FieldValue.serverTimestamp() };
      if (body.job_grade !== undefined) patch.job_grade = normalizeJobGrade(body.job_grade);
      if (body.dedicated_division !== undefined) patch.dedicated_division = normalizeDivision(body.dedicated_division);
      if (body.dedicated_baseline_type !== undefined) patch.dedicated_baseline_type = normalizeBaselineType(body.dedicated_baseline_type);
      const time = (value: unknown) => /^([01]\d|2[0-3]):[0-5]\d$/.test(String(value || '')) ? String(value) : null;
      if (body.prescribed_work_start !== undefined && time(body.prescribed_work_start)) patch.prescribed_work_start = time(body.prescribed_work_start);
      if (body.prescribed_work_end !== undefined && time(body.prescribed_work_end)) patch.prescribed_work_end = time(body.prescribed_work_end);
      if (body.prescribed_break_minutes !== undefined) patch.prescribed_break_minutes = Math.max(0, Math.min(240, Math.floor(Number(body.prescribed_break_minutes) || 0)));
      if (body.prescribed_extend_side !== undefined) patch.prescribed_extend_side = body.prescribed_extend_side === 'after' ? 'after' : 'before';
      if (body.overtime_unit_rate !== undefined) patch.overtime_unit_rate = normalizeUnitRate(body.overtime_unit_rate);
      if (body.short_time_work !== undefined) patch.short_time_work = body.short_time_work === true;
      let approverChange: { added: string[]; removed: string[] } | null = null;
      if (Array.isArray(body.dedicated_approver_ids)) {
        const ids = Array.from(new Set(body.dedicated_approver_ids.map(id => clean(id, 128)).filter(Boolean))).slice(0, 5);
        if (ids.includes(uid)) return bad('本人を承認者にはできません。');
        const docs = ids.length ? await db.getAll(...ids.map(id => db.collection('users').doc(id))) : [];
        if (docs.some(doc => !doc.exists || !activeDedicated(doc.data() || {}))) return bad('承認者には在籍中の専任を選んでください。');
        patch.dedicated_approver_ids = ids;
        approverChange = { added: ids.filter(id => !staff.approver_ids.includes(id)), removed: staff.approver_ids.filter(id => !ids.includes(id)) };
      }
      if (Array.isArray(body.prescribed_work_days)) patch.prescribed_work_days = Array.from(new Set(body.prescribed_work_days.map(Number).filter(day => Number.isInteger(day) && day >= 0 && day <= 6)));
      await ref.set(patch, { merge: true });
      if (approverChange) {
        // 承認者に指名された人は、講師の画面から「専任の承認」を開けるようにする。外れて誰の承認者でもなくなったら戻す。
        const batch = db.batch();
        approverChange.added.forEach(id => batch.set(db.collection('users').doc(id), { dedicated_designated_approver: true }, { merge: true }));
        for (const id of approverChange.removed) {
          const still = await db.collection('users').where('dedicated_approver_ids', 'array-contains', id).limit(1).get();
          if (still.empty) batch.set(db.collection('users').doc(id), { dedicated_designated_approver: false }, { merge: true });
        }
        await batch.commit();
      }
      await writeAuditLog({ actor: user, action: 'dedicated_staff_update', target_type: 'user', target_id: uid, target_label: staff.name, details: { ...patch, updated_at: null } });
      return Response.json({ ok: true });
    }

    if (action === 'season_save' || action === 'season_delete') {
      if (!isSystem(user)) throw new Error('forbidden');
      const seasons = await loadSeasons();
      if (action === 'season_delete') {
        const id = clean(body.id, 60);
        await saveSeasons(seasons.filter(item => item.id !== id), user.uid);
        await writeAuditLog({ actor: user, action: 'dedicated_season_save', target_type: 'settings', target_id: id, details: { deleted: true } });
        return Response.json({ ok: true });
      }
      const raw = (body.season || {}) as Record<string, any>;
      const season = normalizeSeason(raw, clean(raw.id, 60) || `season_${Date.now().toString(36)}`);
      if (!seasonRange(season)) return bad('講習の期間（開始日・終了日）を入れてください。');
      const next = [...seasons.filter(item => item.id !== season.id), season].sort((a, b) => (seasonRange(b)?.start || '').localeCompare(seasonRange(a)?.start || ''));
      await saveSeasons(next.slice(0, 30), user.uid);
      await writeAuditLog({ actor: user, action: 'dedicated_season_save', target_type: 'settings', target_id: season.id, target_label: season.name, details: { courses: season.courses.length } });
      return Response.json({ ok: true, season });
    }

    if (action === 'calendar_save') {
      if (!isSystem(user)) throw new Error('forbidden');
      const list = (Array.isArray(body.holidays) ? body.holidays : []).slice(0, 1000)
        .map((item: any) => ({ date: clean(item?.date, 10), name: clean(item?.name, 40) }))
        .filter(item => /^\d{4}-\d{2}-\d{2}$/.test(item.date) && !Number.isNaN(Date.parse(`${item.date}T00:00:00Z`)));
      const unique = Array.from(new Map(list.map(item => [item.date, item])).values()).sort((a, b) => a.date.localeCompare(b.date));
      await saveCompanyHolidays(unique, user.uid);
      await writeAuditLog({ actor: user, action: 'dedicated_calendar_save', target_type: 'settings', target_id: 'dedicated_calendar', details: { count: unique.length } });
      return Response.json({ ok: true, holidays: unique });
    }

    return bad('操作が不正です。');
  } catch (error) {
    return jsonError(error);
  }
}
