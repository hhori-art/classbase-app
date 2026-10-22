import 'server-only';
import { FieldValue } from 'firebase-admin/firestore';
import { adminDb } from '@/lib/firebase-admin';
import { getNotificationSettings } from '@/lib/line';
import { jstDateKey, weekdayFromDateKey } from '@/lib/date-key';
import { isActiveRegistration, periodFromShift } from '@/lib/student-course-schedule';
import { isDedicatedProfile } from '@/lib/employment-category';
import { recordsMissingWorkDetails } from '@/lib/attendance-work-draft';
import { buildStudentTimetable } from '@/lib/server/student-timetable';
import { loadStudentClassMasters } from '@/lib/server/student-class-masters';
import { normalizeClassButtonSettings } from '@/lib/class-button-settings';
import { attendanceSchoolName } from '@/lib/attendance-schools';
import { loadSchoolStaffRecipients, notifyStaff } from '@/lib/server/staff-recipients';
import { linkedParentIds } from '@/lib/server/linked-parents';
import { userAllows } from '@/lib/server/notify-channels';
import { queuePushToUsers } from '@/lib/server/web-push';

/**
 * 自動で送る通知（管理画面の「通知連携」の通知種別でオン・オフできる）。
 *  - 授業の未参加：受講登録している授業に、欠席連絡なしで参加していない（毎晩22時台）
 *  - 勤務詳細の未登録：退勤したのに勤務の詳細が入っていない（毎朝8時台。前日分と3日前の分）
 *  - 打刻修正の結果：申請が承認・差し戻しされた（その場で）
 *  - 専任の月の報告書（D08）の未提出（月初1〜3日の朝）と、校舎の承認者への翌月の一括申請（D05）の案内（毎月20日の朝）
 * 通知のIDは対象ごとに固定し、同じ日に何度実行しても重ならない。
 */

const INACTIVE = ['suspended', 'withdrawn', 'archived', 'inactive'];
const isActiveUser = (data: FirebaseFirestore.DocumentData | undefined) =>
  Boolean(data) && !INACTIVE.some(status => data!.account_status === status || data!.status === status);
const clean = (value: unknown) => String(value ?? '').trim();
const addDays = (date: string, days: number) => jstDateKey(new Date(new Date(`${date}T12:00:00+09:00`).getTime() + days * 86_400_000));
const dateLabel = (date: string) => `${Number(date.slice(5, 7))}月${Number(date.slice(8, 10))}日（${weekdayFromDateKey(date)}）`;

type Notice = { id: string; userId: string; role: string; title: string; message: string; kind: string; link: string; extra?: Record<string, unknown> };

/** アプリ内通知をまとめて書き、端末通知を応答の後に送る。本人が通知をオフにしていれば送らない。 */
async function deliver(notices: Notice[], profiles: Map<string, FirebaseFirestore.DocumentData>, pushKind: string) {
  const db = adminDb();
  let batch = db.batch();
  let pending = 0;
  const pushByMessage = new Map<string, { ids: string[]; title: string; body: string; link: string }>();
  for (const notice of notices) {
    const profile = profiles.get(notice.userId) || {};
    if (!userAllows(profile, 'in_app', notice.kind)) continue;
    batch.set(db.collection('user_notifications').doc(notice.id), {
      user_id: notice.userId,
      role: notice.role,
      title: notice.title,
      message: notice.message,
      kind: notice.kind,
      link: notice.link,
      read: false,
      ...(notice.extra || {}),
      created_at: FieldValue.serverTimestamp(),
    }, { merge: true });
    pending += 1;
    if (pending % 400 === 0) { await batch.commit(); batch = db.batch(); }
    if (userAllows(profile, 'push', notice.kind)) {
      const key = `${notice.title}\u0000${notice.link}`;
      const group = pushByMessage.get(key) || { ids: [], title: notice.title, body: notice.message.slice(0, 90), link: notice.link };
      group.ids.push(notice.userId);
      pushByMessage.set(key, group);
    }
  }
  if (pending % 400) await batch.commit();
  pushByMessage.forEach(group => queuePushToUsers(group.ids, { title: group.title, body: group.body, link: group.link }, { kind: pushKind }));
  return pending;
}

