import 'server-only';
import { FieldValue } from 'firebase-admin/firestore';
import { revalidateTag, unstable_cache } from 'next/cache';
import { adminDb } from '@/lib/firebase-admin';
import { resolveAttendanceSchoolCode } from '@/lib/attendance-schools';
import { normalizeLessonExclusions } from '@/lib/dedicated-lesson-term';
import { normalizeSeason, type DedicatedSeason } from '@/lib/dedicated-season';
import { normalizeDayAdjustment } from '@/lib/dedicated-month';
import { normalizeSpecialKind } from '@/lib/dedicated-overtime';
import type { CompanyHoliday, LessonDoc, PlanDoc, ReportDoc, SeasonLessonDoc, TransportDoc, WorkRecordLike } from '@/lib/dedicated-month';
import { loadSchoolStaffRecipients, type StaffRecipient } from '@/lib/server/staff-recipients';
import { queuePushToUsers } from '@/lib/server/web-push';

/**
 * 専任の勤怠（サーバー）。コレクションはすべてサーバー専用（firestore.rules で直接の読み書きを禁止）。
 *  - dedicated_overtime_plans：時間外の予定（D05 一括申請・D06 個別申請）
 *  - dedicated_overtime_reports/{uid_date}：予定と違った時間外の実施報告（D07）
 *  - dedicated_monthly_reports/{uid_month}：月の提出（D08 実施予定・実施報告書）
 *  - dedicated_season_lessons：講習の授業コマ
 *  - settings/dedicated_seasons：講習期間の設定
 *  - settings/dedicated_calendar：会社の休日（祝日・夏季休暇・年末年始など）
 * 通常期間の授業時間・交通費は、従来の dedicated_lesson_claims・dedicated_transport_claims を使う。
 */

export const PLANS = 'dedicated_overtime_plans';
export const REPORTS = 'dedicated_overtime_reports';
export const MONTHLY = 'dedicated_monthly_reports';
export const SEASON_LESSONS = 'dedicated_season_lessons';
export const LESSONS = 'dedicated_lesson_claims';
export const TRANSPORT = 'dedicated_transport_claims';
const SEASONS_DOC = 'dedicated_seasons';
const CALENDAR_DOC = 'dedicated_calendar';

export type { CompanyHoliday } from '@/lib/dedicated-month';

export const monthlyReportId = (uid: string, month: string) => `${uid}_${month}`;
export const reportId = (uid: string, date: string) => `${uid}_${date}`;

const text = (value: unknown, max = 300) => String(value ?? '').slice(0, max);
const num = (value: unknown) => Number(value) || 0;

export const toRecord = (doc: FirebaseFirestore.DocumentSnapshot): WorkRecordLike => {
  const data = doc.data() || {};
  return {
    id: doc.id,
    date: text(data.date, 10),
    start_time: text(data.start_time, 40),
    end_time: data.end_time ? text(data.end_time, 40) : null,
    status: text(data.status, 30),
    dedicated_break_minutes: data.dedicated_break_minutes == null ? null : num(data.dedicated_break_minutes),
    dedicated_day_off: typeof data.dedicated_day_off === 'boolean' ? data.dedicated_day_off : null,
    dedicated_adjustment: normalizeDayAdjustment(data.dedicated_adjustment),
  };
};

export const toPlan = (doc: FirebaseFirestore.DocumentSnapshot): PlanDoc => {
  const data = doc.data() || {};
  return {
    id: doc.id,
    user_id: text(data.user_id, 128),
    date: text(data.date, 10),
    start: text(data.start, 5),
    end: text(data.end, 5),
    break_minutes: num(data.break_minutes),
    minutes: num(data.minutes),
    night_minutes: num(data.night_minutes),
    reason: text(data.reason),
    source: data.source === 'bulk' ? 'bulk' : 'individual',
    late: data.late === true,
    day_off: data.day_off === true,
    special_kind: normalizeSpecialKind(data.special_kind),
    status: ['approved', 'rejected', 'cancelled'].includes(data.status) ? data.status : 'pending',
    review_note: text(data.review_note),
    submitted_by: text(data.submitted_by, 128),
  };
};

export const toReport = (doc: FirebaseFirestore.DocumentSnapshot): ReportDoc => {
  const data = doc.data() || {};
  return {
    id: doc.id,
    user_id: text(data.user_id, 128),
    date: text(data.date, 10),
    status: data.status === 'approved' || data.status === 'rejected' ? data.status : 'pending',
    actual_minutes: num(data.actual_minutes),
    planned_minutes: num(data.planned_minutes),
    special_kind: normalizeSpecialKind(data.special_kind),
    reason: text(data.reason),
    details: text(data.details, 1000),
    review_note: text(data.review_note),
  };
};

