import { NextRequest } from 'next/server';
import { FieldValue } from 'firebase-admin/firestore';
import { adminDb } from '@/lib/firebase-admin';
import { getServerUser, jsonError } from '@/lib/server-auth';
import { writeLearningEvent } from '@/lib/events';

export async function POST(request: NextRequest) {
  try {
    const user = await getServerUser(request);
    const body = await request.json();
    const preferences = {
      email: !!body.email,
      line: !!body.line,
      in_app: body.in_app !== false,
      class_start: body.class_start !== false,
      homework: body.homework !== false,
      announcements: body.announcements !== false,
    };

    await adminDb().collection('users').doc(user.uid).set({
      notification_preferences: preferences,
      updated_at: FieldValue.serverTimestamp(),
    }, { merge: true });

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

