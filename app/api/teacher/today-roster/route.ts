import { NextRequest } from 'next/server';
import { adminDb } from '@/lib/firebase-admin';
import { getServerUser, jsonError, requireScienceSocialStaff } from '@/lib/server-auth';
import { jstDateKey } from '@/lib/date-key';
import { accessibleTeacherStudents } from '@/lib/server/teacher-student-access';
import { buildStudentTimetable } from '@/lib/server/student-timetable';

export const runtime = 'nodejs';

const MAX_STUDENTS = 200;
const CONCURRENCY = 8;
const clean = (value: unknown) => String(value ?? '').normalize('NFKC').trim();

/**
 * 当日の対応名簿（/teacher/contacts）用：名簿の生徒それぞれの「今日の授業（何限・何の授業か）」。
 * 時間割と同じ判定（受講登録・振替・休講）を使う。Zoom の入室を、その生徒の時限の授業で確かめたかを判断するために使う。
 * 担当校舎・割り当てで見られる生徒だけ。今日の分だけ返す。
 */
export async function GET(request: NextRequest) {
  try {
    const user = await getServerUser(request);
    requireScienceSocialStaff(user);
    const requested = Array.from(new Set(clean(request.nextUrl.searchParams.get('student_ids')).split(',').map(clean).filter(Boolean))).slice(0, MAX_STUDENTS);
    const today = jstDateKey();
    if (!requested.length) return Response.json({ ok: true, date: today, lessons: {} });

    const accessible = new Set((await accessibleTeacherStudents(user)).flatMap(student => [student.id, student.uid].map(clean).filter(Boolean)));
    const targetIds = requested.filter(id => accessible.has(id));
    const db = adminDb();
    const profiles = new Map<string, FirebaseFirestore.DocumentData>();
    for (let index = 0; index < targetIds.length; index += 100) {
      const snaps = await db.getAll(...targetIds.slice(index, index + 100).map(id => db.collection('users').doc(id)));
      snaps.forEach(snap => { if (snap.exists) profiles.set(snap.id, snap.data() || {}); });
    }

    const lessons: Record<string, Array<{ period: number; label: string; status: string }>> = {};
    const ids = [...profiles.keys()];
    let cursor = 0;
    await Promise.all(Array.from({ length: Math.min(CONCURRENCY, ids.length) }, async () => {
      while (cursor < ids.length) {
        const id = ids[cursor++];
        const timetable = await buildStudentTimetable({ id, profile: profiles.get(id) }, { audience: 'parent', today }).catch(error => {
          console.warn('[today-roster] timetable failed', id, error?.message);
          return null;
        });
        // 時間割を作れなかった生徒は返さない（画面では「今日の授業は不明」として扱う）。
        if (!timetable) continue;
        lessons[id] = (timetable.lessons || [])
          .filter(lesson => lesson.date === today && lesson.status !== 'cancelled')
          .map(lesson => ({ period: Number(lesson.period), label: clean(lesson.label), status: clean(lesson.status) }));
      }
    }));
    return Response.json({ ok: true, date: today, lessons });
  } catch (error) {
    return jsonError(error);
  }
}
