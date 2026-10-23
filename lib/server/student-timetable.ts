import 'server-only';
import { civicsRoomResolver, loadCivicsRosterFor } from '@/lib/server/chu3-civics-rooms';

import { unstable_cache } from 'next/cache';
import { adminDb } from '@/lib/firebase-admin';
import { jstDateKey, weekdayFromDateKey } from '@/lib/date-key';
import { calendarScheduleKind } from '@/lib/calendar-schedule-display';
import { isTestPrepShift } from '@/lib/class-button-settings';
import { parseLegacyCourseOptionId } from '@/lib/course-registration-selection';
import { normalizeCourseText } from '@/lib/course-text';
import { loadStudentClassMasters } from '@/lib/server/student-class-masters';
import {
  collectSelectedCourseIds,
  isMainLessonShift,
  matchStudentLessons,
  periodFromShift,
  preferSheetSyncedShiftsPerDate,
} from '@/lib/student-course-schedule';
import { applyTransfersToLessons } from '@/lib/timetable-transfers';
import {
  TIMETABLE_WEEKDAYS,
  courseLabel,
  type StudentTimetable,
  type TimetableCourse,
  type TimetableLesson,
  type TimetablePeriod,
  type TimetableSlot,
  type TimetableWeekday,
} from '@/lib/timetable';

/** 時間割に出す授業の期間（今日から14日間）。 */
export const TIMETABLE_DAYS = 14;
/** 14日分の講師配置の上限（1日あたり今日の授業APIの80件×平日分を目安に上限を固定）。 */
const SHIFT_LIMIT = 800;
const SCHEDULE_LIMIT = 300;
/** 14日間の本人の振替・欠席連絡（欠席は1日1件、振替も欠席1件につき1件なので14件前後が上限）。 */
const REQUEST_LIMIT = 30;

const addDays = (dateKey: string, days: number) => {
  const date = new Date(`${dateKey}T12:00:00+09:00`);
  date.setUTCDate(date.getUTCDate() + days);
  return jstDateKey(date);
};

// キャッシュに載せない項目（参加URL・ホスト用URL・連絡先など）。時間割では使わない。
const DROPPED_SHIFT_FIELDS = new Set([
  'start_url', 'target_join_url', 'zoom_join_url', 'join_url', 'target_url', 'zoom_url', 'meeting_url', 'url',
  'target_signin_address', 'signin_address', 'target_password', 'password', 'zoom_password',
]);

const plainShift = (id: string, data: FirebaseFirestore.DocumentData) => {
  const result: Record<string, unknown> = { id };
  Object.entries(data || {}).forEach(([key, value]) => {
    if (DROPPED_SHIFT_FIELDS.has(key)) return;
    if (value === null || ['string', 'number', 'boolean'].includes(typeof value)) result[key] = value;
    else if (Array.isArray(value)) result[key] = value.filter(item => ['string', 'number', 'boolean'].includes(typeof item));
  });
  return result;
};

/** 14日分の講師配置。全生徒で共有し、5分ごとに読み直す。 */
const loadUpcomingShifts = unstable_cache(async (start: string, end: string) => {
  const snapshot = await adminDb().collection('shift_assignments')
    .where('target_date', '>=', start)
    .where('target_date', '<=', end)
    .orderBy('target_date', 'asc')
    .limit(SHIFT_LIMIT)
    .get();
  return snapshot.docs.map(doc => plainShift(doc.id, doc.data()));
}, ['student-timetable-shifts-v1'], { revalidate: 300, tags: ['student-timetable'] });

/** 期間にかかる年間予定（休み・休講の判定用）。開始日が2か月以内の予定だけを読む。 */
const loadScheduleWindow = unstable_cache(async (start: string, end: string) => {
  const snapshot = await adminDb().collection('monthly_schedules')
    .where('start_date', '>=', addDays(start, -62))
    .where('start_date', '<=', end)
    .orderBy('start_date', 'asc')
    .limit(SCHEDULE_LIMIT)
    .get();
  return snapshot.docs.map(doc => {
    const data = doc.data() || {};
    return {
      id: doc.id,
      title: String(data.title || ''),
      category: String(data.category || ''),
      audience: String(data.audience || 'all'),
      start_date: String(data.start_date || data.target_date || ''),
      end_date: String(data.end_date || data.target_date || data.start_date || ''),
      grades: Array.isArray(data.grades) ? data.grades.map(String) : [],
      school_ids: [...(Array.isArray(data.school_ids) ? data.school_ids.map(String) : []), ...(data.school_id ? [String(data.school_id)] : [])],
      archived: data.archived === true,
    };
  });
}, ['student-timetable-schedules-v1'], { revalidate: 300, tags: ['student-timetable'] });

const clean = (value: unknown) => String(value || '').normalize('NFKC').trim();

export { courseLabel };

const toWeekday = (value: unknown): TimetableWeekday | '' => {
  const day = clean(value).replace(/曜日?$/, '');
  return (TIMETABLE_WEEKDAYS as readonly string[]).includes(day) ? day as TimetableWeekday : '';
};
const toPeriod = (value: unknown): TimetablePeriod | 0 => {
  const match = clean(value).match(/[12]/);
  return match ? Number(match[0]) as TimetablePeriod : 0;
};

