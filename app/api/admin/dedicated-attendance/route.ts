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
import { buildMonth, buildSeasonView, dedicatedStaffFromProfile, type DedicatedStaff } from '@/lib/dedicated-month';
import {
  checkOvertimePlan,
  monthDates,
  nextMonthOf,
  normalizeDivision,
  normalizeJobGrade,
} from '@/lib/dedicated-overtime';
import { normalizeBaselineType, normalizeSeason, seasonRange } from '@/lib/dedicated-season';
import { writeAuditLog } from '@/lib/server/audit-log';
import {
  LESSONS,
  MONTHLY,
  PLANS,
  REPORTS,
  SEASON_LESSONS,
  TRANSPORT,
  loadSeasons,
  notifyOwner,
  saveSeasons,
  toLesson,
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
 *  POST staff_update / season_save / season_delete（勤怠システムの管理者だけ）
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

/** 担当校舎の専任（在籍中の講師アカウントだけ）。 */
async function loadStaff(user: ServerUser) {
  const snap = await adminDb().collection('users').where('employment_category', '==', 'dedicated').limit(1000).get();
  return snap.docs
    .filter(doc => {
      const data = doc.data() || {};
      return String(data.role || '').toLowerCase() === 'teacher'
        && isDedicatedProfile(data)
        && !INACTIVE.includes(String(data.account_status || data.status || ''));
    })
    .map(doc => ({ staff: dedicatedStaffFromProfile(doc.id, doc.data() || {}), profile: doc.data() || {} }))
    .filter(item => canManageAttendanceSchool(user, item.staff.school));
}

const isSystem = (user: ServerUser) => canManageAttendanceSystem(user);

export async function GET(request: NextRequest) {
  try {
    const user = await getServerUser(request);
    if (!canManageAttendance(user)) throw new Error('forbidden');
    const db = adminDb();
    const staffList = await loadStaff(user);
    const staffIds = new Set(staffList.map(item => item.staff.uid));
    const mine = <T extends { user_id: string }>(items: T[]) => items.filter(item => staffIds.has(item.user_id));
    const seasons = await loadSeasons();

    const seasonId = clean(request.nextUrl.searchParams.get('season'), 60);
    if (seasonId) {
      const season = seasons.find(item => item.id === seasonId);
      if (!season) return Response.json({ ok: false, error: '講習期間が見つかりません。' }, { status: 404 });
      const range = seasonRange(season)!;
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
        }),
      }));
      return Response.json({ ok: true, season, rows }, { headers: { 'Cache-Control': 'no-store' } });
    }

    const month = monthValue(request.nextUrl.searchParams.get('month'));
    const start = `${month}-01`;
    const end = monthDates(month).slice(-1)[0];
    // 一括申請（翌月分）も見られるよう、予定は翌月末まで読む。
    const planEnd = monthDates(nextMonthOf(month)).slice(-1)[0];
    const [recordSnap, planSnap, reportSnap, lessonSnap, seasonLessonSnap, transportSnap, monthlySnap, pendingSnaps] = await Promise.all([
      db.collection('work_records').where('date', '>=', start).where('date', '<=', end).limit(8000).get(),
      db.collection(PLANS).where('date', '>=', start).where('date', '<=', planEnd).limit(8000).get(),
      db.collection(REPORTS).where('date', '>=', start).where('date', '<=', end).limit(4000).get(),
      db.collection(LESSONS).where('lesson_date', '>=', start).where('lesson_date', '<=', end).limit(4000).get(),
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
    const lessons = mine(lessonSnap.docs.map(toLesson));
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
      });
      const report = monthly.get(staff.uid);
      return {
        staff,
        days: view.days,
        summary: view.summary,
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
          actual_minutes: data.actual_minutes, planned_minutes: data.planned_minutes, actual_start: data.actual_start, actual_end: data.actual_end,
          lesson_minutes: data.lesson_minutes, school_name: data.school_name, course_label: data.course_label, count: data.count,
          from: data.from, to: data.to, amount: data.amount, summary: data.summary,
        },
        // 校長が入れた一括申請は、上長（勤怠システムの管理者）が承認する。
        can_review: !own && (!bulkByManager || isSystem(user)),
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
      can_manage_system: isSystem(user),
      viewer: user.uid,
    }, { headers: { 'Cache-Control': 'no-store' } });
  } catch (error) {
    return jsonError(error);
  }
}

export async function POST(request: NextRequest) {
  try {
    const user = await getServerUser(request);
    if (!canManageAttendance(user)) throw new Error('forbidden');
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
        if (!staff || !canManageAttendanceSchool(user, staff.school)) throw new Error('forbidden');
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
      if (Array.isArray(body.prescribed_work_days)) patch.prescribed_work_days = Array.from(new Set(body.prescribed_work_days.map(Number).filter(day => Number.isInteger(day) && day >= 0 && day <= 6)));
      await ref.set(patch, { merge: true });
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
      if (!season.courses.length) return bad('授業の一覧を1つ以上入れてください。');
      const next = [...seasons.filter(item => item.id !== season.id), season].sort((a, b) => (seasonRange(b)?.start || '').localeCompare(seasonRange(a)?.start || ''));
      await saveSeasons(next.slice(0, 30), user.uid);
      await writeAuditLog({ actor: user, action: 'dedicated_season_save', target_type: 'settings', target_id: season.id, target_label: season.name, details: { courses: season.courses.length } });
      return Response.json({ ok: true, season });
    }

    return bad('操作が不正です。');
  } catch (error) {
    return jsonError(error);
  }
}
