import { NextRequest } from 'next/server';
import { FieldValue } from 'firebase-admin/firestore';
import { adminDb } from '@/lib/firebase-admin';
import { getServerUser, jsonError } from '@/lib/server-auth';
import { writeLearningEvent } from '@/lib/events';

export async function POST(request: NextRequest) {
  try {
    const user = await getServerUser(request);
    const body = await request.json();
    const allowedKeys = ['email', 'line', 'in_app', 'class_start', 'homework', 'announcements', 'shift', 'student_contact'] as const;
    const suppliedKeys = allowedKeys.filter(key => Object.hasOwn(body, key));
    if (suppliedKeys.length === 0 || suppliedKeys.some(key => typeof body[key] !== 'boolean')) {
      return Response.json({ ok: false, error: 'invalid-notification-preferences' }, { status: 400 });
    }
    const preferences = Object.fromEntries(suppliedKeys.map(key => [key, body[key]])) as Record<string, boolean>;
    const updates: Record<string, unknown> = { updated_at: FieldValue.serverTimestamp() };
    for (const [key, value] of Object.entries(preferences)) updates[`notification_preferences.${key}`] = value;

    await adminDb().collection('users').doc(user.uid).set(updates, { merge: true });

    const eventId = await writeLearningEvent({
      actor_id: user.uid,
      actor_role: user.role,
      type: 'notification_preferences_updated',
      target_id: user.uid,
      target_type: 'user',
      school: user.school,
      metadata: preferences,
    });

    return Response.json({ ok: true, event_id: eventId });
  } catch (error) {
    return jsonError(error);
  }
}