const courseKey = (subject: string, course: string) => normalizeCourseText(`${subject}_${course}`);

/** 安定キー course_{学年}_{教科}_{講座}_{曜日}_{時限} を曜日・時限つきの講座にする。 */
function parseStableCourseKey(value: string) {
  if (!value.startsWith('course_')) return null;
  const parts = value.slice('course_'.length).split('_');
  if (parts.length < 5) return null;
  const day = toWeekday(parts[parts.length - 2]);
  const period = toPeriod(parts[parts.length - 1]);
  const subject = parts[1];
  const course = parts.slice(2, -2).join('_');
  if (!day || !period || !subject || !course) return null;
  return { day, period, subject, course };
}

type ScheduleRow = Awaited<ReturnType<typeof loadScheduleWindow>>[number];

const studentSchools = (profile: any) => new Set([
  profile?.school, profile?.school_id, profile?.school_code, profile?.school_name,
  ...(Array.isArray(profile?.school_ids) ? profile.school_ids : []),
].map(clean).filter(Boolean));

function closedScheduleFor(rows: ScheduleRow[], profile: any, audience: 'student' | 'parent') {
  const grade = clean(profile?.grade);
  const schools = studentSchools(profile);
  const allowedAudiences = audience === 'parent' ? ['all', 'student_parent', 'parent'] : ['all', 'student_parent', 'student'];
  const closed = rows.filter(row => (
    !row.archived &&
    row.category !== 'curriculum' &&
    allowedAudiences.includes(row.audience) &&
    (row.grades.length === 0 || (grade && row.grades.includes(grade))) &&
    (row.school_ids.length === 0 || row.school_ids.some(school => schools.has(clean(school)))) &&
    calendarScheduleKind(row) === 'closed'
  ));
  return (date: string) => closed.find(row => row.start_date <= date && (row.end_date || row.start_date) >= date) || null;
}

/**
 * 本人の振替・欠席連絡のうち、対象日が期間内のもの（生徒ごとに違うのでキャッシュしない）。
 * 索引 requests(user_id, type, target_date desc) を使う。読めなくても時間割は出す。
 */
const loadStudentRequests = (studentId: string, type: 'transfer' | 'absence', start: string, end: string) =>
  adminDb().collection('requests')
    .where('user_id', '==', studentId)
    .where('type', '==', type)
    .where('target_date', '>=', start)
    .where('target_date', '<=', end)
    .orderBy('target_date', 'desc')
    .limit(REQUEST_LIMIT)
    .get()
    .then(snapshot => snapshot.docs.map(doc => ({ ...doc.data(), id: doc.id })))
    .catch(error => {
      console.warn('[student-timetable] requests unavailable', type, error);
      return [] as Array<Record<string, any> & { id: string }>;
    });

/**
 * 生徒の時間割：毎週の曜日×1限/2限と、今日から14日間の授業（休講つき）。
 * 受講登録と講師配置の照合は今日の授業ボタンと同じ matchStudentLessons を使う。
 */
