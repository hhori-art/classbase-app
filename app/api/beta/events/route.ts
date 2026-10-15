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

const MAX_EVENTS_PER_REQUEST = 25;

const eventCountFields = (events: Array<{ type: string; feature: string }>) => {
  const counts = new Map<string, number>();
  const features = new Map<string, number>();
  events.forEach(event => {
    counts.set(event.type, (counts.get(event.type) || 0) + 1);
    const feature = cleanField(event.feature);
    features.set(feature, (features.get(feature) || 0) + 1);
  });
  return { counts, features };
};

export async function POST(request: NextRequest) {
  try {
    const user = await getServerUser(request);
    const parsedBody: unknown = await request.json();
    const body = parsedBody && typeof parsedBody === 'object' && !Array.isArray(parsedBody)
      ? parsedBody as Record<string, unknown>
      : {};
    const rawEvents: unknown[] = (Array.isArray(body.events) ? body.events : [body]).slice(0, MAX_EVENTS_PER_REQUEST);
    if (rawEvents.length === 0) return Response.json({ ok: true, count: 0 });
    const school = clean(user.school || user.school_ids[0] || body.school, 120);
    const now = new Date();
    const dateKey = now.toISOString().slice(0, 10);
    const db = adminDb();
    const events = rawEvents.map(rawEvent => {
      const raw = rawEvent && typeof rawEvent === 'object' && !Array.isArray(rawEvent)
        ? rawEvent as Record<string, unknown>
        : {};
      const type = EVENT_TYPES.has(String(raw.type)) ? String(raw.type) : 'click';
      const path = clean(raw.path, 300) || '/';
      return {
        type,
        path,
        sessionId: clean(raw.session_id, 120),
        feature: clean(raw.feature || raw.target || path, 120),
        durationMs: Math.max(0, Math.min(1000 * 60 * 60 * 6, Number(raw.duration_ms || 0))),
        metadata: cleanObject(raw.metadata),
      };
    });
    const batch = db.batch();
    const eventRefs = events.map(event => {
      const eventRef = db.collection('beta_test_events').doc();
      batch.set(eventRef, {
        type: event.type,
        actor_id: user.uid,
        actor_role: user.role,
        school,
        path: event.path,
        session_id: event.sessionId,
        feature: event.feature,
        duration_ms: event.durationMs,
        user_agent: request.headers.get('user-agent') || '',
        metadata: event.metadata,
        created_at: FieldValue.serverTimestamp(),
      });
      return eventRef;
    });

    const totalDurationMs = events.reduce((sum, event) => sum + event.durationMs, 0);
    const { counts, features } = eventCountFields(events);
    const dailyRef = db.collection('beta_test_daily').doc(dateKey);
    const roleUidField = `${user.role}_uids`;
    const dailyUpdate: Record<string, unknown> = {
      date: dateKey,
      total_events: FieldValue.increment(events.length),
      total_duration_ms: FieldValue.increment(totalDurationMs),
      active_uids: FieldValue.arrayUnion(user.uid),
      [roleUidField]: FieldValue.arrayUnion(user.uid),
      updated_at: FieldValue.serverTimestamp(),
    };
    counts.forEach((count, type) => { dailyUpdate[`events_by_type.${type}`] = FieldValue.increment(count); });
    features.forEach((count, feature) => { dailyUpdate[`features.${feature}`] = FieldValue.increment(count); });
    batch.set(dailyRef, dailyUpdate, { merge: true });

    batch.set(db.collection('beta_user_metrics').doc(user.uid), {
      uid: user.uid,
      role: user.role,
      school,
      name: user.profile.student_name || user.profile.name || '',
      grade: user.profile.grade || '',
      last_seen_at: FieldValue.serverTimestamp(),
      last_path: events[events.length - 1].path,
      session_id: events[events.length - 1].sessionId,
      event_count: FieldValue.increment(events.length),
      total_duration_ms: FieldValue.increment(totalDurationMs),
      first_seen_at: FieldValue.serverTimestamp(),
    }, { merge: true });
    await batch.commit();

    return Response.json({ ok: true, id: eventRefs[0].id, count: events.length });
  } catch (error) {
    return jsonError(error);
  }
}