export const toLesson = (doc: FirebaseFirestore.DocumentSnapshot): LessonDoc => {
  const data = doc.data() || {};
  const minutes = num(data.lesson_minutes);
  return { id: doc.id, user_id: text(data.user_id, 128), lesson_date: text(data.lesson_date, 10), lesson_minutes: minutes, status: text(data.status, 20) || 'pending', school_name: text(data.school_name, 100), review_note: text(data.review_note), excluded: normalizeLessonExclusions(data.excluded, minutes) || [] };
};

/** 期間内の授業時間の申請（全員分、最大8,000件）。月の照合と半期の授業分数に使う。 */
export async function loadLessonsBetween(start: string, end: string) {
  const snap = await adminDb().collection(LESSONS).where('lesson_date', '>=', start).where('lesson_date', '<=', end).limit(8000).get();
  return snap.docs.map(toLesson);
}

export const toSeasonLesson = (doc: FirebaseFirestore.DocumentSnapshot): SeasonLessonDoc => {
  const data = doc.data() || {};
  return {
    id: doc.id,
    user_id: text(data.user_id, 128),
    season_id: text(data.season_id, 60),
    date: text(data.date, 10),
    course_id: text(data.course_id, 40),
    course_label: text(data.course_label, 160),
    count: num(data.count),
    minutes: num(data.minutes),
    status: text(data.status, 20) || 'pending',
    school_name: text(data.school_name, 100),
    review_note: text(data.review_note),
  };
};

export const toTransport = (doc: FirebaseFirestore.DocumentSnapshot): TransportDoc => {
  const data = doc.data() || {};
  return { id: doc.id, user_id: text(data.user_id, 128), expense_date: text(data.expense_date, 10), from: text(data.from, 100), to: text(data.to, 100), amount: num(data.amount), reason: text(data.reason), status: text(data.status, 20) || 'pending', review_note: text(data.review_note) };
};

/** 本人の勤務記録・時間外の予定・実施報告（各最大1,000件）。月の集計と、時間外の見込みの確認に使う。 */
export async function loadOwnOvertimeInputs(uid: string) {
  const db = adminDb();
  const [recordSnap, planSnap, reportSnap] = await Promise.all([
    db.collection('work_records').where('teacher_id', '==', uid).limit(1000).get(),
    db.collection(PLANS).where('user_id', '==', uid).limit(1000).get(),
    db.collection(REPORTS).where('user_id', '==', uid).limit(1000).get(),
  ]);
  return { records: recordSnap.docs.map(toRecord), plans: planSnap.docs.map(toPlan), reports: reportSnap.docs.map(toReport) };
}

export async function loadSeasons(): Promise<DedicatedSeason[]> {
  const snap = await adminDb().collection('settings').doc(SEASONS_DOC).get();
  const list = Array.isArray(snap.data()?.seasons) ? snap.data()!.seasons : [];
  return list.map((item: any) => normalizeSeason(item, item?.id));
}

export async function saveSeasons(seasons: DedicatedSeason[], uid: string) {
  await adminDb().collection('settings').doc(SEASONS_DOC).set({ seasons, updated_by: uid, updated_at: FieldValue.serverTimestamp() });
}

const CALENDAR_TAG = 'dedicated-calendar';

/** 会社の休日表は全員で同じなので、5分の共有キャッシュから返す（保存したときはすぐ消す）。 */
export const loadCompanyHolidays = unstable_cache(async (): Promise<CompanyHoliday[]> => {
  const snap = await adminDb().collection('settings').doc(CALENDAR_DOC).get();
  const list = Array.isArray(snap.data()?.holidays) ? snap.data()!.holidays : [];
  return list
    .map((item: any) => ({ date: text(item?.date, 10), name: text(item?.name, 40) }))
    .filter((item: CompanyHoliday) => /^\d{4}-\d{2}-\d{2}$/.test(item.date));
}, ['dedicated-calendar-v1'], { revalidate: 300, tags: [CALENDAR_TAG] });

export const holidaySet = (holidays: CompanyHoliday[]) => new Set(holidays.map(item => item.date));