/** 授業開始からこの分数が過ぎたら、その時限の未参加を知らせる。 */
export const MISSED_CLASS_DELAY_MINUTES = 10;
const RUNS_COLLECTION = 'auto_notification_runs';

type MissedEntry = { student_id: string; name: string; school: string; period: number; label: string };

/** 時限の開始時刻（管理画面の授業ボタン設定）から10分たった時限。 */
export function dueMissedClassPeriods(settings: { period1_start: string; period2_start: string }, today: string, now: Date) {
  return ([1, 2] as const).filter(period => {
    const start = period === 1 ? settings.period1_start : settings.period2_start;
    const at = new Date(`${today}T${start}:00+09:00`).getTime() + MISSED_CLASS_DELAY_MINUTES * 60_000;
    return Number.isFinite(at) && at <= now.getTime();
  });
}

/**
 * 授業の未参加：各時限の開始から10分たっても、受講登録している授業に欠席連絡なしで参加していない生徒を、
 * 本人と保護者へ知らせる。時限ごとに1日1回だけ処理する（何度呼ばれても重ならない）。
 * その日の最後の時限まで処理したら、校舎の管理者へ未参加のまとめを送る。
 */
export async function runMissedClassNotifications(options: { today?: string; now?: Date; dryRun?: boolean } = {}) {
  const settings = await getNotificationSettings();
  const now = options.now || new Date();
  const today = options.today || jstDateKey(now);
  if ((!settings.missed_class_enabled && !settings.missed_class_summary_enabled) || !settings.in_app_enabled) return { skipped: 'disabled' as const };
  const db = adminDb();
  const masters = await loadStudentClassMasters();
  const classSettings = normalizeClassButtonSettings(masters.classButtonSettingsData || {});
  const due = dueMissedClassPeriods(classSettings, today, now);
  const runRef = db.collection(RUNS_COLLECTION).doc(`missed_class_${today}`);
  const run = (await runRef.get()).data() || {};
  const processed = new Set<number>((Array.isArray(run.processed_periods) ? run.processed_periods : []).map(Number));
  const periods = options.dryRun ? due : due.filter(period => !processed.has(period));
  const allPeriodsDone = [1, 2].every(period => processed.has(period) || periods.includes(period as 1 | 2));

  let missed: MissedEntry[] = [];
  let notified = 0;
  let students = 0;
  if (periods.length) {
    // 受講登録のある生徒だけを対象にする（全生徒は読まない）。
    const registrationSnap = await db.collection('course_registrations').select('student_id', 'status').limit(5000).get();
    const studentIds = Array.from(new Set(registrationSnap.docs
      .filter(doc => isActiveRegistration(doc.data()))
      .map(doc => clean(doc.data().student_id))
      .filter(Boolean)));
    students = studentIds.length;
    const profiles = new Map<string, FirebaseFirestore.DocumentData>();
    for (let index = 0; index < studentIds.length; index += 100) {
      const snaps = await db.getAll(...studentIds.slice(index, index + 100).map(id => db.collection('users').doc(id)));
      snaps.forEach(snap => { if (snap.exists) profiles.set(snap.id, snap.data() || {}); });
    }
    // 今日の講師配置から「どの授業が何限か」を求め、参加記録（授業ごと）と照らし合わせる。
    const shiftSnap = await db.collection('shift_assignments').where('target_date', '==', today).select('period', 'target_period', 'time_period', 'class_period', 'period_number', 'lesson_period', 'slot', 'time_slot', 'note', 'target_grade', 'grade', 'target_detail_subject', 'detail_subject').limit(2000).get();
    const periodOfShift = new Map(shiftSnap.docs.map(doc => [doc.id, periodFromShift({ id: doc.id, ...doc.data() })]));
    const attendanceSnap = await db.collection('attendance').where('target_date', '==', today).select('user_id', 'student_id', 'participations').limit(5000).get();
    const attended = new Set<string>();
    attendanceSnap.docs.forEach(doc => {
      const data = doc.data();
      const ids = [clean(data.user_id), clean(data.student_id)].filter(Boolean);
      const parts = Array.isArray(data.participations) ? data.participations : [];
      const knownPeriods = parts.map((part: any) => periodOfShift.get(clean(part?.class_id))).filter((value: unknown): value is number => value === 1 || value === 2);
      // 何限か分からない参加（古い記録など）は、その日のどの時限も参加扱いにして、誤って知らせない。
      const periodsJoined = knownPeriods.length === parts.length && parts.length > 0 ? knownPeriods : [1, 2];
      ids.forEach(id => periodsJoined.forEach(period => attended.add(`${id}_${period}`)));
    });

    for (const studentId of studentIds) {
      const profile = profiles.get(studentId);
      if (!isActiveUser(profile) || clean(profile!.role) !== 'student') continue;
      if (periods.every(period => attended.has(`${studentId}_${period}`))) continue;
      // 時間割と同じ判定（欠席連絡・振替・休講を反映した今日の授業）。
      const timetable = await buildStudentTimetable({ id: studentId, profile }, { audience: 'parent', today }).catch(error => {
        console.warn('[missed-class] timetable failed', studentId, error?.message);
        return null;
      });
      (timetable?.lessons || [])
        .filter(lesson => lesson.date === today && lesson.status === 'scheduled' && periods.includes(lesson.period as 1 | 2) && !attended.has(`${studentId}_${lesson.period}`))
        .forEach(lesson => missed.push({
          student_id: studentId,
          name: clean(profile!.student_name || profile!.name) || '生徒',
          school: clean(profile!.school_id || profile!.school_code || profile!.school),
          period: lesson.period,
          label: lesson.label,
        }));
    }

    const parentIds = Array.from(new Set(missed.flatMap(item => linkedParentIds(profiles.get(item.student_id) || {}))));
    for (let index = 0; index < parentIds.length; index += 100) {
      const snaps = await db.getAll(...parentIds.slice(index, index + 100).map(id => db.collection('users').doc(id)));
      snaps.forEach(snap => { if (snap.exists) profiles.set(snap.id, snap.data() || {}); });
    }
    const notices: Notice[] = [];
    if (settings.missed_class_enabled) missed.forEach(item => {
      const extra = { student_id: item.student_id, student_name: item.name, target_date: today, period: item.period };
      const lessonText = `${dateLabel(today)}の${item.period}限「${item.label}」`;
      notices.push({
        id: `missed_class_${item.student_id}_${today}_p${item.period}`,
        userId: item.student_id, role: 'student', kind: 'attendance', link: '/student/absence',
        title: '授業に参加できていません',
        message: `${lessonText}が始まっていますが、参加した記録がありません。これから参加する場合は、ホームの授業ボタンから入ってください。休む場合は「欠席・遅刻連絡」から連絡しましょう。`,
        extra,
      });
      linkedParentIds(profiles.get(item.student_id) || {}).forEach(parentId => {
        if (!isActiveUser(profiles.get(parentId))) return;
        notices.push({
          id: `missed_class_${item.student_id}_${today}_p${item.period}_parent_${parentId}`,
          userId: parentId, role: 'parent', kind: 'attendance', link: '/parent/absence',
          title: '授業への参加が確認できていません',
          message: `${item.name}さんの${lessonText}が始まって${MISSED_CLASS_DELAY_MINUTES}分たちましたが、参加した記録がありません（欠席のご連絡もありません）。お休みの場合は「欠席・遅刻連絡」からご連絡いただくと、振替を選べます。`,
          extra,
        });
      });
    });
    if (options.dryRun) return { today, due, periods, students, missed: missed.length, notified: 0, would_notify: notices.length, preview: missed.slice(0, 20) };
    notified = await deliver(notices, profiles, 'attendance');
    await runRef.set({
      date: today,
      processed_periods: FieldValue.arrayUnion(...periods),
      missed: FieldValue.arrayUnion(...missed),
      updated_at: FieldValue.serverTimestamp(),
    }, { merge: true });
  } else if (options.dryRun) {
    return { today, due, periods, students: 0, missed: 0, notified: 0, would_notify: 0, preview: [] };
  }

  // その日の最後の時限まで処理したら、校舎ごとの未参加のまとめを管理者へ1回だけ送る。
  let summary = 0;
  if (settings.missed_class_summary_enabled && allPeriodsDone && !run.summary_sent) {
    const all: MissedEntry[] = [...(Array.isArray(run.missed) ? run.missed : []), ...missed];
    summary = await sendMissedClassSummary(today, all);
    await runRef.set({ summary_sent: true, summary_sent_at: FieldValue.serverTimestamp() }, { merge: true });
  }
  return { today, due, periods, students, missed: missed.length, notified, summary };
}