export async function buildStudentTimetable(student: { id: string; profile: any }, options: { audience?: 'student' | 'parent'; today?: string } = {}): Promise<StudentTimetable> {
  const today = options.today || jstDateKey();
  const end = addDays(today, TIMETABLE_DAYS - 1);
  const [rawShifts, registrationSnap, masters, scheduleRows, transfers, absences] = await Promise.all([
    loadUpcomingShifts(today, end),
    adminDb().collection('course_registrations').where('student_id', '==', student.id).limit(50).get(),
    loadStudentClassMasters(),
    loadScheduleWindow(today, end).catch(error => {
      console.warn('[student-timetable] schedule window unavailable', error);
      return [] as ScheduleRow[];
    }),
    loadStudentRequests(student.id, 'transfer', today, end),
    loadStudentRequests(student.id, 'absence', today, end),
  ]);

  const mainShifts = rawShifts.filter(isMainLessonShift) as any[];
  const shifts = preferSheetSyncedShiftsPerDate(mainShifts);
  const { selectedIds } = collectSelectedCourseIds(
    registrationSnap.docs.map(doc => ({ id: doc.id, ...doc.data() })),
    student.profile,
    masters,
    today,
  );
  const civicsRoster = await loadCivicsRosterFor(student.profile);
  const match = matchStudentLessons({
    shifts,
    masters,
    profile: student.profile,
    selectedIds,
    civicsRoomFor: civicsRoster ? civicsRoomResolver(student.id, shifts, civicsRoster) : undefined,
  });
  const settings = match.classButtonSettings;
  const periods: StudentTimetable['periods'] = {
    1: { start: settings.period1_start, end: settings.period1_end },
    2: { start: settings.period2_start, end: settings.period2_end },
  };

  // --- 毎週の時間割 ---
  const slots = new Map<string, TimetableSlot>();
  const addCourse = (day: TimetableWeekday | '', period: TimetablePeriod | 0, subject: string, course: string) => {
    if (!day || !period) return;
    const slotKey = `${day}_${period}`;
    if (!slots.has(slotKey)) slots.set(slotKey, { day, period, courses: [] });
    const slot = slots.get(slotKey)!;
    const key = courseKey(subject, course);
    if (slot.courses.some(item => item.key === key)) return;
    slot.courses.push({ key, label: courseLabel(subject, course), subject: clean(subject), course_name: clean(course) } satisfies TimetableCourse);
  };
  match.selectedOptions
    .filter(option => match.regularOptions.includes(option))
    .forEach(option => addCourse(
      toWeekday(option.resolved_day || option.day || option.day_of_week),
      toPeriod(option.resolved_slot || option.slot || option.time_slot || option.period),
      String(option.subject || ''),
      String(option.course_name || option.title || ''),
    ));
  // 14日間に配置がない講座も、登録のキー（曜日・時限入り）から時間割に出す。
  // 同じ曜日・時限に講座が見つかっている枠は、表記ゆれで重複させないよう補わない。
  const filledSlots = new Set(slots.keys());
  const addFallback = (day: TimetableWeekday | '', period: TimetablePeriod | 0, subject: string, course: string) => {
    if (!filledSlots.has(`${day}_${period}`)) addCourse(day, period, subject, course);
  };
  selectedIds.forEach(id => {
    const stable = parseStableCourseKey(id);
    if (stable) return addFallback(stable.day, stable.period, stable.subject, stable.course);
    const legacy = parseLegacyCourseOptionId(id);
    if (legacy) addFallback(toWeekday(legacy.day), toPeriod(legacy.slot), legacy.subject, legacy.course);
  });

  // --- 14日間の授業 ---
  const lessonGroups = new Map<string, any[]>();
  shifts
    .filter(shift => match.eligibleShiftIds.has(String(shift.id)))
    .forEach(shift => {
      const period = periodFromShift(shift);
      if (period !== 1 && period !== 2) return;
      const key = `${shift.target_date}_${period}`;
      if (!lessonGroups.has(key)) lessonGroups.set(key, []);
      lessonGroups.get(key)!.push(shift);
    });
  const lessons: TimetableLesson[] = [];
  lessonGroups.forEach((group, key) => {
    const first = group[0];
    const period = periodFromShift(first) as TimetablePeriod;
    const labels = Array.from(new Set(group.map(shift => courseLabel(shift.target_subject || shift.subject, shift.target_detail_subject || shift.detail_subject))));
    const units = Array.from(new Set(group.map(shift => clean(shift.unit)).filter(Boolean)));
    lessons.push({
      id: key,
      date: String(first.target_date),
      weekday: weekdayFromDateKey(first.target_date),
      period,
      start: periods[period].start,
      end: periods[period].end,
      label: labels.join(' / '),
      unit: units.join(' / '),
      status: 'scheduled',
      note: '',
      kind: group.every(shift => match.testPrepShiftIds.has(String(shift.id)) || isTestPrepShift(shift)) ? 'test_prep' : 'regular',
    });
  });

  // 毎週の授業がある曜日なのに配置が無い日は、休講（年間予定のお休み・配置済みの日）か未定として出す。
  const closedOn = closedScheduleFor(scheduleRows, student.profile, options.audience || 'student');
  const datesWithPlacements = new Set(mainShifts.map(shift => String(shift.target_date || '')));
  const lastPlacementDate = Array.from(datesWithPlacements).sort().at(-1) || '';
  for (let offset = 0; offset < TIMETABLE_DAYS; offset += 1) {
    const date = addDays(today, offset);
    const weekday = weekdayFromDateKey(date);
    slots.forEach(slot => {
      if (slot.day !== weekday || lessonGroups.has(`${date}_${slot.period}`)) return;
      const closed = closedOn(date);
      const placed = Boolean(lastPlacementDate && date <= lastPlacementDate);
      lessons.push({
        id: `${date}_${slot.period}`,
        date,
        weekday,
        period: slot.period,
        start: periods[slot.period].start,
        end: periods[slot.period].end,
        label: slot.courses.map(course => course.label).join(' / '),
        unit: '',
        status: closed || placed ? 'cancelled' : 'tentative',
        note: closed ? closed.title || 'お休み' : placed ? '' : '予定を準備中',
        kind: 'regular',
      });
    });
  }

  // 確定した振替を「振替」として加え、もとの欠席日は「欠席（振替あり）」にする。
  const shiftById = new Map(rawShifts.map(shift => [String(shift.id), shift]));
  const timetableLessons = applyTransfersToLessons(lessons, {
    range: { start: today, end },
    periods,
    transfers,
    absences,
    periodForShiftId: shiftId => {
      const shift = shiftById.get(shiftId);
      return shift ? periodFromShift(shift as any) : null;
    },
  });
  const weekly = Array.from(slots.values()).sort((a, b) => (
    TIMETABLE_WEEKDAYS.indexOf(a.day) - TIMETABLE_WEEKDAYS.indexOf(b.day) || a.period - b.period
  ));

  return {
    today,
    range: { start: today, end },
    periods,
    weekly,
    lessons: timetableLessons,
    has_registration: selectedIds.size > 0,
  };
}
