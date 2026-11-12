import { NextRequest } from 'next/server';
import { adminDb } from '@/lib/firebase-admin';
import { getServerUser, jsonError } from '@/lib/server-auth';
import { jstDateKey } from '@/lib/date-key';
import {
  cameraOffStreak, cameraRate, isCameraOffLesson, isJudgedCameraLesson, normalizeCameraMonitorRule, type CameraLesson,
} from '@/lib/camera-time';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

const clean = (value: unknown) => String(value ?? '').trim();

/** 講師の授業の評価にあたるため、見られるのはマスターだけ。 */
function requireMaster(user: Awaited<ReturnType<typeof getServerUser>>) {
  if (user.role !== 'master') throw new Error('forbidden');
}

type Sum = { camera: number; present: number; records: number; off: number };
const emptySum = (): Sum => ({ camera: 0, present: 0, records: 0, off: 0 });

/**
 * 授業のカメラON率（毎晩 Zoom から読んだ camera_session_summaries の集計）。
 * 先生ごと・授業ごとのON率と、続けてカメラがオフの生徒。ON率は「カメラONの分 ÷ 参加していた分」で、
 * 参加が短い記録（設定の分数未満）は入れない。
 */
export async function GET(request: NextRequest) {
  try {
    const user = await getServerUser(request);
    requireMaster(user);
    const db = adminDb();
    const days = Math.min(120, Math.max(1, Number(request.nextUrl.searchParams.get('days')) || 30));
    const today = jstDateKey();
    const since = jstDateKey(new Date(Date.now() - (days - 1) * 86_400_000));
    // 続けてオフの判定は、期間に関係なく直近8週を見る。
    const streakSince = jstDateKey(new Date(Date.now() - 56 * 86_400_000));
    const [snap, missionSnap] = await Promise.all([
      db.collection('camera_session_summaries').where('target_date', '>=', since < streakSince ? since : streakSince).limit(20000).get(),
      db.collection('settings').doc('mission_control').get(),
    ]);
    const rule = normalizeCameraMonitorRule(missionSnap.data()?.camera_monitor);

    const total = emptySum();
    const teachers = new Map<string, Sum & { teacher_name: string; lessons: Set<string> }>();
    const lessons = new Map<string, Sum & { date: string; period: number; teacher_name: string; label: string }>();
    const byStudent = new Map<string, (CameraLesson & { key: string; classroom: string; grade: string })[]>();
    snap.docs.forEach(doc => {
      const data = doc.data() || {};
      const lesson: CameraLesson = { date: clean(data.target_date), camera_minutes: Number(data.camera_minutes || 0), present_minutes: Number(data.present_minutes || 0) };
      const studentId = clean(data.student_id);
      if (studentId && lesson.date >= streakSince) {
        if (!byStudent.has(studentId)) byStudent.set(studentId, []);
        byStudent.get(studentId)!.push({ ...lesson, key: `${lesson.date}_${String(data.period ?? '')}`, classroom: clean(data.classroom), grade: clean(data.grade) });
      }
      if (lesson.date < since || !isJudgedCameraLesson(lesson, rule)) return;
      const add = (sum: Sum) => {
        sum.camera += Math.min(lesson.camera_minutes, lesson.present_minutes);
        sum.present += lesson.present_minutes;
        sum.records += 1;
        if (isCameraOffLesson(lesson, rule)) sum.off += 1;
      };
      add(total);
      const teacherKey = clean(data.teacher_id) || clean(data.teacher_name) || 'unknown';
      if (!teachers.has(teacherKey)) teachers.set(teacherKey, { ...emptySum(), teacher_name: clean(data.teacher_name), lessons: new Set() });
      const teacher = teachers.get(teacherKey)!;
      add(teacher);
      teacher.lessons.add(clean(data.shift_id));
      const shiftId = clean(data.shift_id);
      if (!lessons.has(shiftId)) {
        lessons.set(shiftId, {
          ...emptySum(), date: lesson.date, period: Number(data.period || 0), teacher_name: clean(data.teacher_name),
          label: clean(data.lesson_label) || [data.grade, data.subject, data.detail_subject].map(clean).filter(Boolean).join(' '),
        });
      }
      add(lessons.get(shiftId)!);
    });

    // 続けてオフの生徒（名前は、出す生徒の分だけ読む）。
    const streaks = Array.from(byStudent.entries()).map(([studentId, records]) => {
      const sorted = records.sort((a, b) => a.key.localeCompare(b.key));
      const { streak, since: streakFrom } = cameraOffStreak(sorted, rule);
      const recent = sorted.filter(record => isJudgedCameraLesson(record, rule)).slice(-Math.max(streak, rule.streak_lessons));
      const latest = sorted[sorted.length - 1];
      return {
        student_id: studentId, streak, since: streakFrom,
        recent_rate: cameraRate(recent.reduce((sum, item) => sum + item.camera_minutes, 0), recent.reduce((sum, item) => sum + item.present_minutes, 0)),
        last_date: latest?.date || '', classroom: latest?.classroom || '', grade: latest?.grade || '',
      };
    }).filter(item => item.streak >= rule.streak_lessons).sort((a, b) => b.streak - a.streak || a.since.localeCompare(b.since)).slice(0, 300);
    const names = new Map<string, Record<string, any>>();
    for (let index = 0; index < streaks.length; index += 100) {
      const refs = streaks.slice(index, index + 100).map(item => db.collection('users').doc(item.student_id));
      if (refs.length) (await db.getAll(...refs)).forEach(item => names.set(item.id, item.data() || {}));
    }

    const rateOf = (sum: Sum) => cameraRate(sum.camera, sum.present);
    return Response.json({
      ok: true,
      days,
      since,
      today,
      rule,
      totals: { records: total.records, rate: rateOf(total), off: total.off, lessons: lessons.size, teachers: teachers.size },
      teachers: Array.from(teachers.entries()).map(([id, item]) => ({
        id, teacher_name: item.teacher_name || '講師未設定', lessons: item.lessons.size, records: item.records, off: item.off,
        camera_minutes: item.camera, present_minutes: item.present, rate: rateOf(item),
      })).sort((a, b) => (a.rate ?? 101) - (b.rate ?? 101)),
      lessons: Array.from(lessons.entries()).map(([id, item]) => ({
        id, date: item.date, period: item.period, teacher_name: item.teacher_name || '講師未設定', label: item.label,
        records: item.records, off: item.off, camera_minutes: item.camera, present_minutes: item.present, rate: rateOf(item),
      })).sort((a, b) => b.date.localeCompare(a.date) || a.period - b.period),
      streaks: streaks.map(item => {
        const profile = names.get(item.student_id) || {};
        return {
          ...item,
          student_name: clean(profile.student_name || profile.name) || '氏名未設定',
          grade: clean(profile.grade) || item.grade,
          classroom: clean(profile.classroom || profile.school) || item.classroom,
        };
      }),
    }, { headers: { 'Cache-Control': 'private, no-store' } });
  } catch (error) {
    return jsonError(error);
  }
}