/** 未参加のまとめ：校舎の理社講座の管理者へ自校舎分、マスターへ全校舎分を1通ずつ。 */
async function sendMissedClassSummary(today: string, entries: MissedEntry[]) {
  const unique = new Map(entries.map(entry => [`${entry.student_id}_${entry.period}`, entry]));
  const rows = Array.from(unique.values()).sort((a, b) => a.school.localeCompare(b.school) || a.period - b.period || a.name.localeCompare(b.name, 'ja'));
  const line = (entry: MissedEntry) => `・${entry.period}限 ${entry.name}（${entry.label}）`;
  const bySchool = new Map<string, MissedEntry[]>();
  rows.forEach(entry => bySchool.set(entry.school, [...(bySchool.get(entry.school) || []), entry]));
  let sent = 0;
  let masters: Awaited<ReturnType<typeof loadSchoolStaffRecipients>> = [];
  for (const [school, list] of bySchool) {
    const recipients = await loadSchoolStaffRecipients(school || null, { audience: 'science_social' });
    masters = recipients.filter(item => item.isMaster);
    const staff = recipients.filter(item => !item.isMaster);
    if (!staff.length) continue;
    sent += await notifyStaff(staff, {
      idPrefix: `missed_class_summary_${today}_${school || 'none'}`,
      title: `今日の授業の未参加 ${list.length}件（${attendanceSchoolName(school) || '校舎未設定'}）`,
      message: [`${dateLabel(today)}に、欠席連絡なしで授業に参加しなかった生徒です。保護者・本人には通知しています。必要に応じて連絡してください。`, ...list.map(line)].join('\n'),
      kind: 'missed_class_summary',
      masterLink: '/master/school-students',
      staffLink: '/master/school-students',
      pushBody: `今日の授業の未参加が${list.length}件ありました。`,
    });
  }
  if (!rows.length) return sent;
  if (!masters.length) masters = (await loadSchoolStaffRecipients(null)).filter(item => item.isMaster);
  sent += await notifyStaff(masters, {
    idPrefix: `missed_class_summary_${today}_all`,
    title: `今日の授業の未参加 ${rows.length}件（全校舎）`,
    message: [`${dateLabel(today)}に、欠席連絡なしで授業に参加しなかった生徒です。`, ...Array.from(bySchool, ([school, list]) => [`【${attendanceSchoolName(school) || '校舎未設定'}】`, ...list.map(line)].join('\n'))].join('\n'),
    kind: 'missed_class_summary',
    masterLink: '/master/school-students',
    pushBody: `今日の授業の未参加が${rows.length}件ありました。`,
  });
  return sent;
}

