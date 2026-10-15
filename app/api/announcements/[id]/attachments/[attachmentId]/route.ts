import { NextRequest } from 'next/server';
import { adminBucket, adminDb } from '@/lib/firebase-admin';
import { getServerUser, jsonError } from '@/lib/server-auth';
import { canReadAnnouncement, cleanAnnouncementList, serializeAnnouncement } from '@/lib/server/announcement-access';

export const runtime = 'nodejs';

export async function GET(request: NextRequest, { params }: { params: Promise<{ id: string; attachmentId: string }> }) {
  try {
    const user = await getServerUser(request);
    const { id, attachmentId } = await params;
    const db = adminDb();
    const [snapshot] = await db.getAll(db.collection('announcements').doc(id));
    if (!snapshot.exists) return new Response('Not found', { status: 404 });
    let viewer: any = user;
    if (['parent', 'guardian'].includes(user.role)) {
      const ids = cleanAnnouncementList(user.profile?.student_ids).slice(0, 20);
      const students = ids.length ? await db.getAll(...ids.map(studentId => db.collection('users').doc(studentId))) : [];
      viewer = { ...user,
        linked_schools: students.flatMap(student => { const data = student.data() || {}; return [data.school_id, data.school_code, data.school].filter(Boolean); }),
        linked_grades: students.map(student => student.data()?.grade).filter(Boolean),
      };
    }
    const announcement: any = serializeAnnouncement(snapshot);
    if (!canReadAnnouncement(viewer, announcement)) throw new Error('forbidden');
    const attachment = (Array.isArray(announcement.attachments) ? announcement.attachments : []).find((item: any) => item.id === attachmentId);
    if (!attachment?.path) return new Response('Not found', { status: 404 });
    const [buffer] = await adminBucket().file(attachment.path).download();
    const filename = String(attachment.name || 'attachment').replace(/["\r\n]/g, '_');
    const body = buffer.buffer.slice(buffer.byteOffset, buffer.byteOffset + buffer.byteLength) as ArrayBuffer;
    return new Response(body, { headers: { 'Content-Type': attachment.content_type || 'application/octet-stream', 'Content-Disposition': `attachment; filename*=UTF-8''${encodeURIComponent(filename)}`, 'Cache-Control': 'private, max-age=300' } });
  } catch (error) { return jsonError(error); }
}
