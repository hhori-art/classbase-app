import { NextRequest } from 'next/server';
import { adminDb } from '@/lib/firebase-admin';
import { requireStudentEnrollment } from '@/lib/eiken/access';
import { getServerUser, jsonError } from '@/lib/server-auth';
import { fetchOfficialZoomJoinUrl } from '@/lib/zoom-meeting';
import { hasZoomPasswordToken } from '@/lib/zoom-url';

export const runtime = 'nodejs';

const timestampMillis = (value: any) => {
  if (!value) return null;
  if (typeof value.toDate === 'function') return value.toDate().getTime();
  const time = new Date(value).getTime();
  return Number.isNaN(time) ? null : time;
};

export async function POST(request: NextRequest, context: { params: { id: string } }) {
  try {
    const user = await getServerUser(request);
    const lessonRef = adminDb().collection('eiken_lessons').doc(String(context.params.id || ''));
    const lessonSnap = await lessonRef.get();
    if (!lessonSnap.exists) throw new Error('lesson-not-found');
    const lesson = lessonSnap.data() || {};
    await requireStudentEnrollment(user, String(lesson.course_id || ''));
    if (lesson.status === 'cancelled' || lesson.status === 'draft') throw new Error('lesson-not-available');

    const start = timestampMillis(lesson.start_at);
    const end = timestampMillis(lesson.end_at);
    const now = Date.now();
    const openBefore = Math.max(0, Number(lesson.join_open_before_minutes ?? 15)) * 60_000;
    const closeAfter = Math.max(0, Number(lesson.join_close_after_minutes ?? 30)) * 60_000;
    if (!start || now < start - openBefore || (end && now > end + closeAfter)) {
      throw new Error('outside-join-window');
    }

    const storedJoinUrl = String(lesson.join_url || '').trim();
    const joinUrl = hasZoomPasswordToken(storedJoinUrl)
      ? storedJoinUrl
      : await fetchOfficialZoomJoinUrl(lesson.meeting_id);
    if (!joinUrl) throw new Error('zoom-join-url-unavailable');

    if (joinUrl !== storedJoinUrl) {
      await lessonRef.set({
        join_url: joinUrl,
        join_url_updated_at: new Date(),
      }, { merge: true });
    }

    return Response.json({ ok: true, join_url: joinUrl });
  } catch (error) {
    return jsonError(error);
  }
}

