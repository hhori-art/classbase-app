import 'server-only';
import { adminDb } from '@/lib/firebase-admin';
import { jstDateKey } from '@/lib/date-key';
import { attendanceSchoolName, resolveAttendanceSchoolCode } from '@/lib/attendance-schools';
import { isActiveRegistration, periodFromShift } from '@/lib/student-course-schedule';
import { buildStudentTimetable } from '@/lib/server/student-timetable';
import { sendEmail } from '@/lib/server/notify-channels';
import { BETA_REPORT_SCHOOL_CODES, type BetaSchoolStats, formatBetaReport, isBetaReportPeriod } from '@/lib/beta-school-report';

const INACTIVE = ['suspended', 'withdrawn', 'archived', 'cancelled', 'inactive'];
const clean = (value: unknown) => String(value ?? '').trim();
const isActiveUser = (data: FirebaseFirestore.DocumentData | undefined) =>
  Boolean(data) && !INACTIVE.some(status => data!.account_status === status || data!.status === status);
const addDays = (date: string, days: number) => jstDateKey(new Date(new Date(`${date}T12:00:00+09:00`).getTime() + days * 86_400_000));

/** レポートの宛先（Vercel の環境変数 BETA_REPORT_EMAILS、カンマ区切り）。 */
export function betaReportEmails() {
  return Array.from(new Set(String(process.env.BETA_REPORT_EMAILS || '')
    .split(/[,\s]+/).map(value => value.trim().toLowerCase())
    .filter(value => /^[^@\s]+@[^@\s]+\.[^@\s]+$/.test(value)))).slice(0, 10);
}

async function getAllDocs(db: FirebaseFirestore.Firestore, refs: FirebaseFirestore.DocumentReference[]) {
  const snaps: FirebaseFirestore.DocumentSnapshot[] = [];
  for (let index = 0; index < refs.length; index += 200) {
    if (refs.slice(index, index + 200).length) snaps.push(...await db.getAll(...refs.slice(index, index + 200)));
  }
  return snaps;
}

/** 校舎の在籍生徒（school_id / school に番号・校舎名のどちらが入っていても拾う）。 */
async function loadSchoolStudents(db: FirebaseFirestore.Firestore, code: string) {
  const aliases = Array.from(new Set([code, attendanceSchoolName(code)].filter(Boolean)));
  const snaps = await Promise.all(aliases.flatMap(alias => [
    db.collection('users').where('role', '==', 'student').where('school_id', '==', alias).limit(1000).get(),
    db.collection('users').where('role', '==', 'student').where('school', '==', alias).limit(1000).get(),
  ]));
  const docs = new Map<string, FirebaseFirestore.DocumentData>();
  snaps.flatMap(snap => snap.docs).forEach(doc => { if (isActiveUser(doc.data())) docs.set(doc.id, doc.data()); });
  return docs;
}

