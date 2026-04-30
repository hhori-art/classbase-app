import { NextRequest } from 'next/server';
import { clearLineUserId } from '@/lib/line';
import { getServerUser, jsonError } from '@/lib/server-auth';
import { writeLearningEvent } from '@/lib/events';

export async function POST(request: NextRequest) {
  try {
    const user = await getServerUser(request);
    const body = await request.json().catch(() => ({}));
    const action = String(body.action || '');

    if (action !== 'unlink') {
      return Response.json({ ok: false, error: 'unsupported-action' }, { status: 400 });
    }

    await clearLineUserId(user.uid);
    const eventId = await writeLearningEvent({
      actor_id: user.uid,
      actor_role: user.role,
      type: 'line_unlinked',
      target_id: user.uid,
      target_type: 'user',
      school: user.school,
      metadata: {},
    });

    return Response.json({ ok: true, event_id: eventId });
  } catch (error) {
    return jsonError(error);
  }
}
