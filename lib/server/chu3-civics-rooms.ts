import 'server-only';
import { unstable_cache } from 'next/cache';
import { adminDb } from '@/lib/firebase-admin';
import { chu3SelectionsFromIds, computeCivicsRooms, type CivicsRosterEntry } from '@/lib/chu3-schedule';
import { isTestPrepShift } from '@/lib/class-button-settings';
import { collectSelectedCourseIds, periodFromShift } from '@/lib/student-course-schedule';
import { loadStudentClassMasters } from '@/lib/server/student-class-masters';
import { jstDateKey } from '@/lib/date-key';

/**
 * 中3の社会（公民）の教室の割り振りに使う名簿。中3の受講登録を読み、10分間すべての生徒で共有する。
 * 生徒ごとの授業ボタンのたびに全員の登録を読まないようにするため。
 */
export type CivicsRosterSource = Array<{ student_id: string; ids: string[] }>;

export const loadChu3CivicsRoster = unstable_cache(async (): Promise<CivicsRosterSource> => {
  const [snap, masters] = await Promise.all([
    adminDb().collection('course_registrations')
      .select('student_id', 'grade', 'registration_type', 'status', 'is_current', 'current', 'year', 'term', 'selected_course_ids', 'selected_course_keys', 'updated_at', 'created_at')
      .limit(5000)
      .get(),
    loadStudentClassMasters(),
  ]);
  const byStudent = new Map<string, any[]>();
  snap.docs.forEach(doc => {
    const data = doc.data() || {};
    if (!String(data.grade || '').normalize('NFKC').includes('3')) return;
    const studentId = String(data.student_id || '');
    if (studentId) byStudent.set(studentId, [...(byStudent.get(studentId) || []), { id: doc.id, ...data }]);
  });
  const today = jstDateKey();
  // 生徒の授業ボタンと同じ決め方（今期の有効な登録）で、選んだ講座を読む。
  return Array.from(byStudent.entries()).map(([student_id, registrations]) => ({
    student_id,
    ids: Array.from(collectSelectedCourseIds(registrations, { grade: '中3' }, masters, today).selectedIds),
  }));
}, ['chu3-civics-roster-v2'], { revalidate: 600, tags: ['course-registrations'] });

const toRoster = (source: CivicsRosterSource): CivicsRosterEntry[] =>
  source.map(item => ({ student_id: item.student_id, selections: chu3SelectionsFromIds(item.ids) }));

/** 生徒が日付ごとに入る社会の教室（1か2）を返す関数。planShifts はその日（または期間）のすべての時限の配置。 */
export function civicsRoomResolver(studentId: string, planShifts: any[], source: CivicsRosterSource) {
  const roster = toRoster(source);
  const regular = planShifts.filter(shift => !isTestPrepShift(shift));
  const cache = new Map<string, 1 | 2 | null>();
  return (dateKey: string) => {
    if (!cache.has(dateKey)) {
      const rooms = computeCivicsRooms(dateKey, regular.filter(shift => shift.target_date === dateKey), roster, periodFromShift);
      cache.set(dateKey, rooms.get(studentId) ?? null);
    }
    return cache.get(dateKey)!;
  };
}

/** 中3のときだけ名簿を読む（それ以外は読まない）。失敗しても授業ボタンは止めない（両方の教室を出す）。 */
export async function loadCivicsRosterFor(profile: any) {
  if (!String(profile?.grade || '').normalize('NFKC').includes('3')) return null;
  return loadChu3CivicsRoster().catch(error => {
    console.warn('[chu3-civics] roster unavailable', error?.message);
    return null;
  });
}