/** 対象日（日本時間）の集計。生徒・保護者の名前は使わず、人数だけを数える。 */
export async function collectBetaSchoolStats(targetDate: string) {
  const db = adminDb();
  const weekDates = Array.from({ length: 7 }, (_, index) => addDays(targetDate, -index));

  // 対象日の講師配置から「どの授業が何限か」を求め、参加記録（授業ごと）と照らし合わせる（未参加の通知と同じ判定）。
  const [shiftSnap, attendanceSnap] = await Promise.all([
    db.collection('shift_assignments').where('target_date', '==', targetDate).select('period', 'target_period', 'time_period', 'class_period', 'period_number', 'lesson_period', 'slot', 'time_slot', 'note', 'target_grade', 'grade', 'target_detail_subject', 'detail_subject').limit(2000).get(),
    db.collection('attendance').where('target_date', '==', targetDate).select('user_id', 'student_id', 'participations').limit(5000).get(),
  ]);
  const periodOfShift = new Map(shiftSnap.docs.map(doc => [doc.id, periodFromShift({ id: doc.id, ...doc.data() })]));
  const attended = new Set<string>();
  attendanceSnap.docs.forEach(doc => {
    const data = doc.data();
    const parts = Array.isArray(data.participations) ? data.participations : [];
    if (!parts.length) return;
    const knownPeriods = parts.map((part: any) => periodOfShift.get(clean(part?.class_id))).filter((value: unknown): value is number => value === 1 || value === 2);
    const periodsJoined = knownPeriods.length === parts.length ? knownPeriods : [1, 2];
    [clean(data.user_id), clean(data.student_id)].filter(Boolean)
      .forEach(id => periodsJoined.forEach(period => attended.add(`${id}_${period}`)));
  });

  const rows: BetaSchoolStats[] = [];
  for (const code of BETA_REPORT_SCHOOL_CODES) {
    const students = await loadSchoolStudents(db, code);
    const studentIds = Array.from(students.keys());

    // ログイン：ログインボーナスの記録（生徒×日の文書ID）を7日分だけ読む。
    const loginSnaps = await getAllDocs(db, studentIds.flatMap(id => weekDates.map(date => db.collection('coin_transactions').doc(`${id}_daily_login_${date}`))));
    const loggedDay = new Set<string>();
    const logged7 = new Set<string>();
    loginSnaps.forEach(snap => {
      if (!snap.exists) return;
      const userId = clean(snap.data()?.user_id);
      logged7.add(userId);
      if (snap.id.endsWith(`_daily_login_${targetDate}`)) loggedDay.add(userId);
    });

    const registrationSnaps = await Promise.all(studentIds.map(id => db.collection('course_registrations').where('student_id', '==', id).select('status').limit(20).get()));
    const registeredIds = new Set(studentIds.filter((_, index) => registrationSnaps[index].docs.some(doc => isActiveRegistration(doc.data()))));
    const registered = registeredIds.size;

    // 授業：時間割と同じ判定（欠席連絡・振替・休講を反映）で、対象日の授業ごとに参加の記録を見る。
    let lessons = 0;
    let joined = 0;
    let absent = 0;
    // 受講登録のない生徒には授業がないので組み立てない。60秒の制限に収まるよう、16人ずつ並べる。
    const entries = Array.from(students.entries()).filter(([id]) => registeredIds.has(id));
    // 最初の1人を先に組み立て、講師配置・年間予定の共有キャッシュ（5分）を温めてから並べる。
    for (let index = 0; index < entries.length; index = index ? index + 16 : 1) {
      await Promise.all(entries.slice(index, index ? index + 16 : 1).map(async ([studentId, profile]) => {
        const timetable = await buildStudentTimetable({ id: studentId, profile }, { audience: 'parent', today: targetDate }).catch(error => {
          console.warn('[beta-report] timetable failed', studentId, error?.message);
          return null;
        });
        (timetable?.lessons || []).filter(lesson => lesson.date === targetDate).forEach(lesson => {
          if (lesson.status === 'absent') absent += 1;
          if (lesson.status !== 'scheduled') return;
          lessons += 1;
          if (attended.has(`${studentId}_${lesson.period}`)) joined += 1;
        });
      }));
    }


    rows.push({
      code,
      name: attendanceSchoolName(resolveAttendanceSchoolCode(code) || code) || code,
      students: studentIds.length,
      registered,
      loginDay: loggedDay.size,
      login7: logged7.size,
      lessons,
      joined,
      absent,
    });
  }
  return rows;
}

/** 毎朝、前の日（日本時間）のレポートを送る。BETA_REPORT_UNTIL を過ぎたら何もしない。 */
export async function runBetaSchoolReport(options: { now?: Date; dryRun?: boolean } = {}) {
  const now = options.now || new Date();
  const today = jstDateKey(now);
  if (!isBetaReportPeriod(today)) return { skipped: 'expired' as const };
  const targetDate = addDays(today, -1);
  const rows = await collectBetaSchoolStats(targetDate);
  const appUrl = clean(process.env.NEXT_PUBLIC_APP_URL) || 'https://classbase-app.vercel.app';
  const { subject, body } = formatBetaReport(targetDate, rows, { appUrl });
  if (options.dryRun) return { target_date: targetDate, rows, subject, body, sent: 0 };

  const emails = betaReportEmails();
  if (!emails.length) return { target_date: targetDate, rows, sent: 0, error: 'BETA_REPORT_EMAILS is not set' };
  const results = await Promise.all(emails.map(email => sendEmail(email, subject, body, `beta-report-${targetDate}-${email}`)));
  const errors = results.filter(item => !item.ok).map(item => item.error || 'unknown');
  if (errors.length) console.error('[beta-report] email failed', errors);
  return { target_date: targetDate, rows, sent: results.length - errors.length, failed: errors.length, errors };
}