/**
 * 朝の職員向けの通知（勤務記録を1回だけ読んで、2種類をまとめて判定する）。
 *  - 勤務詳細の未登録：前日分と3日前の分で、退勤したのに勤務詳細がない（専任は対象外）
 *  - 打刻忘れ：前日に出勤したまま退勤の打刻がない（打刻修正を申請中なら知らせない）
 */
export async function runWorkDetailReminders(options: { today?: string; dryRun?: boolean } = {}) {
  const settings = await getNotificationSettings();
  const detailOn = settings.work_detail_reminder_enabled && settings.in_app_enabled;
  const clockOutOn = settings.clock_out_missing_enabled && settings.in_app_enabled;
  if (!detailOn && !clockOutOn) return { skipped: 'disabled' as const };
  const today = options.today || jstDateKey();
  const yesterday = addDays(today, -1);
  const targetDates = new Set([yesterday, addDays(today, -3)]);
  const db = adminDb();
  const snap = await db.collection('work_records')
    .where('date', '>=', addDays(today, -3))
    .where('date', '<=', yesterday)
    .limit(3000).get();
  const all = snap.docs.map(doc => ({ id: doc.id, ...doc.data() } as Record<string, any> & { id: string }));
  const missingDetails = detailOn
    ? recordsMissingWorkDetails(all, today, 4).filter(record => targetDates.has(String(record.date)) && clean(record.teacher_id))
    : [];
  let missingClockOut = clockOutOn
    ? all.filter(record => String(record.date) === yesterday && clean(record.teacher_id) && record.start_time && !record.end_time
      && !['deleted', 'cancelled'].includes(clean(record.status)))
    : [];
  if (missingClockOut.length) {
    // すでに打刻修正を申請している人には知らせない。
    const pendingSnap = await db.collection('attendance_correction_requests').where('status', '==', 'pending').select('work_record_id', 'teacher_id', 'target_date').limit(500).get();
    const pending = new Set(pendingSnap.docs.flatMap(doc => [clean(doc.data().work_record_id), `${clean(doc.data().teacher_id)}_${clean(doc.data().target_date)}`]).filter(Boolean));
    missingClockOut = missingClockOut.filter(record => !pending.has(record.id) && !pending.has(`${clean(record.teacher_id)}_${record.date}`));
  }
  const teacherIds = Array.from(new Set([...missingDetails, ...missingClockOut].map(record => clean(record.teacher_id))));
  const profiles = new Map<string, FirebaseFirestore.DocumentData>();
  for (let index = 0; index < teacherIds.length; index += 100) {
    const snaps = await db.getAll(...teacherIds.slice(index, index + 100).map(id => db.collection('users').doc(id)));
    snaps.forEach(snap => { if (snap.exists) profiles.set(snap.id, snap.data() || {}); });
  }
  const profileOf = (record: Record<string, any>) => profiles.get(clean(record.teacher_id));
  const notices: Notice[] = [
    ...missingDetails
      // 専任は勤務詳細を入力しない（専任用の勤怠）ので対象外。
      .filter(record => isActiveUser(profileOf(record)) && !isDedicatedProfile(profileOf(record) || {}))
      .map(record => {
        const date = String(record.date);
        const again = date === addDays(today, -3);
        return {
          id: `work_detail_missing_${record.id}_${today}`,
          userId: clean(record.teacher_id), role: 'teacher', kind: 'attendance', link: `/teacher/attendance?detail=${encodeURIComponent(date)}`,
          title: again ? '勤務詳細が未登録です（再通知）' : '勤務詳細が未登録です',
          message: `${dateLabel(date)}の勤務の詳細（授業・事務などの内訳と交通費）がまだ登録されていません。勤怠の画面から登録してください。登録がないと承認・給与計算ができません。`,
          extra: { work_record_id: record.id, target_date: date },
        };
      }),
    ...missingClockOut
      .filter(record => isActiveUser(profileOf(record)))
      .map(record => {
        const dedicated = isDedicatedProfile(profileOf(record) || {});
        return {
          id: `clock_out_missing_${record.id}`,
          userId: clean(record.teacher_id), role: 'teacher', kind: 'attendance',
          link: dedicated ? '/teacher/attendance/dedicated' : '/teacher/attendance',
          title: '退勤の打刻がありません',
          message: `${dateLabel(String(record.date))}は出勤の打刻のあと、退勤の打刻がありません。勤怠の画面から打刻修正を申請して、退勤した時刻を登録してください。`,
          extra: { work_record_id: record.id, target_date: record.date },
        };
      }),
  ];
  if (options.dryRun) return { today, checked: snap.size, missing: missingDetails.length, clock_out_missing: missingClockOut.length, notified: 0, would_notify: notices.length };
  const notified = await deliver(notices, profiles, 'attendance');
  return { today, checked: snap.size, missing: missingDetails.length, clock_out_missing: missingClockOut.length, notified };
}

