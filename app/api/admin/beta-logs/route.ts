import { NextRequest } from 'next/server';
import { FieldValue } from 'firebase-admin/firestore';
import { adminDb } from '@/lib/firebase-admin';
import { getServerUser, isAdminLike, jsonError } from '@/lib/server-auth';

export const runtime = 'nodejs';

export async function POST(request: NextRequest) {
  try {
    const actor = await getServerUser(request);
    if (!isAdminLike(actor)) throw new Error('forbidden');
    const body = await request.json();
    const event = String(body.event || 'beta_event').slice(0, 120);
    const enabled = body.enabled === undefined ? true : Boolean(body.enabled);
    const school = String(body.school_id || body.school || actor.school_ids[0] || actor.school || '');
    const metadata = typeof body.metadata === 'object' && body.metadata ? body.metadata : {};

    const ref = await adminDb().collection('beta_test_logs').add({
      event,
      enabled,
      actor_id: actor.uid,
      actor_role: actor.role,
      school,
      path: String(body.path || ''),
      user_agent: request.headers.get('user-agent') || '',
      metadata,
      created_at: FieldValue.serverTimestamp(),
    });

    return Response.json({ ok: true, id: ref.id });
  } catch (error) {
    return jsonError(error);
  }
}