export async function saveCompanyHolidays(holidays: CompanyHoliday[], uid: string) {
  await adminDb().collection('settings').doc(CALENDAR_DOC).set({ holidays, updated_by: uid, updated_at: FieldValue.serverTimestamp() });
  revalidateTag(CALENDAR_TAG);
}

/** 月の提出（D08）が「提出済み」「確認済み」なら、その月の予定・報告・休憩の変更はできない（差し戻されたら直せる）。 */
export async function isMonthLocked(uid: string, month: string) {
  const snap = await adminDb().collection(MONTHLY).doc(monthlyReportId(uid, month)).get();
  const status = snap.data()?.status;
  return status === 'submitted' || status === 'confirmed';
}

const canonical = (value: unknown) => resolveAttendanceSchoolCode(value) || String(value || '').trim();

/**
 * 専任の申請を承認する人：承認者が指名されていればその人（部長など）、
 * いなければ同じ校舎の専任の校舎承認者、その校舎の勤怠管理者、マスター。
 */
export async function dedicatedApprovers(school: string, exceptUid: string, approverIds: string[] = []): Promise<StaffRecipient[]> {
  const designated = approverIds.filter(id => id && id !== exceptUid);
  if (designated.length) {
    const docs = await adminDb().getAll(...designated.map(id => adminDb().collection('users').doc(id)));
    return docs.filter(doc => doc.exists).map(doc => ({ id: doc.id, data: doc.data() || {}, isMaster: false }));
  }
  const target = canonical(school);
  const [admins, managers] = await Promise.all([
    loadSchoolStaffRecipients(school, { audience: 'attendance' }),
    adminDb().collection('users').where('attendance_school_manager', '==', true).limit(300).get(),
  ]);
  const schoolManagers = managers.docs
    .map(doc => ({ id: doc.id, data: doc.data() || {}, isMaster: false }))
    .filter(item => target && canonical(item.data.school_id || item.data.school_code || item.data.school_name || item.data.school) === target);
  const unique = new Map<string, StaffRecipient>();
  [...admins, ...schoolManagers].forEach(item => { if (item.id !== exceptUid) unique.set(item.id, item); });
  return Array.from(unique.values());
}

export async function notifyDedicatedApprovers(input: { school: string; exceptUid: string; approverIds?: string[]; idPrefix: string; title: string; message: string }) {
  const recipients = (await dedicatedApprovers(input.school, input.exceptUid, input.approverIds))
    .filter(item => item.data.notification_preferences?.in_app !== false);
  if (!recipients.length) return 0;
  const db = adminDb();
  const batch = db.batch();
  // 専任の校舎承認者は講師の画面、勤怠管理者とマスターは管理画面で承認する。
  const linkFor = (item: StaffRecipient) => String(item.data.role || '').toLowerCase() === 'teacher'
    ? '/teacher/attendance-approvals/dedicated'
    : '/master/attendance/dedicated';
  recipients.slice(0, 400).forEach(item => {
    batch.set(db.collection('user_notifications').doc(`${input.idPrefix}_${item.id}`), {
      user_id: item.id,
      title: input.title,
      message: input.message,
      kind: 'dedicated_attendance',
      link: linkFor(item),
      read: false,
      created_at: FieldValue.serverTimestamp(),
      updated_at: FieldValue.serverTimestamp(),
    }, { merge: true });
  });
  await batch.commit();
  const teachers = recipients.filter(item => linkFor(item).startsWith('/teacher')).map(item => item.id);
  const admins = recipients.filter(item => !linkFor(item).startsWith('/teacher')).map(item => item.id);
  queuePushToUsers(teachers, { title: input.title, body: input.message.slice(0, 120), link: '/teacher/attendance-approvals/dedicated' }, { kind: 'dedicated_attendance' });
  queuePushToUsers(admins, { title: input.title, body: input.message.slice(0, 120), link: '/master/attendance/dedicated' }, { kind: 'dedicated_attendance' });
  return recipients.length;
}

/** 申請した本人への結果の通知。 */
export function notifyOwner(batch: FirebaseFirestore.WriteBatch, input: { uid: string; id: string; title: string; message: string }) {
  batch.set(adminDb().collection('user_notifications').doc(`dedicated_${input.id}`), {
    user_id: input.uid,
    title: input.title,
    message: input.message,
    kind: '専任勤怠',
    link: '/teacher/attendance/dedicated',
    read: false,
    created_at: FieldValue.serverTimestamp(),
    updated_at: FieldValue.serverTimestamp(),
  }, { merge: true });
}