/**
 * 振替の未選択：欠席したのに振替を選んでいない生徒と保護者へ、欠席の2日後と7日後に知らせる。
 * 遅刻・取り消し済み・振替が決まっている欠席は対象外。
 */
export async function runTransferReminders(options: { today?: string; dryRun?: boolean } = {}) {
  const settings = await getNotificationSettings();
  if (!settings.transfer_reminder_enabled || !settings.in_app_enabled) return { skipped: 'disabled' as const };
  const today = options.today || jstDateKey();
  const remindDates = new Map([[addDays(today, -2), 'first'], [addDays(today, -7), 'again']]);
  const db = adminDb();
  // 日付の範囲だけで読み、種類は手元で絞る（requests(type, target_date) の複合索引を使わない）。
  const snap = await db.collection('requests')
    .where('target_date', '>=', addDays(today, -7))
    .where('target_date', '<=', addDays(today, -2))
    .limit(3000).get();
  const absences = snap.docs.map(doc => ({ id: doc.id, ...doc.data() } as Record<string, any> & { id: string })).filter(item => (
    clean(item.type) === 'absence'
    && remindDates.has(clean(item.target_date))
    && clean(item.absence_type || 'absent') !== 'late'
    && !['cancelled', 'rejected', 'replaced'].includes(clean(item.status))
    && !item.replaced_by
    && clean(item.transfer_status) !== 'registered' && !clean(item.transfer_request_id)
    && clean(item.student_id || item.user_id)
  ));
  const studentIds = Array.from(new Set(absences.map(item => clean(item.student_id || item.user_id))));
  const profiles = new Map<string, FirebaseFirestore.DocumentData>();
  for (let index = 0; index < studentIds.length; index += 100) {
    const snaps = await db.getAll(...studentIds.slice(index, index + 100).map(id => db.collection('users').doc(id)));
    snaps.forEach(snap => { if (snap.exists) profiles.set(snap.id, snap.data() || {}); });
  }
  const parentIds = Array.from(new Set(absences.flatMap(item => linkedParentIds(profiles.get(clean(item.student_id || item.user_id)) || {}, [clean(item.parent_id)].filter(Boolean)))));
  for (let index = 0; index < parentIds.length; index += 100) {
    const snaps = await db.getAll(...parentIds.slice(index, index + 100).map(id => db.collection('users').doc(id)));
    snaps.forEach(snap => { if (snap.exists) profiles.set(snap.id, snap.data() || {}); });
  }
  const notices: Notice[] = [];
  absences.forEach(item => {
    const studentId = clean(item.student_id || item.user_id);
    const profile = profiles.get(studentId);
    if (!isActiveUser(profile)) return;
    const name = clean(profile!.student_name || profile!.name || item.student_name) || '生徒';
    const date = clean(item.target_date);
    const again = remindDates.get(date) === 'again';
    const extra = { absence_request_id: item.id, student_id: studentId, target_date: date };
    notices.push({
      id: `transfer_reminder_${item.id}_${again ? 'again' : 'first'}`,
      userId: studentId, role: 'student', kind: 'attendance', link: '/student/absence',
      title: again ? '振替がまだ選ばれていません（再通知）' : '振替を選びましょう',
      message: `${dateLabel(date)}に休んだ授業の振替が、まだ決まっていません。「欠席・遅刻連絡」から振替の授業を選びましょう。録画で学習することもできます。`,
      extra,
    });
    linkedParentIds(profile!, [clean(item.parent_id)].filter(Boolean)).forEach(parentId => {
      if (!isActiveUser(profiles.get(parentId))) return;
      notices.push({
        id: `transfer_reminder_${item.id}_${again ? 'again' : 'first'}_parent_${parentId}`,
        userId: parentId, role: 'parent', kind: 'attendance', link: '/parent/absence',
        title: again ? '振替がまだ選ばれていません（再通知）' : '振替のご案内',
        message: `${name}さんが${dateLabel(date)}にお休みした授業の振替が、まだ決まっていません。「欠席・遅刻連絡」から振替の授業を選べます。`,
        extra,
      });
    });
  });
  if (options.dryRun) return { today, checked: snap.size, absences: absences.length, notified: 0, would_notify: notices.length };
  const notified = await deliver(notices, profiles, 'attendance');
  return { today, checked: snap.size, absences: absences.length, notified };
}

