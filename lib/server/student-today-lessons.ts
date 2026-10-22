import 'server-only';

import { jstTodayKey, lessonDayEnded } from '@/lib/lesson-deadline';
import { isTestPrepShift, normalizeClassButtonSettings } from '@/lib/class-button-settings';
import {
  collectSelectedCourseIds,
  getShiftMeetingId,
  isStudentVisibleShift,
  matchStudentLessons,
  normalizeGrade,
  periodFromShift,
  preferSheetSyncedShifts,
  type StudentClassMasters,
} from '@/lib/student-course-schedule';
import { loadStudentClassMasters } from '@/lib/server/student-class-masters';

/**
 * 今日の授業ボタン（/api/student/today-classes）と「今日の授業へ振替」（/api/student/transfer-options?scope=today_grade）が
 * 同じ取得・同じ判定を使うための共通処理。今日の講師配置は target_date == 今日 で最大80件だけ読む。
 */
export async function loadTodayLessonSources(db: FirebaseFirestore.Firestore, input: { studentId: string | null; period: number }) {
  const targetDate = jstTodayKey();
  const { studentId, period } = input;
  const [shiftSnap, registrationSnap, requestSnap, masters] = await Promise.all([
    db.collection('shift_assignments').where('target_date', '==', targetDate).limit(80).get(),
    studentId
      ? db.collection('course_registrations').where('student_id', '==', studentId).limit(50).get()
      : Promise.resolve({ docs: [] as FirebaseFirestore.QueryDocumentSnapshot[] }),
    studentId
      // 今日の振替だけを直接取る（等価条件だけなので複合インデックスは不要）。
      ? db.collection('requests')
        .where('student_id', '==', studentId)
        .where('type', '==', 'transfer')
        .where('target_date', '==', targetDate)
        .limit(20)
        .get()
      : Promise.resolve({ docs: [] as FirebaseFirestore.QueryDocumentSnapshot[] }),
    loadStudentClassMasters(),
  ]);

  const rawShifts: any[] = shiftSnap.docs
    .map(doc => ({ id: doc.id, ...doc.data() }))
    .filter(isStudentVisibleShift)
    .filter((shift: any) => !period || periodFromShift(shift) === period);
  const transferRequests: any[] = requestSnap.docs
    .map(doc => ({ id: doc.id, ...doc.data() }))
    .filter((item: any) => item.type === 'transfer')
    .filter((item: any) => item.target_date === targetDate)
    .filter((item: any) => item.status !== 'rejected' && item.status !== 'cancelled');
  return {
    targetDate,
    rawShifts,
    registrationDocs: registrationSnap.docs.map(doc => ({ id: doc.id, ...doc.data() })),
    transferRequests,
    masters,
  };
}

export const transferShiftIdOf = (item: any) => String(item.transfer_shift_id || item.target_shift_id || item.shift_assignment_id || '');

/** 受講登録・登録済みの振替から、今日その生徒が参加できる配置IDを決める。shifts は preferSheetSyncedShifts 済み。 */
export function resolveTodayEligibility(input: {
  shifts: any[];
  registrationDocs: any[];
  transferRequests: any[];
  masters: StudentClassMasters;
  profile: any;
  targetDate: string;
}) {
  const { selectedIds } = collectSelectedCourseIds(input.registrationDocs, input.profile, input.masters, input.targetDate);
  const { eligibleShiftIds, eligibleReasons, testPrepShiftIds } = matchStudentLessons({
    shifts: input.shifts,
    masters: input.masters,
    profile: input.profile,
    selectedIds,
  });
  input.transferRequests.forEach((item: any) => {
    const shiftId = transferShiftIdOf(item);
    if (shiftId) {
      eligibleShiftIds.add(shiftId);
      eligibleReasons.set(shiftId, '振替登録済み');
    }
  });
  return { eligibleShiftIds, eligibleReasons, testPrepShiftIds };
}

/** その時限の授業がもう終わっているか（日本時間・授業時刻設定の終了時刻）。 */
export function todayPeriodEnded(masters: StudentClassMasters, targetDate: string, period: number) {
  const times = normalizeClassButtonSettings(masters.classButtonSettingsData || {});
  return lessonDayEnded(targetDate, period === 1 ? times.period1_end : times.period2_end);
}

export function periodTimes(masters: StudentClassMasters, period: number) {
  const times = normalizeClassButtonSettings(masters.classButtonSettingsData || {});
  return period === 1
    ? { start: times.period1_start, end: times.period1_end }
    : { start: times.period2_start, end: times.period2_end };
}

/**
 * 「今日の同じ学年の授業へ振替」の候補になる配置か（参加できる授業はここで外さない）。
 * - 今日・指定した時限（1か2）・生徒向けの主授業（Zoomあり）
 * - 生徒と同じ学年（学年が分からない配置・生徒は対象外）
 * - 対策講座は別の申込みなので対象外
 */
export function isTodayGradeTransferShift(shift: any, input: { studentGrade: unknown; targetDate: string; period: number }) {
  const studentGrade = normalizeGrade(input.studentGrade);
  const shiftGrade = normalizeGrade(shift?.target_grade || shift?.grade);
  return Boolean(studentGrade) &&
    shiftGrade === studentGrade &&
    String(shift?.target_date || '').slice(0, 10) === input.targetDate &&
    (input.period === 1 || input.period === 2) &&
    periodFromShift(shift) === input.period &&
    isStudentVisibleShift(shift) &&
    !isTestPrepShift(shift);
}

/**
 * 今日・この時限・同じ学年で、まだ参加ボタンが出ていない授業（振替の候補）。
 * すでに参加できる授業（受講登録・振替登録済み）と、それと同じZoomの授業は外す。時限が終わっていれば空。
 */
export function todayGradeTransferCandidates(input: {
  sources: Awaited<ReturnType<typeof loadTodayLessonSources>>;
  profile: any;
  period: number;
}) {
  const { sources, profile, period } = input;
  const { targetDate, masters } = sources;
  if ((period !== 1 && period !== 2) || todayPeriodEnded(masters, targetDate, period)) return [];
  const shifts = preferSheetSyncedShifts(sources.rawShifts);
  const { eligibleShiftIds } = resolveTodayEligibility({
    shifts,
    registrationDocs: sources.registrationDocs,
    transferRequests: sources.transferRequests,
    masters,
    profile,
    targetDate,
  });
  const eligibleMeetings = new Set(shifts
    .filter((shift: any) => eligibleShiftIds.has(String(shift.id)))
    .map((shift: any) => getShiftMeetingId(shift))
    .filter(Boolean));
  const seenMeetings = new Set<string>();
  return shifts
    .filter((shift: any) => isTodayGradeTransferShift(shift, { studentGrade: profile?.grade, targetDate, period }))
    .filter((shift: any) => !eligibleShiftIds.has(String(shift.id)))
    .filter((shift: any) => {
      const meetingId = getShiftMeetingId(shift);
      if (!meetingId) return true;
      if (eligibleMeetings.has(meetingId) || seenMeetings.has(meetingId)) return false;
      seenMeetings.add(meetingId);
      return true;
    });
}
