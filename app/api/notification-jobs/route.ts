import { NextRequest } from 'next/server';
import { FieldValue } from 'firebase-admin/firestore';
import { adminDb } from '@/lib/firebase-admin';
import { getServerUser, isAdminLike, jsonError, requireRole } from '@/lib/server-auth';
import { writeLearningEvent } from '@/lib/events';

export async function POST(request: NextRequest) {
  try {
    const user = await getServerUser(request);
    const body = await request.json();
    const isParentReportRequest =
      user.role === 'parent' &&
      String(body.target_role || 'parent') === 'parent' &&
      (body.period?.source === 'parent_dashboard' || body.source === 'parent_dashboard');

    if (!isParentReportRequest && !isAdminLike(user) && user.role !== 'teacher') requireRole(user, ['admin']);

    const targetRole = String(body.target_role || 'parent');
    const channel = String(body.channel || 'in_app');
    const title = String(body.title || 'お知らせ').slice(0, 80);
    const message = String(body.message || '').slice(0, 4000);
    const period = body.period || null;

    if (!message) return Response.json({ ok: false, error: 'message is required' }, { status: 400 });

    const jobRef = await adminDb().collection('notification_jobs').add({
      target_role: targetRole,
      channel,
      title,
      message,
      period,
      status: 'queued',
      created_by: user.uid,
      created_by_role: user.role,
      created_at: FieldValue.serverTimestamp(),
    });

    const eventId = await writeLearningEvent({
      actor_id: user.uid,
      actor_role: user.role,
      type: 'notification_job_created',
      target_id: jobRef.id,
      target_type: 'notification_job',
      school: user.school,
      metadata: { target_role: targetRole, channel, title, period },
    });

    return Response.json({ ok: true, job_id: jobRef.id, event_id: eventId });
  } catch (error) {
    return jsonError(error);
  }
}