/** 打刻修正の結果：承認・差し戻しを申請した講師へ知らせる。失敗しても承認処理には影響させない。 */
export async function notifyCorrectionResult(input: {
  requestId: string;
  teacherId: string;
  status: 'approved' | 'rejected';
  targetDate?: string | null;
  reviewNote?: string;
}) {
  const settings = await getNotificationSettings();
  if (!settings.correction_result_enabled || !settings.in_app_enabled || !input.teacherId) return 0;
  const db = adminDb();
  const profileSnap = await db.collection('users').doc(input.teacherId).get();
  const profile = profileSnap.data() || {};
  if (!isActiveUser(profile)) return 0;
  const date = clean(input.targetDate);
  const when = /^\d{4}-\d{2}-\d{2}$/.test(date) ? `${dateLabel(date)}の` : '';
  const approved = input.status === 'approved';
  const note = clean(input.reviewNote).slice(0, 300);
  const dedicated = isDedicatedProfile(profile);
  return deliver([{
    id: `correction_result_${input.requestId}`,
    userId: input.teacherId, role: 'teacher', kind: 'attendance',
    link: dedicated ? '/teacher/attendance/dedicated' : '/teacher/attendance',
    title: approved ? '打刻修正が承認されました' : '打刻修正が差し戻されました',
    message: approved
      ? `${when}打刻修正が承認され、勤怠に反映されました。${dedicated ? '' : '勤務の詳細もあわせて確認してください。'}`
      : `${when}打刻修正が差し戻されました。${note ? `管理者からのコメント：${note}` : '内容を確認して、必要なら申請し直してください。'}`,
    extra: { correction_request_id: input.requestId, target_date: date || null },
  }], new Map([[input.teacherId, profile]]), 'attendance');
}

