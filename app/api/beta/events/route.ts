import { NextRequest } from 'next/server';
import { FieldValue } from 'firebase-admin/firestore';
import { adminDb } from '@/lib/firebase-admin';
import { getServerUser, jsonError } from '@/lib/server-auth';

export const runtime = 'nodejs';

const EVENT_TYPES = new Set([
  'page_view',
  'page_leave',
  'click',
  'error',
  'visibility',
  'performance',
]);

const clean = (value: unknown, max = 240) => String(value || '').slice(0, max);
const cleanField = (value: unknown) => clean(value, 80).replace(/[.\[\]*`/]/g, '_') || 'unknown';

const cleanObject = (value: unknown, depth = 0): Record<string, unknown> => {
  if (!value || typeof value !== 'object' || Array.isArray(value) || depth > 1) return {};
  return Object.fromEntries(
    Object.entries(value as Record<string, unknown>)
      .slice(0, 30)
      .map(([key, item]) => {
        if (item && typeof item === 'object' && !Array.isArray(item)) return [clean(key, 60), cleanObject(item, depth + 1)];
        if (Array.isArray(item)) return [clean(key, 60), item.slice(0, 20).map(v => clean(v, 120))];
        if (typeof item === 'number' || typeof item === 'boolean') return [clean(key, 60), item];
        return [clean(key, 60), clean(item, 300)];
      })
  );
};

export async function POST(request: NextRequest) {
  try {
    const user = await getServerUser(request);
    const body = await request.json();
    const type = EVENT_TYPES.has(String(body.type)) ? String(body.type) : 'click';
    const path = clean(body.path, 300) || '/';
    const sessionId = clean(body.session_id, 120);
    const feature = clean(body.feature || body.target || path, 120);
    const school = clean(user.school || user.school_ids[0] || body.school, 120);
    const now = new Date();
    const dateKey = now.toISOString().slice(0, 10);
    const durationMs = Math.max(0, Math.min(1000 * 60 * 60 * 6, Number(body.duration_ms || 0)));
    const metadata = cleanObject(body.metadata);
    const db = adminDb();

    const eventRef = await db.collection('beta_test_events').add({
      type,
      actor_id: user.uid,
      actor_role: user.role,
      school,
      path,
      session_id: sessionId,
      feature,
      duration_ms: durationMs,
      user_agent: request.headers.get('user-agent') || '',
      metadata,
      created_at: FieldValue.serverTimestamp(),
    });

    const dailyRef = db.collection('beta_test_daily').doc(dateKey);
    const roleUidField = `${user.role}_uids`;
    const eventField = `events_by_type.${type}`;
    const featureField = `features.${cleanField(feature)}`;
    await dailyRef.set({
      date: dateKey,
      total_events: FieldValue.increment(1),
      total_duration_ms: FieldValue.increment(durationMs),
      active_uids: FieldValue.arrayUnion(user.uid),
      [roleUidField]: FieldValue.arrayUnion(user.uid),
      [eventField]: FieldValue.increment(1),
      [featureField]: FieldValue.increment(1),
      updated_at: FieldValue.serverTimestamp(),
    }, { merge: true });

    await db.collection('beta_user_metrics').doc(user.uid).set({
      uid: user.uid,
      role: user.role,
      school,
      name: user.profile.student_name || user.profile.name || '',
      grade: user.profile.grade || '',
      last_seen_at: FieldValue.serverTimestamp(),
      last_path: path,
      session_id: sessionId,
      event_count: FieldValue.increment(1),
      total_duration_ms: FieldValue.increment(durationMs),
      first_seen_at: FieldValue.serverTimestamp(),
    }, { merge: true });

    return Response.json({ ok: true, id: eventRef.id });
  } catch (error) {
    return jsonError(error);
  }
}
