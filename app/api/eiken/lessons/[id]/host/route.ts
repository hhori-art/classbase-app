import { NextRequest } from 'next/server';
import { adminDb } from '@/lib/firebase-admin';
import { canManageEikenCourse } from '@/lib/eiken/access';
import { getZoomServerAccessToken } from '@/lib/zoom-meeting';
import { getServerUser, jsonError } from '@/lib/server-auth';
import { normalizeZoomMeetingId } from '@/lib/zoom-url';

export const runtime = 'nodejs';

export async function POST(request: NextRequest, context: { params: { id: string } }) {
  try {
    const user = await getServerUser(request);
    if (!['teacher', 'admin', 'master'].includes(user.role)) throw new Error('forbidden');
    const lessonSnap = await adminDb().collection('eiken_lessons').doc(String(context.params.id || '')).get();
    if (!lessonSnap.exists) throw new Error('lesson-not-found');
    const lesson = lessonSnap.data() || {};
    if (!(await canManageEikenCourse(user, String(lesson.course_id || '')))) throw new Error('forbidden');
    const meetingId = normalizeZoomMeetingId(lesson.meeting_id);
    if (!meetingId) throw new Error('meeting-id-not-configured');

    const token = await getZoomServerAccessToken();
    const response = await fetch(`https://api.zoom.us/v2/meetings/${meetingId}`, {
      headers: { Authorization: `Bearer ${token}` },
      cache: 'no-store',
    });
    const data = await response.json().catch(() => ({}));
    if (!response.ok || !data.start_url) throw new Error('zoom-host-url-unavailable');
    return Response.json({ ok: true, start_url: String(data.start_url) });
  } catch (error) {
    return jsonError(error);
  }
}