/**
 * 専任の時間外の手続きの案内（毎朝8時台の実行に相乗りする）。
 *  - 1〜3日：前の月の時間外報告書（D08）をまだ出していない専任へ（翌月3日が締め切り）
 *  - 20日：専任の校舎承認者へ、翌月の時間外の一括申請（D05）を25日までに入れるよう案内
 */
export async function runDedicatedReportReminders(options: { today?: string; dryRun?: boolean } = {}) {
  const settings = await getNotificationSettings();
  if (!settings.dedicated_report_reminder_enabled || !settings.in_app_enabled) return { skipped: 'disabled' as const };
  const today = options.today || jstDateKey();
  const day = Number(today.slice(8, 10));
  if (!(day >= 1 && day <= 3) && day !== 20) return { skipped: 'not-today' as const };
  const db = adminDb();
  const staffSnap = await db.collection('users').where('employment_category', '==', 'dedicated').limit(1000).get();
  const staff = staffSnap.docs.filter(doc => isActiveUser(doc.data()) && clean(doc.data().role).toLowerCase() === 'teacher' && isDedicatedProfile(doc.data() || {}));
  const profiles = new Map(staff.map(doc => [doc.id, doc.data() || {}]));
  const notices: Notice[] = [];
  if (day <= 3) {
    const previous = jstDateKey(new Date(new Date(`${today.slice(0, 7)}-01T12:00:00+09:00`).getTime() - 86_400_000)).slice(0, 7);
    const reportSnap = await db.collection('dedicated_monthly_reports').where('month', '==', previous).limit(1000).get();
    const submitted = new Set(reportSnap.docs.filter(doc => ['submitted', 'confirmed'].includes(clean(doc.data().status))).map(doc => clean(doc.data().user_id)));
    staff.filter(doc => !submitted.has(doc.id)).forEach(doc => notices.push({
      id: `dedicated_month_reminder_${doc.id}_${previous}_${today}`,
      userId: doc.id, role: 'teacher', kind: 'attendance', link: '/teacher/attendance/dedicated',
      title: `${Number(previous.slice(5))}月の時間外報告書を提出してください`,
      message: `${Number(previous.slice(5))}月の時間外勤務 実施予定・実施報告書（D08）がまだ提出されていません。専任勤怠の「勤務と時間外」から、${Number(today.slice(5, 7))}月3日までに提出してください。`,
    }));
  } else {
    const next = jstDateKey(new Date(new Date(`${today.slice(0, 7)}-28T12:00:00+09:00`).getTime() + 7 * 86_400_000)).slice(0, 7);
    staff.filter(doc => doc.data().attendance_school_manager === true).forEach(doc => notices.push({
      id: `dedicated_bulk_reminder_${doc.id}_${next}`,
      userId: doc.id, role: 'teacher', kind: 'attendance', link: '/teacher/attendance-approvals/dedicated',
      title: `${Number(next.slice(5))}月の時間外の一括申請（D05）`,
      message: `校舎の専任の${Number(next.slice(5))}月の時間外の予定を、${Number(today.slice(5, 7))}月25日までに「専任の承認」の「一括申請（D05）」から入れてください。`,
    }));
  }
  if (options.dryRun) return { today, would_notify: notices.length };
  return { today, notified: await deliver(notices, profiles, 'attendance') };
}
