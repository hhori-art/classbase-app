import { FieldValue } from 'firebase-admin/firestore';
import { adminDb } from '@/lib/firebase-admin';

type EventInput = {
  actor_id: string;
  actor_role?: string;
  type: string;
  target_id?: string;
  target_type?: string;
  school?: string;
  metadata?: Record<string, unknown>;
};

export async function writeLearningEvent(input: EventInput) {
  const db = adminDb();
  const now = FieldValue.serverTimestamp();
  const data = Object.fromEntries(
    Object.entries(input).filter(([, value]) => value !== undefined)
  );
  const doc = await db.collection('learning_events').add({
    ...data,
    created_at: now,
  });
  return doc.id;
}
